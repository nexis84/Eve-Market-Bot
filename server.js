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
console.log("Twitch client connected.");

// Set a default User Agent if one is not set in the environment variables.
const USER_AGENT = process.env.USER_AGENT || 'TwitchBot/1.0.0 (contact@example.com)';

// Cache for Type IDs
const typeIDCache = new Map();

// Trade hub information (Name, Region ID)
const TRADE_HUBS = {
    jita: { name: 'Jita', regionId: 10000002 }, // The Forge
    amarr: { name: 'Amarr', regionId: 10000043 }, // Domain
    dodixie: { name: 'Dodixie', regionId: 10000032 }, // Sinq Laison
    rens: { name: 'Rens', regionId: 10000030 }, // Heimatar
    hek: { name: 'Hek', regionId: 10000034 },  // Metropolis
};

// Function to fetch market data for an item
async function fetchMarketData(itemName, typeID, channel, tradeHub = 'jita', retryCount = 0) {
    try {
        console.log(`[fetchMarketData] Start: Fetching market data for ${itemName} (TypeID: ${typeID}) in ${tradeHub}, Retry: ${retryCount}`);
        return fetchMarketDataFromESI(itemName, typeID, channel, tradeHub, retryCount);

    } catch (error) {
        console.error(`[fetchMarketData] General Error: ${error.message}, Retry: ${retryCount}`);
        client.say(channel, `❌ Error fetching data for "${itemName}": ${error.message} ❌`);
    }
}

async function fetchMarketDataFromESI(itemName, typeID, channel, tradeHub = 'jita', retryCount = 0) {
    try {
        const regionId = TRADE_HUBS[tradeHub].regionId;
        const sellOrdersURL = `https://esi.evetech.net/latest/markets/${regionId}/orders/?datasource=tranquility&order_type=sell&type_id=${typeID}`;
        const buyOrdersURL = `https://esi.evetech.net/latest/markets/${regionId}/orders/?datasource=tranquility&order_type=buy&type_id=${typeID}`;

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
            console.error(`[fetchMarketDataFromESI] Error fetching sell orders in ${tradeHub}. HTTP Status: ${sellOrdersRes.status}, Response: ${JSON.stringify(sellOrdersRes.data)}`);
            client.say(channel, `❌ Error fetching sell orders for "${itemName}" in ${TRADE_HUBS[tradeHub].name}: HTTP ${sellOrdersRes.status}. ❌`);
            return;
        }
        if (buyOrdersRes.status !== 200) {
            console.error(`[fetchMarketDataFromESI] Error fetching buy orders in ${tradeHub}. HTTP Status: ${buyOrdersRes.status}, Response: ${JSON.stringify(buyOrdersRes.data)}`);
            client.say(channel, `❌ Error fetching buy orders for "${itemName}" in ${TRADE_HUBS[tradeHub].name}: HTTP ${buyOrdersRes.status}. ❌`);
            return;
        }

        const sellOrders = sellOrdersRes.data;
        const buyOrders = buyOrdersRes.data;

        if (!sellOrders || sellOrders.length === 0) {
            console.error(`[fetchMarketDataFromESI] No sell orders found for "${itemName}" (TypeID: ${typeID}) in ${tradeHub}`);
            if (tradeHub !== 'jita') {
                console.log(`[fetchMarketDataFromESI] No sell orders in ${tradeHub}, retrying in Jita`);
                return fetchMarketDataFromESI(itemName, typeID, channel, 'jita', retryCount); // Fallback to Jita
            }
            client.say(channel, `❌ No sell orders for "${itemName}" in ${TRADE_HUBS[tradeHub].name}. ❌`);
            return;
        }

        if (!buyOrders || buyOrders.length === 0) {
            console.error(`[fetchMarketDataFromESI] No buy orders found for "${itemName}" (TypeID: ${typeID}) in ${tradeHub}`);
            if (tradeHub !== 'jita') {
                console.log(`[fetchMarketDataFromESI] No buy orders in ${tradeHub}, retrying in Jita`);
                return fetchMarketDataFromESI(itemName, typeID, channel, 'jita', retryCount); // Fallback to Jita
            }
            client.say(channel, `❌ No buy orders for "${itemName}" in ${TRADE_HUBS[tradeHub].name}. ❌`);
            return;
        }

        // Find the lowest sell price
        const lowestSellOrder = sellOrders.reduce((min, order) => (order.price < min.price ? order : min), sellOrders[0]);
        // Find the highest buy price
        const highestBuyOrder = buyOrders.reduce((max, order) => (order.price > max.price ? order : max), buyOrders[0]);

        const sellPrice = parseFloat(lowestSellOrder.price).toLocaleString(undefined, { minimumFractionDigits: 2 });
        const buyPrice = parseFloat(highestBuyOrder.price).toLocaleString(undefined, { minimumFractionDigits: 2 });
        client.say(channel, `${TRADE_HUBS[tradeHub].name} Sell: ${sellPrice} ISK, Buy: ${buyPrice} ISK`);

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.log(`[fetchMarketDataFromESI] Catch - Axios Error: ${error.message}, Retry: ${retryCount}`);
            if (error.response) {
                if (error.response.status === 503) {
                    const retryDelay = Math.pow(2, retryCount) * 1000;
                    console.error(`[fetchMarketDataFromESI] ESI Temporarily Unavailable (503) for "${itemName}" (TypeID: ${typeID}) in ${tradeHub}. Retrying in ${retryDelay / 1000} seconds...`);
                    if (retryCount < 3) {
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        return fetchMarketDataFromESI(itemName, typeID, channel, tradeHub, retryCount + 1);
                    } else {
                        console.error(`[fetchMarketDataFromESI] ESI Unavailable (503) for "${itemName}" (TypeID: ${typeID}) in ${tradeHub} after multiple retries.`);
                        client.say(channel, `❌ ESI Temporarily Unavailable for "${itemName}". ❌`);
                        return;
                    }
                } else {
                    console.error(`[fetchMarketDataFromESI] Error fetching market data for "${itemName}" (TypeID: ${typeID}) in ${tradeHub}. HTTP Status: ${error.response.status}, Response: ${JSON.stringify(error.response.data)}`);
                    client.say(channel, `❌ Error fetching market data for "${itemName}" in ${TRADE_HUBS[tradeHub].name}: HTTP ${error.response.status}. ❌`);
                    return;
                }
            } else {
                console.error(`[fetchMarketDataFromESI] Error fetching market data for "${itemName}" (TypeID: ${typeID}) in ${tradeHub}:`, error.message);
                client.say(channel, `❌ Error fetching data for "${itemName}": ${error.message} ❌`);
                return;
            }
        } else {
            console.error(`[fetchMarketDataFromESI] Error fetching market data for "${itemName}":`, error);
            client.say(channel, `❌ Error fetching data for "${itemName}": ${error.message} ❌`);
        }
    }
}

