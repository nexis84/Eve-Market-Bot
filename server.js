const tmi = require('tmi.js');
const axios = require('axios');
const Bottleneck = require('bottleneck');
const express = require('express');

// Set up Express server for Cloud Run
const app = express();

// Set up rate limiter for external APIs (ESI, Fuzzwork, EVE Ref)
const apiLimiter = new Bottleneck({
    minTime: 500, // 500ms between ESI/external requests (2 request per second)
    maxConcurrent: 1 // Only one external request at a time
});

// Set up rate limiter for sending Twitch chat messages
const chatLimiter = new Bottleneck({
    minTime: 1500, // Limit to 1 message every 1.5 seconds (Adjust as needed for Twitch limits)
    maxConcurrent: 1
});

// Ensure OAuth Token is properly set
if (!process.env.TWITCH_OAUTH_TOKEN) {
    console.error("Missing TWITCH_OAUTH_TOKEN. Check your environment variables.");
    process.exit(1);
}

// Twitch Bot Configuration
const client = new tmi.Client({
    options: { debug: false }, // <--- DISABLED TMI.JS DEBUG LOGGING to reduce chat message logs --->
    identity: {
        username: 'Eve_twitch_market_bot',
        password: process.env.TWITCH_OAUTH_TOKEN // Ensure this includes 'chat:read' and 'chat:edit' scopes
    },
    channels: ['ne_x_is', 'contempoenterprises'] // Channels the bot should join
});

// Set a default User Agent if one is not set in the environment variables.
const USER_AGENT = process.env.USER_AGENT || 'EveTwitchMarketBot/1.1.0 (Contact: YourEmailOrDiscord)'; // Customize this

// Cache for Type IDs
const typeIDCache = new Map(); // This will now primarily be populated by eve-files.com
// Cache for Blueprint data (though less relevant with EVE Ref Industry API)
const blueprintCache = new Map(); // Still useful if we ever need raw blueprint data for other purposes

const JITA_SYSTEM_ID = 30000142; // Jita system ID (still used for non-PLEX items)
const JITA_REGION_ID = 10000002; // The Forge Region ID (still used for non-PLEX items)
const PLEX_TYPE_ID = 44992; // Correct Type ID for PLEX (Pilot's License Extension)
const GLOBAL_PLEX_REGION_ID = 19000001; // New Global PLEX Market Region ID

// New Map to store Type IDs from eve-files.com/chribba/typeid.txt
const eveFilesTypeIDMap = new Map();
let isEveFilesTypeIDMapLoaded = false;

/**
 * Loads Type IDs from eve-files.com/chribba/typeid.txt into an in-memory map.
 * This should be called once at bot startup.
 */
async function loadEveFilesTypeIDs() {
    console.log('[loadEveFilesTypeIDs] Starting to load Type IDs from eve-files.com...');
    const typeIdFileUrl = 'https://eve-files.com/chribba/typeid.txt';
    try {
        const response = await axios.get(typeIdFileUrl, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 30000 // Increased timeout for large file download
        });

        const lines = response.data.split('\n');
        lines.forEach(line => {
            const parts = line.trim().split(' ');
            if (parts.length >= 2) {
                const typeID = parseInt(parts[0], 10);
                // Rejoin parts from index 1 onwards to form the full name
                const itemName = parts.slice(1).join(' ').trim();
                if (!isNaN(typeID) && itemName) {
                    eveFilesTypeIDMap.set(itemName.toLowerCase(), typeID);
                }
            }
        });
        isEveFilesTypeIDMapLoaded = true;
        console.log(`[loadEveFilesTypeIDs] Successfully loaded ${eveFilesTypeIDMap.size} Type IDs from eve-files.com.`);
    } catch (error) {
        console.error(`[loadEveFilesTypeIDs] Error loading Type IDs from ${typeIdFileUrl}:`, error.message);
        // If loading fails, the bot will still try Fuzzwork as a fallback, but log the error.
    }
}

// --- TMI Event Listeners ---
client.on('connected', (addr, port) => {
    console.log(`* Connected to Twitch chat (${addr}:${port}). State: ${client.readyState()}`);
    // Send a test message to the first channel on connection using the chat limiter
    if (client.opts.channels && client.opts.channels.length > 0) {
        const testChannel = client.opts.channels[0]; // Test on the first channel listed
        chatLimiter.schedule(() => {
            console.log(`Attempting initial connection message to ${testChannel}`);
            return client.say(testChannel, 'Eve_twitch_market_bot connected and ready!')
                .then(() => console.log(`Sent connection confirmation to ${testChannel}`))
                .catch(err => console.error(`>>>> FAILED to send connection confirmation to ${testChannel}:`, err));
        });
    }
});

