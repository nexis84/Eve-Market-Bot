const tmi = require('tmi.js');
const axios = require('axios');
const Bottleneck = require('bottleneck');
const express = require('express');

// Set up Express server for Cloud Run
const app = express();

// Set up rate limiter with Bottleneck
const limiter = new Bottleneck({
    minTime: 500, // 500ms between requests (2 request per second), Fuzzwork recommended min is 1000ms
    maxConcurrent: 1 // Only one request at a time
});

// Ensure OAuth Token is properly set
if (!process.env.TWITCH_OAUTH_TOKEN) {
    console.error("Missing TWITCH_OAUTH_TOKEN. Check your environment variables.");
    process.exit(1);
}

// Twitch Bot Configuration
const client = new tmi.Client({
    identity: {
        username: 'Eve_twitch_market_bot',
        password: process.env.TWITCH_OAUTH_TOKEN
    },
    channels: ['ne_x_is', 'contempoenterprises']
});

// Connect the Twitch bot to the chat
client.connect();
console.log("Twitch client connected."); // Added connection log

//Set a default User Agent if one is not set in the environment variables.
const USER_AGENT = process.env.USER_AGENT || 'TwitchBot/1.0.0 (contact@example.com)';

// Cache for Type IDs and Combat Site Info
const typeIDCache = new Map();
const combatSiteCache = new Map();

const JITA_SYSTEM_ID = 30000142; // Jita system ID
const JITA_REGION_ID = 10000002; // The Forge Region ID