// Function to search contracts for an item
async function searchContracts(itemName, typeID, channel) {
    try {
        console.log(`[searchContracts] Start: Searching contracts for ${itemName} (TypeID: ${typeID})`);

        const contractsURL = `https://esi.evetech.net/latest/contracts/public/${JITA_REGION_ID}/?datasource=tranquility`;
        const contractsRes = await axios.get(contractsURL, {
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: function (status) {
                return status >= 200 && status < 500;
            },
        });

        if (contractsRes.status !== 200) {
            console.error(`[searchContracts] Error fetching contracts. HTTP Status: ${contractsRes.status}, Response: ${JSON.stringify(contractsRes.data)}`);
            client.say(channel, `❌ Error fetching contracts: HTTP ${contractsRes.status}. ❌`);
            return;
        }

        const contracts = contractsRes.data;
        let foundContracts = [];
        let prices = []; // Array to store prices for average calculation.

        // Iterate through contracts and check items
        for (const contract of contracts) {
            const contractItemsURL = `https://esi.evetech.net/latest/contracts/public/items/${contract.contract_id}/?datasource=tranquility`;
            const contractItemsRes = await axios.get(contractItemsURL, {
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: function (status) {
                    return status >= 200 && status < 500;
                },
            });

            if (contractItemsRes.status === 200) {
                const items = contractItemsRes.data;
                if (items.some(item => item.type_id === typeID)) {
                    foundContracts.push(contract);
                    if (contract.price) {
                        prices.push(contract.price);
                    }
                }
            } else {
                console.error(`[searchContracts] Error fetching contract items for contract ${contract.contract_id}. HTTP Status: ${contractItemsRes.status}, Response: ${JSON.stringify(contractItemsRes.data)}`);
            }
        }

        if (foundContracts.length > 0) {
            // Calculate average price
            const averagePrice = prices.length > 0 ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0;

            // Filter contracts based on price (e.g., within +/- 20% of average)
            const filteredContracts = foundContracts.filter(contract => {
                if (!contract.price) return true; // Include contracts without price

                const lowerBound = averagePrice * 0.8; // 80% of average
                const upperBound = averagePrice * 1.2; // 120% of average
                return contract.price >= lowerBound && contract.price <= upperBound;
            });

            if (filteredContracts.length > 0) {
                // Format and display contract information
                let contractMessages = filteredContracts.slice(0, 5).map(contract => {
                    return `Contract ID: ${contract.contract_id}, Title: ${contract.title || "No Title"}, Availability: ${contract.availability}, Price: ${contract.price ? parseFloat(contract.price).toLocaleString() + " ISK" : "N/A"}`;
                });

                client.say(channel, `Contracts found for "${itemName}": ${contractMessages.join(" | ")}`);
            } else {
                client.say(channel, `❌ No contracts found for "${itemName}" within the price range. ❌`);
            }
        } else {
            client.say(channel, `❌ No contracts found for "${itemName}". ❌`);
        }

    } catch (error) {
        console.error(`[searchContracts] Error: ${error.message}`);
        client.say(channel, `❌ Error searching contracts: ${error.message} ❌`);
    }
}

