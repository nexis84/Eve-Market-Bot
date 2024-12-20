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
    password: 'oauth:6updnryywhgkpt1ycqs5wk6lr3tr0f'  // Replace with your bot's OAuth token
    },
    channels: ['ne_x_is', 'contempoenterprises']  // Replace with your Twitch channels
});

// Connect the Twitch bot to the chat
client.connect();


//Set a default User Agent if one is not set in the environment variables.
const USER_AGENT = process.env.USER_AGENT || 'TwitchBot/1.0.0 (contact@example.com)';

// Cache for Type IDs
const typeIDCache = new Map();

// Location is "region", "station", or "" for global
const DEFAULT_LOCATION_TYPE = process.env.DEFAULT_LOCATION_TYPE || "";
const DEFAULT_LOCATION_ID = process.env.DEFAULT_LOCATION_ID || "";


// Function to fetch market data for an item
async function fetchMarketData(itemName, typeID, channel, retryCount = 0) {
    try {
        console.log(`Fetching market data for ${itemName} (TypeID: ${typeID})...`);

        // Construct the base URL
        let baseURL = `https://market.fuzzwork.co.uk/aggregates/?`;

        // Add the location parameter if it is not blank.
         if(DEFAULT_LOCATION_TYPE !== "" && DEFAULT_LOCATION_ID !== "") {
          baseURL += `${DEFAULT_LOCATION_TYPE}=${DEFAULT_LOCATION_ID}&`;
        }
       // Add the type parameter.
       baseURL += `types=${typeID}`

        // Fetch market data from Fuzzwork API
        const marketRes = await limiter.schedule(() =>
            axios.get(baseURL, {
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: function (status) {
                    return status >= 200 && status < 500; // Accept all status codes between 200 and 499 (inclusive)
                 },
            })
        );

         // If the response is not a 200, check specifically for a 404.
         if (marketRes.status !== 200) {
           if (marketRes.status === 404) {
               console.error(`Market data not found for "${itemName}" (TypeID: ${typeID}) with URL ${baseURL}.`);
                client.say(channel, `❌ No active market data for "${itemName}". ❌`);
               return;
            } else if (marketRes.status === 503) {
                const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff
                console.error(`Fuzzwork API Temporarily Unavailable (503) for "${itemName}" (TypeID: ${typeID}). Retrying in ${retryDelay/1000} seconds...`);
                 if (retryCount < 3) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    return fetchMarketData(itemName, typeID, channel, retryCount + 1);
                } else {
                    console.error(`Fuzzwork API Unavailable (503) for "${itemName}" (TypeID: ${typeID}) after multiple retries.`);
                    client.say(channel, `❌ Fuzzwork API Temporarily Unavailable for "${itemName}". ❌`);
                    return;
                 }
                return; // Add this return here.
              } else {
               console.error(`Error fetching market data for "${itemName}" (TypeID: ${typeID}). HTTP Status: ${marketRes.status}, Response: ${JSON.stringify(marketRes.data)}`);
                  client.say(channel, `❌ Error fetching market data for "${itemName}": HTTP ${marketRes.status}. ❌`);
                return;
            }
         }

        const marketData = marketRes.data;

        // Check to see that there is market data, as the api can return an empty array.
       if (!marketData || !marketData[typeID]) {
          console.error(`Market data for "${itemName}" is empty or missing for Type ID ${typeID}: Response Data: ${JSON.stringify(marketData)}`);
          client.say(channel, `❌ No active market data for "${itemName}". ❌`);
            return;
        }

       // Extract the relevant data from the API response.
      const itemData = marketData[typeID];
       const sellData = itemData?.sell;
       const buyData = itemData?.buy;


        // Validate that there is both sell and buy data.
        if (!sellData) {
           console.error(`No sell data for "${itemName}". Response Data: ${JSON.stringify(marketData)}`);
            client.say(channel, `❌ No sell orders for "${itemName}". ❌`);
            return;
        }
         if (!buyData) {
           console.error(`No buy data for "${itemName}". Response Data: ${JSON.stringify(marketData)}`);
             client.say(channel, `❌ No buy orders for "${itemName}". ❌`);
           return;
        }


         // Extract the median sell price, and median buy price
         const sellPrice = parseFloat(sellData.median).toLocaleString(undefined, { minimumFractionDigits: 2 });
         const buyPrice = parseFloat(buyData.median).toLocaleString(undefined, { minimumFractionDigits: 2 });

         // Output the sell and buy price to chat
         client.say(channel, `Sell: ${sellPrice} ISK, Buy: ${buyPrice} ISK`);


    } catch (error) {
           if (axios.isAxiosError(error)) {
            if (error.response) {
                if (error.response.status === 503) {
                   const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff
                    console.error(`Fuzzwork API Temporarily Unavailable (503) for "${itemName}" (TypeID: ${typeID}). Retrying in ${retryDelay/1000} seconds...`);
                     if (retryCount < 3) {
                         await new Promise(resolve => setTimeout(resolve, retryDelay));
                         return fetchMarketData(itemName, typeID, channel, retryCount + 1);
                     } else {
                         console.error(`Fuzzwork API Unavailable (503) for "${itemName}" (TypeID: ${typeID}) after multiple retries.`);
                         client.say(channel, `❌ Fuzzwork API Temporarily Unavailable for "${itemName}". ❌`);
                         return;
                      }
                    return; // Add this return here.
                 } else {
                      console.error(`Error fetching market data for "${itemName}" (TypeID: ${typeID}). HTTP Status: ${error.response.status}, Response: ${JSON.stringify(error.response.data)}`);
                      client.say(channel, `❌ Error fetching market data for "${itemName}": HTTP ${error.response.status}. ❌`);
                    return;
                }
            } else {
                console.error(`Error fetching market data for "${itemName}" (TypeID: ${typeID}):`, error.message);
               client.say(channel, `❌ Error fetching data for "${itemName}": ${error.message} ❌`);
               return;
            }
          }  else {
            console.error(`Error fetching market data for "${itemName}":`, error);
             client.say(channel, `❌ Error fetching data for "${itemName}": ${error.message} ❌`);
           }
    }
}


