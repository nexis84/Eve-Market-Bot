const tmi = require('tmi.js');
const axios = require('axios');
const Bottleneck = require('bottleneck');
const express = require('express');
const cheerio = require('cheerio'); // For parsing HTML

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
console.log("Twitch client connected.");

// Set a default User Agent if one is not set in the environment variables.
const USER_AGENT = process.env.USER_AGENT || 'TwitchBot/1.0.0 (contact@example.com)';

// Cache for Type IDs and Combat Site Info.  Include the HTML
const typeIDCache = new Map();
const combatSiteCache = new Map();

const JITA_SYSTEM_ID = 30000142; // Jita system ID
const JITA_REGION_ID = 10000002; // The Forge Region ID

// Combat site data (simplified for demonstration)
const combatSites = {
    "Angel Forlorn Hub": { url: "https://wiki.eveuniversity.org/Angel_Forlorn_Hub", escalates: false, escalationUrl: null },
    "Angel Forsaken Hub": { url: "https://wiki.eveuniversity.org/Angel_Forsaken_Hub", escalates: false, escalationUrl: null },
    "Angel Hideaway": { url: "https://wiki.eveuniversity.org/Angel_Hideaway", escalates: true, escalationUrl: "https://wiki.eveuniversity.org/Angel_Hideaway" }, //example
    "Blood Raider Forlorn Hub": { url: "https://wiki.eveuniversity.org/Blood_Raider_Forlorn_Hub", escalates: false, escalationUrl: null },
    "Blood Raider Forsaken Hub": { url: "https://wiki.eveuniversity.org/Blood_Raider_Forsaken_Hub", escalates: false, escalationUrl: null },
    "Blood Raider Hideaway": { url: "https://wiki.eveuniversity.org/Blood_Raider_Hideaway", escalates: true, escalationUrl: "https://wiki.eveuniversity.org/Blood_Raider_Hideaway" }, //example
    "Guristas Forlorn Hub": { url: "https://wiki.eveuniversity.org/Guristas_Forlorn_Hub", escalates: false, escalationUrl: null },
    "Guristas Forsaken Hub": { url: "https://wiki.eveuniversity.org/Guristas_Forsaken_Hub", escalates: false, escalationUrl: null },
    "Guristas Hideaway": { url: "https://wiki.eveuniversity.org/Guristas_Hideaway", escalates: true, escalationUrl: "https://wiki.eveuniversity.org/Guristas_Hideaway" }, //example
    "Sansha Forlorn Hub": { url: "https://wiki.eveuniversity.org/Sansha_Forlorn_Hub", escalates: false, escalationUrl: null },
    "Sansha Forsaken Hub": { url: "https://wiki.eveuniversity.org/Sansha_Forsaken_Hub", escalates: false, escalationUrl: null },
    "Sansha Hideaway": { url: "https://wiki.eveuniversity.org/Sansha_Hideaway", escalates: true, escalationUrl: "https://wiki.eveuniversity.org/Sansha_Hideaway" }, //example
    "Serpentis Forlorn Hub": { url: "https://wiki.eveuniversity.org/Serpentis_Forlorn_Hub", escalates: false, escalationUrl: null },
    "Serpentis Forsaken Hub": { url: "https://wiki.eveuniversity.org/Serpentis_Forsaken_Hub", escalates: false, escalationUrl: null },
    "Serpentis Hideaway": { url: "https://wiki.eveuniversity.org/Serpentis_Hideaway", escalates: true, escalationUrl: "https://wiki.eveuniversity.org/Serpentis_Hideaway" }, //example
    "Guristas Den": { url: "https://wiki.eveuniversity.org/Guristas_Den", escalates: true, escalationUrl: "https://wiki.eveuniversity.org/Guristas_Hallucinogen_Supply_Waypoint" }, //added
    "Guristas Hideout": { url: "https://wiki.eveuniversity.org/Guristas_Hideout", escalates: true, escalationUrl: "https://wiki.eveuniversity.org/Guristas_Hideout" }, //added. same as site.
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
        const sellOrdersURL = `https://esi.evetech.net/latest/markets/${JITA_REGION_ID}/orders/?datasource=tranquility&order_type=sell&type_id=${typeID}`;
        const buyOrdersURL = `https://esi.evetech.net/latest/markets/${JITA_REGION_ID}/orders/?datasource=tranquility&order_type=buy&type_id=${typeID}`;

        const [sellOrdersRes, buyOrdersRes] = await Promise.all([
            axios.get(sellOrdersURL, {
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: function (status) {
                    return status >= 200 && status < 500;
                },
            }),
            axios.get(buyOrdersURL, {
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: function (status) {
                    return status >= 200 && status < 500;
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
        client.say(channel, `Sell: ${sellPrice} ISK, Buy: ${buyPrice} ISK`);

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.log(`[fetchMarketDataFromESI] Catch - Axios Error: ${error.message}, Retry: ${retryCount}`);
            if (error.response) {
                if (error.response.status === 503) {
                    const retryDelay = Math.pow(2, retryCount) * 1000;
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
client.on('message', async (channel, userstate, message, self) => {
    if (self) return;

    // Check if the message starts with the command !market
    if (message.toLowerCase().startsWith('!market')) {
        let itemName = message.slice(8).trim();
        console.log('[client.on(\'message\')] Original command:', message);
        console.log('[client.on(\'message\')] Item Name:', itemName);

        if (!itemName) {
            client.say(channel, '❌ Please specify an item to search for. ❌');
            console.log('[client.on(\'message\')] Empty Item Name');
            return;
        }

        getItemTypeID(itemName)
            .then((typeID) => {
                if (typeID) {
                    fetchMarketData(itemName, typeID, channel);
                } else {
                    client.say(channel, `❌ No TypeID found for "${itemName}". ❌`);
                    console.log(`[client.on('message')] No TypeID found`);
                }
            })
            .catch((error) => {
                client.say(channel, `❌ Error fetching TypeID for "${itemName}": ${error.message} ❌`);
                console.log(`[client.on('message')] TypeID Error ${error.message}`);
            });
    }

    // !combat command
    if (message.toLowerCase().startsWith('!combat')) {
        const itemIdentifier = message.slice(7).trim();
        console.log('[client.on(\'message\')] !combat command:', message);
        console.log('[client.on(\'message\')] Item Identifier:', itemIdentifier);

        if (!itemIdentifier) {
            client.say(channel, '❌ Please specify a combat site name. ❌');
            return;
        }

        // Check if it is a combat site.
        if (combatSites.hasOwnProperty(itemIdentifier)) {
            const combatSiteData = combatSites[itemIdentifier];
            const combatSiteURL = combatSiteData.url;
            const doesEscalate = combatSiteData.escalates;
            const escalationUrl = combatSiteData.escalationUrl;
            client.say(channel, `${itemIdentifier} Info: ${combatSiteURL}.  Escalates: ${doesEscalate ? `Yes, check here: ${escalationUrl}` : 'No'}`);
            return;
        } else {
            client.say(channel, `❌ Combat site "${itemIdentifier}" not found. ❌`);
        }
    }

    // !ask command (for basic AI)
    if (message.toLowerCase().startsWith('!ask')) {
        const question = message.slice(5).trim().toLowerCase(); // Remove "!ask" and convert to lowercase
        console.log('[client.on(\'message\')] !ask command:', message);
        console.log('[client.on(\'message\')] Question:', question);

        if (!question) {
            client.say(channel, '❌ Please ask a question. ❌');
            return;
        }

        // Basic AI logic (keyword matching)
        if (question.includes("escalate")) {
            let siteName = "";
            for (const site in combatSites) {
                if (question.includes(site.toLowerCase())) {
                    siteName = site;
                    break;
                }
            }
            if (siteName) {
                try {
                    const siteURL = combatSites[siteName].url;
                    const response = await axios.get(siteURL, { headers: { 'User-Agent': USER_AGENT } });
                    const html = response.data;
                    const $ = cheerio.load(html);
                    const escalationHeader = $('#Escalation'); //id of the Escalation header
                    let escalationLink = null;
                    if (escalationHeader.length) {
                         escalationLink = siteURL + "#Escalation";
                    }
                    const doesEscalate = combatSites[siteName].escalates;
                    client.say(channel, `${siteName} ${doesEscalate ? `does, check here: ${escalationLink ? escalationLink : siteURL}` : 'does not'} escalate.`);

                } catch (error){
                     const doesEscalate = combatSites[siteName].escalates;
                     const siteURL = combatSites[siteName].url;
                     client.say(channel, `${siteName} ${doesEscalate ? `does, check here: ${siteURL}` : 'does not'} escalate.`);
                }

            } else {
                client.say(channel, "I'm sorry, I don't have information on that specific site.");
            }
        } else if (question.includes("market")) {
            const itemName = question.split("market")[1].trim();
             if (!itemName) {
                    client.say(channel, '❌ Please specify an item to search for. ❌');
                    console.log('[client.on(\'message\')] Empty Item Name');
                    return;
                }
            getItemTypeID(itemName)
            .then((typeID) => {
                if (typeID) {
                    fetchMarketData(itemName, typeID, channel);
                } else {
                    client.say(channel, `❌ No TypeID found for "${itemName}". ❌`);
                    console.log(`[client.on('message')] No TypeID found`);
                }
            })
            .catch((error) => {
                client.say(channel, `❌ Error fetching TypeID for "${itemName}": ${error.message} ❌`);
                console.log(`[client.on('message')] TypeID Error ${error.message}`);
            });

        }
         else {
            client.say(channel, "I'm sorry, I can only answer questions about combat site escalations and market data.");
        }
    }

    // !info command
    if (message.toLowerCase().startsWith('!info')) {
        // Extract the item name or ID from the message
        const itemIdentifier = message.slice(6).trim();
        console.log('[client.on(\'message\')] !info command:', message);
        console.log('[client.on(\'message\')] Item Identifier:', itemIdentifier);

        if (!itemIdentifier) {
            client.say(channel, '❌ Please specify an item name or TypeID. ❌');
            return;
        }

        // Check if the itemIdentifier is a number (TypeID)
        if (!isNaN(parseInt(itemIdentifier))) {
            // It's a number, so treat it as a TypeID
            const typeID = parseInt(itemIdentifier);
            const everefURL = `https://everef.net/type/${typeID}`;
            client.say(channel, `TypeID ${typeID} Info: ${everefURL}`);
        } else {
            // It's not a number, so treat it as an item name.  We still need to get the TypeID to use Everef.
            getItemTypeID(itemIdentifier)
                .then(typeID => {
                    if (typeID) {
                        const everefURL = `https://everef.net/type/${typeID}`;
                        client.say(channel, `${itemIdentifier} Info: ${everefURL}`);
                    } else {
                        client.say(channel, `❌ Could not find TypeID for "${itemIdentifier}". ❌`);
                    }
                })
                .catch(error => {
                    client.say(channel, `❌ Error finding TypeID for "${itemIdentifier}": ${error.message} ❌`);
                });
        }
    }
});


// Function to get the TypeID of an item based on its name
async function getItemTypeID(itemName) {

    if (typeIDCache.has(itemName)) {
        return typeIDCache.get(itemName);
    }

    try {
        let cleanItemName = itemName.replace(/[^a-zA-Z0-9\s]/g, '');
        const searchRes = await limiter.schedule(() => {
            return axios.get(`http://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(cleanItemName)}`, {
                headers: { 'User-Agent': USER_AGENT }
            });
        });

        if (searchRes.status !== 200) {
            console.error(`[getItemTypeID] Error fetching TypeID for "${itemName}": HTTP ${searchRes.status}. Response was: ${JSON.stringify(searchRes.data)}`);
            return null;
        }

        if (typeof searchRes.data === 'string') {
            const typeID = searchRes.data.trim();
            if (isNaN(parseInt(typeID))) {
                console.error(`[getItemTypeID] TypeID not found for "${itemName}". Response Data: "${typeID}"`)
                return null;
            }
            typeIDCache.set(itemName, parseInt(typeID, 10));
            return parseInt(typeID, 10);

        } else if (typeof searchRes.data === 'object') {
            if (searchRes.data && searchRes.data.typeID) {
                typeIDCache.set(itemName, searchRes.data.typeID);
                return searchRes.data.typeID;
            } else {
                console.error(`[getItemTypeID] TypeID not found for "${itemName}". JSON Response did not contain typeID : ${JSON.stringify(searchRes.data)}`);
                return null;
            }
        } else {
            console.error(`[getItemTypeID] TypeID not found for "${itemName}". Unexpected response data type: ${typeof searchRes.data}, Response: ${JSON.stringify(searchRes.data)}`);
            return null;
        }


    } catch (error) {
        console.error('[getItemTypeID] Error fetching TypeID:', error);
        return null;
    }
}
// Set up health check route for Cloud Run
app.get('/', (req, res) => {
    res.send('Eve Market Bot is running!');
});

// Set the server to listen on the appropriate port
const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
