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
    options: { debug: true }, // <--- ENABLED TMI.JS DEBUG LOGGING --->
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

const JITA_SYSTEM_ID = 30000142; // Jita system ID
const JITA_REGION_ID = 10000002; // The Forge Region ID
const PLEX_TYPE_ID = 44992; // Corrected Type ID for PLEX (Pilot's License Extension)

// Combat site data
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
    "serpentis forlorn rally point": { url: "https://wiki.eveuniversity.org/Serpentis_Forlorn_Rally_Point", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
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
        const regionId = JITA_REGION_ID; // ESI still requires a region ID even for global PLEX market, Jita's region is commonly used.

        const sellOrdersURL = `https://esi.evetech.net/latest/markets/${regionId}/orders/?datasource=tranquility&order_type=sell&type_id=${typeID}`;
        const buyOrdersURL = `https://esi.evetech.net/latest/markets/${regionId}/orders/?datasource=tranquility&order_type=buy&type_id=${typeID}`;

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
    console.log(`--------\n[client.on('message')] START | Channel: ${channel} | User: ${userstate.username} | State: ${client.readyState()} | Message: "${message}"\n--------`);

    const args = message.trim().split(/\s+/);
    const commandName = (args.shift() || '').toLowerCase();

    // !market command
    if (commandName === '!market') {
        const itemName = args.join(' ');
        console.log(`[client.on('message')] !market command received in ${channel}. Item Name: "${itemName}"`);
        if (!itemName) {
            safeSay(channel, '❌ Please specify an item name. Usage: !market <item name> ❌');
            console.log('[client.on(\'message\')] Empty Item Name for !market');
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
    // !combat command
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
    // !info command
    else if (commandName === '!info') {
        const itemName = args.join(' ');
        console.log(`[client.on('message')] !info command received in ${channel}. Item Name: "${itemName}"`);
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
        console.log(`[client.on('message')] Responding to !ping in ${channel} with state ${state}`);
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
