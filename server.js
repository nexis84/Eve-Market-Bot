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
    "Angel Hideaway": { url: "https://wiki.eveuniversity.org/Angel_Hideaway", difficulty: "4/10", foundIn: "Angel Cartel", tier: "Low" },
    "Blood Hideaway": { url: "https://wiki.eveuniversity.org/Blood_Raider_Hideaway", difficulty: "None", foundIn: "Blood Raiders", tier: "Low" },
    "Guristas Hideaway": { url: "https://wiki.eveuniversity.org/Guristas_Hideaway", difficulty: "4/10", foundIn: "Guristas Pirates", tier: "Low" },
    "Sansha Hideaway": { url: "https://wiki.eveuniversity.org/Sansha_Hideaway", difficulty: "3/10", foundIn: "Sansha's Nation", tier: "Low" },
    "Serpentis Hideaway": { url: "https://wiki.eveuniversity.org/Serpentis_Hideaway", difficulty: "3/10", foundIn: "Serpentis Corporation", tier: "Low" },
    "Drone Cluster": { url: "https://wiki.eveuniversity.org/Drone_Cluster", difficulty: "None", foundIn: "Rogue Drones", tier: "Low" },
    "Angel Hidden Hideaway": { url: "https://wiki.eveuniversity.org/Angel_Hidden_Hideaway", difficulty: "None", foundIn: "Angel Cartel", tier: "High" },
    "Blood Hidden Hideaway": { url: "https://wiki.eveuniversity.org/Blood_Hidden_Hideaway", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Hidden Hideaway": { url: "https://wiki.eveuniversity.org/Guristas_Hidden_Hideaway", difficulty: "None", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Hidden Hideaway": { url: "https://wiki.eveuniversity.org/Sansha_Hidden_Hideaway", difficulty: "None", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Hidden Hideaway": { url: "https://wiki.eveuniversity.org/Serpentis_Hidden_Hideaway", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "Angel Forsaken Hideaway": { url: "https://wiki.eveuniversity.org/Angel_Forsaken_Hideaway", difficulty: "3/10", foundIn: "Angel Cartel", tier: "High" },
    "Blood Forsaken Hideaway": { url: "https://wiki.eveuniversity.org/Blood_Forsaken_Hideaway", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Forsaken Hideaway": { url: "https://wiki.eveuniversity.org/Guristas_Forsaken_Hideaway", difficulty: "None", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Forsaken Hideaway": { url: "https://wiki.eveuniversity.org/Sansha_Forsaken_Hideaway", difficulty: "None", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Forsaken Hideaway": { url: "https://wiki.eveuniversity.org/Serpentis_Forsaken_Hideaway", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "Angel Forlorn Hideaway": { url: "https://wiki.eveuniversity.org/Angel_Forlorn_Hideaway", difficulty: "None", foundIn: "Angel Cartel", tier: "High" },
    "Blood Forlorn Hideaway": { url: "https://wiki.eveuniversity.org/Blood_Forlorn_Hideaway", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Forlorn Hideaway": { url: "https://wiki.eveuniversity.org/Guristas_Forlorn_Hideaway", difficulty: "None", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Forlorn Hideaway": { url: "https://wiki.eveuniversity.org/Sansha_Forlorn_Hideaway", difficulty: "None", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Forlorn Hideaway": { url: "https://wiki.eveuniversity.org/Serpentis_Forlorn_Hideaway", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "Angel Burrow": { url: "https://wiki.eveuniversity.org/Angel_Burrow", difficulty: "None", foundIn: "Angel Cartel", tier: "Low" },
    "Blood Burrow": { url: "https://wiki.eveuniversity.org/Blood_Burrow", difficulty: "None", foundIn: "Blood Raiders", tier: "Low" },
    "Guristas Burrow": { url: "https://wiki.eveuniversity.org/Guristas_Burrow", difficulty: "None", foundIn: "Guristas Pirates", tier: "Low" },
    "Sansha Burrow": { url: "https://wiki.eveuniversity.org/Sansha_Burrow", difficulty: "None", foundIn: "Sansha's Nation", tier: "Low" },
    "Serpentis Burrow": { url: "https://wiki.eveuniversity.org/Serpentis_Burrow", difficulty: "None", foundIn: "Serpentis Corporation", tier: "Low" },
    "Drone Collection": { url: "https://wiki.eveuniversity.org/Drone_Collection", difficulty: "None", foundIn: "Rogue Drones", tier: "Low" },
    "Angel Refuge": { url: "https://wiki.eveuniversity.org/Angel_Refuge", difficulty: "5/10", foundIn: "Angel Cartel", tier: "Low" },
    "Blood Refuge": { url: "https://wiki.eveuniversity.org/Blood_Refuge", difficulty: "4/10", foundIn: "Blood Raiders", tier: "Low" },
    "Guristas Refuge": { url: "https://wiki.eveuniversity.org/Guristas_Refuge", difficulty: "4/10", foundIn: "Guristas Pirates", tier: "Low" },
    "Sansha Refuge": { url: "https://wiki.eveuniversity.org/Sansha_Refuge", difficulty: "3/10", foundIn: "Sansha's Nation", tier: "Low" },
    "Serpentis Refuge": { url: "https://wiki.eveuniversity.org/Serpentis_Refuge", difficulty: "3/10", foundIn: "Serpentis Corporation", tier: "Low" },
    "Drone Assembly": { url: "https://wiki.eveuniversity.org/Drone_Assembly", difficulty: "3/10", foundIn: "Rogue Drones", tier: "Low" },
    "Angel Den": { url: "https://wiki.eveuniversity.org/Angel_Den", difficulty: "5/10", foundIn: "Angel Cartel", tier: "Mid" },
    "Blood Den": { url: "https://wiki.eveuniversity.org/Blood_Den", difficulty: "5/10", foundIn: "Blood Raiders", tier: "Mid" },
    "Guristas Den": { url: "https://wiki.eveuniversity.org/Guristas_Den", difficulty: "5/10", foundIn: "Guristas Pirates", tier: "Mid" },
    "Sansha Den": { url: "https://wiki.eveuniversity.org/Sansha_Den", difficulty: "5/10", foundIn: "Sansha's Nation", tier: "Mid" },
    "Serpentis Den": { url: "https://wiki.eveuniversity.org/Serpentis_Den", difficulty: "5/10", foundIn: "Serpentis Corporation", tier: "Mid" },
    "Drone Gathering": { url: "https://wiki.eveuniversity.org/Drone_Gathering", difficulty: "3/10", foundIn: "Rogue Drones", tier: "Mid" },
    "Angel Hidden Den": { url: "https://wiki.eveuniversity.org/Angel_Hidden_Den", difficulty: "None", foundIn: "Angel Cartel", tier: "High" },
    "Blood Hidden Den": { url: "https://wiki.eveuniversity.org/Blood_Hidden_Den", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Hidden Den": { url: "https://wiki.eveuniversity.org/Guristas_Hidden_Den", difficulty: "6/10", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Hidden Den": { url: "https://wiki.eveuniversity.org/Sansha_Hidden_Den", difficulty: "None", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Hidden Den": { url: "https://wiki.eveuniversity.org/Serpentis_Hidden_Den", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "Angel Forsaken Den": { url: "https://wiki.eveuniversity.org/Angel_Forsaken_Den", difficulty: "7/10", foundIn: "Angel Cartel", tier: "High" },
    "Blood Forsaken Den": { url: "https://wiki.eveuniversity.org/Blood_Forsaken_Den", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Forsaken Den": { url: "https://wiki.eveuniversity.org/Guristas_Forsaken_Den", difficulty: "7/10", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Forsaken Den": { url: "https://wiki.eveuniversity.org/Sansha_Forsaken_Den", difficulty: "None", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Forsaken Den": { url: "https://wiki.eveuniversity.org/Serpentis_Forsaken_Den", difficulty: "7/10", foundIn: "Serpentis Corporation", tier: "High" },
    "Angel Forlorn Den": { url: "https://wiki.eveuniversity.org/Angel_Forlorn_Den", difficulty: "7/10", foundIn: "Angel Cartel", tier: "High" },
    "Blood Forlorn Den": { url: "https://wiki.eveuniversity.org/Blood_Forlorn_Den", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Forlorn Den": { url: "https://wiki.eveuniversity.org/Guristas_Forlorn_Den", difficulty: "7/10", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Forlorn Den": { url: "https://wiki.eveuniversity.org/Sansha_Forlorn_Den", difficulty: "None", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Forlorn Den": { url: "https://wiki.eveuniversity.org/Serpentis_Forlorn_Den", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "Angel Yard": { url: "https://wiki.eveuniversity.org/Angel_Yard", difficulty: "5/10", foundIn: "Angel Cartel", tier: "Mid" },
    "Blood Yard": { url: "https://wiki.eveuniversity.org/Blood_Yard", difficulty: "6/10", foundIn: "Blood Raiders", tier: "Mid" },
    "Guristas Yard": { url: "https://wiki.eveuniversity.org/Guristas_Yard", difficulty: "5/10", foundIn: "Guristas Pirates", tier: "Mid" },
    "Sansha Yard": { url: "https://wiki.eveuniversity.org/Sansha_Yard", difficulty: "6/10", foundIn: "Sansha's Nation", tier: "Mid" },
    "Serpentis Yard": { url: "https://wiki.eveuniversity.org/Serpentis_Yard", difficulty: "6/10", foundIn: "Serpentis Corporation", tier: "Mid" },
    "Drone Surveillance": { url: "https://wiki.eveuniversity.org/Drone_Surveillance", difficulty: "3/10", foundIn: "Rogue Drones", tier: "Mid" },
    "Angel Rally Point": { url: "https://wiki.eveuniversity.org/Angel_Rally_Point", difficulty: "6/10", foundIn: "Angel Cartel", tier: "Mid" },
    "Blood Rally Point": { url: "https://wiki.eveuniversity.org/Blood_Rally_Point", difficulty: "6/10", foundIn: "Blood Raiders", tier: "Mid" },
    "Guristas Rally Point": { url: "https://wiki.eveuniversity.org/Guristas_Rally_Point", difficulty: "6/10", foundIn: "Guristas Pirates", tier: "Mid" },
    "Sansha Rally Point": { url: "https://wiki.eveuniversity.org/Sansha_Rally_Point", difficulty: "6/10", foundIn: "Sansha's Nation", tier: "Mid" },
    "Serpentis Rally Point": { url: "https://wiki.eveuniversity.org/Serpentis_Rally_Point", difficulty: "6/10", foundIn: "Serpentis Corporation", tier: "Mid" },
    "Drone Menagerie": { url: "https://wiki.eveuniversity.org/Drone_Menagerie", difficulty: "5/10", foundIn: "Rogue Drones", tier: "Mid" },
    "Angel Hidden Rally Point": { url: "https://wiki.eveuniversity.org/Angel_Hidden_Rally_Point", difficulty: "6/10", foundIn: "Angel Cartel", tier: "High" },
    "Blood Hidden Rally Point": { url: "https://wiki.eveuniversity.org/Blood_Hidden_Rally_Point", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Hidden Rally Point": { url: "https://wiki.eveuniversity.org/Guristas_Hidden_Rally_Point", difficulty: "9/10", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Hidden Rally Point": { url: "https://wiki.eveuniversity.org/Sansha_Hidden_Rally_Point", difficulty: "9/10", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Hidden Rally Point": { url: "https://wiki.eveuniversity.org/Serpentis_Hidden_Rally_Point", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "Angel Forsaken Rally Point": { url: "https://wiki.eveuniversity.org/Angel_Forsaken_Rally_Point", difficulty: "8/10", foundIn: "Angel Cartel", tier: "High" },
    "Blood Forsaken Rally Point": { url: "https://wiki.eveuniversity.org/Blood_Forsaken_Rally_Point", difficulty: "8/10", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Forsaken Rally Point": { url: "https://wiki.eveuniversity.org/Guristas_Forsaken_Rally_Point", difficulty: "8/10", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Forsaken Rally Point": { url: "https://wiki.eveuniversity.org/Sansha_Forsaken_Rally_Point", difficulty: "8/10", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Forsaken Rally Point": { url: "https://wiki.eveuniversity.org/Serpentis_Forsaken_Rally_Point", difficulty: "8/10", foundIn: "Serpentis Corporation", tier: "High" },
    "Angel Forlorn Rally Point": { url: "https://wiki.eveuniversity.org/Angel_Forlorn_Rally_Point", difficulty: "None", foundIn: "Angel Cartel", tier: "High" },
    "Blood Forlorn Rally Point": { url: "https://wiki.eveuniversity.org/Blood_Forlorn_Rally_Point", difficulty: "8/10", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Forlorn Rally Point": { url: "https://wiki.eveuniversity.org/Guristas_Forlorn_Rally_Point", difficulty: "8/10", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Forlorn Rally Point": { url: "https://wiki.eveuniversity.org/Sansha_Forlorn_Rally_Point", difficulty: "8/10", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Forlorn Rally Point": { url: "https://wiki.eveuniversity.org/Serpentis_Forlorn_Rally_Point", difficulty: "8/10", foundIn: "Serpentis Corporation", tier: "High" },
    "Angel Port": { url: "https://wiki.eveuniversity.org/Angel_Port", difficulty: "7/10", foundIn: "Angel Cartel", tier: "Mid" },
    "Blood Port": { url: "https://wiki.eveuniversity.org/Blood_Port", difficulty: "7/10", foundIn: "Blood Raiders", tier: "Mid" },
    "Guristas Port": { url: "https://wiki.eveuniversity.org/Guristas_Port", difficulty: "7/10", foundIn: "Guristas Pirates", tier: "Mid" },
    "Sansha Port": { url: "https://wiki.eveuniversity.org/Sansha_Port", difficulty: "7/10", foundIn: "Sansha's Nation", tier: "Mid" },
    "Serpentis Port": { url: "https://wiki.eveuniversity.org/Serpentis_Port", difficulty: "7/10", foundIn: "Serpentis Corporation", tier: "Mid" },
    "Drone Herd": { url: "https://wiki.eveuniversity.org/Drone_Herd", difficulty: "5/10", foundIn: "Rogue Drones", tier: "Mid" },
    "Angel Hub": { url: "https://wiki.eveuniversity.org/Angel_Hub", difficulty: "8/10", foundIn: "Angel Cartel", tier: "Mid" },
    "Blood Hub": { url: "https://wiki.eveuniversity.org/Blood_Hub", difficulty: "8/10", foundIn: "Blood Raiders", tier: "Mid" },
    "Guristas Hub": { url: "https://wiki.eveuniversity.org/Guristas_Hub", difficulty: "8/10", foundIn: "Guristas Pirates", tier: "Mid" },
    "Sansha Hub": { url: "https://wiki.eveuniversity.org/Sansha_Hub", difficulty: "8/10", foundIn: "Sansha's Nation", tier: "Mid" },
    "Serpentis Hub": { url: "https://wiki.eveuniversity.org/Serpentis_Hub", difficulty: "8/10", foundIn: "Serpentis Corporation", tier: "Mid" },
    "Drone Squad": { url: "https://wiki.eveuniversity.org/Drone_Squad", difficulty: "10/10", foundIn: "Rogue Drones", tier: "Mid" },
    "Angel Hidden Hub": { url: "https://wiki.eveuniversity.org/Angel_Hidden_Hub", difficulty: "9/10", foundIn: "Angel Cartel", tier: "High" },
    "Blood Hidden Hub": { url: "https://wiki.eveuniversity.org/Blood_Hidden_Hub", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Hidden Hub": { url: "https://wiki.eveuniversity.org/Guristas_Hidden_Hub", difficulty: "9/10", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Hidden Hub": { url: "https://wiki.eveuniversity.org/Sansha_Hidden_Hub", difficulty: "Unknown", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Hidden Hub": { url: "https://wiki.eveuniversity.org/Serpentis_Hidden_Hub", difficulty: "None", foundIn: "Serpentis Corporation", tier: "High" },
    "Angel Forsaken Hub": { url: "https://wiki.eveuniversity.org/Angel_Forsaken_Hub", difficulty: "9/10", foundIn: "Angel Cartel", tier: "High" },
    "Blood Forsaken Hub": { url: "https://wiki.eveuniversity.org/Blood_Forsaken_Hub", difficulty: "None", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Forsaken Hub": { url: "https://wiki.eveuniversity.org/Guristas_Forsaken_Hub", difficulty: "9/10", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Forsaken Hub": { url: "https://wiki.eveuniversity.org/Sansha_Forsaken_Hub", difficulty: "9/10", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Forsaken Hub": { url: "https://wiki.eveuniversity.org/Serpentis_Forsaken_Hub", difficulty: "9/10", foundIn: "Serpentis Corporation", tier: "High" },
    "Angel Forlorn Hub": { url: "https://wiki.eveuniversity.org/Angel_Forlorn_Hub", difficulty: "9/10", foundIn: "Angel Cartel", tier: "High" },
    "Blood Forlorn Hub": { url: "https://wiki.eveuniversity.org/Blood_Forlorn_Hub", difficulty: "Unknown", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Forlorn Hub": { url: "https://wiki.eveuniversity.org/Guristas_Forlorn_Hub", difficulty: "9/10", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Forlorn Hub": { url: "https://wiki.eveuniversity.org/Sansha_Forlorn_Hub", difficulty: "9/10", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Forlorn Hub": { url: "https://wiki.eveuniversity.org/Serpentis_Forlorn_Hub", difficulty: "9/10", foundIn: "Serpentis Corporation", tier: "High" },
    "Angel Haven": { url: "https://wiki.eveuniversity.org/Angel_Haven", difficulty: "10/10", foundIn: "Angel Cartel", tier: "Mid" },
    "Blood Haven": { url: "https://wiki.eveuniversity.org/Blood_Haven", difficulty: "10/10", foundIn: "Blood Raiders", tier: "Mid" },
    "Guristas Haven": { url: "https://wiki.eveuniversity.org/Guristas_Haven", difficulty: "10/10", foundIn: "Guristas Pirates", tier: "Mid" },
    "Sansha Haven": { url: "https://wiki.eveuniversity.org/Sansha_Haven", difficulty: "10/10", foundIn: "Sansha's Nation", tier: "Mid" },
    "Serpentis Haven": { url: "https://wiki.eveuniversity.org/Serpentis_Haven", difficulty: "10/10", foundIn: "Serpentis Corporation", tier: "Mid" },
    "Drone Patrol": { url: "https://wiki.eveuniversity.org/Drone_Patrol", difficulty: "10/10",foundIn: "Rogue Drones", tier: "Mid" },
    "Angel Sanctum": { url: "https://wiki.eveuniversity.org/Angel_Sanctum", difficulty: "N/A", foundIn: "Angel Cartel", tier: "High" },
    "Blood Sanctum": { url: "https://wiki.eveuniversity.org/Blood_Sanctum", difficulty: "10/10", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Sanctum": { url: "https://wiki.eveuniversity.org/Guristas_Sanctum", difficulty: "10/10", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Sanctum": { url: "https://wiki.eveuniversity.org/Sansha_Sanctum", difficulty: "10/10", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Sanctum": { url: "https://wiki.eveuniversity.org/Serpentis_Sanctum", difficulty: "10/10", foundIn: "Serpentis Corporation", tier: "High" },
    "Drone Horde": { url: "https://wiki.eveuniversity.org/Drone_Horde", difficulty: "10/10", foundIn: "Rogue Drones", tier: "High" },
    "Angel Forsaken Sanctum": { url: "https://wiki.eveuniversity.org/Angel_Forsaken_Sanctum", difficulty: "?", foundIn: "Angel Cartel", tier: "High" },
    "Blood Forsaken Sanctum": { url: "https://wiki.eveuniversity.org/Blood_Forsaken_Sanctum", difficulty: "?", foundIn: "Blood Raiders", tier: "High" },
    "Guristas Forsaken Sanctum": { url: "https://wiki.eveuniversity.org/Guristas_Forsaken_Sanctum", difficulty: "?", foundIn: "Guristas Pirates", tier: "High" },
    "Sansha Forsaken Sanctum": { url: "https://wiki.eveuniversity.org/Sansha_Forsaken_Sanctum", difficulty: "?", foundIn: "Sansha's Nation", tier: "High" },
    "Serpentis Forsaken Sanctum": { url: "https://wiki.eveuniversity.org/Serpentis_Forsaken_Sanctum", difficulty: "10/10", foundIn: "Serpentis Corporation", tier: "High" },
    "Teeming Drone Horde": { url: "https://wiki.eveuniversity.org/Teeming_Drone_Horde", difficulty: "?", foundIn: "Rogue Drones", tier: "High" },
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
        //    console.log(`[fetchMarketDataFromESI] Output: Sell: ${sellPrice} ISK, Buy: ${buyPrice} ISK, Retry: ${retryCount}`);
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
            //  console.log(`[getItemTypeID] Axios Call to Fuzzwork TypeID: ${itemName}`);
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
            //  console.log(`[getItemTypeID] TypeID Response (String) for "${itemName}": "${typeID}"`);

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
