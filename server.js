const tmi = require('tmi.js');
const axios = require('axios');
const Bottleneck = require('bottleneck');
const express = require('express');

// Set up Express server for Cloud Run
const app = express();

// Set up rate limiter with Bottleneck
// ESI allows more requests, but Fuzzwork recommends 1/sec. Let's keep it conservative.
// A single limiter for both simplifies things, but ensure total requests stay within limits.
const limiter = new Bottleneck({
    minTime: 600, // ~1.6 requests per second max overall for external APIs
    maxConcurrent: 1 // Only one request at a time
});

// Ensure OAuth Token is properly set
if (!process.env.TWITCH_OAUTH_TOKEN) {
    console.error("FATAL: Missing TWITCH_OAUTH_TOKEN. Check your environment variables.");
    process.exit(1);
}

// Twitch Bot Configuration
const client = new tmi.Client({
    options: { debug: false }, // Set to true for verbose tmi.js logging if needed
    identity: {
        username: 'Eve_twitch_market_bot', // Replace if needed
        password: process.env.TWITCH_OAUTH_TOKEN
    },
    channels: ['ne_x_is', 'contempoenterprises'] // Add/remove channels as needed
});

// Connect the Twitch bot to the chat
client.connect()
    .then(([server, port]) => {
        console.log(`Twitch client connected to ${server}:${port}.`);
        console.log(`Listening in channels: ${client.opts.channels.join(', ')}`);
    })
    .catch((err) => {
        console.error("FATAL: Failed to connect to Twitch:", err);
        process.exit(1); // Exit if connection fails
    });

// Set a default User Agent if one is not set in the environment variables. IMPORTANT for ESI.
const USER_AGENT = process.env.USER_AGENT || 'EveTwitchMarketBot/1.2.0 (Maintainer: YourContactInfo@example.com)'; // PLEASE update contact info
console.log(`Using User-Agent: ${USER_AGENT}`);

// Cache for Type IDs
const typeIDCache = new Map();
// Cache expiry time (e.g., 1 hour)
const CACHE_EXPIRY_MS = 60 * 60 * 1000;

// EVE Online Constants
// const JITA_SYSTEM_ID = 30000142; // System ID (Less relevant for market orders)
const JITA_REGION_ID = 10000002; // The Forge Region ID
const JITA_44_STATION_ID = 60003760; // Jita IV - Moon 4 - Caldari Navy Assembly Plant (Correct ID for location filtering)
const PLEX_TYPE_ID = 44992; // Type ID for PLEX

const ESI_BASE_URL = 'https://esi.evetech.net/latest';
const DATASOURCE = 'tranquility';

// Combat site data (simplified for demonstration) - Keep this up-to-date if needed
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


// --- Helper Functions ---

// Function to safely say message in chat, handling potential rate limiting/errors
async function safeSay(channel, message) {
    try {
        await client.say(channel, message);
    } catch (err) {
        console.error(`[safeSay] Error sending message to ${channel}: ${err}`);
        // Optional: Implement retry logic or specific error handling if needed
    }
}

// Format ISK price
function formatISK(price) {
    if (typeof price !== 'number' || isNaN(price)) {
        return 'N/A';
    }
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


// --- Core Logic Functions ---

/**
 * Gets the TypeID of an item based on its name.
 * Prioritizes ESI search (strict then fuzzy), falls back to Fuzzwork.
 * Caches successful lookups.
 * @param {string} itemName The name of the item to search for.
 * @returns {Promise<number|null>} The TypeID if found, otherwise null.
 */
async function getItemTypeID(itemName) {
    const lowerCaseItemName = itemName.toLowerCase().trim();
    if (!lowerCaseItemName) return null; // Don't search empty strings

    // 1. Check Cache
    const cachedEntry = typeIDCache.get(lowerCaseItemName);
    if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_EXPIRY_MS)) {
        console.log(`[getItemTypeID] Cache HIT for "${itemName}" -> ${cachedEntry.typeID}`);
        return cachedEntry.typeID;
    }

    console.log(`[getItemTypeID] Cache MISS for "${itemName}". Searching ESI...`);

    // 2. Try ESI Search (Strict first, then Fuzzy)
    let esiTypeID = await searchESIForItem(lowerCaseItemName);

    if (esiTypeID) {
        console.log(`[getItemTypeID] ESI Found TypeID for "${itemName}": ${esiTypeID}`);
        typeIDCache.set(lowerCaseItemName, { typeID: esiTypeID, timestamp: Date.now() });
        return esiTypeID;
    }

    console.log(`[getItemTypeID] ESI search failed for "${itemName}". Falling back to Fuzzwork...`);

    // 3. Fallback to Fuzzwork
    let fuzzworkTypeID = await searchFuzzworkForItem(lowerCaseItemName, itemName); // Pass original name for logging clarity

    if (fuzzworkTypeID) {
        console.log(`[getItemTypeID] Fuzzwork Found TypeID for "${itemName}": ${fuzzworkTypeID}`);
        typeIDCache.set(lowerCaseItemName, { typeID: fuzzworkTypeID, timestamp: Date.now() });
        return fuzzworkTypeID;
    }

    console.error(`[getItemTypeID] Failed to find TypeID for "${itemName}" using both ESI and Fuzzwork.`);
    return null;
}

