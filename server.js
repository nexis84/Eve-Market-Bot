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

// Set up Twitch bot configuration
const client = new tmi.Client({
    identity: {
        username: 'eve_market_bot',  // Replace with your bot's username
        password: 'oauth:ggjjrtb9q7w0oq8xohlmcf034sgx4x'  // Replace with your bot's OAuth token
    },
    channels: ['ne_x_is', 'contempoenterprises']  // Replace with your Twitch channels
});

// Connect the Twitch bot to the chat
client.connect();
console.log("Twitch client connected."); // Added connection log

//Set a default User Agent if one is not set in the environment variables.
const USER_AGENT = process.env.USER_AGENT || 'TwitchBot/1.0.0 (contact@example.com)';

// Cache for Type IDs
const typeIDCache = new Map();

const JITA_SYSTEM_ID = 30000142; // Jita system ID
const JITA_REGION_ID = 10000002; // The Forge Region ID

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
                 headers: { 'User-Agent': USER_AGENT } ,
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
        //   console.log(`[fetchMarketDataFromESI] Output: Sell: ${sellPrice} ISK, Buy: ${buyPrice} ISK, Retry: ${retryCount}`);
         client.say(channel, `Sell: ${sellPrice} ISK, Buy: ${buyPrice} ISK`);
          // console.log(`[fetchMarketDataFromESI] End (Success) - Success getting data from ESI, Retry: ${retryCount}`);

  } catch (error) {
        if (axios.isAxiosError(error)) {
            console.log(`[fetchMarketDataFromESI] Catch - Axios Error: ${error.message}, Retry: ${retryCount}`);
            if (error.response) {
                if (error.response.status === 503) {
                    const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff
                    console.error(`[fetchMarketDataFromESI] ESI Temporarily Unavailable (503) for "${itemName}" (TypeID: ${typeID}). Retrying in ${retryDelay/1000} seconds...`);
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
          }  else {
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
});


// Function to get the TypeID of an item based on its name
async function getItemTypeID(itemName) {

     if (typeIDCache.has(itemName)) {
       //  console.log(`[getItemTypeID] Using cached TypeID for "${itemName}"`)
        return typeIDCache.get(itemName);
    }

    try {
        // Fetch the typeID using the fuzzwork api
        const searchRes = await limiter.schedule(() => {
         //  console.log(`[getItemTypeID] Axios Call to Fuzzwork TypeID: ${itemName}`);
             return axios.get(`http://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(itemName)}`, {
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
         //   console.log(`[getItemTypeID] TypeID Response (String) for "${itemName}": "${typeID}"`);

          // Check if TypeID is a valid number and return if so, if not return null
          if (isNaN(parseInt(typeID))) {
               console.error(`[getItemTypeID] TypeID not found for "${itemName}". Response Data: "${typeID}"`)
               return null;
           }
            typeIDCache.set(itemName, parseInt(typeID, 10));
           //  console.log(`[getItemTypeID] TypeID Resolved for "${itemName}": "${parseInt(typeID, 10)}", String Response`);
            return parseInt(typeID, 10);

        } else if (typeof searchRes.data === 'object') {
           // If the response is an object, it should contain a `typeID`.
            if (searchRes.data && searchRes.data.typeID) {
              //  console.log(`[getItemTypeID] TypeID Response (JSON) for "${itemName}": ${JSON.stringify(searchRes.data)}`);
                typeIDCache.set(itemName, searchRes.data.typeID);
                // console.log(`[getItemTypeID] TypeID Resolved for "${itemName}": "${searchRes.data.typeID}", JSON Response`);
               return searchRes.data.typeID;
            } else {
               console.error(`[getItemTypeID] TypeID not found for "${itemName}". JSON Response did not contain typeID : ${JSON.stringify(searchRes.data)}`);
              return null;
            }
         }  else {
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
