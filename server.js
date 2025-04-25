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
        password: process.env.TWITCH_OAUTH_TOKEN // Ensure this includes 'chat:read' and 'chat:edit' scopes
    },
    channels: ['ne_x_is', 'contempoenterprises']
});

// Set a default User Agent if one is not set in the environment variables.
const USER_AGENT = process.env.USER_AGENT || 'TwitchBot/1.0.0 (contact@example.com)';

// Cache for Type IDs and Combat Site Info
const typeIDCache = new Map();
const combatSiteCache = new Map(); // Note: combatSiteCache isn't actually used, data is directly from combatSites object

const JITA_SYSTEM_ID = 30000142; // Jita system ID
const JITA_REGION_ID = 10000002; // The Forge Region ID

// Combat site data (simplified for demonstration) - (Data remains the same as original)
const combatSites = {
    "angel hideaway": { url: "https://wiki.eveuniversity.org/Angel_Hideaway", difficulty: "4/10", foundIn: "Angel Cartel", tier: "Low" },
    "blood hideaway": { url: "https://wiki.eveuniversity.org/Blood_Raider_Hideaway", difficulty: "None", foundIn: "Blood Raiders", tier: "Low" },
    "guristas hideaway": { url: "https://wiki.eveuniversity.org/Guristas_Hideaway", difficulty: "4/10", foundIn: "Guristas Pirates", tier: "Low" },
    "sansha hideaway": { url: "https://wiki.eveuniversity.org/Sansha_Hideaway", difficulty: "3/10", foundIn: "Sansha's Nation", tier: "Low" },
    "serpentis hideaway": { url: "https://wiki.eveuniversity.org/Serpentis_Hideaway", difficulty: "3/10", foundIn: "Serpentis Corporation", tier: "Low" },
    "drone cluster": { url: "https://wiki.eveuniversity.org/Drone_Cluster", difficulty: "None", foundIn: "Rogue Drones", tier: "Low" },
    "angel hidden hideaway": { url: "https://wiki.eveuniversity.org/Angel_Hidden_Hideaway", difficulty: "None", foundIn: "Angel Cartel", tier: "High" },
    "blood hidden hideaway": { url: "https://wiki.eveuniversity.org/Blood_Hidden_Hideaway", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "guristas hidden hideaway": { url: "https://wiki.eveuniversity.org/Guristas_Hidden_Hideaway", difficulty: "None", foundIn: "Guristas Pirates", tier: "High" },
    "sansha hidden hideaway": { url: "https://wiki.eveuniversity.org/Sansha_Hidden_Hideaway", difficulty: "None", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis hidden hideaway": { url: "https://wiki.eveuniversity.org/Serpentis_Hidden_Hideaway", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "angel forsaken hideaway": { url: "https://wiki.eveuniversity.org/Angel_Forsaken_Hideaway", difficulty: "3/10", foundIn: "Angel Cartel", tier: "High" },
    "blood forsaken hideaway": { url: "https://wiki.eveuniversity.org/Blood_Forsaken_Hideaway", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "guristas forsaken hideaway": { url: "https://wiki.eveuniversity.org/Guristas_Forsaken_Hideaway", difficulty: "7/10", foundIn: "Guristas Pirates", tier: "High" },
    "sansha forsaken hideaway": { url: "https://wiki.eveuniversity.org/Sansha_Forsaken_Hideaway", difficulty: "None", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis forsaken hideaway": { url: "https://wiki.eveuniversity.org/Serpentis_Forsaken_Hideaway", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "angel forlorn hideaway": { url: "https://wiki.eveuniversity.org/Angel_Forlorn_Hideaway", difficulty: "None", foundIn: "Angel Cartel", tier: "High" },
    "blood forlorn hideaway": { url: "https://wiki.eveuniversity.org/Blood_Forlorn_Hideaway", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "guristas forlorn hideaway": { url: "https://wiki.eveuniversity.org/Guristas_Forlorn_Hideaway", difficulty: "None", foundIn: "Guristas Pirates", tier: "High" },
    "sansha forlorn hideaway": { url: "https://wiki.eveuniversity.org/Sansha_Forlorn_Hideaway", difficulty: "None", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis forlorn hideaway": { url: "https://wiki.eveuniversity.org/Serpentis_Forlorn_Hideaway", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "angel burrow": { url: "https://wiki.eveuniversity.org/Angel_Burrow", difficulty: "None", foundIn: "Angel Cartel", tier: "Low" },
    "blood burrow": { url: "https://wiki.eveuniversity.org/Blood_Burrow", difficulty: "None", foundIn: "Blood Raiders", tier: "Low" },
    "guristas burrow": { url: "https://wiki.eveuniversity.org/Guristas_Burrow", difficulty: "None", foundIn: "Guristas Pirates", tier: "Low" },
    "sansha burrow": { url: "https://wiki.eveuniversity.org/Sansha_Burrow", difficulty: "None", foundIn: "Sansha's Nation", tier: "Low" },
    "serpentis burrow": { url: "https://wiki.eveuniversity.org/Serpentis_Burrow", difficulty: "None", foundIn: "Serpentis Corporation", tier: "Low" },
    "drone collection": { url: "https://wiki.eveuniversity.org/Drone_Collection", difficulty: "None", foundIn: "Rogue Drones", tier: "Low" },
    "angel refuge": { url: "https://wiki.eveuniversity.org/Angel_Refuge", difficulty: "5/10", foundIn: "Angel Cartel", tier: "Low" },
    "blood refuge": { url: "https://wiki.eveuniversity.org/Blood_Refuge", difficulty: "4/10", foundIn: "Blood Raiders", tier: "Low" },
    "guristas refuge": { url: "https://wiki.eveuniversity.org/Guristas_Refuge", difficulty: "4/10", foundIn: "Guristas Pirates", tier: "Low" },
    "sansha refuge": { url: "https://wiki.eveuniversity.org/Sansha_Refuge", difficulty: "3/10", foundIn: "Sansha's Nation", tier: "Low" },
    "serpentis refuge": { url: "https://wiki.eveuniversity.org/Serpentis_Refuge", difficulty: "3/10", foundIn: "Serpentis Corporation", tier: "Low" },
    "drone assembly": { url: "https://wiki.eveuniversity.org/Drone_Assembly", difficulty: "3/10", foundIn: "Rogue Drones", tier: "Low" },
    "angel den": { url: "https://wiki.eveuniversity.org/Angel_Den", difficulty: "5/10", foundIn: "Angel Cartel", tier: "Mid" },
    "blood den": { url: "https://wiki.eveuniversity.org/Blood_Den", difficulty: "5/10", foundIn: "Blood Raiders", tier: "Mid" },
    "guristas den": { url: "https://wiki.eveuniversity.org/Guristas_Den", difficulty: "5/10", foundIn: "Guristas Pirates", tier: "Mid" },
    "sansha den": { url: "https://wiki.eveuniversity.org/Sansha_Den", difficulty: "5/10", foundIn: "Sansha's Nation", tier: "Mid" },
    "serpentis den": { url: "https://wiki.eveuniversity.org/Serpentis_Den", difficulty: "5/10", foundIn: "Serpentis Corporation", tier: "Mid" },
    "drone gathering": { url: "https://wiki.eveuniversity.org/Drone_Gathering", difficulty: "3/10", foundIn: "Rogue Drones", tier: "Mid" },
    "angel hidden den": { url: "https://wiki.eveuniversity.org/Angel_Hidden_Den", difficulty: "None", foundIn: "Angel Cartel", tier: "High" },
    "blood hidden den": { url: "https://wiki.eveuniversity.org/Blood_Hidden_Den", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "guristas hidden den": { url: "https://wiki.eveuniversity.org/Guristas_Hidden_Den", difficulty: "6/10", foundIn: "Guristas Pirates", tier: "High" },
    "sansha hidden den": { url: "https://wiki.eveuniversity.org/Sansha_Hidden_Den", difficulty: "None", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis hidden den": { url: "https://wiki.eveuniversity.org/Serpentis_Hidden_Den", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "angel forsaken den": { url: "https://wiki.eveuniversity.org/Angel_Forsaken_Den", difficulty: "7/10", foundIn: "Angel Cartel", tier: "High" },
    "blood forsaken den": { url: "https://wiki.eveuniversity.org/Blood_Forsaken_Den", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "guristas forsaken den": { url: "https://wiki.eveuniversity.org/Guristas_Forsaken_Den", difficulty: "7/10", foundIn: "Guristas Pirates", tier: "High" },
    "sansha forsaken den": { url: "https://wiki.eveuniversity.org/Sansha_Forsaken_Den", difficulty: "None", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis forsaken den": { url: "https://wiki.eveuniversity.org/Serpentis_Forsaken_Den", difficulty: "7/10", foundIn: "Serpentis Corporation", tier: "High" },
    "angel forlorn den": { url: "https://wiki.eveuniversity.org/Angel_Forlorn_Den", difficulty: "7/10", foundIn: "Angel Cartel", tier: "High" },
    "blood forlorn den": { url: "https://wiki.eveuniversity.org/Blood_Forlorn_Den", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "guristas forlorn den": { url: "https://wiki.eveuniversity.org/Guristas_Forlorn_Den", difficulty: "7/10", foundIn: "Guristas Pirates", tier: "High" },
    "sansha forlorn den": { url: "https://wiki.eveuniversity.org/Sansha_Forlorn_Den", difficulty: "None", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis forlorn den": { url: "https://wiki.eveuniversity.org/Serpentis_Forlorn_Den", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "angel yard": { url: "https://wiki.eveuniversity.org/Angel_Yard", difficulty: "5/10", foundIn: "Angel Cartel", tier: "Mid" },
    "blood yard": { url: "https://wiki.eveuniversity.org/Blood_Yard", difficulty: "6/10", foundIn: "Blood Raiders", tier: "Mid" },
    "guristas yard": { url: "https://wiki.eveuniversity.org/Guristas_Yard", difficulty: "5/10", foundIn: "Guristas Pirates", tier: "Mid" },
    "sansha yard": { url: "https://wiki.eveuniversity.org/Sansha_Yard", difficulty: "6/10", foundIn: "Sansha's Nation", tier: "Mid" },
    "serpentis yard": { url: "https://wiki.eveuniversity.org/Serpentis_Yard", difficulty: "6/10", foundIn: "Serpentis Corporation", tier: "Mid" },
    "drone surveillance": { url: "https://wiki.eveuniversity.org/Drone_Surveillance", difficulty: "3/10", foundIn: "Rogue Drones", tier: "Mid" },
    "angel rally point": { url: "https://wiki.eveuniversity.org/Angel_Rally_Point", difficulty: "6/10", foundIn: "Angel Cartel", tier: "Mid" },
    "blood rally point": { url: "https://wiki.eveuniversity.org/Blood_Rally_Point", difficulty: "6/10", foundIn: "Blood Raiders", tier: "Mid" },
    "guristas rally point": { url: "https://wiki.eveuniversity.org/Guristas_Rally_Point", difficulty: "6/10", foundIn: "Guristas Pirates", tier: "Mid" },
    "sansha rally point": { url: "https://wiki.eveuniversity.org/Sansha_Rally_Point", difficulty: "6/10", foundIn: "Sansha's Nation", tier: "Mid" },
    "serpentis rally point": { url: "https://wiki.eveuniversity.org/Serpentis_Rally_Point", difficulty: "6/10", foundIn: "Serpentis Corporation", tier: "Mid" },
    "drone menagerie": { url: "https://wiki.eveuniversity.org/Drone_Menagerie", difficulty: "5/10", foundIn: "Rogue Drones", tier: "Mid" },
    "angel hidden rally point": { url: "https://wiki.eveuniversity.org/Angel_Hidden_Rally_Point", difficulty: "6/10", foundIn: "Angel Cartel", tier: "High" },
    "blood hidden rally point": { url: "https://wiki.eveuniversity.org/Blood_Hidden_Rally_Point", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "guristas hidden rally point": { url: "https://wiki.eveuniversity.org/Guristas_Hidden_Rally_Point", difficulty: "9/10", foundIn: "Guristas Pirates", tier: "High" },
    "sansha hidden rally point": { url: "https://wiki.eveuniversity.org/Sansha_Hidden_Rally_Point", difficulty: "9/10", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis hidden rally point": { url: "https://wiki.eveuniversity.org/Serpentis_Hidden_Rally_Point", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "angel forsaken rally point": { url: "https://wiki.eveuniversity.org/Angel_Forsaken_Rally_Point", difficulty: "8/10", foundIn: "Angel Cartel", tier: "High" },
    "blood forsaken rally point": { url: "https://wiki.eveuniversity.org/Blood_Forsaken_Rally_Point", difficulty: "8/10", foundIn: "Blood Raiders", tier: "High" },
    "guristas forsaken rally point": { url: "https://wiki.eveuniversity.org/Guristas_Forsaken_Rally_Point", difficulty: "8/10", foundIn: "Guristas Pirates", tier: "High" },
    "sansha forsaken rally point": { url: "https://wiki.eveuniversity.org/Sansha_Forsaken_Rally_Point", difficulty: "8/10", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis forsaken rally point": { url: "https://wiki.eveuniversity.org/Serpentis_Forsaken_Rally_Point", difficulty: "8/10", foundIn: "Serpentis Corporation", tier: "High" },
    "angel forlorn rally point": { url: "https://wiki.eveuniversity.org/Angel_Forlorn_Rally_Point", difficulty: "None", foundIn: "Angel Cartel", tier: "High" },
    "blood forlorn rally point": { url: "https://wiki.eveuniversity.org/Blood_Forlorn_Rally_Point", difficulty: "8/10", foundIn: "Blood Raiders", tier: "High" },
    "guristas forlorn rally point": { url: "https://wiki.eveuniversity.org/Guristas_Forlorn_Rally_Point", difficulty: "8/10", foundIn: "Guristas Pirates", tier: "High" },
    "sansha forlorn rally point": { url: "https://wiki.eveuniversity.org/Sansha_Forlorn_Rally_Point", difficulty: "8/10", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis forlorn rally point": { url: "https://wiki.eveuniversity.org/Serpentis_Forlorn_Rally_Point", difficulty: "8/10", foundIn: "Serpentis Corporation", tier: "High" },
    "angel port": { url: "https://wiki.eveuniversity.org/Angel_Port", difficulty: "7/10", foundIn: "Angel Cartel", tier: "Mid" },
    "blood port": { url: "https://wiki.eveuniversity.org/Blood_Port", difficulty: "7/10", foundIn: "Blood Raiders", tier: "Mid" },
    "guristas port": { url: "https://wiki.eveuniversity.org/Guristas_Port", difficulty: "7/10", foundIn: "Guristas Pirates", tier: "Mid" },
    "sansha port": { url: "https://wiki.eveuniversity.org/Sansha_Port", difficulty: "7/10", foundIn: "Sansha's Nation", tier: "Mid" },
    "serpentis port": { url: "https://wiki.eveuniversity.org/Serpentis_Port", difficulty: "7/10", foundIn: "Serpentis Corporation", tier: "Mid" },
    "drone herd": { url: "https://wiki.eveuniversity.org/Drone_Herd", difficulty: "5/10", foundIn: "Rogue Drones", tier: "Mid" },
    "angel hub": { url: "https://wiki.eveuniversity.org/Angel_Hub", difficulty: "8/10", foundIn: "Angel Cartel", tier: "Mid" },
    "blood hub": { url: "https://wiki.eveuniversity.org/Blood_Hub", difficulty: "8/10", foundIn: "Blood Raiders", tier: "Mid" },
    "guristas hub": { url: "https://wiki.eveuniversity.org/Guristas_Hub", difficulty: "8/10", foundIn: "Guristas Pirates", tier: "Mid" },
    "sansha hub": { url: "https://wiki.eveuniversity.org/Sansha_Hub", difficulty: "8/10", foundIn: "Sansha's Nation", tier: "Mid" },
    "serpentis hub": { url: "https://wiki.eveuniversity.org/Serpentis_Hub", difficulty: "8/10", foundIn: "Serpentis Corporation", tier: "Mid" },
    "drone squad": { url: "https://wiki.eveuniversity.org/Drone_Squad", difficulty: "10/10", foundIn: "Rogue Drones", tier: "Mid" },
    "angel hidden hub": { url: "https://wiki.eveuniversity.org/Angel_Hidden_Hub", difficulty: "9/10", foundIn: "Angel Cartel", tier: "High" },
    "blood hidden hub": { url: "https://wiki.eveuniversity.org/Blood_Hidden_Hub", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "guristas hidden hub": { url: "https://wiki.eveuniversity.org/Guristas_Hidden_Hub", difficulty: "9/10", foundIn: "Guristas Pirates", tier: "High" },
    "sansha hidden hub": { url: "https://wiki.eveuniversity.org/Sansha_Hidden_Hub", difficulty: "Unknown", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis hidden hub": { url: "https://wiki.eveuniversity.org/Serpentis_Hidden_Hub", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "angel forsaken hub": { url: "https://wiki.eveuniversity.org/Angel_Forsaken_Hub", difficulty: "9/10", foundIn: "Angel Cartel", tier: "High" },
    "blood forsaken hub": { url: "https://wiki.eveuniversity.org/Blood_Forsaken_Hub", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "guristas forsaken hub": { url: "https://wiki.eveuniversity.org/Guristas_Forsaken_Hub", difficulty: "9/10", foundIn: "Guristas Pirates", tier: "High" },
    "sansha forsaken hub": { url: "https://wiki.eveuniversity.org/Sansha_Forsaken_Hub", difficulty: "9/10", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis forsaken hub": { url: "https://wiki.eveuniversity.org/Serpentis_Forsaken_Hub", difficulty: "9/10", foundIn: "Serpentis Corporation", tier: "High" },
    "angel forlorn hub": { url: "https://wiki.eveuniversity.org/Angel_Forlorn_Hub", difficulty: "9/10", foundIn: "Angel Cartel", tier: "High" },
    "blood forlorn hub": { url: "https://wiki.eveuniversity.org/Blood_Forlorn_Hub", difficulty: "Unknown", foundIn: "Blood Raiders", tier: "High" },
    "guristas forlorn hub": { url: "https://wiki.eveuniversity.org/Guristas_Forlorn_Hub", difficulty: "9/10", foundIn: "Guristas Pirates", tier: "High" },
    "sansha forlorn hub": { url: "https://wiki.eveuniversity.org/Sansha_Forlorn_Hub", difficulty: "9/10", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis forlorn hub": { url: "https://wiki.eveuniversity.org/Serpentis_Forlorn_Hub", difficulty: "9/10", foundIn: "Serpentis Corporation", tier: "High" },
    "angel haven": { url: "https://wiki.eveuniversity.org/Angel_Haven", difficulty: "10/10", foundIn: "Angel Cartel", tier: "Mid" },
    "blood haven": { url: "https://wiki.eveuniversity.org/Blood_Haven", difficulty: "10/10", foundIn: "Blood Raiders", tier: "Mid" },
    "guristas haven": { url: "https://wiki.eveuniversity.org/Guristas_Haven", difficulty: "10/10", foundIn: "Guristas Pirates", tier: "Mid" },
    "sansha haven": { url: "https://wiki.eveuniversity.org/Sansha_Haven", difficulty: "10/10", foundIn: "Sansha's Nation", tier: "Mid" },
    "serpentis haven": { url: "https://wiki.eveuniversity.org/Serpentis_Haven", difficulty: "10/10", foundIn: "Serpentis Corporation", tier: "Mid" },
    "drone patrol": { url: "https://wiki.eveuniversity.org/Drone_Patrol", difficulty: "10/10", foundIn: "Rogue Drones", tier: "Mid" },
    "angel sanctum": { url: "https://wiki.eveuniversity.org/Angel_Sanctum", difficulty: "N/A", foundIn: "Angel Cartel", tier: "High" },
    "blood sanctum": { url: "https://wiki.eveuniversity.org/Blood_Sanctum", difficulty: "10/10", foundIn: "Blood Raiders", tier: "High" },
    "guristas sanctum": { url: "https://wiki.eveuniversity.org/Guristas_Sanctum", difficulty: "10/10", foundIn: "Guristas Pirates", tier: "High" },
    "sansha sanctum": { url: "https://wiki.eveuniversity.org/Sansha_Sanctum", difficulty: "10/10", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis sanctum": { url: "https://wiki.eveuniversity.org/Serpentis_Sanctum", difficulty: "10/10", foundIn: "Serpentis Corporation", tier: "High" },
    "drone horde": { url: "https://wiki.eveuniversity.org/Drone_Horde", difficulty: "10/10", foundIn: "Rogue Drones", tier: "High" },
    "angel forsaken sanctum": { url: "https://wiki.eveuniversity.org/Angel_Forsaken_Sanctum", difficulty: "?", foundIn: "Angel Cartel", tier: "High" },
    "blood forsaken sanctum": { url: "https://wiki.eveuniversity.org/Blood_Forsaken_Sanctum", difficulty: "?", foundIn: "Blood Raiders", tier: "High" },
    "guristas forsaken sanctum": { url: "https://wiki.eveuniversity.org/Guristas_Forsaken_Sanctum", difficulty: "?", foundIn: "Guristas Pirates", tier: "High" },
    "sansha forsaken sanctum": { url: "https://wiki.eveuniversity.org/Sansha_Forsaken_Sanctum", difficulty: "?", foundIn: "Sansha's Nation", tier: "High" },
    "serpentis forsaken sanctum": { url: "https://wiki.eveuniversity.org/Serpentis_Forsaken_Sanctum", difficulty: "10/10", foundIn: "Serpentis Corporation", tier: "High" },
    "teeming drone horde": { url: "https://wiki.eveuniversity.org/Teeming_Drone_Horde", difficulty: "?", foundIn: "Rogue Drones", tier: "High" },
};

// --- TMI Event Listeners (Added for Debugging) ---
client.on('connected', (addr, port) => {
    console.log(`* Connected to Twitch chat (${addr}:${port})`);
    // Send a test message to the first channel on connection
    if (client.opts.channels && client.opts.channels.length > 0) {
        const testChannel = client.opts.channels[0];
        client.say(testChannel, 'Eve_twitch_market_bot connected and ready!')
            .then(() => console.log(`Sent connection confirmation to ${testChannel}`))
            .catch(err => console.error(`Failed to send connection confirmation to ${testChannel}:`, err));
    }
});

client.on('disconnected', (reason) => {
    console.error(`Twitch client disconnected: ${reason}`);
    // Optional: Implement reconnection logic here if needed
});

client.on('error', (err) => {
    console.error('Twitch client error:', err);
});
// --- End TMI Event Listeners ---


// Connect the Twitch bot to the chat
client.connect()
    .then(() => {
        console.log("Twitch client connection initiated.");
    })
    .catch(error => {
        console.error("Twitch client failed to connect:", error);
        process.exit(1); // Exit if connection fails initially
    });


// Function to fetch market data for an item
async function fetchMarketData(itemName, typeID, channel, retryCount = 0) {
    try {
        console.log(`[fetchMarketData] Start: Fetching market data for ${itemName} (TypeID: ${typeID}), Channel: ${channel}, Retry: ${retryCount}`);
        // Call the ESI function directly
        await fetchMarketDataFromESI(itemName, typeID, channel, retryCount);
        console.log(`[fetchMarketData] End: Completed fetch attempt for ${itemName} (TypeID: ${typeID})`);

    } catch (error) {
        // Log errors that might bubble up from fetchMarketDataFromESI if not caught there
        console.error(`[fetchMarketData] General Error caught for "${itemName}": ${error.message}, Retry: ${retryCount}`);
        // Avoid sending duplicate error messages if already handled in fetchMarketDataFromESI
        // client.say(channel, `❌ Error fetching data for "${itemName}": ${error.message} ❌`);
    }
}


async function fetchMarketDataFromESI(itemName, typeID, channel, retryCount = 0) {
    try {
        console.log(`[fetchMarketDataFromESI] Start ESI Call: Fetching for ${itemName} (TypeID: ${typeID}), Retry: ${retryCount}`);

        const sellOrdersURL = `https://esi.evetech.net/latest/markets/${JITA_REGION_ID}/orders/?datasource=tranquility&order_type=sell&type_id=${typeID}`;
        const buyOrdersURL = `https://esi.evetech.net/latest/markets/${JITA_REGION_ID}/orders/?datasource=tranquility&order_type=buy&type_id=${typeID}`;

        const [sellOrdersRes, buyOrdersRes] = await Promise.all([
            axios.get(sellOrdersURL, {
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: function (status) {
                    return status >= 200 && status < 500; // Accept all status codes between 200 and 499
                },
            }),
            axios.get(buyOrdersURL, {
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: function (status) {
                    return status >= 200 && status < 500; // Accept all status codes between 200 and 499
                },
            })
        ]);

        console.log(`[fetchMarketDataFromESI] ESI Response Status - Sell: ${sellOrdersRes.status}, Buy: ${buyOrdersRes.status} for ${itemName}`); // Added Log

        if (sellOrdersRes.status !== 200) {
            console.error(`[fetchMarketDataFromESI] Error fetching sell orders. HTTP Status: ${sellOrdersRes.status}, Response: ${JSON.stringify(sellOrdersRes.data)}`);
            client.say(channel, `❌ Error fetching sell orders for "${itemName}": HTTP ${sellOrdersRes.status}. ❌`);
            return; // Stop execution for this item
        }
        if (buyOrdersRes.status !== 200) {
            console.error(`[fetchMarketDataFromESI] Error fetching buy orders. HTTP Status: ${buyOrdersRes.status}, Response: ${JSON.stringify(buyOrdersRes.data)}`);
            client.say(channel, `❌ Error fetching buy orders for "${itemName}": HTTP ${buyOrdersRes.status}. ❌`);
            return; // Stop execution for this item
        }
        const sellOrders = sellOrdersRes.data;
        const buyOrders = buyOrdersRes.data;

        if (!sellOrders || sellOrders.length === 0) {
            console.warn(`[fetchMarketDataFromESI] No sell orders found for "${itemName}" (TypeID: ${typeID}) in Jita`); // Changed to warn
            client.say(channel, `❌ No sell orders for "${itemName}" in Jita. ❌`);
            return; // Stop execution
        }

        if (!buyOrders || buyOrders.length === 0) {
            console.warn(`[fetchMarketDataFromESI] No buy orders found for "${itemName}" (TypeID: ${typeID}) in Jita`); // Changed to warn
            client.say(channel, `❌ No buy orders for "${itemName}" in Jita. ❌`);
            return; // Stop execution
        }

        // Find the lowest sell price in Jita (system_id 30000142)
        const jitaSellOrders = sellOrders.filter(order => order.system_id === JITA_SYSTEM_ID);
        if (jitaSellOrders.length === 0) {
            console.warn(`[fetchMarketDataFromESI] No Jita sell orders found for "${itemName}" (TypeID: ${typeID})`);
            client.say(channel, `❌ No sell orders specifically in Jita station for "${itemName}". ❌`);
             // Decide if you want to return here or show region lowest
             // For now, let's proceed with region lowest if no Jita station orders
        }
        const lowestSellOrder = jitaSellOrders.length > 0
            ? jitaSellOrders.reduce((min, order) => (order.price < min.price ? order : min), jitaSellOrders[0])
            : sellOrders.reduce((min, order) => (order.price < min.price ? order : min), sellOrders[0]); // Fallback to region lowest

        // Find the highest buy price in Jita (system_id 30000142)
         const jitaBuyOrders = buyOrders.filter(order => order.system_id === JITA_SYSTEM_ID);
         if (jitaBuyOrders.length === 0) {
             console.warn(`[fetchMarketDataFromESI] No Jita buy orders found for "${itemName}" (TypeID: ${typeID})`);
             client.say(channel, `❌ No buy orders specifically in Jita station for "${itemName}". ❌`);
             // Decide if you want to return here or show region highest
             // For now, let's proceed with region highest if no Jita station orders
         }
        const highestBuyOrder = jitaBuyOrders.length > 0
            ? jitaBuyOrders.reduce((max, order) => (order.price > max.price ? order : max), jitaBuyOrders[0])
            : buyOrders.reduce((max, order) => (order.price > max.price ? order : max), buyOrders[0]); // Fallback to region highest


        const sellPrice = parseFloat(lowestSellOrder.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const buyPrice = parseFloat(highestBuyOrder.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        console.log(`[fetchMarketDataFromESI] Calculated Prices - Sell: ${sellPrice}, Buy: ${buyPrice} for ${itemName}`); // Added Log
        console.log(`[fetchMarketDataFromESI] Attempting to send message to channel: ${channel} for ${itemName}`); // Added Log

        // Send the message
        await client.say(channel, `${itemName} - Jita Sell: ${sellPrice} ISK, Jita Buy: ${buyPrice} ISK`); // Added item name for clarity

        console.log(`[fetchMarketDataFromESI] Message supposedly sent for ${itemName}.`); // Added Log

    } catch (error) {
        // --- Enhanced Catch Block ---
        if (axios.isAxiosError(error)) {
            console.error(`[fetchMarketDataFromESI] Axios Error: ${error.message}, Retry: ${retryCount} for ${itemName}`);
            if (error.response) {
                 // Check specifically for 503 before retrying
                if (error.response.status === 503 && retryCount < 3) {
                    const retryDelay = Math.pow(2, retryCount) * 1500; // Exponential backoff, slightly longer base
                    console.warn(`[fetchMarketDataFromESI] ESI Temporarily Unavailable (503) for "${itemName}" (TypeID: ${typeID}). Retrying in ${retryDelay / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    // IMPORTANT: Need to 'await' the recursive call here
                    return await fetchMarketDataFromESI(itemName, typeID, channel, retryCount + 1); // Use await and return
                } else if (error.response.status === 503) { // Retries exhausted for 503
                     console.error(`[fetchMarketDataFromESI] ESI Unavailable (503) for "${itemName}" (TypeID: ${typeID}) after multiple retries.`);
                     client.say(channel, `❌ ESI Temporarily Unavailable for "${itemName}". Please try again later. ❌`);
                }
                 else {
                    // Handle other HTTP errors from ESI
                    console.error(`[fetchMarketDataFromESI] ESI HTTP Error for "${itemName}" (TypeID: ${typeID}). Status: ${error.response.status}, Response: ${JSON.stringify(error.response.data)}`);
                    client.say(channel, `❌ Error fetching market data for "${itemName}": ESI Error ${error.response.status}. ❌`);
                }
            } else {
                // Network or other Axios error without a response
                console.error(`[fetchMarketDataFromESI] Network/Request Error for "${itemName}" (TypeID: ${typeID}):`, error.message);
                client.say(channel, `❌ Network error fetching data for "${itemName}". ❌`);
            }
        } else {
            // Catch non-Axios errors (e.g., processing errors, typos)
            console.error(`[fetchMarketDataFromESI] Non-Axios Error processing "${itemName}" (TypeID: ${typeID}):`, error);
            // Send a generic error message for internal issues
            client.say(channel, `❌ An internal error occurred while processing data for "${itemName}". ❌`);
        }
        // Ensure function returns void or a specific error indicator if needed upstream
        return; // Explicitly return undefined on error
        // --- End Enhanced Catch Block ---
    }
}


// Function to handle commands from Twitch chat
client.on('message', (channel, userstate, message, self) => {
    if (self) return; // Ignore messages from the bot itself
    const command = message.trim().toLowerCase();
    const args = message.trim().split(/\s+/); // Split message into parts
    const commandName = (args.shift() || '').toLowerCase(); // Get the first word as command

    // console.log(`[client.on('message')] User: ${userstate.username}, Channel: ${channel}, Message: ${message}`); // Log incoming message details

    // !market command
    if (commandName === '!market') {
        const itemName = args.join(' '); // Rejoin the rest as item name
        console.log('[client.on(\'message\')] !market command received. Item Name:', itemName);

        if (!itemName) {
            client.say(channel, '❌ Please specify an item name. Usage: !market <item name> ❌');
            console.log('[client.on(\'message\')] Empty Item Name for !market');
            return;
        }

        getItemTypeID(itemName)
            .then(typeID => {
                if (typeID) {
                    console.log(`[client.on('message')] TypeID Found: ${typeID} for "${itemName}", calling fetchMarketData.`);
                    // Use await here IF fetchMarketData needs to complete before potentially doing something else
                    // Otherwise, just call it asynchronously
                     fetchMarketData(itemName, typeID, channel);
                } else {
                    console.log(`[client.on('message')] No TypeID found for "${itemName}".`);
                    client.say(channel, `❌ Could not find an EVE Online item matching "${itemName}". Check spelling? ❌`);
                }
            })
            .catch(error => {
                console.error(`[client.on('message')] Error during TypeID lookup for "${itemName}":`, error);
                client.say(channel, `❌ Error looking up item "${itemName}": ${error.message} ❌`);
            });
    }

    // !combat command
    else if (commandName === '!combat') {
        const siteName = args.join(' ').toLowerCase(); // Get the site name
        console.log('[client.on(\'message\')] !combat command received. Site Name:', siteName);

        if (!siteName) {
            client.say(channel, '❌ Please specify a combat site name. Usage: !combat <site name> ❌');
            return;
        }

        if (combatSites.hasOwnProperty(siteName)) {
            const siteData = combatSites[siteName];
            client.say(channel, `${siteName} | Faction: ${siteData.foundIn} | Difficulty: ${siteData.difficulty} | Tier: ${siteData.tier} | Info: ${siteData.url}`);
        } else {
            client.say(channel, `❌ Combat site "${siteName}" not found in the list. Check spelling or request it to be added. ❌`);
        }
    }

    // !info command
    else if (commandName === '!info') {
        const itemName = args.join(' '); // Get item name
        console.log(`[client.on('message')] !info command received. Item Name: ${itemName}`);

        if (!itemName) {
            client.say(channel, '❌ Please specify an item name. Usage: !info <item name> ❌');
            return;
        }

        getItemTypeID(itemName)
            .then(typeID => {
                if (typeID) {
                    const eveRefUrl = `https://everef.net/type/${typeID}`;
                    client.say(channel, `${itemName} info: ${eveRefUrl}`);
                } else {
                    client.say(channel, `❌ Could not find an EVE Online item matching "${itemName}". Check spelling? ❌`);
                }
            })
            .catch(error => {
                console.error(`[client.on('message')] Error during TypeID lookup for !info "${itemName}":`, error);
                client.say(channel, `❌ Error looking up item "${itemName}": ${error.message} ❌`);
            });
    }
});


// Function to get the TypeID of an item based on its name (using Fuzzwork API)
async function getItemTypeID(itemName) {
    const lowerCaseItemName = itemName.toLowerCase(); // Use lowercase for cache key
    if (typeIDCache.has(lowerCaseItemName)) {
        console.log(`[getItemTypeID] Cache HIT for "${itemName}"`);
        return typeIDCache.get(lowerCaseItemName);
    }
    console.log(`[getItemTypeID] Cache MISS for "${itemName}". Fetching from Fuzzwork...`);

    try {
        // Clean item name slightly - remove potential markdown or extra chars
        let cleanItemName = itemName.replace(/[^a-zA-Z0-9\s'-]/g, '').trim(); // Allow hyphens and apostrophes
        if (!cleanItemName) {
             console.error(`[getItemTypeID] Cleaned item name is empty for original: "${itemName}"`);
             return null;
        }

        const searchRes = await limiter.schedule(() => {
            console.log(`[getItemTypeID] Axios Call to Fuzzwork API for TypeID: "${cleanItemName}"`);
            return axios.get(`https://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(cleanItemName)}`, {
                headers: { 'User-Agent': USER_AGENT },
                 timeout: 5000 // Add a timeout for Fuzzwork requests
            });
        });

        // Fuzzwork returns 200 even for "not found", response body needs checking
        if (searchRes.status !== 200) {
            console.error(`[getItemTypeID] Fuzzwork API Error for "${itemName}": HTTP ${searchRes.status}. Response: ${JSON.stringify(searchRes.data)}`);
            return null;
        }

        // Fuzzwork returns an empty body or '[]' for not found, or just the ID as text, or JSON for ambiguity
        const responseData = searchRes.data;

        if (typeof responseData === 'string') {
            const typeIDString = responseData.trim();
            // Check if it's a number and not empty or '[]' which indicates not found
            if (typeIDString && !isNaN(typeIDString) && typeIDString !== '[]') {
                 const typeID = Number(typeIDString);
                 console.log(`[getItemTypeID] Fuzzwork Success (String): Found TypeID ${typeID} for "${itemName}"`);
                 typeIDCache.set(lowerCaseItemName, typeID);
                 return typeID;
            } else {
                 console.log(`[getItemTypeID] Fuzzwork Info (String): No exact match or invalid ID for "${itemName}". Response: "${typeIDString}"`);
                 return null; // Treat empty or '[]' string as not found
            }
        } else if (typeof responseData === 'object' && responseData !== null) {
            // Handle potential ambiguity (JSON object/array response)
            let foundTypeID = null;
             if (Array.isArray(responseData.typeID) && responseData.typeID.length > 0) {
                 // If multiple matches, prefer exact name match if possible, otherwise take first
                 const exactMatch = responseData.typeID.find(item => item.typeName.toLowerCase() === lowerCaseItemName);
                 foundTypeID = exactMatch ? exactMatch.typeID : responseData.typeID[0].typeID;
                 const foundName = exactMatch ? exactMatch.typeName : responseData.typeID[0].typeName;
                 console.log(`[getItemTypeID] Fuzzwork Success (Array): Found ambiguous match for "${itemName}", using ID ${foundTypeID} (${foundName})`);
             } else if (responseData.typeID && !isNaN(responseData.typeID)) {
                foundTypeID = Number(responseData.typeID);
                console.log(`[getItemTypeID] Fuzzwork Success (Object): Found TypeID ${foundTypeID} for "${itemName}"`);
             } else if (Array.isArray(responseData) && responseData.length === 0) {
                 // Handle case where it returns an empty array `[]`
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
        return null; // Return null on any error
    }
}


// Start the Express server for Cloud Run health checks etc.
const port = process.env.PORT || 8080; // Use 8080 for Cloud Run default
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

// Basic root endpoint
app.get('/', (req, res) => {
    console.log("Root endpoint '/' accessed.");
    res.status(200).send('Eve Twitch Market Bot is running and healthy.');
});

// Optional: Add a health check endpoint Cloud Run can use
app.get('/_health', (req, res) => {
    // Basic check: is the Twitch client connected?
    if (client.readyState() === 'OPEN') {
        res.status(200).send('OK');
    } else {
        console.warn("/_health check failed: Twitch client not connected.");
        res.status(503).send('Service Unavailable: Twitch client not connected');
    }
});


console.log("Eve Twitch Market Bot script finished loading.");