/**
 * Searches ESI for an item's Type ID.
 * @param {string} lowerCaseItemName Lowercase, trimmed item name.
 * @returns {Promise<number|null>} TypeID or null.
 */
async function searchESIForItem(lowerCaseItemName) {
    const searchUrl = `${ESI_BASE_URL}/search/`;
    const params = {
        categories: 'inventory_type',
        datasource: DATASOURCE,
        language: 'en-us',
        search: lowerCaseItemName,
        strict: true // Start with strict search
    };

    try {
        // Attempt Strict Search
        let esiRes = await limiter.schedule(() => axios.get(searchUrl, {
            params,
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: (status) => status === 200 || status === 404 // Allow 404 (not found)
        }));

        if (esiRes.status === 200 && esiRes.data.inventory_type && esiRes.data.inventory_type.length === 1) {
            console.log(`[searchESIForItem] ESI Strict search SUCCESS for "${lowerCaseItemName}"`);
            return esiRes.data.inventory_type[0];
        }

        // If Strict search failed or gave multiple results (unlikely but possible), try Fuzzy
        console.log(`[searchESIForItem] ESI Strict search failed or ambiguous for "${lowerCaseItemName}". Trying fuzzy search...`);
        params.strict = false;
        esiRes = await limiter.schedule(() => axios.get(searchUrl, {
            params,
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: (status) => status === 200 || status === 404
        }));

        if (esiRes.status === 200 && esiRes.data.inventory_type && esiRes.data.inventory_type.length > 0) {
            // Fuzzy search might return multiple items. We'll take the first one.
            // This is a common approach, but be aware it might not always be the *intended* item if the query was ambiguous.
            console.log(`[searchESIForItem] ESI Fuzzy search SUCCESS for "${lowerCaseItemName}" (found ${esiRes.data.inventory_type.length} results, using first).`);
            return esiRes.data.inventory_type[0];
        }

        console.log(`[searchESIForItem] ESI Fuzzy search FAILED for "${lowerCaseItemName}" (Status: ${esiRes.status})`);
        return null;

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`[searchESIForItem] Axios error during ESI search for "${lowerCaseItemName}": ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data)}` : '');
        } else {
            console.error(`[searchESIForItem] Generic error during ESI search for "${lowerCaseItemName}": ${error.message}`);
        }
        return null;
    }
}

/**
 * Searches Fuzzwork API for an item's Type ID.
 * @param {string} lowerCaseItemName Lowercase, trimmed item name (used for URL encoding).
 * @param {string} originalItemName Original item name (for logging).
 * @returns {Promise<number|null>} TypeID or null.
 */
