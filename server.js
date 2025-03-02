import 'dotenv/config';
import { ReadableStream, WritableStream, TransformStream } from 'web-streams-polyfill/dist/polyfill.es2018.js';
if (!globalThis.ReadableStream) {
    globalThis.ReadableStream = ReadableStream;
}
if (!globalThis.WritableStream) {
    globalThis.WritableStream = WritableStream;
}
if (!globalThis.TransformStream) {
    globalThis.TransformStream = TransformStream;
}
import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';
import Bottleneck from 'bottleneck';
import express from 'express';

// Set up Express server for Cloud Run
const app = express();

// Set up rate limiter with Bottleneck
const limiter = new Bottleneck({
    minTime: 500, // 500ms between requests (2 requests per second), Fuzzwork recommended min is 1000ms
    maxConcurrent: 1 // Only one request at a time
});

// Set up Discord bot client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) {
    console.error("Discord token is missing, exiting.");
    process.exit(1);
}

// Log in to Discord with your client's token
client.login(DISCORD_TOKEN);

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// Set a default User Agent if one is not set in the environment variables.
const USER_AGENT = process.env.USER_AGENT || 'DiscordBot/1.0.0 (contact@example.com)';

// Cache for Type IDs
const typeIDCache = new Map();

// Function to fetch TypeID for an item name
async function getItemTypeID(itemName) {
    if (!itemName) {
        console.error(`Item name is invalid: "${itemName}"`);
        return null;
    }
    if (typeIDCache.has(itemName)) {
        return typeIDCache.get(itemName);
    }
    try {
        const response = await axios.get(`https://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(itemName)}`);
        if (response.data.typeID) {
            typeIDCache.set(itemName, response.data.typeID);
            return response.data.typeID;
        } else {
            console.error(`TypeID not found for "${itemName}"`);
            return null;
        }
    } catch (error) {
        console.error(`Error fetching TypeID for "${itemName}":`, error);
        return null;
    }
}

// Region ID mappings for the four main trade hubs
const tradeHubRegions = {
    jita: 10000002,
    amarr: 10000043,
    dodixie: 10000032,
    hek: 10000042,
    rens: 10000030
};

// Function to fetch market data for an item in trade hubs
async function fetchMarketDataTradeHubs(itemName, typeID, channel) {
    const results = [];
    for (const [regionName, regionID] of Object.entries(tradeHubRegions)) {
        try {
            const sellOrdersURL = `https://esi.evetech.net/latest/markets/${regionID}/orders/?datasource=tranquility&order_type=sell&type_id=${typeID}`;
            const buyOrdersURL = `https://esi.evetech.net/latest/markets/${regionID}/orders/?datasource=tranquility&order_type=buy&type_id=${typeID}`;
            
            const [sellOrdersRes, buyOrdersRes] = await Promise.all([
                limiter.schedule(() => axios.get(sellOrdersURL, { headers: { 'User-Agent': USER_AGENT }, validateStatus: status => status >= 200 && status < 500 })),
                limiter.schedule(() => axios.get(buyOrdersURL, { headers: { 'User-Agent': USER_AGENT }, validateStatus: status => status >= 200 && status < 500 }))
            ]);

            if (sellOrdersRes.status !== 200 || buyOrdersRes.status !== 200) {
                console.error(`[fetchMarketDataTradeHubs] Error fetching data for "${itemName}" in region ${regionName}`);
                continue;
            }

            const sellOrders = sellOrdersRes.data;
            const buyOrders = buyOrdersRes.data;

            if (!sellOrders.length || !buyOrders.length) {
                results.push(`❌ No market data found for "${itemName}" in ${regionName}. ❌`);
                continue;
            }

            const lowestSellOrder = sellOrders.reduce((min, order) => (order.price < min.price ? order : min), sellOrders[0]);
            const highestBuyOrder = buyOrders.reduce((max, order) => (order.price > max.price ? order : max), buyOrders[0]);

            const sellPrice = parseFloat(lowestSellOrder.price).toLocaleString(undefined, { minimumFractionDigits: 2 });
            const buyPrice = parseFloat(highestBuyOrder.price).toLocaleString(undefined, { minimumFractionDigits: 2 });

            results.push(`${regionName.toUpperCase()}: Sell: ${sellPrice} ISK, Buy: ${buyPrice} ISK`);
        } catch (error) {
            console.error(`[fetchMarketDataTradeHubs] Error fetching market data for "${itemName}" in ${regionName}`);
        }
    }

    // Prepend the item name to the results
    const finalMessage = `**Market data for ${itemName}:**\n${results.join('\n')}`;
    channel.send(finalMessage);
}

// Discord message event handler
client.on('messageCreate', async message => {
    if (message.author.bot) return; // Ignore messages from other bots
    const prefix = '!';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'market') {
        const itemName = args.join(' ').trim(); // Use full input as item name
        if (!itemName) {
            message.channel.send('❌ Please specify an item to search for. ❌');
            return;
        }

        message.channel.send(`🔍 I will get the market data for "${itemName}". This may take a little while (up to 30 seconds). Please stand by...`);

        getItemTypeID(itemName)
            .then(typeID => {
                if (typeID) {
                    fetchMarketDataTradeHubs(itemName, typeID, message.channel);
                } else {
                    message.channel.send(`❌ No TypeID found for "${itemName}". ❌`);
                }
            })
            .catch(error => {
                message.channel.send(`❌ Error fetching TypeID for "${itemName}": ${error.message} ❌`);
            });
    }
});

// Periodically ping the bot's own endpoint to keep it alive
setInterval(() => {
    axios.get('https://eve-market-discord-bot.glitch.me')
        .then(() => console.log('Ping sent to keep the service alive'))
        .catch(err => console.error('Error sending ping:', err));
}, 5 * 60 * 1000); // Ping every 5 minutes

// Set up health check route for Cloud Run
app.get('/', (req, res) => {
    res.send('Eve Market Bot is running!');
});

// Set the server to listen on the appropriate port
const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