// Function to handle commands from Twitch chat
client.on('message', (channel, userstate, message, self) => {
    if (self) return;

    // Check if the message starts with the command !market
    if (message.toLowerCase().startsWith('!market')) {
        // Extract the item name from the message
        let parts = message.slice(8).trim().split(' ');
        let itemName = parts.pop(); // Get the last word, which should be the item name
        let tradeHub = parts.length > 0 ? parts.join('').toLowerCase() : 'jita'; //if the user provides more than one word, join those words and search for the trade hub, otherwise default to jita.
        console.log('[client.on(\'message\')] Original command:', message);
        console.log('[client.on(\'message\')] Item Name:', itemName);
        console.log('[client.on(\'message\')] Trade Hub:', tradeHub);


        // Check if the item name is empty
        if (!itemName) {
            client.say(channel, '❌ Please specify an item to search for. ❌');
            console.log('[client.on(\'message\')] Empty Item Name');
            return;
        }

         if (!TRADE_HUBS[tradeHub]) {
            client.say(channel, `❌ Trade hub "${tradeHub}" not found.  Defaulting to Jita. ❌`);
            tradeHub = 'jita';
        }

        // Get the type ID using getItemTypeID
        getItemTypeID(itemName)
            .then((typeID) => {
                // if a type ID is received, fetch market data.
                if (typeID) {
                    fetchMarketData(itemName, typeID, channel, tradeHub);
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

    // !info command
    if (message.toLowerCase().startsWith('!info')) {
        // Extract the item name or ID from the message
        const itemIdentifier = message.slice(6).trim();

        // Check if the item name or ID is empty
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

    // Check if the message starts with the command !contracts
    if (message.toLowerCase().startsWith('!contracts')) {
        // Extract the item name from the message
        let itemName = message.slice(10).trim();
        console.log('[client.on(\'message\')] Original command:', message);
        console.log('[client.on(\'message\')] Item Name:', itemName);

        // Check if the item name is empty
        if (!itemName) {
            client.say(channel, '❌ Please specify an item to search contracts for. ❌');
            console.log('[client.on(\'message\')] Empty Item Name');
            return;
        }

        // Get the type ID using getItemTypeID
        getItemTypeID(itemName)
            .then((typeID) => {
                // if a type ID is received, fetch contract data.
                if (typeID) {
                    searchContracts(itemName, typeID, channel);
                } else {
                    // if no TypeID was found, report this to the user.
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
});


// Function to get the TypeID of an item based on its name
async function getItemTypeID(itemName) {

    if (typeIDCache.has(itemName)) {
        return typeIDCache.get(itemName);
    }

    try {
        // Fetch the typeID using the fuzzwork api
        let cleanItemName = itemName.replace(/[^a-zA-Z0-9\s]/g, '');
        const searchRes = await limiter.schedule(() => {
            return axios.get(`http://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(cleanItemName)}`, {
                headers: { 'User-Agent': USER_AGENT }
            });
        });


        // Handle non-200 status codes
        if (searchRes.status !== 200) {
            console.error(`[getItemTypeID] Error fetching TypeID for "${itemName}": HTTP ${searchRes.status}. Response was: ${JSON.stringify(searchRes.data)}`);
            return null;
        }

        // Check if the response is a string or an object.
        if (typeof searchRes.data === 'string') {

            // Fuzzwork API returns the TypeID as the response text (not JSON), so it must be parsed as a string first.
            const typeID = searchRes.data.trim(); // remove leading and trailing whitespace.

            // Check if TypeID is a valid number and return if so, if not return null
            if (isNaN(parseInt(typeID))) {
                console.error(`[getItemTypeID] TypeID not found for "${itemName}". Response Data: "${typeID}"`)
                return null;
            }
            typeIDCache.set(itemName, parseInt(typeID, 10));
            return parseInt(typeID, 10);

        } else if (typeof searchRes.data === 'object') {
            // If the response is an object, it should contain a `typeID`.
            if (searchRes.data && searchRes.data.typeID) {
                typeIDCache.set(itemName, searchRes.data.typeID);
                return searchRes.data.typeID;
            } else {
                console.error(`[getItemTypeID] TypeID not found for "${itemName}". JSON Response did not contain typeID : ${JSON.stringify(searchRes.data)}`);
                return null;
            }
        } else {
            // Handle other unexpected response types
            console.error(`[getItemTypeID] TypeID not found for "${itemName}". Unexpected response data type: ${typeof searchRes.data}, Response: ${JSON.stringify(searchRes.data)}`);
            return null;
        }


    } catch (error) {
        console.error('[getItemTypeID] Error fetching TypeID:', error);
        return null; // Return null in case of any other error
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