async function searchFuzzworkForItem(lowerCaseItemName, originalItemName) {
    // Fuzzwork might be less sensitive to special chars, but basic clean is good.
    let cleanItemName = lowerCaseItemName.replace(/[^a-z0-9\s'-]/g, ''); // Allow letters, numbers, space, hyphen, apostrophe

    if (!cleanItemName) return null;

    const fuzzUrl = `https://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(cleanItemName)}`;

    try {
        const fuzzRes = await limiter.schedule(() => axios.get(fuzzUrl, {
            headers: { 'User-Agent': USER_AGENT },
            // Fuzzwork can return non-JSON plain text or JSON error/ambiguity object
            transformResponse: [(data) => data], // Keep response as string initially
            validateStatus: (status) => status >= 200 && status < 500 // Accept 2xx, 4xx
        }));

        if (fuzzRes.status !== 200) {
            console.error(`[searchFuzzworkForItem] Fuzzwork Error for "${originalItemName}" (Cleaned: "${cleanItemName}"): HTTP ${fuzzRes.status}. Response: ${fuzzRes.data}`);
            return null;
        }

        // Fuzzwork sometimes returns plain text TypeID
        if (typeof fuzzRes.data === 'string') {
            const potentialID = parseInt(fuzzRes.data.trim(), 10);
            if (!isNaN(potentialID) && potentialID > 0) {
                 console.log(`[searchFuzzworkForItem] Fuzzwork SUCCESS (string response) for "${originalItemName}": ${potentialID}`);
                 return potentialID;
            }
        }

        // Fuzzwork sometimes returns JSON (often for errors or ambiguity)
        try {
            const jsonData = JSON.parse(fuzzRes.data);
            // Check if it returned a single typeID object like { typeName: "...", typeID: 123 }
             if (jsonData && typeof jsonData === 'object' && jsonData.typeID && !isNaN(parseInt(jsonData.typeID, 10))) {
                 const typeID = parseInt(jsonData.typeID, 10);
                 console.log(`[searchFuzzworkForItem] Fuzzwork SUCCESS (JSON object response) for "${originalItemName}": ${typeID}`);
                 return typeID;
             }
            // Check if it returned an array for ambiguous results: { typeID: [ { typeName: "...", typeID: 1 }, { typeName: "...", typeID: 2 } ] }
             if (jsonData && typeof jsonData === 'object' && Array.isArray(jsonData.typeID) && jsonData.typeID.length > 0) {
                const firstResultID = parseInt(jsonData.typeID[0]?.typeID, 10);
                if (!isNaN(firstResultID) && firstResultID > 0) {
                    console.log(`[searchFuzzworkForItem] Fuzzwork AMBIGUOUS result for "${originalItemName}", using first result: ${firstResultID}`);
                    return firstResultID; // Take the first ambiguous result
                }
             }
        } catch (parseError) {
            // Ignore parse error if the string check above didn't find an ID - it means the string wasn't a simple ID
            console.warn(`[searchFuzzworkForItem] Fuzzwork response for "${originalItemName}" was not a simple TypeID string and failed JSON parsing: ${parseError.message}. Response: ${fuzzRes.data}`);
        }

        console.error(`[searchFuzzworkForItem] Fuzzwork FAILED for "${originalItemName}". Unexpected response format or no valid ID found. Response: ${fuzzRes.data}`);
        return null;

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`[searchFuzzworkForItem] Axios error during Fuzzwork search for "${originalItemName}": ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data)}` : '');
        } else {
            console.error(`[searchFuzzworkForItem] Generic error during Fuzzwork search for "${originalItemName}": ${error.message}`);
        }
        return null;
    }
}


/**
 * Fetches market data (lowest sell, highest buy) for a given TypeID from ESI.
 * Handles the special case for PLEX.
 * @param {string} itemName Original item name (for logging/messaging).
 * @param {number} typeID The TypeID of the item.
 * @param {string} channel The Twitch channel to send the message to.
 * @param {number} [retryCount=0] Internal retry counter for 503 errors.
 */