client.on('disconnected', (reason) => {
    console.error(`Twitch client disconnected: ${reason}. State: ${client.readyState()}`);
});

client.on('error', (err) => {
    console.error('>>>>>> Twitch client library error:', err);
});

// --- End TMI Event Listeners ---

// Connect the Twitch bot to the chat
// Load Type IDs before connecting the client
loadEveFilesTypeIDs().then(() => {
    client.connect()
        .then(() => {
            console.log("Twitch client connection initiated.");
        })
        .catch(error => {
            console.error(">>>>>> Twitch client failed to connect:", error);
            process.exit(1);
        });
});


// Function to safely send messages using the chat limiter
async function safeSay(channel, message) {
    return chatLimiter.schedule(() => {
        console.log(`[safeSay] Attempting to send to ${channel}: "${message.substring(0, 50)}..."`);
        return client.say(channel, message)
            .then(() => {
                console.log(`[safeSay] Message supposedly sent successfully to ${channel}.`);
            })
            .catch(err => {
                console.error(`[safeSay] >>>>> ERROR sending message to ${channel}:`, err);
            });
    });
}

/**
 * Fetches market data for a given item type ID from ESI.
 * @param {string} itemName - The name of the item.
 * @param {number} typeID - The Type ID of the item.
 * @param {string} channel - The Twitch channel to send messages to.
 * @param {number} quantity - The quantity of the item to calculate total price for.
 * @param {number} retryCount - Current retry count for API calls.
 */
async function fetchMarketData(itemName, typeID, channel, quantity = 1, retryCount = 0) {
    try {
        console.log(`[fetchMarketData] Start: Fetching market data for ${itemName} (TypeID: ${typeID}), Quantity: ${quantity}, received channel: ${channel}, Retry: ${retryCount}`);
        await fetchMarketDataFromESI(itemName, typeID, channel, quantity, retryCount); // Pass quantity
        console.log(`[fetchMarketData] End: Completed fetch attempt for ${itemName} (TypeID: ${typeID}), Quantity: ${quantity}`);
    } catch (error) {
        console.error(`[fetchMarketData] General Error caught for "${itemName}": ${error.message}, Retry: ${retryCount}`);
        await safeSay(channel, `❌ Error fetching data for "${itemName}": ${error.message} ❌`);
    }
}

/**
 * Fetches market data directly from ESI and sends a formatted message to Twitch chat.
 * @param {string} itemName - The name of the item.
 * @param {number} typeID - The Type ID of the item.
 * @param {string} channel - The Twitch channel to send messages to.
 * @param {number} quantity - The quantity of the item to calculate total price for.
 * @param {number} retryCount - Current retry count for API calls.
 */