// Combat site data
const combatSites = {
    "Angel Cartel Hideaway": "https://wiki.eveuniversity.org/Angel_Cartel_Hideaway",
    "Angel Hideaway": "https://wiki.eveuniversity.org/Angel_Hideaway",
    "Angel Cartel Den": "https://wiki.eveuniversity.org/Angel_Cartel_Den",
    "Angel Den": "https://wiki.eveuniversity.org/Angel_Den",
    "Angel Cartel Rally Point": "https://wiki.eveuniversity.org/Angel_Cartel_Rally_Point",
    "Angel Rally Point": "https://wiki.eveuniversity.org/Angel_Rally_Point",
    "Angel Cartel Staging Point": "https://wiki.eveuniversity.org/Angel_Cartel_Staging_Point",
    "Angel Staging Point": "https://wiki.eveuniversity.org/Angel_Staging_Point",
    "Angel Cartel Yard": "https://wiki.eveuniversity.org/Angel_Cartel_Yard",
    "Angel Yard": "https://wiki.eveuniversity.org/Angel_Yard",
    "Angel Cartel Forlorn Hideaway": "https://wiki.eveuniversity.org/Angel_Cartel_Forlorn_Hideaway",
    "Angel Forlorn Hideaway": "https://wiki.eveuniversity.org/Angel_Forlorn_Hideaway",
    "Angel Cartel Forlorn Den": "https://wiki.eveuniversity.org/Angel_Cartel_Forlorn_Den",
    "Angel Forlorn Den": "https://wiki.eveuniversity.org/Angel_Forlorn_Den",
    "Angel Cartel Forlorn Rally Point": "https://wiki.eveuniversity.org/Angel_Cartel_Forlorn_Rally_Point",
    "Angel Forlorn Rally Point": "https://wiki.eveuniversity.org/Angel_Forlorn_Rally_Point",
    "Angel Cartel Forlorn Staging Point": "https://wiki.eveuniversity.org/Angel_Cartel_Forlorn_Staging_Point",
    "Angel Forlorn Staging Point": "https://wiki.eveuniversity.org/Angel_Forlorn_Staging_Point",
    "Angel Cartel Forlorn Yard": "https://wiki.eveuniversity.org/Angel_Cartel_Forlorn_Yard",
    "Angel Forlorn Yard": "https://wiki.eveuniversity.org/Angel_Forlorn_Yard",
    "Angel Cartel Forsaken Hideaway": "https://wiki.eveuniversity.org/Angel_Cartel_Forsaken_Hideaway",
    "Angel Forsaken Hideaway": "https://wiki.eveuniversity.org/Angel_Forsaken_Hideaway",
    "Angel Cartel Forsaken Den": "https://wiki.eveuniversity.org/Angel_Cartel_Forsaken_Den",
    "Angel Forsaken Den": "https://wiki.eveuniversity.org/Angel_Forsaken_Den",
    "Angel Cartel Forsaken Rally Point": "https://wiki.eveuniversity.org/Angel_Cartel_Forsaken_Rally_Point",
    "Angel Forsaken Rally Point": "https://wiki.eveuniversity.org/Angel_Forsaken_Rally_Point",
    "Angel Cartel Forsaken Staging Point": "https://wiki.eveuniversity.org/Angel_Cartel_Forsaken_Staging_Point",
    "Angel Forsaken Staging Point": "https://wiki.eveuniversity.org/Angel_Forsaken_Staging_Point",
    "Angel Cartel Forsaken Yard": "https://wiki.eveuniversity.org/Angel_Cartel_Forsaken_Yard",
    "Angel Forsaken Yard": "https://wiki.eveuniversity.org/Angel_Forsaken_Yard",
    "Blood Raider Hideaway": "https://wiki.eveuniversity.org/Blood_Raider_Hideaway",
    "Blood Raider Den": "https://wiki.eveuniversity.org/Blood_Raider_Den",
    "Blood Raider Rally Point": "https://wiki.eveuniversity.org/Blood_Raider_Rally_Point",
    "Blood Raider Staging Point": "https://wiki.eveuniversity.org/Blood_Raider_Staging_Point",
    "Blood Raider Yard": "https://wiki.eveuniversity.org/Blood_Raider_Yard",
    "Blood Raider Forlorn Hideaway": "https://wiki.eveuniversity.org/Blood_Raider_Forlorn_Hideaway",
    "Blood Raider Forlorn Den": "https://wiki.eveuniversity.org/Blood_Raider_Forlorn_Den",
    "Blood Raider Forlorn Rally Point": "https://wiki.eveuniversity.org/Blood_Raider_Forlorn_Rally_Point",
    "Blood Raider Forlorn Staging Point": "https://wiki.eveuniversity.org/Blood_Raider_Forlorn_Staging_Point",
    "Blood Raider Forlorn Yard": "https://wiki.eveuniversity.org/Blood_Raider_Forlorn_Yard",
    "Blood Raider Forsaken Hideaway": "https://wiki.eveuniversity.org/Blood_Raider_Forsaken_Hideaway",
    "Blood Raider Forsaken Den": "https://wiki.eveuniversity.org/Blood_Raider_Forsaken_Den",
    "Blood Raider Forsaken Rally Point": "https://wiki.eveuniversity.org/Blood_Raider_Forsaken_Rally_Point",
    "Blood Raider Forsaken Staging Point": "https://wiki.eveuniversity.org/Blood_Raider_Forsaken_Staging_Point",
    "Blood Raider Forsaken Yard": "https://wiki.eveuniversity.org/Blood_Raider_Forsaken_Yard",
    "Guristas Hideaway": "https://wiki.eveuniversity.org/Guristas_Hideaway",
    "Guristas Den": "https://wiki.eveuniversity.org/Guristas_Den",
    "Guristas Rally Point": "https://wiki.eveuniversity.org/Guristas_Rally_Point",
    "Guristas Staging Point": "https://wiki.eveuniversity.org/Guristas_Staging_Point",
    "Guristas Yard": "https://wiki.eveuniversity.org/Guristas_Yard",
    "Guristas Forlorn Hideaway": "https://wiki.eveuniversity.org/Guristas_Forlorn_Hideaway",
    "Guristas Forlorn Den": "https://wiki.eveuniversity.org/Guristas_Forlorn_Den",
    "Guristas Forlorn Rally Point": "https://wiki.eveuniversity.org/Guristas_Forlorn_Rally_Point",
    "Guristas Forlorn Staging Point": "https://wiki.eveuniversity.org/Guristas_Forlorn_Staging_Point",
    "Guristas Forlorn Yard": "https://wiki.eveuniversity.org/Guristas_Forlorn_Yard",
    "Guristas Forsaken Hideaway": "https://wiki.eveuniversity.org/Guristas_Forsaken_Hideaway",
    "Guristas Forsaken Den": "https://wiki.eveuniversity.org/Guristas_Forsaken_Den",
    "Guristas Forsaken Rally Point": "https://wiki.eveuniversity.org/Guristas_Forsaken_Rally_Point",
    "Guristas Forsaken Staging Point": "https://wiki.eveuniversity.org/Guristas_Forsaken_Staging_Point",
    "Guristas Forsaken Yard": "https://wiki.eveuniversity.org/Guristas_Forsaken_Yard",
    "Sansha Hideaway": "https://wiki.eveuniversity.org/Sansha_Hideaway",
    "Sansha Den": "https://wiki.eveuniversity.org/Sansha_Den",
    "Sansha Rally Point": "https://wiki.eveuniversity.org/Sansha_Rally_Point",
    "Sansha Staging Point": "https://wiki.eveuniversity.org/Sansha_Staging_Point",
    "Sansha Yard": "https://wiki.eveuniversity.org/Sansha_Yard",
    "Sansha Forlorn Hideaway": "https://wiki.eveuniversity.org/Sansha_Forlorn_Hideaway",
    "Sansha Forlorn Den": "https://wiki.eveuniversity.org/Sansha_Forlorn_Den",
    "Sansha Forlorn Rally Point": "https://wiki.eveuniversity.org/Sansha_Forlorn_Rally_Point",
    "Sansha Forlorn Staging Point": "https://wiki.eveuniversity.org/Sansha_Forlorn_Staging_Point",
    "Sansha Forlorn Yard": "https://wiki.eveuniversity.org/Sansha_Forlorn_Yard",
    "Sansha Forsaken Hideaway": "https://wiki.eveuniversity.org/Sansha_Forsaken_Hideaway",
    "Sansha Forsaken Den": "https://wiki.eveuniversity.org/Sansha_Forsaken_Den",
    "Sansha Forsaken Rally Point": "https://wiki.eveuniversity.org/Sansha_Forsaken_Rally_Point",
    "Sansha Forsaken Staging Point": "https://wiki.eveuniversity.org/Sansha_Forsaken_Staging_Point",
    "Sansha Forsaken Yard": "https://wiki.eveuniversity.org/Sansha_Forsaken_Yard",
    "Serpentis Hideaway": "https://wiki.eveuniversity.org/Serpentis_Hideaway",
    "Serpentis Den": "https://wiki.eveuniversity.org/Serpentis_Den",
    "Serpentis Rally Point": "https://wiki.eveuniversity.org/Serpentis_Rally_Point",
    "Serpentis Staging Point": "https://wiki.eveuniversity.org/Serpentis_Staging_Point",
    "Serpentis Yard": "https://wiki.eveuniversity.org/Serpentis_Yard",
    "Serpentis Forlorn Hideaway": "https://wiki.eveuniversity.org/Serpentis_Forlorn_Hideaway",
    "Serpentis Forlorn Den": "https://wiki.eveuniversity.org/Serpentis_Forlorn_Den",
    "Serpentis Forlorn Rally Point": "https://wiki.eveuniversity.org/Serpentis_Forlorn_Rally_Point",
    "Serpentis Forlorn Staging Point": "https://wiki.eveuniversity.org/Serpentis_Forlorn_Staging_Point",
    "Serpentis Forlorn Yard": "https://wiki.eveuniversity.org/Serpentis_Forlorn_Yard",
    "Serpentis Forsaken Hideaway": "https://wiki.eveuniversity.org/Serpentis_Forsaken_Hideaway",
    "Serpentis Forsaken Den": "https://wiki.eveuniversity.org/Serpentis_Forsaken_Den",
    "Serpentis Forsaken Rally Point": "https://wiki.eveuniversity.org/Serpentis_Forsaken_Rally_Point",
    "Serpentis Forsaken Staging Point": "https://wiki.eveuniversity.org/Serpentis_Forsaken_Staging_Point",
    "Serpentis Forsaken Yard": "https://wiki.eveuniversity.org/Serpentis_Forsaken_Yard",
    "Angel Haven": "https://wiki.eveuniversity.org/Angel_Haven",
    "Blood Raider Haven": "https://wiki.eveuniversity.org/Blood_Raider_Haven",
    "Guristas Haven": "https://wiki.eveuniversity.org/Guristas_Haven",
    "Sansha Haven": "https://wiki.eveuniversity.org/Sansha_Haven",
    "Serpentis Haven": "https://wiki.eveuniversity.org/Serpentis_Haven",
    "Angel Sanctum": "https://wiki.eveuniversity.org/Angel_Sanctum",
    "Blood Raider Sanctum": "https://wiki.eveuniversity.org/Blood_Raider_Sanctum",
    "Guristas Sanctum": "https://wiki.eveuniversity.org/Guristas_Sanctum",
    "Sansha Sanctum": "https://wiki.eveuniversity.org/Sansha_Sanctum",
    "Serpentis Sanctum": "https://wiki.eveuniversity.org/Serpentis_Sanctum"
};