async function fetchMarketDataFromESI(itemName, typeID, channel, retryCount = 0) {
    // *** ADDED CHECK FOR PLEX ***
    if (typeID === PLEX_TYPE_ID) {
        console.log(`[fetchMarketDataFromESI] Detected PLEX (TypeID: ${typeID}). PLEX is not traded on the standard regional market.`);
        safeSay(channel, `PLEX prices are handled via the secure NES/PLEX Vault, not the Jita market. Check in-game for current rates.`);
        return; // Stop processing for PLEX
    }
    // *** END OF PLEX CHECK ***


    const marketOrdersURL = `${ESI_BASE_URL}/markets/${JITA_REGION_ID}/orders/`;
    const params = {
        datasource: DATASOURCE,
        order_type: 'all', // Fetch both buy and sell
        type_id: typeID
    };

    console.log(`[fetchMarketDataFromESI] Fetching Jita market orders for "${itemName}" (TypeID: ${typeID})`);

    try {
        // Use limiter for the ESI market call as well
        const marketRes = await limiter.schedule(() => axios.get(marketOrdersURL, {
            params,
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: (status) => status >= 200 && status < 504 // Accept 2xx and client errors, retry 503 later
        }));

        // Handle ESI 503 Service Unavailable with backoff
        if (marketRes.status === 503) {
             const retryDelay = Math.pow(2, retryCount) * 1000 + Math.random() * 500; // Exponential backoff + jitter
             console.error(`[fetchMarketDataFromESI] ESI Temporarily Unavailable (503) for "${itemName}" (TypeID: ${typeID}). Retrying in ${Math.round(retryDelay / 1000)}s... (Attempt ${retryCount + 1})`);
             if (retryCount < 3) {
                 await new Promise(resolve => setTimeout(resolve, retryDelay));
                 return fetchMarketDataFromESI(itemName, typeID, channel, retryCount + 1); // Recursive retry call
             } else {
                 console.error(`[fetchMarketDataFromESI] ESI Unavailable (503) for "${itemName}" (TypeID: ${typeID}) after multiple retries.`);
                 safeSay(channel, `❌ ESI market data is temporarily unavailable for "${itemName}". Please try again later.`);
                 return;
             }
        }

        // Handle other non-success status codes
        if (marketRes.status !== 200) {
            console.error(`[fetchMarketDataFromESI] Error fetching market orders for "${itemName}" (TypeID: ${typeID}). HTTP Status: ${marketRes.status}. Response: ${JSON.stringify(marketRes.data)}`);
            safeSay(channel, `❌ Error fetching market orders for "${itemName}": ESI returned HTTP ${marketRes.status}.`);
            return;
        }

        const allOrders = marketRes.data;

        // *** CORRECTED FILTERING: Use JITA_44_STATION_ID for location_id ***
        // Filter for Jita 4-4 sell orders specifically
        const jitaSellOrders = allOrders.filter(order => !order.is_buy_order && order.location_id === JITA_44_STATION_ID);
        // Filter for Jita 4-4 buy orders specifically
        const jitaBuyOrders = allOrders.filter(order => order.is_buy_order && order.location_id === JITA_44_STATION_ID);


        let lowestSellPrice = Infinity;
        if (jitaSellOrders.length > 0) {
            lowestSellPrice = jitaSellOrders.reduce((min, order) => (order.price < min ? order.price : min), Infinity);
        } else {
             console.log(`[fetchMarketDataFromESI] No SELL orders found specifically in Jita 4-4 for "${itemName}" (TypeID: ${typeID})`);
        }

        let highestBuyPrice = 0;
         if (jitaBuyOrders.length > 0) {
            highestBuyPrice = jitaBuyOrders.reduce((max, order) => (order.price > max ? order.price : max), 0);
         } else {
             console.log(`[fetchMarketDataFromESI] No BUY orders found specifically in Jita 4-4 for "${itemName}" (TypeID: ${typeID})`);
         }

        const sellStr = lowestSellPrice !== Infinity ? formatISK(lowestSellPrice) : 'N/A';
        const buyStr = highestBuyPrice !== 0 ? formatISK(highestBuyPrice) : 'N/A';

        console.log(`[fetchMarketDataFromESI] Result for "${itemName}": Sell: ${sellStr}, Buy: ${buyStr}`);
        safeSay(channel, `"${itemName}" (Jita 4-4): Sell: ${sellStr} ISK, Buy: ${buyStr} ISK`);

    } catch (error) {
         // Catch errors not handled by validateStatus (e.g., network errors, timeouts)
         if (axios.isAxiosError(error)) {
            console.error(`[fetchMarketDataFromESI] Axios error fetching market data for "${itemName}" (TypeID: ${typeID}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data)}` : '');
        } else {
            console.error(`[fetchMarketDataFromESI] Generic error fetching market data for "${itemName}" (TypeID: ${typeID}):`, error);
        }
        safeSay(channel, `❌ An error occurred while fetching market data for "${itemName}".`);
    }
}

// --- Twitch Event Listener ---