async function fetchMarketDataFromESI(itemName, typeID, channel, quantity = 1, retryCount = 0) {
    try {
        console.log(`[fetchMarketDataFromESI] Start ESI Call: Fetching for ${itemName} (TypeID: ${typeID}), Quantity: ${quantity}, received channel: ${channel}, Retry: ${retryCount}`);
        const isPlex = (typeID === PLEX_TYPE_ID);
        console.log(`[fetchMarketDataFromESI] isPlex: ${isPlex} (TypeID: ${typeID}, PLEX_TYPE_ID: ${PLEX_TYPE_ID})`); // Added log

        // Determine which region ID to use based on whether it's PLEX or another item
        const targetRegionId = isPlex ? GLOBAL_PLEX_REGION_ID : JITA_REGION_ID;

        const sellOrdersURL = `https://esi.evetech.net/latest/markets/${targetRegionId}/orders/?datasource=tranquility&order_type=sell&type_id=${typeID}`;
        const buyOrdersURL = `https://esi.evetech.net/latest/markets/${targetRegionId}/orders/?datasource=tranquility&order_type=buy&type_id=${typeID}`;

        console.log(`[fetchMarketDataFromESI] Sell Orders URL: ${sellOrdersURL}`); // Added log
        console.log(`[fetchMarketDataFromESI] Buy Orders URL: ${buyOrdersURL}`);   // Added log

        const [sellOrdersRes, buyOrdersRes] = await Promise.all([
            apiLimiter.schedule(() => axios.get(sellOrdersURL, {
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: (status) => status >= 200 && status < 500,
                timeout: 7000
            })),
            apiLimiter.schedule(() => axios.get(buyOrdersURL, {
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: (status) => status >= 200 && status < 500,
                timeout: 7000
            }))
        ]);

        console.log(`[fetchMarketDataFromESI] ESI Response Status - Sell: ${sellOrdersRes.status}, Buy: ${buyOrdersRes.status} for ${itemName}`);
        console.log(`[fetchMarketDataFromESI] Raw Sell Orders Data (first 500 chars): ${JSON.stringify(sellOrdersRes.data).substring(0, 500)}`); // Added log
        console.log(`[fetchMarketDataFromESI] Raw Buy Orders Data (first 500 chars): ${JSON.stringify(buyOrdersRes.data).substring(0, 500)}`);   // Added log

        if (sellOrdersRes.status !== 200) {
            console.error(`[fetchMarketDataFromESI] Error fetching sell orders. HTTP Status: ${sellOrdersRes.status}, Response: ${JSON.stringify(sellOrdersRes.data)}`);
            await safeSay(channel, `❌ Error fetching sell orders for "${itemName}": HTTP ${sellOrdersRes.status}. ❌`);
            return;
        }

        if (buyOrdersRes.status !== 200) {
            console.error(`[fetchMarketDataFromESI] Error fetching buy orders. HTTP Status: ${buyOrdersRes.status}, Response: ${JSON.stringify(buyOrdersRes.data)}`);
            await safeSay(channel, `❌ Error fetching buy orders for "${itemName}": HTTP ${buyOrdersRes.status}. ❌`);
            return;
        }

        const sellOrders = sellOrdersRes.data;
        const buyOrders = buyOrdersRes.data;

        console.log(`[fetchMarketDataFromESI] Sell Orders Count: ${sellOrders.length}, Buy Orders Count: ${buyOrders.length} for ${itemName}`); // Added log

        let lowestSellOrder = null;
        let highestBuyOrder = null;

        if (isPlex) {
            // For PLEX, orders are global, so no need to filter by system_id
            lowestSellOrder = sellOrders.length > 0
                ? sellOrders.reduce((min, order) => (order.price < min.price ? order : min), sellOrders[0])
                : null;
            highestBuyOrder = buyOrders.length > 0
                ? buyOrders.reduce((max, order) => (order.price > max.price ? order : max), buyOrders[0])
                : null;
        } else {
            // For other items, filter by Jita system ID
            const jitaSellOrders = sellOrders.filter(order => order.system_id === JITA_SYSTEM_ID);
            lowestSellOrder = jitaSellOrders.length > 0
                ? jitaSellOrders.reduce((min, order) => (order.price < min.price ? order : min), jitaSellOrders[0])
                : null;
            const jitaBuyOrders = buyOrders.filter(order => order.system_id === JITA_SYSTEM_ID);
            highestBuyOrder = jitaBuyOrders.length > 0
                ? jitaBuyOrders.reduce((max, order) => (order.price > max.price ? order : min), jitaBuyOrders[0])
                : null;
        }

        let message = `${itemName}`;
        if (quantity > 1) {
            message += ` x${quantity}`;
        }
        message += ` - `;

        if (lowestSellOrder) {
            const totalSellPrice = lowestSellOrder.price * quantity; // Calculate total price
            const sellPriceFormatted = parseFloat(totalSellPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            message += `${isPlex ? 'Global Sell' : 'Jita Sell'}: ${sellPriceFormatted} ISK`;
            console.log(`[fetchMarketDataFromESI] Calculated ${isPlex ? 'Global Sell' : 'Jita Sell'} Price: ${sellPriceFormatted} for ${itemName} x${quantity}`);
        } else {
            message += `${isPlex ? 'Global Sell' : 'Jita Sell'}: (None)`;
            console.log(`[fetchMarketDataFromESI] No ${isPlex ? 'global' : 'Jita station'} sell orders for ${itemName}`);
        }

        if (highestBuyOrder) {
            const totalBuyPrice = highestBuyOrder.price * quantity; // Calculate total price
            const buyPriceFormatted = parseFloat(totalBuyPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            message += `, ${isPlex ? 'Global Buy' : 'Jita Buy'}: ${buyPriceFormatted} ISK`;
            console.log(`[fetchMarketDataFromESI] Calculated ${isPlex ? 'Global Buy' : 'Jita Buy'} Price: ${buyPriceFormatted} for ${itemName} x${quantity}`);
        } else {
            message += `, ${isPlex ? 'Global Buy' : 'Jita Buy'}: (None)`;
            console.log(`[fetchMarketDataFromESI] No ${isPlex ? 'global' : 'Jita station'} buy orders for ${itemName}`);
        }

        if (!lowestSellOrder && !highestBuyOrder) {
            await safeSay(channel, `❌ No market data found for "${itemName}" in ${isPlex ? 'the global market' : 'Jita region'}. ❌`);
            return;
        }

        await safeSay(channel, message);

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`[fetchMarketDataFromESI] Axios Error: ${error.message}, Retry: ${retryCount} for ${itemName}`, error.code === 'ECONNABORTED' ? '(Timeout)' : '');
            if (error.response) {
                if (error.response.status === 503 && retryCount < 3) {
                    const retryDelay = Math.pow(2, retryCount) * 1500;
                    console.warn(`[fetchMarketDataFromESI] ESI Temporarily Unavailable (503) for "${itemName}". Retrying in ${retryDelay / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    return await fetchMarketDataFromESI(itemName, typeID, channel, quantity, retryCount + 1); // Pass quantity on retry
                } else if (error.response.status === 503) {
                    console.error(`[fetchMarketDataFromESI] ESI Unavailable (503) for "${itemName}" after multiple retries.`);
                    await safeSay(channel, `❌ ESI Temporarily Unavailable for "${itemName}". Please try again later. ❌`);
                } else {
                    console.error(`[fetchMarketDataFromESI] ESI HTTP Error for "${itemName}". Status: ${error.response.status}, Response: ${JSON.stringify(error.response.data)}`);
                    await safeSay(channel, `❌ Error fetching market data for "${itemName}": ESI Error ${error.response.status}. ❌`);
                }
            } else {
                console.error(`[fetchMarketDataFromESI] Network/Request Error for "${itemName}".`, error.message);
                await safeSay(channel, `❌ Network error fetching data for "${itemName}". ❌`);
            }
        } else {
            console.error(`[fetchMarketDataFromESI] Non-Axios Error processing "${itemName}":`, error);
            await safeSay(channel, `❌ An internal error occurred while processing data for "${itemName}". ❌`);
        }
        return;
    }
}

/**
 * Fetches the lowest sell price for a given item from ESI (Jita or Global PLEX).
 * Used internally for blueprint cost calculation.
 * @param {number} typeID - The Type ID of the item.
 * @returns {Promise<number|null>} The lowest sell price or null if not found/error.
 */
async function getLowestSellPrice(typeID) {
    const isPlex = (typeID === PLEX_TYPE_ID);
    const targetRegionId = isPlex ? GLOBAL_PLEX_REGION_ID : JITA_REGION_ID;
    const sellOrdersURL = `https://esi.evetech.net/latest/markets/${targetRegionId}/orders/?datasource=tranquility&order_type=sell&type_id=${typeID}`;

    try {
        const sellOrdersRes = await apiLimiter.schedule(() => axios.get(sellOrdersURL, {
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: (status) => status >= 200 && status < 500,
            timeout: 5000
        }));

        if (sellOrdersRes.status !== 200) {
            console.error(`[getLowestSellPrice] Error fetching sell orders for typeID ${typeID}. Status: ${sellOrdersRes.status}`);
            return null;
        }

        const sellOrders = sellOrdersRes.data;
        if (sellOrders.length === 0) {
            return null;
        }

        let lowestSellOrder = null;
        if (isPlex) {
            lowestSellOrder = sellOrders.reduce((min, order) => (order.price < min.price ? order : min), sellOrders[0]);
        } else {
            const jitaSellOrders = sellOrders.filter(order => order.system_id === JITA_SYSTEM_ID);
            lowestSellOrder = jitaSellOrders.length > 0
                ? jitaSellOrders.reduce((min, order) => (order.price < min.price ? order : min), jitaSellOrders[0])
                : null;
        }

        return lowestSellOrder ? lowestSellOrder.price : null;

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`[getLowestSellPrice] Axios error fetching lowest sell price for typeID ${typeID}: ${error.message}`);
        } else {
            console.error(`[getLowestSellPrice] General error fetching lowest sell price for typeID ${typeID}: ${error.message}`);
        }
        return null;
    }
}

/**
 * Fetches the blueprint materials for an item and calculates its production cost using EVE Ref Industry Cost API.
 * @param {string} itemName - The name of the item to build (e.g., "Drake").
 * @param {string} channel - The Twitch channel to send messages to.
 */
async function fetchBlueprintCost(itemName, channel) {
    // Initial message to chat
    await safeSay(channel, `Calculating build cost for "${itemName}"... This might take a moment.`);
    
    try {
        // Get the TypeID for the *product* (the ship itself), not the blueprint
        console.log(`[fetchBlueprintCost] Attempting to get TypeID for product: "${itemName}"`);
        const productTypeID = await getItemTypeID(itemName);
        
        if (!productTypeID) {
            await safeSay(channel, `❌ Could not find item "${itemName}". Check spelling. ❌`);
            console.log(`[fetchBlueprintCost] No product TypeID found for "${itemName}".`);
            return;
        }
        console.log(`[fetchBlueprintCost] Found product TypeID: ${productTypeID} for "${itemName}".`);

        // EVE Ref Industry Cost API URL
        // We'll calculate for 1 run for simplicity, assuming default ME/TE (0/0) and Jita system cost index.
        // For more advanced calculations, you'd add parameters like &me=5&te=4&system_id=...
        const eveRefApiUrl = `https://api.everef.net/v1/industry/cost?product_id=${productTypeID}&runs=1&manufacturing_cost=0.01&facility_tax=0.02`; // Added default cost index and tax for a more realistic base calculation
        console.log(`[fetchBlueprintCost] Fetching blueprint cost from EVE Ref API URL: ${eveRefApiUrl}`);

        const response = await apiLimiter.schedule(() => axios.get(eveRefApiUrl, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000 // Increased timeout for this more complex API
        }));

        console.log(`[fetchBlueprintCost] EVE Ref API Response Status: ${response.status}`);
        console.log(`[fetchBlueprintCost] Raw EVE Ref API Data (first 500 chars): ${JSON.stringify(response.data).substring(0, 500)}`);

        // Check for the manufacturing data and cost within the nested structure
        const manufacturingData = response.data.manufacturing?.[productTypeID];
        const totalCost = manufacturingData?.cost; // Access cost directly from manufacturingData

        if (response.status !== 200 || !manufacturingData || totalCost === undefined) {
            await safeSay(channel, `❌ Could not get build cost data for "${itemName}". Data might be unavailable or API error. ❌`);
            console.log(`[fetchBlueprintCost] EVE Ref API data missing or malformed for ${itemName} (Product TypeID: ${productTypeID}). Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
            return;
        }

        const totalCostFormatted = parseFloat(totalCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        let message = `Build Cost for ${itemName} x1: ${totalCostFormatted} ISK`;

        // EVE Ref API provides details on missing prices if any
        if (manufacturingData.missing_materials && manufacturingData.missing_materials.length > 0) {
            const missingNames = manufacturingData.missing_materials.map(m => m.name).join(', ');
            message += ` (Missing prices for: ${missingNames})`;
        }

        await safeSay(channel, message);

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`[fetchBlueprintCost] Axios Error fetching build cost for "${itemName}": ${error.message}`, error.code === 'ECONNABORTED' ? '(Timeout)' : `Status: ${error.response?.status}`);
            await safeSay(channel, `❌ Error fetching build cost for "${itemName}": ${error.response?.status || 'Network Error'}. ❌`);
        } else {
            console.error(`[fetchBlueprintCost] General error fetching build cost for "${itemName}": ${error.message}`);
            await safeSay(channel, `❌ An internal error occurred while fetching build cost for "${itemName}". ❌`);
        }
    }
}

// Function to handle commands from Twitch chat
client.on('message', (channel, userstate, message, self) => {
    // **** START OF MESSAGE HANDLER ****
    if (self) return; // Ignore messages from the bot itself

    const args = message.trim().split(/\s+/);
    const commandName = (args.shift() || '').toLowerCase();

    // !market command
    if (commandName === '!market') {
        let quantity = 1; // Default quantity to 1

        // Check if the last argument is a quantity (e.g., "x100")
        const lastArg = args[args.length - 1];
        const quantityMatch = lastArg ? lastArg.match(/^x(\d+)$/i) : null;

        if (quantityMatch) {
            quantity = parseInt(quantityMatch[1], 10);
            args.pop(); // Remove the quantity argument from args
            if (isNaN(quantity) || quantity <= 0) {
                safeSay(channel, '❌ Invalid quantity specified. Please use a positive number (e.g., x100). ❌');
                console.log('[client.on(\'message\')] Invalid quantity for !market');
                return;
            }
        }

        const itemName = args.join(' ');

        if (!itemName) {
            safeSay(channel, '❌ Please specify an item name. Usage: !market <item name> [x<quantity>] ❌');
            console.log('[client.on(\'message\')] Empty Item Name for !market');
            return;
        }

        // For !market, we want the item's typeID
        getItemTypeID(itemName)
            .then(typeID => {
                console.log(`[client.on('message')] TypeID result for "${itemName}": ${typeID}. Preparing to fetch market data for channel: ${channel}, Quantity: ${quantity}`);
                if (typeID) {
                    fetchMarketData(itemName, typeID, channel, quantity); // Pass the quantity
                } else {
                    console.log(`[client.on('message')] No TypeID found for "${itemName}".`);
                    safeSay(channel, `❌ Could not find an EVE Online item matching "${itemName}". Check spelling? ❌`);
                }
            })
            .catch(error => {
                console.error(`[client.on('message')] Error during TypeID lookup for "${itemName}":`, error);
                safeSay(channel, `❌ Error looking up item "${itemName}": ${error.message} ❌`);
            });
    }

    // !build command (NEW)
    else if (commandName === '!build') {
        const itemName = args.join(' ');
        if (!itemName) {
            safeSay(channel, '❌ Please specify an item name. Usage: !build <item name> ❌');
            return;
        }
        fetchBlueprintCost(itemName, channel);
    }

    // !info command
    else if (commandName === '!info') {
        const itemName = args.join(' ');
        if (!itemName) {
            safeSay(channel, '❌ Please specify an item name. Usage: !info <item name> ❌');
            return;
        }

        // For !info, we want the item's typeID
        getItemTypeID(itemName)
            .then(typeID => {
                console.log(`[client.on('message')] TypeID result for !info "${itemName}": ${typeID}. Preparing reply for channel: ${channel}`);
                if (typeID) {
                    const eveRefUrl = `https://everef.net/type/${typeID}`;
                    safeSay(channel, `${itemName} info: ${eveRefUrl}`);
                } else {
                    console.log(`[client.on('message')] No TypeID found for "${itemName}".`);
                    safeSay(channel, `❌ Could not find an EVE Online item matching "${itemName}". Check spelling? ❌`);
                }
            })
            .catch(error => {
                console.error(`[client.on('message')] Error during TypeID lookup for !info "${itemName}":`, error);
                safeSay(channel, `❌ Error looking up item "${itemName}": ${error.message} ❌`);
            });
    }

    // !ping command
    else if (commandName === '!ping') {
        const state = client.readyState();
        const reply = `Pong! Bot is running. Twitch connection state: ${state}. Responding in channel: ${channel}.`;
        console.log(`[client.on('message')] Responding to !ping in ${channel} with state ${state}`);
        safeSay(channel, reply);
    }
    // **** END OF MESSAGE HANDLER ****
});