// Function to handle commands from Twitch chat
client.on('message', (channel, userstate, message, self) => {
    if (self) return;

     // Check if the message starts with the command !market
    if (message.toLowerCase().startsWith('!market')) {
      // Extract the item name from the message
        let itemName = message.slice(8).trim();
        console.log('Original command:', message);
        console.log('Item Name:', itemName);

        // Check if the item name is empty
        if (!itemName) {
            client.say(channel, '❌ Please specify an item to search for. ❌');
            return;
        }

        // Get the type ID using getItemTypeID
        getItemTypeID(itemName)
            .then((typeID) => {
               // if a type ID is received, fetch market data.
                if (typeID) {
                    fetchMarketData(itemName, typeID, channel);
                } else {
                    // if no typeID was found, report this to the user.
                    client.say(channel, `❌ No TypeID found for "${itemName}". ❌`);
                }
            })
            .catch((error) => {
              // Report any errors fetching the TypeID to the user
                client.say(channel, `❌ Error fetching TypeID for "${itemName}": ${error.message} ❌`);
            });
    }
});


// Function to get the TypeID of an item based on its name
async function getItemTypeID(itemName) {

     if (typeIDCache.has(itemName)) {
        console.log(`Using cached TypeID for "${itemName}"`)
        return typeIDCache.get(itemName);
    }

    try {
        // Fetch the typeID using the fuzzwork api
        const searchRes = await limiter.schedule(() =>
            axios.get(`http://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(itemName)}`, {
                headers: { 'User-Agent': USER_AGENT }
            })
        );

        // Handle non-200 status codes
        if (searchRes.status !== 200) {
            console.error(`Error fetching TypeID for "${itemName}": HTTP ${searchRes.status}. Response was: ${JSON.stringify(searchRes.data)}`);
            return null;
        }

        // Check if the response is a string or an object.
        if (typeof searchRes.data === 'string') {

           // Fuzzwork API returns the TypeID as the response text (not JSON), so it must be parsed as a string first.
           const typeID = searchRes.data.trim(); // remove leading and trailing whitespace.
           console.log(`TypeID Response (String) for "${itemName}": "${typeID}"`);

          // Check if TypeID is a valid number and return if so, if not return null
          if (isNaN(parseInt(typeID))) {
               console.error(`TypeID not found for "${itemName}". Response Data: "${typeID}"`)
               return null;
           }
            typeIDCache.set(itemName, parseInt(typeID, 10));
            return parseInt(typeID, 10);

        } else if (typeof searchRes.data === 'object') {
           // If the response is an object, it should contain a `typeID`.
            if (searchRes.data && searchRes.data.typeID) {
               console.log(`TypeID Response (JSON) for "${itemName}": ${JSON.stringify(searchRes.data)}`);
                typeIDCache.set(itemName, searchRes.data.typeID);
               return searchRes.data.typeID;
            } else {
               console.error(`TypeID not found for "${itemName}". JSON Response did not contain typeID : ${JSON.stringify(searchRes.data)}`);
              return null;
            }
         }  else {
            // Handle other unexpected response types
             console.error(`TypeID not found for "${itemName}". Unexpected response data type: ${typeof searchRes.data}, Response: ${JSON.stringify(searchRes.data)}`);
             return null;
         }


    } catch (error) {
         console.error('Error fetching TypeID:', error);
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