// Function to fetch market data for an item
async function fetchMarketData(itemName, typeID, channel, retryCount = 0) {
    try {
        console.log(`[fetchMarketData] Start: Fetching market data for ${itemName} (TypeID: ${typeID}), Retry: ${retryCount}`);
        return fetchMarketDataFromESI(itemName, typeID, channel, retryCount);


    } catch (error) {
        console.error(`[fetchMarketData] General Error: ${error.message}, Retry: ${retryCount}`);
        client.say(channel, `❌ Error fetching data for "${itemName}": ${error.message} ❌`);
    }
}


async function fetchMarketDataFromESI(itemName, typeID, channel, retryCount = 0) {
    try {
        // console.log(`[fetchMarketDataFromESI] Start: Fetching market data from ESI for ${itemName} (TypeID: ${typeID}), Retry: ${retryCount}`);

        const sellOrdersURL = `https://esi.evetech.net/latest/markets/${JITA_REGION_ID}/orders/?datasource=tranquility&order_type=sell&type_id=${typeID}`;
        const buyOrdersURL = `https://esi.evetech.net/latest/markets/${JITA_REGION_ID}/orders/?datasource=tranquility&order_type=buy&type_id=${typeID}`;

        const [sellOrdersRes, buyOrdersRes] = await Promise.all([
            axios.get(sellOrdersURL, {
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: function (status) {
                    return status >= 200 && status < 500; // Accept all status codes between 200 and 499 (inclusive)
                },
            }),
            axios.get(buyOrdersURL, {
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: function (status) {
                    return status >= 200 && status < 500; // Accept all status codes between 200 and 499 (inclusive)
                },
            })
        ]);


        if (sellOrdersRes.status !== 200) {
            console.error(`[fetchMarketDataFromESI] Error fetching sell orders. HTTP Status: ${sellOrdersRes.status}, Response: ${JSON.stringify(sellOrdersRes.data)}`);
            client.say(channel, `❌ Error fetching sell orders for "${itemName}": HTTP ${sellOrdersRes.status}. ❌`);
            return;
        }
        if (buyOrdersRes.status !== 200) {
            console.error(`[fetchMarketDataFromESI] Error fetching buy orders. HTTP Status: ${buyOrdersRes.status}, Response: ${JSON.stringify(buyOrdersRes.data)}`);
            client.say(channel, `❌ Error fetching buy orders for "${itemName}": HTTP ${buyOrdersRes.status}. ❌`);
            return;
        }
        const sellOrders = sellOrdersRes.data;
        const buyOrders = buyOrdersRes.data;

        if (!sellOrders || sellOrders.length === 0) {
            console.error(`[fetchMarketDataFromESI] No sell orders found for "${itemName}" (TypeID: ${typeID}) in Jita`);
            client.say(channel, `❌ No sell orders for "${itemName}" in Jita. ❌`);
            return;
        }

        if (!buyOrders || buyOrders.length === 0) {
            console.error(`[fetchMarketDataFromESI] No buy orders found for "${itemName}" (TypeID: ${typeID}) in Jita`);
            client.say(channel, `❌ No buy orders for "${itemName}" in Jita. ❌`);
            return;
        }

        // Find the lowest sell price
        const lowestSellOrder = sellOrders.reduce((min, order) => (order.price < min.price ? order : min), sellOrders[0]);
        // Find the highest buy price
        const highestBuyOrder = buyOrders.reduce((max, order) => (order.price > max.price ? order : max), buyOrders[0]);

        const sellPrice = parseFloat(lowestSellOrder.price).toLocaleString(undefined, { minimumFractionDigits: 2 });
        const buyPrice = parseFloat(highestBuyOrder.price).toLocaleString(undefined, { minimumFractionDigits: 2 });
        //        console.log(`[fetchMarketDataFromESI] Output: Sell: ${sellPrice} ISK, Buy: ${buyPrice} ISK, Retry: ${retryCount}`);
        client.say(channel, `Sell: ${sellPrice} ISK, Buy: ${buyPrice} ISK`);
        // console.log(`[fetchMarketDataFromESI] End (Success) - Success getting data from ESI, Retry: ${retryCount}`);

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.log(`[fetchMarketDataFromESI] Catch - Axios Error: ${error.message}, Retry: ${retryCount}`);
            if (error.response) {
                if (error.response.status === 503) {
                    const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff
                    console.error(`[fetchMarketDataFromESI] ESI Temporarily Unavailable (503) for "${itemName}" (TypeID: ${typeID}). Retrying in ${retryDelay / 1000} seconds...`);
                    if (retryCount < 3) {
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        return fetchMarketDataFromESI(itemName, typeID, channel, retryCount + 1);
                    } else {
                        console.error(`[fetchMarketDataFromESI] ESI Unavailable (503) for "${itemName}" (TypeID: ${typeID}) after multiple retries.`);
                        client.say(channel, `❌ ESI Temporarily Unavailable for "${itemName}". ❌`);
                        return;
                    }
                    return;
                } else {
                    console.error(`[fetchMarketDataFromESI] Error fetching market data for "${itemName}" (TypeID: ${typeID}). HTTP Status: ${error.response.status}, Response: ${JSON.stringify(error.response.data)}`);
                    client.say(channel, `❌ Error fetching market data for "${itemName}": HTTP ${error.response.status}. ❌`);
                    return;
                }
            } else {
                console.error(`[fetchMarketDataFromESI] Error fetching market data for "${itemName}" (TypeID: ${typeID}):`, error.message);
                client.say(channel, `❌ Error fetching data for "${itemName}": ${error.message} ❌`);
                return;
            }
        } else {
            console.error(`[fetchMarketDataFromESI] Error fetching market data for "${itemName}":`, error);
            client.say(channel, `❌ Error fetching data for "${itemName}": ${error.message} ❌`);
        }

    }
}