/**
 * Function to get the TypeID of an item based on its name.
 * It first checks the in-memory map loaded from eve-files.com, then falls back to Fuzzwork API.
 * @param {string} itemName - The name of the item to look up.
 * @returns {Promise<number|null>} The Type ID or null if not found.
 */
async function getItemTypeID(itemName) {
    const lowerCaseItemName = itemName.toLowerCase();

    // 1. Check the eve-files.com map first
    if (isEveFilesTypeIDMapLoaded) {
        if (eveFilesTypeIDMap.has(lowerCaseItemName)) {
            console.log(`[getItemTypeID] eve-files.com Cache HIT for "${itemName}"`);
            return eveFilesTypeIDMap.get(lowerCaseItemName);
        }
    } else {
        console.warn('[getItemTypeID] eve-files.com TypeID map not yet loaded. Falling back to Fuzzwork.');
    }

    // 2. Fallback to Fuzzwork API if not found in eve-files.com map or if map isn't loaded
    if (typeIDCache.has(lowerCaseItemName)) {
        console.log(`[getItemTypeID] Fuzzwork Cache HIT for "${itemName}"`);
        return typeIDCache.get(lowerCaseItemName);
    }

    console.log(`[getItemTypeID] Cache MISS for "${itemName}". Attempting to fetch from Fuzzwork...`);
    try {
        let cleanItemName = itemName.replace(/[^a-zA-Z0-9\s'-]/g, '').trim();
        if (!cleanItemName) {
            console.error(`[getItemTypeID] Cleaned item name is empty for original: "${itemName}"`);
            return null;
        }

        const fuzzworkTypeIdUrl = `https://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(cleanItemName)}`;
        console.log(`[getItemTypeID] Calling Fuzzwork TypeID API: ${fuzzworkTypeIdUrl}`);
        
        const searchRes = await apiLimiter.schedule(() => {
            return axios.get(fuzzworkTypeIdUrl, {
                headers: { 'User-Agent': USER_AGENT },
                timeout: 5000
            });
        });

        console.log(`[getItemTypeID] Fuzzwork TypeID API Response Status for "${itemName}": ${searchRes.status}`);
        console.log(`[getItemTypeID] Raw Fuzzwork TypeID Data for "${itemName}": ${JSON.stringify(searchRes.data)}`);

        if (searchRes.status !== 200) {
            console.error(`[getItemTypeID] Fuzzwork TypeID API Error for "${itemName}": HTTP ${searchRes.status}. Response: ${JSON.stringify(searchRes.data)}`);
            return null;
        }

        const responseData = searchRes.data;
        let foundTypeID = null;

        if (typeof responseData === 'string') {
            const typeIDString = responseData.trim();
            if (typeIDString && !isNaN(typeIDString) && typeIDString !== '[]') {
                foundTypeID = Number(typeIDString);
                console.log(`[getItemTypeID] Fuzzwork Success (String): Found TypeID ${foundTypeID} for "${itemName}"`);
            } else {
                console.log(`[getItemTypeID] Fuzzwork Info (String): No exact match or invalid ID for "${itemName}". Response: "${typeIDString}"`);
            }
        } else if (typeof responseData === 'object' && responseData !== null) {
            if (Array.isArray(responseData.typeID) && responseData.typeID.length > 0) {
                // Prioritize exact match, then the first result
                const exactMatch = responseData.typeID.find(item => item.typeName.toLowerCase() === lowerCaseItemName);
                foundTypeID = exactMatch ? exactMatch.typeID : responseData.typeID[0].typeID;
                const foundName = exactMatch ? exactMatch.typeName : responseData.typeID[0].typeName;
                console.log(`[getItemTypeID] Fuzzwork Success (Array): Found match for "${itemName}", using ID ${foundTypeID} (${foundName})`);
            } else if (responseData.typeID && !isNaN(responseData.typeID)) {
                foundTypeID = Number(responseData.typeID);
                console.log(`[getItemTypeID] Fuzzwork Success (Object): Found TypeID ${foundTypeID} for "${itemName}"`);
            } else if (Array.isArray(responseData) && responseData.length === 0) {
                console.log(`[getItemTypeID] Fuzzwork Info (Empty Array): No match found for "${itemName}".`);
            }
        } else {
            console.warn(`[getItemTypeID] Fuzzwork Warning: Unexpected response type for "${itemName}". Response: ${JSON.stringify(responseData)}`);
        }

        if (foundTypeID) {
            typeIDCache.set(lowerCaseItemName, foundTypeID); // Cache Fuzzwork result too
            return foundTypeID;
        } else {
            return null;
        }
    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`[getItemTypeID] Axios error fetching TypeID from Fuzzwork for "${itemName}": ${error.message}`, error.code === 'ECONNABORTED' ? '(Timeout)' : `Status: ${error.response?.status}`);
        } else {
            console.error(`[getItemTypeID] General error fetching TypeID from Fuzzwork for "${itemName}": ${error.message}`);
        }
        return null;
    }
}


// Start the Express server for Cloud Run health checks etc.
const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

// Basic root endpoint
app.get('/', (req, res) => {
    console.log("Root endpoint '/' accessed.");
    res.status(200).send('Eve Twitch Market Bot is running and healthy.');
});

// Health check endpoint
app.get('/_health', (req, res) => {
    const clientState = client.readyState();
    if (clientState === 'OPEN') {
        res.status(200).send(`OK - Twitch client connected (State: ${clientState})`);
    } else {
        console.warn(`/_health check failed: Twitch client not connected (State: ${clientState})`);
        res.status(503).send(`Service Unavailable: Twitch client not connected (State: ${clientState})`);
    }
});

console.log("Eve Twitch Market Bot script finished loading. Waiting for connection and messages...");
