const tmi = require('tmi.js');
const axios = require('axios');
const Bottleneck = require('bottleneck');
const express = require('express');

// Set up Express server for Cloud Run
const app = express();

// Set up rate limiter for external APIs (ESI, Fuzzwork)
const apiLimiter = new Bottleneck({
    minTime: 500, // 500ms between ESI requests (2 request per second)
    maxConcurrent: 1 // Only one ESI request at a time
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
const typeIDCache = new Map();

const JITA_SYSTEM_ID = 30000142; // Jita system ID (still used for non-PLEX items)
const JITA_REGION_ID = 10000002; // The Forge Region ID (still used for non-PLEX items)
const PLEX_TYPE_ID = 44992; // Correct Type ID for PLEX (Pilot's License Extension)
const GLOBAL_PLEX_REGION_ID = 19000001; // New Global PLEX Market Region ID

// Removed combat site data as requested.
// const combatSites = { ... };

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
client.connect()
    .then(() => {
        console.log("Twitch client connection initiated.");
    })
    .catch(error => {
        console.error(">>>>>> Twitch client failed to connect:", error);
        process.exit(1);
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

// Function to fetch market data for an item
async function fetchMarketData(itemName, typeID, channel, retryCount = 0) {
    try {
        console.log(`[fetchMarketData] Start: Fetching market data for ${itemName} (TypeID: ${typeID}), received channel: ${channel}, Retry: ${retryCount}`);
        await fetchMarketDataFromESI(itemName, typeID, channel, retryCount);
        console.log(`[fetchMarketData] End: Completed fetch attempt for ${itemName} (TypeID: ${typeID})`);
    } catch (error) {
        console.error(`[fetchMarketData] General Error caught for "${itemName}": ${error.message}, Retry: ${retryCount}`);
        await safeSay(channel, `❌ Error fetching data for "${itemName}": ${error.message} ❌`);
    }
}

async function fetchMarketDataFromESI(itemName, typeID, channel, retryCount = 0) {
    try {
        console.log(`[fetchMarketDataFromESI] Start ESI Call: Fetching for ${itemName} (TypeID: ${typeID}), received channel: ${channel}, Retry: ${retryCount}`);

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
                ? jitaBuyOrders.reduce((max, order) => (order.price > max.price ? order : max), jitaBuyOrders[0])
                : null;
        }

        let message = `${itemName} - `;

        if (lowestSellOrder) {
            const sellPrice = parseFloat(lowestSellOrder.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            message += `${isPlex ? 'Global Sell' : 'Jita Sell'}: ${sellPrice} ISK`;
            console.log(`[fetchMarketDataFromESI] Calculated ${isPlex ? 'Global Sell' : 'Jita Sell'} Price: ${sellPrice} for ${itemName}`);
        } else {
            message += `${isPlex ? 'Global Sell' : 'Jita Sell'}: (None)`;
            console.log(`[fetchMarketDataFromESI] No ${isPlex ? 'global' : 'Jita station'} sell orders for ${itemName}`);
        }

        if (highestBuyOrder) {
            const buyPrice = parseFloat(highestBuyOrder.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            message += `, ${isPlex ? 'Global Buy' : 'Jita Buy'}: ${buyPrice} ISK`;
            console.log(`[fetchMarketDataFromESI] Calculated ${isPlex ? 'Global Buy' : 'Jita Buy'} Price: ${buyPrice} for ${itemName}`);
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
                    return await fetchMarketDataFromESI(itemName, typeID, channel, retryCount + 1);
                } else if (error.response.status === 503) {
                    console.error(`[fetchMarketDataFromESI] ESI Unavailable (503) for "${itemName}" after multiple retries.`);
                    await safeSay(channel, `❌ ESI Temporarily Unavailable for "${itemName}". Please try again later. ❌`);
                } else {
                    console.error(`[fetchMarketDataFromESI] ESI HTTP Error for "${itemName}". Status: ${error.response.status}, Response: ${JSON.stringify(error.response.data)}`);
                    await safeSay(channel, `❌ Error fetching market data for "${itemName}": ESI Error ${error.response.status}. ❌`);
                }
            } else {
                console.error(`[fetchMarketDataFromESI] Network/Request Error for "${itemName}":`, error.message);
                await safeSay(channel, `❌ Network error fetching data for "${itemName}". ❌`);
            }
        } else {
            console.error(`[fetchMarketDataFromESI] Non-Axios Error processing "${itemName}":`, error);
            await safeSay(channel, `❌ An internal error occurred while processing data for "${itemName}". ❌`);
        }
        return;
    }
}

// Function to handle commands from Twitch chat
client.on('message', (channel, userstate, message, self) => {
    // **** START OF MESSAGE HANDLER ****
    if (self) return; // Ignore messages from the bot itself
    // Chat message logging is now handled by specific console.log statements within command handlers
    // to provide relevant context without excessive verbosity.

    const args = message.trim().split(/\s+/);
    const commandName = (args.shift() || '').toLowerCase();

    // !market command
    if (commandName === '!market') {
        const itemName = args.join(' ');
        // Removed console.log for item name here to stop chat content in logs
        if (!itemName) {
            safeSay(channel, '❌ Please specify an item name. Usage: !market <item name> ❌');
            console.log('[client.on(\'message\')] Empty Item Name for !market'); // This log is fine as it's an internal state
            return;
        }

        getItemTypeID(itemName)
            .then(typeID => {
                console.log(`[client.on('message')] TypeID result for "${itemName}": ${typeID}. Preparing to fetch market data for channel: ${channel}`);
                if (typeID) {
                    fetchMarketData(itemName, typeID, channel); // Pass the original channel variable
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
    // Removed !combat command as requested.
    /*
    else if (commandName === '!combat') {
        const siteName = args.join(' ').toLowerCase();
        console.log(`[client.on('message')] !combat command received in ${channel}. Site Name: "${siteName}"`);
        if (!siteName) {
            safeSay(channel, '❌ Please specify a combat site name. Usage: !combat <site name> ❌');
            return;
        }
        if (combatSites.hasOwnProperty(siteName)) {
            const siteData = combatSites[siteName];
            safeSay(channel, `${siteName} | Faction: ${siteData.foundIn} | Difficulty: ${siteData.difficulty} | Tier: ${siteData.tier} | Info: ${siteData.url}`);
        } else {
            safeSay(channel, `❌ Combat site "${siteName}" not found in the list. Check spelling or request it to be added. ❌`);
        }
    }
    */
    // !info command
    else if (commandName === '!info') {
        const itemName = args.join(' ');
        // Removed console.log for item name here to stop chat content in logs
        if (!itemName) {
            safeSay(channel, '❌ Please specify an item name. Usage: !info <item name> ❌');
            return;
        }
        getItemTypeID(itemName)
            .then(typeID => {
                console.log(`[client.on('message')] TypeID result for !info "${itemName}": ${typeID}. Preparing reply for channel: ${channel}`);
                if (typeID) {
                    const eveRefUrl = `https://everef.net/type/${typeID}`;
                    safeSay(channel, `${itemName} info: ${eveRefUrl}`);
                } else {
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
        console.log(`[client.on('message')] Responding to !ping in ${channel} with state ${state}`); // This log is fine as it's about the bot's response/state
        safeSay(channel, reply);
    }
    // **** END OF MESSAGE HANDLER ****
});

// Function to get the TypeID of an item based on its name (using Fuzzwork API)
async function getItemTypeID(itemName) {
    const lowerCaseItemName = itemName.toLowerCase();
    if (typeIDCache.has(lowerCaseItemName)) {
        console.log(`[getItemTypeID] Cache HIT for "${itemName}"`);
        return typeIDCache.get(lowerCaseItemName);
    }

    console.log(`[getItemTypeID] Cache MISS for "${itemName}". Fetching from Fuzzwork...`);
    try {
        let cleanItemName = itemName.replace(/[^a-zA-Z0-9\s'-]/g, '').trim();
        if (!cleanItemName) {
            console.error(`[getItemTypeID] Cleaned item name is empty for original: "${itemName}"`);
            return null;
        }

        const searchRes = await apiLimiter.schedule(() => {
            console.log(`[getItemTypeID] Axios Call to Fuzzwork API for TypeID: "${cleanItemName}"`);
            return axios.get(`https://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(cleanItemName)}`, {
                headers: { 'User-Agent': USER_AGENT },
                timeout: 5000
            });
        });

        console.log(`[getItemTypeID] Fuzzwork API Response Status for "${itemName}": ${searchRes.status}`); // Added log
        console.log(`[getItemTypeID] Raw Fuzzwork Data for "${itemName}": ${JSON.stringify(searchRes.data)}`); // Added log

        if (searchRes.status !== 200) {
            console.error(`[getItemTypeID] Fuzzwork API Error for "${itemName}": HTTP ${searchRes.status}. Response: ${JSON.stringify(searchRes.data)}`);
            return null;
        }

        const responseData = searchRes.data;

        if (typeof responseData === 'string') {
            const typeIDString = responseData.trim();
            if (typeIDString && !isNaN(typeIDString) && typeIDString !== '[]') {
                const typeID = Number(typeIDString);
                console.log(`[getItemTypeID] Fuzzwork Success (String): Found TypeID ${typeID} for "${itemName}"`);
                typeIDCache.set(lowerCaseItemName, typeID);
                return typeID;
            } else {
                console.log(`[getItemTypeID] Fuzzwork Info (String): No exact match or invalid ID for "${itemName}". Response: "${typeIDString}"`);
                return null;
            }
        } else if (typeof responseData === 'object' && responseData !== null) {
            let foundTypeID = null;
            if (Array.isArray(responseData.typeID) && responseData.typeID.length > 0) {
                const exactMatch = responseData.typeID.find(item => item.typeName.toLowerCase() === lowerCaseItemName);
                foundTypeID = exactMatch ? exactMatch.typeID : responseData.typeID[0].typeID;
                const foundName = exactMatch ? exactMatch.typeName : responseData.typeID[0].typeName;
                console.log(`[getItemTypeID] Fuzzwork Success (Array): Found ambiguous match for "${itemName}", using ID ${foundTypeID} (${foundName})`);
            } else if (responseData.typeID && !isNaN(responseData.typeID)) {
                foundTypeID = Number(responseData.typeID);
                console.log(`[getItemTypeID] Fuzzwork Success (Object): Found TypeID ${foundTypeID} for "${itemName}"`);
            } else if (Array.isArray(responseData) && responseData.length === 0) {
                console.log(`[getItemTypeID] Fuzzwork Info (Empty Array): No match found for "${itemName}".`);
                return null;
            }

            if (foundTypeID) {
                typeIDCache.set(lowerCaseItemName, foundTypeID);
                return foundTypeID;
            } else {
                console.warn(`[getItemTypeID] Fuzzwork Warning: Unexpected object structure or no TypeID found for "${itemName}". Response: ${JSON.stringify(responseData)}`);
                return null;
            }
        } else {
            console.warn(`[getItemTypeID] Fuzzwork Warning: Unexpected response type for "${itemName}". Response: ${JSON.stringify(responseData)}`);
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