client.on('message', async (channel, userstate, message, self) => {
    if (self) return; // Ignore messages from the bot itself

    const messageLower = message.toLowerCase().trim();
    const commandArgs = message.trim().split(/\s+/); // Split message by spaces
    const command = commandArgs[0]?.toLowerCase(); // First word is the command

    // --- !market command ---
    if (command === '!market') {
        const itemName = commandArgs.slice(1).join(' '); // Join the rest back together
        console.log(`[Twitch] Received !market command in ${channel} for: "${itemName}"`);

        if (!itemName) {
            safeSay(channel, 'Usage: !market <item name>');
            return;
        }

        try {
            const typeID = await getItemTypeID(itemName);

            if (typeID) {
                // Directly call the updated ESI fetcher
                await fetchMarketDataFromESI(itemName, typeID, channel);
            } else {
                safeSay(channel, `❌ Could not find an item matching "${itemName}". Check spelling or try a more specific name.`);
            }
        } catch (error) {
            // Catch errors from getItemTypeID itself if any slip through
            console.error(`[Twitch] Error processing !market command for "${itemName}": ${error}`);
            safeSay(channel, `❌ An unexpected error occurred while searching for "${itemName}".`);
        }
    }

    // --- !combat command ---
    else if (command === '!combat') {
        const siteName = commandArgs.slice(1).join(' ').toLowerCase(); // Join the rest, lowercase
        console.log(`[Twitch] Received !combat command in ${channel} for: "${siteName}"`);

        if (!siteName) {
            safeSay(channel, 'Usage: !combat <combat site name>');
            return;
        }

        const siteData = combatSites[siteName]; // Direct lookup in our static data

        if (siteData) {
            safeSay(channel, `"${siteName}" Info: ${siteData.url} | Difficulty: ${siteData.difficulty} | Faction: ${siteData.foundIn} | Tier: ${siteData.tier}`);
        } else {
            // Suggest possible matches (simple substring check)
            const possibleMatches = Object.keys(combatSites).filter(key => key.includes(siteName)).slice(0, 3); // Limit suggestions
            let response = `❌ Combat site "${siteName}" not found.`;
            if (possibleMatches.length > 0) {
                response += ` Did you mean: ${possibleMatches.join(', ')}?`;
            }
            safeSay(channel, response);
        }
    }

    // --- !info command ---
    else if (command === '!info') {
         const itemName = commandArgs.slice(1).join(' ');
         console.log(`[Twitch] Received !info command in ${channel} for: "${itemName}"`);

         if (!itemName) {
            safeSay(channel, 'Usage: !info <item name>');
            return;
         }

         try {
             const typeID = await getItemTypeID(itemName);

             if (typeID) {
                 const eveRefUrl = `https://everef.net/type/${typeID}`;
                 // Future idea: Could also link to EVE University wiki if available?
                 safeSay(channel, `"${itemName}" Info [TypeID: ${typeID}]: ${eveRefUrl}`);
             } else {
                 safeSay(channel, `❌ Could not find an item matching "${itemName}" for info lookup.`);
             }
         } catch (error) {
             console.error(`[Twitch] Error processing !info command for "${itemName}": ${error}`);
             safeSay(channel, `❌ An unexpected error occurred while looking up info for "${itemName}".`);
         }
    }
});

// --- Basic Health Check for Cloud Run/Express ---
app.get('/', (req, res) => {
    // Check if TMI client thinks it's connected
    const twitchConnected = client.readyState() === "OPEN";
    const status = twitchConnected ? 200 : 503; // OK or Service Unavailable
    const message = twitchConnected ? 'Eve Twitch Market Bot is running and connected to Twitch.' : 'Eve Twitch Market Bot is running BUT disconnected from Twitch.';

    console.log(`[Health Check] Status: ${status}, Twitch Connected: ${twitchConnected}`);
    res.status(status).send(message);
});

// Start the Express server
const port = process.env.PORT || 8080; // Cloud Run expects 8080 by default
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing Twitch client and HTTP server');
  const serverInstance = app.listen(); // Need to capture the server instance if not already done
  client.disconnect()
    .then(() => {
        console.log('Twitch client disconnected.');
        serverInstance.close(() => { // Close the HTTP server gracefully
            console.log('HTTP server closed.');
            process.exit(0);
        });
    })
    .catch(err => {
        console.error('Error during shutdown:', err);
        process.exit(1); // Exit with error code if shutdown fails
    });

    // Force close after a timeout if graceful shutdown fails
    setTimeout(() => {
        console.error('Could not close connections in time, forcing shutdown');
        process.exit(1);
    }, 10000); // 10 seconds timeout
});
