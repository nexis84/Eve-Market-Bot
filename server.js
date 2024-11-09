const tmi = require('tmi.js');
const axios = require('axios');
const Bottleneck = require('bottleneck');
const express = require('express');

// Set up Express server for Cloud Run
const app = express();

// Set up rate limiter with Bottleneck
const limiter = new Bottleneck({
  minTime: 250, // 250ms between requests (4 requests per second)
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

// Default region (Jita) for all queries
const defaultRegionID = '10000002';
const defaultRegionDisplayName = 'Jita';

// Function to fetch market data for an item
async function fetchMarketData(itemName, typeID, channel) {
  try {
    console.log(`Fetching market data for ${itemName} (TypeID: ${typeID}) from ${defaultRegionDisplayName}...`);
    const marketRes = await limiter.schedule(() =>
      axios.get(`https://api.adam4eve.eu/v1/market_prices?typeID=${typeID}&regionID=${defaultRegionID}`, {
        headers: { 'User-Agent': 'TwitchBot (contact@example.com)' }
      })
    );
    const marketData = marketRes.data[defaultRegionID];
    if (!marketData || !marketData.sell_price || !marketData.buy_price) {
      client.say(channel, `No active market data for "${itemName}" in ${defaultRegionDisplayName}.`);
      return;
    }

    const sellPrice = parseFloat(marketData.sell_price).toLocaleString(undefined, { minimumFractionDigits: 2 });
    const buyPrice = parseFloat(marketData.buy_price).toLocaleString(undefined, { minimumFractionDigits: 2 });
    const sellVolume = (marketData.sell_volume || 'Unavailable').toLocaleString();
    const buyVolume = (marketData.buy_volume || 'Unavailable').toLocaleString();

    client.say(channel, `Market Info for ${itemName} in ${defaultRegionDisplayName}: Sell Price: ${sellPrice} ISK, Sell Volume: ${sellVolume}, Buy Price: ${buyPrice} ISK, Buy Volume: ${buyVolume}`);
  } catch (error) {
    client.say(channel, `Error fetching data for "${itemName}" in ${defaultRegionDisplayName}: ${error.message}`);
  }
}

// Function to handle commands from Twitch chat
client.on('message', (channel, userstate, message, self) => {
  if (self) return;

  if (message.toLowerCase().startsWith('!market')) {
    let itemName = message.slice(8).trim();
    console.log('Original command:', message);
    console.log('Item Name:', itemName);

    if (!itemName) {
      client.say(channel, 'Please specify an item to search for.');
      return;
    }

    getItemTypeID(itemName)
      .then((typeID) => {
        if (typeID) {
          fetchMarketData(itemName, typeID, channel);
        } else {
          client.say(channel, `❌ No TypeID found for "${itemName}". ❌`);
        }
      })
      .catch((error) => {
        client.say(channel, `Error fetching TypeID for "${itemName}": ${error.message}`);
      });
  }
});

// Function to get the TypeID of an item based on its name
async function getItemTypeID(itemName) {
  try {
    const searchRes = await limiter.schedule(() =>
      axios.get(`https://api.adam4eve.eu/v1/search?item=type&term=${encodeURIComponent(itemName)}`, {
        headers: { 'User-Agent': 'TwitchBot (contact@example.com)' }
      })
    );
    const item = searchRes.data.find((entry) => entry.value.toLowerCase() === itemName.toLowerCase());
    return item ? item.id : null;
  } catch (error) {
    console.error('Error fetching TypeID:', error.message);
    throw new Error('Failed to fetch TypeID');
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