// Function to handle commands from Twitch chat
client.on('message', (channel, userstate, message, self) => {
    if (self) return;
    // console.log(`[client.on('message')] Message Received: ${message}`); // Logging message received

    // Check if the message starts with the command !market
    if (message.toLowerCase().startsWith('!market')) {
        // Extract the item name from the message
        let itemName = message.slice(8).trim();
        console.log('[client.on(\'message\')] Original command:', message);
        console.log('[client.on(\'message\')] Item Name:', itemName);

        // Check if the item name is empty
        if (!itemName) {
            client.say(channel, '❌ Please specify an item to search for. ❌');
            console.log('[client.on(\'message\')] Empty Item Name');
            return;
        }

        // Get the type ID using getItemTypeID
        getItemTypeID(itemName)
            .then((typeID) => {
                // if a type ID is received, fetch market data.
                if (typeID) {
                    // console.log(`[client.on('message')] TypeID Found: ${typeID}, Calling fetchMarketData`);
                    fetchMarketData(itemName, typeID, channel);
                } else {
                    // if no typeID was found, report this to the user.
                    client.say(channel, `❌ No TypeID found for "${itemName}". ❌`);
                    console.log(`[client.on('message')] No TypeID found`);
                }
            })
            .catch((error) => {
                // Report any errors fetching the TypeID to the user
                client.say(channel, `❌ Error fetching TypeID for "${itemName}": ${error.message} ❌`);
                console.log(`[client.on('message')] TypeID Error ${error.message}`);
            });
    }

    // !combat command
    if (message.toLowerCase().startsWith('!combat')) {
        // Extract the item name or ID from the message
        const itemIdentifier = message.slice(7).trim(); // Changed from 6 to 7
        console.log('[client.on(\'message\')] !combat command:', message); // Changed from !info to !combat
        console.log('[client.on(\'message\')] Item Identifier:', itemIdentifier);

        // Check if the item name or ID is empty
        if (!itemIdentifier) {
            client.say(channel, '❌ Please specify a combat site name. ❌'); // Changed the message
            return;
        }

        // Check if it is a combat site.
        if (combatSites.hasOwnProperty(itemIdentifier)) {
            const combatSiteURL = combatSites[itemIdentifier];
            client.say(channel, `${itemIdentifier} Info: ${combatSiteURL}`);
            return;
        } else {
            client.say(channel, `❌ Combat site "${itemIdentifier}" not found. ❌`); //tell user if site is not found
        }
    }
    // !info command
    if (message.toLowerCase().startsWith('!info')) {
        const itemName = message.slice(6).trim(); // Remove "!info " and get the item name
        console.log('[client.on(\'message\')] !info command:', message);
        console.log('[client.on(\'message\')] Item Name:', itemName);

        if (!itemName) {
            client.say(channel, '❌ Please specify an item to search for. ❌');
            return;
        }

        getItemTypeID(itemName)
            .then((typeID) => {
                if (typeID) {
                    const everefURL = `https://everef.net/?type=${typeID}`;
                    client.say(channel, `${itemName} info: ${everefURL}`);
                } else {
                    client.say(channel, `❌ No TypeID found for "${itemName}". ❌`);
                }
            })
            .catch((error) => {
                client.say(channel, `❌ Error fetching TypeID for "${itemName}": ${error.message} ❌`);
            });
    }
});


// Function to get the TypeID of an item based on its name
async function getItemTypeID(itemName) {

    if (typeIDCache.has(itemName)) {
        //  console.log(`[getItemTypeID] Using cached TypeID for "${itemName}"`)
        return typeIDCache.get(itemName);
    }

    try {
        // Fetch the typeID using the fuzzwork api
        let cleanItemName = itemName.replace(/[^a-zA-Z0-9\s]/g, '');
        const searchRes = await limiter.schedule(() => {
            // console.log(`[getItemTypeID] Axios Call to Fuzzwork TypeID: ${itemName}`);
            return axios.get(`http://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(cleanItemName)}`, {
                headers: { 'User-Agent': USER_AGENT }
            });
        });


        // Handle non-200 status codes
        if (searchRes.status 
