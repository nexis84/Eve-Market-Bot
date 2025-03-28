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

// Combat site data (simplified for demonstration)
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
    "guristas forsaken hideaway": { url: "https://wiki.eveuniversity.org/Guristas_Forsaken_Hideaway", difficulty: "None", foundIn: "Guristas Pirates", tier: "High" },
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
    "drone patrol": { url: "https://wiki.eveuniversity.org/Drone_Patrol", difficulty: "10/10", foundIn: "Rogue Drones",tier: "Mid" },
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
        //    console.log(`[fetchMarketDataFromESI] Output: Sell: ${sellPrice} ISK, Buy: ${buyPrice} ISK, Retry: ${retryCount}`);
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
        const itemIdentifier = message.slice(7).trim().toLowerCase(); // Changed from 6 to 7 and toLowerCase()
        console.log('[client.on(\'message\')] !combat command:', message); // Changed from !info to !combat
        console.log('[client.on(\'message\')] Item Identifier:', itemIdentifier);

        // Check if the item name or ID is empty
        if (!itemIdentifier) {
            client.say(channel, '❌ Please specify a combat site name. ❌'); // Changed the message
            return;
        }

        // Check if it is a combat site.
        if (combatSites.hasOwnProperty(itemIdentifier)) {
            const siteData = combatSites[itemIdentifier];
            client.say(channel, `${itemIdentifier} Info: ${siteData.url}, Difficulty: ${siteData.difficulty}, Found In: ${siteData.foundIn}, Tier: ${siteData.tier}`);
            return;
        } else {
            client.say(channel, `❌ Combat site "${itemIdentifier}" not found. ❌`); //tell user if site is not found
        }
    }
    // !info command
    if (message.toLowerCase().startsWith('!info')) {
        const itemName = message.slice(6).trim(); // Remove '!info ' and get the item name
        console.log(`[client.on('message')] !info command, Item Name: ${itemName}`);

        if (!itemName) {
            client.say(channel, '❌ Please specify an item to search for. ❌');
            return;
        }

        getItemTypeID(itemName)
            .then((typeID) => {
                if (typeID) {
                    const eveRefUrl = `https://everef.net/?type=${typeID}`;
                    client.say(channel, `${itemName} info: ${eveRefUrl}`);
                } else {
                   client.say(channel, `❌ No TypeID found for "${itemName}". ❌`);
                }
            })
            .catch((error) => {
                client.say(channel, `❌ Error fetching TypeID for "${itemName}": ${error.message} ❌`);
                console.error(`[client.on('message')] Error fetching TypeID:`, error);
            });
    }
    // !search command
    if (message.toLowerCase().startsWith('!search')) {
        const query = message.slice(7).trim(); // Remove '!search ' and get the query
        console.log(`[client.on('message')] !search command, Query: ${query}`);

        if (!query) {
            client.say(channel, '❌ Please specify a search query. ❌');
            return;
        }

        const searchUrl = `https://wiki.eveuniversity.org/index.php?search=${encodeURIComponent(query)}`;
        client.say(channel, `Search results for "${query}": ${searchUrl}`);
    }
});


// Function to get the TypeID of an item based on its name
async function getItemTypeID(itemName) {
    const lowerCaseItemName = itemName.toLowerCase(); //convert to lower case
    if (typeIDCache.has(lowerCaseItemName)) {
        //  console.log(`[getItemTypeID] Using cached TypeID for "${itemName}"`)
        return typeIDCache.get(lowerCaseItemName);
    }

    try {
        // Fetch the typeID using the fuzzwork api
        let cleanItemName = itemName.replace(/[^a-zA-Z0-9\s]/g, '');
        const searchRes = await limiter.schedule(() => {
            //  console.log(`[getItemTypeID] Axios Call to Fuzzwork TypeID: ${itemName}`);
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
            //  console.log(`[getItemTypeID] TypeID Response (String)
