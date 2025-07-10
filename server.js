const tmi = require('tmi.js');
const axios = require('axios');
const Bottleneck = require('bottleneck');
const express = require('express');

// Set up Express server for Cloud Run
const app = express();

// Set up rate limiter for external APIs (ESI, Fuzzwork)
const apiLimiter = new Bottleneck({
    minTime: 500, // 500ms between ESI/Fuzzwork requests (2 request per second)
    maxConcurrent: 1 // Only one external API request at a time
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
const USER_AGENT = process.env.USER_AGENT || 'EveTwitchMarketBot/1.2.0 (Contact: YourEmailOrDiscord)'; // Customize this

// Cache for Type IDs
const typeIDCache = new Map(); // This will now primarily be populated by eve-files.com
// Cache for Blueprint data to reduce API calls
const blueprintCache = new Map();

const JITA_SYSTEM_ID = 30000142; // Jita system ID
const JITA_REGION_ID = 10000002; // The Forge Region ID
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
    }
}

// --- TMI Event Listeners ---
client.on('connected', (addr, port) => {
    console.log(`* Connected to Twitch chat (${addr}:${port}). State: ${client.readyState()}`);
    if (client.opts.channels && client.opts.channels.length > 0) {
        const testChannel = client.opts.channels[0];
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
 */
async function fetchMarketData(itemName, typeID, channel, quantity = 1) {
    try {
        console.log(`[fetchMarketData] Start: Fetching market data for ${itemName} (TypeID: ${typeID}), Quantity: ${quantity}`);
        await fetchMarketDataFromESI(itemName, typeID, channel, quantity, 0); // Pass quantity and initial retry count
    } catch (error) {
        console.error(`[fetchMarketData] General Error caught for "${itemName}": ${error.message}`);
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
        console.log(`[fetchMarketDataFromESI] Start ESI Call: Fetching for ${itemName} (TypeID: ${typeID}), Quantity: ${quantity}, Retry: ${retryCount}`);
        const isPlex = (typeID === PLEX_TYPE_ID);
        const targetRegionId = isPlex ? GLOBAL_PLEX_REGION_ID : JITA_REGION_ID;

        const sellOrdersURL = `https://esi.evetech.net/latest/markets/${targetRegionId}/orders/?datasource=tranquility&order_type=sell&type_id=${typeID}`;
        const buyOrdersURL = `https://esi.evetech.net/latest/markets/${targetRegionId}/orders/?datasource=tranquility&order_type=buy&type_id=${typeID}`;

        const [sellOrdersRes, buyOrdersRes] = await Promise.all([
            apiLimiter.schedule(() => axios.get(sellOrdersURL, { headers: { 'User-Agent': USER_AGENT }, validateStatus: (s) => s >= 200 && s < 500, timeout: 7000 })),
            apiLimiter.schedule(() => axios.get(buyOrdersURL, { headers: { 'User-Agent': USER_AGENT }, validateStatus: (s) => s >= 200 && s < 500, timeout: 7000 }))
        ]);

        if (sellOrdersRes.status !== 200) throw new Error(`ESI returned status ${sellOrdersRes.status} for sell orders.`);
        if (buyOrdersRes.status !== 200) throw new Error(`ESI returned status ${buyOrdersRes.status} for buy orders.`);

        const sellOrders = sellOrdersRes.data;
        const buyOrders = buyOrdersRes.data;

        let lowestSellOrder = null;
        let highestBuyOrder = null;

        if (isPlex) {
            lowestSellOrder = sellOrders.length > 0 ? sellOrders.reduce((min, o) => (o.price < min.price ? o : min)) : null;
            highestBuyOrder = buyOrders.length > 0 ? buyOrders.reduce((max, o) => (o.price > max.price ? o : max)) : null;
        } else {
            const jitaSellOrders = sellOrders.filter(o => o.system_id === JITA_SYSTEM_ID);
            lowestSellOrder = jitaSellOrders.length > 0 ? jitaSellOrders.reduce((min, o) => (o.price < min.price ? o : min)) : null;
            const jitaBuyOrders = buyOrders.filter(o => o.system_id === JITA_SYSTEM_ID);
            highestBuyOrder = jitaBuyOrders.length > 0 ? jitaBuyOrders.reduce((max, o) => (o.price > max.price ? o : max)) : null;
        }

        let message = `${itemName}${quantity > 1 ? ` x${quantity}` : ''} - `;
        const formatIsk = (amount) => parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        if (lowestSellOrder) message += `${isPlex ? 'Global Sell' : 'Jita Sell'}: ${formatIsk(lowestSellOrder.price * quantity)} ISK`;
        else message += `${isPlex ? 'Global Sell' : 'Jita Sell'}: (None)`;

        if (highestBuyOrder) message += `, ${isPlex ? 'Global Buy' : 'Jita Buy'}: ${formatIsk(highestBuyOrder.price * quantity)} ISK`;
        else message += `, ${isPlex ? 'Global Buy' : 'Jita Buy'}: (None)`;

        if (!lowestSellOrder && !highestBuyOrder) {
            await safeSay(channel, `❌ No market data found for "${itemName}" in ${isPlex ? 'the global market' : 'Jita'}. ❌`);
        } else {
            await safeSay(channel, message);
        }

    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 503 && retryCount < 3) {
            const retryDelay = Math.pow(2, retryCount) * 1500;
            console.warn(`[fetchMarketDataFromESI] ESI 503 for "${itemName}". Retrying in ${retryDelay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return fetchMarketDataFromESI(itemName, typeID, channel, quantity, retryCount + 1);
        }
        console.error(`[fetchMarketDataFromESI] Error for "${itemName}":`, error.message);
        await safeSay(channel, `❌ Error fetching market data for "${itemName}". Please try again later. ❌`);
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
        if (sellOrders.length === 0) return null;

        let lowestSellOrder = null;
        if (isPlex) {
            lowestSellOrder = sellOrders.reduce((min, o) => (o.price < min.price ? o : min));
        } else {
            const jitaSellOrders = sellOrders.filter(o => o.system_id === JITA_SYSTEM_ID);
            lowestSellOrder = jitaSellOrders.length > 0 ? jitaSellOrders.reduce((min, o) => (o.price < min.price ? o : min)) : null;
        }

        return lowestSellOrder ? lowestSellOrder.price : null;

    } catch (error) {
        console.error(`[getLowestSellPrice] Error fetching lowest sell price for typeID ${typeID}: ${error.message}`);
        return null;
    }
}

/**
 * Fetches the blueprint for a given product and calculates its production cost.
 * This is the main function for the !build command.
 * @param {string} productName - The name of the item to build (the product).
 * @param {string} channel - The Twitch channel to send messages to.
 */
async function fetchBlueprintCost(productName, channel) {
    await safeSay(channel, `Checking blueprint for "${productName}"...`);
    try {
        // Step 1: Assume a standard blueprint name ("<Item Name> Blueprint") and get its TypeID.
        // This is a more reliable way to find manufacturable items than searching by the product's TypeID.
        const blueprintName = `${productName} Blueprint`;
        console.log(`[fetchBlueprintCost] Attempting to find blueprint by name: "${blueprintName}"`);
        const blueprintTypeID = await getItemTypeID(blueprintName);

        if (!blueprintTypeID) {
            // This is a common failure point for items that aren't built from a "Blueprint" (e.g., T2, faction)
            await safeSay(channel, `❌ Could not find a blueprint for "${productName}". It might have a non-standard name (e.g., faction/T2) or not be manufacturable. ❌`);
            console.log(`[fetchBlueprintCost] No blueprint TypeID found for name "${blueprintName}".`);
            return;
        }
        console.log(`[fetchBlueprintCost] Found blueprint TypeID: ${blueprintTypeID} for "${blueprintName}".`);

        // Step 2: Fetch the blueprint details from Fuzzwork using the blueprint's actual TypeID.
        const blueprintApiUrl = `https://www.fuzzwork.co.uk/api/blueprint.php?typeid=${blueprintTypeID}`;
        console.log(`[fetchBlueprintCost] Fetching blueprint data from Fuzzwork by blueprint ID: ${blueprintApiUrl}`);
        
        const blueprintRes = await apiLimiter.schedule(() => axios.get(blueprintApiUrl, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000
        }));

        console.log(`[fetchBlueprintCost] Fuzzwork Blueprint API Response Status: ${blueprintRes.status}`);

        // Step 3: Check if the API returned valid data. A 200 with an empty object is possible.
        if (blueprintRes.status !== 200 || !blueprintRes.data || Object.keys(blueprintRes.data).length === 0) {
            await safeSay(channel, `❌ No manufacturing data found for "${productName}", even though a blueprint exists. The API may be unavailable or the item unbuildable. ❌`);
            console.log(`[fetchBlueprintCost] No data from Fuzzwork for blueprint ${blueprintName} (TypeID: ${blueprintTypeID}).`);
            return;
        }

        // The Fuzzwork API returns an object where the key is the blueprint's TypeID.
        const blueprintData = blueprintRes.data[blueprintTypeID];
        
        if (!blueprintData || !blueprintData.materials) {
            await safeSay(channel, `❌ Blueprint data for "${productName}" is incomplete or malformed. ❌`);
            console.error(`[fetchBlueprintCost] Malformed blueprint data for ${productName}:`, blueprintData);
            return;
        }
        
        // Step 4: Extract the product's TypeID from the blueprint data and proceed with cost calculation.
        const productTypeID = blueprintData.productTypeID;
        if (!productTypeID) {
            await safeSay(channel, `❌ Blueprint data for "${productName}" is missing the final product information. ❌`);
            console.error(`[fetchBlueprintCost] Blueprint data for ${blueprintName} (ID: ${blueprintTypeID}) is missing a productTypeID.`);
            return;
        }

        await calculateAndSendBlueprintCost(productName, productTypeID, blueprintData, channel);

    } catch (error) {
        if (axios.isAxiosError(error)) {
            // This will catch network errors or specific HTTP statuses like the 404 from the log if the URL is bad.
            const status = error.response?.status || 'Network Error';
            console.error(`[fetchBlueprintCost] Axios Error fetching blueprint for "${productName}": ${error.message}`, error.code === 'ECONNABORTED' ? '(Timeout)' : `Status: ${status}`);
            await safeSay(channel, `❌ Error fetching blueprint data for "${productName}": API returned status ${status}. ❌`);
        } else {
            console.error(`[fetchBlueprintCost] General error fetching blueprint for "${productName}": ${error.message}`);
            await safeSay(channel, `❌ An internal error occurred while fetching blueprint for "${productName}". ❌`);
        }
    }
}


/**
 * Calculates material cost, fetches product sell price, and sends a comprehensive build cost message.
 * @param {string} productName - The name of the final product.
 * @param {number} productTypeID - The Type ID of the final product.
 * @param {object} blueprintData - The raw blueprint data from Fuzzwork (containing materials).
 * @param {string} channel - The Twitch channel.
 */
async function calculateAndSendBlueprintCost(productName, productTypeID, blueprintData, channel) {
    const blueprintTypeID = blueprintData.typeID; // Fuzzwork includes the blueprint's typeID in the data
    if (!blueprintCache.has(blueprintTypeID)) {
        blueprintCache.set(blueprintTypeID, blueprintData);
        console.log(`[calculateAndSendBlueprintCost] Blueprint data cached for TypeID: ${blueprintTypeID}`);
    }

    await safeSay(channel, `Calculating material costs for "${productName}"... This may take a moment.`);

    const materials = blueprintData.materials;
    const productQuantity = blueprintData.productQuantity || 1;

    let totalMaterialCost = 0;
    let missingPrices = [];

    console.log(`[calculateAndSendBlueprintCost] Calculating costs for ${productName}, materials:`, materials.map(m => m.typeName));

    // Fetch prices for all materials concurrently
    const pricePromises = materials.map(async (material) => {
        const price = await getLowestSellPrice(material.typeID);
        if (price !== null) {
            totalMaterialCost += price * material.quantity;
        } else {
            missingPrices.push(material.typeName); // Fuzzwork provides typeName
            console.warn(`[calculateAndSendBlueprintCost] Missing price for material: ${material.typeName} (TypeID: ${material.typeID})`);
        }
    });

    // Also fetch the final product's sell price concurrently
    const productSellPricePromise = getLowestSellPrice(productTypeID);

    const [productSellPrice] = await Promise.all([productSellPricePromise, ...pricePromises]);

    // Format numbers for clean output
    const formatIsk = (amount) => parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Build the final message
    let message = `Build Cost for ${productName} x${productQuantity}`;
    message += ` — Materials: ${formatIsk(totalMaterialCost)} ISK`;

    if (productSellPrice !== null) {
        const totalSellValue = productSellPrice * productQuantity;
        const profit = totalSellValue - totalMaterialCost;
        const profitSign = profit >= 0 ? '+' : '';
        
        message += ` | Jita Sell: ${formatIsk(totalSellValue)} ISK`;
        message += ` | Profit: ${profitSign}${formatIsk(profit)} ISK`;
    } else {
        message += ` | Jita Sell: (N/A)`;
    }

    if (missingPrices.length > 0) {
        const displayedMissing = missingPrices.length > 3 ? missingPrices.slice(0, 3).join(', ') + '...' : missingPrices.join(', ');
        message += ` (Prices missing for: ${displayedMissing})`;
    }

    await safeSay(channel, message);
}


// Function to handle commands from Twitch chat
client.on('message', (channel, userstate, message, self) => {
    if (self) return; // Ignore messages from the bot itself

    const args = message.trim().split(/\s+/);
    const commandName = (args.shift() || '').toLowerCase();

    // !market command
    if (commandName === '!market') {
        let quantity = 1;
        const lastArg = args[args.length - 1];
        const quantityMatch = lastArg ? lastArg.match(/^x(\d+)$/i) : null;

        if (quantityMatch) {
            quantity = parseInt(quantityMatch[1], 10);
            args.pop();
            if (isNaN(quantity) || quantity <= 0) {
                safeSay(channel, '❌ Invalid quantity specified. Use a positive number (e.g., x100). ❌');
                return;
            }
        }

        const itemName = args.join(' ');
        if (!itemName) {
            safeSay(channel, '❌ Please specify an item name. Usage: !market <item name> [x<quantity>] ❌');
            return;
        }

        getItemTypeID(itemName)
            .then(typeID => {
                if (typeID) {
                    fetchMarketData(itemName, typeID, channel, quantity);
                } else {
                    safeSay(channel, `❌ Could not find an EVE Online item matching "${itemName}". Check spelling? ❌`);
                }
            })
            .catch(error => {
                console.error(`[client.on('message')] Error during TypeID lookup for "${itemName}":`, error);
                safeSay(channel, `❌ Error looking up item "${itemName}". ❌`);
            });
    }

    // !build command
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

        getItemTypeID(itemName)
            .then(typeID => {
                if (typeID) {
                    const eveRefUrl = `https://everef.net/type/${typeID}`;
                    safeSay(channel, `${itemName} info: ${eveRefUrl}`);
                } else {
                    safeSay(channel, `❌ Could not find an EVE Online item matching "${itemName}". Check spelling? ❌`);
                }
            })
            .catch(error => {
                console.error(`[client.on('message')] Error during !info lookup for "${itemName}":`, error);
                safeSay(channel, `❌ Error looking up item "${itemName}". ❌`);
            });
    }

    // !ping command
    else if (commandName === '!ping') {
        const state = client.readyState();
        const reply = `Pong! Bot is running. Twitch connection state: ${state}.`;
        console.log(`[client.on('message')] Responding to !ping in ${channel} with state ${state}`);
        safeSay(channel, reply);
    }
});

/**
 * Function to get the TypeID of an item based on its name.
 * Checks local cache, then eve-files.com map, then falls back to Fuzzwork API.
 * @param {string} itemName - The name of the item to look up.
 * @returns {Promise<number|null>} The Type ID or null if not found.
 */
async function getItemTypeID(itemName) {
    const lowerCaseItemName = itemName.toLowerCase();

    if (isEveFilesTypeIDMapLoaded && eveFilesTypeIDMap.has(lowerCaseItemName)) {
        console.log(`[getItemTypeID] eve-files.com Cache HIT for "${itemName}"`);
        return eveFilesTypeIDMap.get(lowerCaseItemName);
    }
    if (typeIDCache.has(lowerCaseItemName)) {
        console.log(`[getItemTypeID] Fuzzwork Cache HIT for "${itemName}"`);
        return typeIDCache.get(lowerCaseItemName);
    }

    console.log(`[getItemTypeID] Cache MISS for "${itemName}". Fetching from Fuzzwork...`);
    try {
        let cleanItemName = itemName.replace(/[^a-zA-Z0-9\s'-]/g, '').trim();
        if (!cleanItemName) return null;

        const fuzzworkTypeIdUrl = `https://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(cleanItemName)}`;
        const searchRes = await apiLimiter.schedule(() => axios.get(fuzzworkTypeIdUrl, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 5000
        }));

        const responseData = searchRes.data;
        let foundTypeID = null;

        // Fuzzwork can return a single object, an array of objects, or just a string for typeID.
        if (Array.isArray(responseData)) {
            if (responseData.length > 0) {
                // Prioritize exact match, then the first result
                const exactMatch = responseData.find(item => item.typeName.toLowerCase() === lowerCaseItemName);
                foundTypeID = exactMatch ? exactMatch.typeID : responseData[0].typeID;
            }
        } else if (typeof responseData === 'object' && responseData !== null && responseData.typeID) {
            foundTypeID = Number(responseData.typeID);
        }

        if (foundTypeID) {
            console.log(`[getItemTypeID] Fuzzwork Success: Found TypeID ${foundTypeID} for "${itemName}"`);
            typeIDCache.set(lowerCaseItemName, foundTypeID); // Cache Fuzzwork result
            return foundTypeID;
        } else {
            console.warn(`[getItemTypeID] Fuzzwork Warning: No match found for "${itemName}". Response: ${JSON.stringify(responseData)}`);
            return null;
        }
    } catch (error) {
        console.error(`[getItemTypeID] Error fetching TypeID from Fuzzwork for "${itemName}": ${error.message}`);
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
