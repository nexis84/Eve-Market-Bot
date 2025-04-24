const tmi = require('tmi.js');
const axios = require('axios');
const Bottleneck = require('bottleneck');
const express = require('express');

// Set up Express server for Cloud Run
const app = express();

// Set up rate limiter with Bottleneck
const limiter = new Bottleneck({
    minTime: 500, // Adjusted slightly, ~2 req/sec max overall
    maxConcurrent: 1
});

// Ensure OAuth Token is properly set
if (!process.env.TWITCH_OAUTH_TOKEN) {
    console.error("FATAL: Missing TWITCH_OAUTH_TOKEN. Check your environment variables.");
    process.exit(1);
}

// Twitch Bot Configuration
const client = new tmi.Client({
    options: { debug: false },
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
        process.exit(1);
    });

// Set a default User Agent if one is not set in the environment variables. IMPORTANT for ESI.
const USER_AGENT = process.env.USER_AGENT || 'EveTwitchMarketBot/1.3.0 (Maintainer: YourContactInfo@example.com)'; // PLEASE update contact info (Version Bumped)
console.log(`Using User-Agent: ${USER_AGENT}`);

// Caches
const typeIDCache = new Map();
const CACHE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour for TypeIDs
let jitaStationIDsCache = null; // Cache for Jita system's station IDs
let jitaCacheTimestamp = 0;
const JITA_CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours for Jita station list

// EVE Online Constants
const JITA_SYSTEM_ID = 30000142;   // Jita System ID
const JITA_REGION_ID = 10000002; // The Forge Region ID
// const JITA_44_STATION_ID = 60003760; // Jita IV - Moon 4 (No longer primary filter)
const PLEX_TYPE_ID = 44992;     // Type ID for PLEX

const ESI_BASE_URL = 'https://esi.evetech.net/latest';
const DATASOURCE = 'tranquility';

// Combat site data (Keep this updated if needed)
const combatSites = { /* ... combat site data remains the same as before ... */
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

async function safeSay(channel, message) {
    try {
        await client.say(channel, message);
    } catch (err) {
        console.error(`[safeSay] Error sending message to ${channel}: ${err}`);
    }
}

function formatISK(price) {
    if (typeof price !== 'number' || isNaN(price)) {
        return 'N/A';
    }
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Fetches and caches the list of NPC station IDs within the Jita system.
 * @returns {Promise<number[]|null>} Array of station IDs or null on error.
 */
async function getJitaStationIDs() {
    const now = Date.now();
    if (jitaStationIDsCache && (now - jitaCacheTimestamp < JITA_CACHE_EXPIRY_MS)) {
        // console.log("[getJitaStationIDs] Using cached Jita station IDs.");
        return jitaStationIDsCache;
    }

    console.log("[getJitaStationIDs] Fetching Jita system info for station IDs...");
    const systemInfoUrl = `${ESI_BASE_URL}/universe/systems/${JITA_SYSTEM_ID}/`;
    try {
        const response = await limiter.schedule(() => axios.get(systemInfoUrl, {
            params: { datasource: DATASOURCE, language: 'en-us' },
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: (status) => status === 200
        }));

        if (response.data && Array.isArray(response.data.stations)) {
            jitaStationIDsCache = response.data.stations;
            jitaCacheTimestamp = now;
            console.log(`[getJitaStationIDs] Cached ${jitaStationIDsCache.length} station IDs for Jita system.`);
            return jitaStationIDsCache;
        } else {
            console.error("[getJitaStationIDs] Unexpected response structure from ESI system info:", response.data);
            return null;
        }
    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`[getJitaStationIDs] Axios error fetching Jita system info: ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data)}` : '');
        } else {
            console.error(`[getJitaStationIDs] Generic error fetching Jita system info: ${error.message}`);
        }
        // Don't permanently cache failure, allow retry later
        jitaStationIDsCache = null;
        jitaCacheTimestamp = 0;
        return null;
    }
}


// --- Core Logic Functions ---

/**
 * Gets the TypeID using ESI search, handling ambiguity better.
 * Returns object: { typeID: number } on success,
 *                 { ambiguous: true, potentialIDs: number[] } if fuzzy search is ambiguous,
 *                 { error: string } on failure.
 * @param {string} lowerCaseItemName
 * @returns {Promise<object>}
 */
async function searchESIForItemImproved(lowerCaseItemName) {
    const searchUrl = `${ESI_BASE_URL}/search/`;
    let params = {
        categories: 'inventory_type',
        datasource: DATASOURCE,
        language: 'en-us',
        search: lowerCaseItemName,
        strict: true
    };

    try {
        // 1. Strict Search
        let esiRes = await limiter.schedule(() => axios.get(searchUrl, {
            params,
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: (status) => status === 200 || status === 404
        }));

        if (esiRes.status === 200 && esiRes.data.inventory_type?.length === 1) {
            console.log(`[searchESIForItemImproved] ESI Strict SUCCESS for "${lowerCaseItemName}"`);
            return { typeID: esiRes.data.inventory_type[0] };
        }
        // Handle cases where strict somehow returns multiple (rare, but possible with weird data)
        if (esiRes.status === 200 && esiRes.data.inventory_type?.length > 1) {
             console.warn(`[searchESIForItemImproved] ESI Strict returned MULTIPLE results for "${lowerCaseItemName}", treating as ambiguous.`);
             return { ambiguous: true, potentialIDs: esiRes.data.inventory_type };
        }

        // 2. Fuzzy Search
        console.log(`[searchESIForItemImproved] ESI Strict failed for "${lowerCaseItemName}". Trying fuzzy...`);
        params.strict = false;
        esiRes = await limiter.schedule(() => axios.get(searchUrl, {
            params,
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: (status) => status === 200 || status === 404
        }));

        if (esiRes.status === 200 && esiRes.data.inventory_type?.length === 1) {
            console.log(`[searchESIForItemImproved] ESI Fuzzy SUCCESS (single result) for "${lowerCaseItemName}"`);
            return { typeID: esiRes.data.inventory_type[0] };
        }
        // *** NEW: Handle Ambiguous Fuzzy Result ***
        if (esiRes.status === 200 && esiRes.data.inventory_type?.length > 1) {
            console.log(`[searchESIForItemImproved] ESI Fuzzy AMBIGUOUS for "${lowerCaseItemName}" (found ${esiRes.data.inventory_type.length} results).`);
            return { ambiguous: true, potentialIDs: esiRes.data.inventory_type };
        }

        console.log(`[searchESIForItemImproved] ESI Fuzzy FAILED for "${lowerCaseItemName}" (Status: ${esiRes.status})`);
        return { error: "ESI search returned no results." }; // Not found via ESI

    } catch (error) {
        let errorMsg = "Error during ESI search";
        if (axios.isAxiosError(error)) {
            errorMsg = `Axios error during ESI search: ${error.message}`;
            console.error(`[searchESIForItemImproved] ${errorMsg}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data)}` : '');
        } else {
            errorMsg = `Generic error during ESI search: ${error.message}`;
            console.error(`[searchESIForItemImproved] ${errorMsg}`);
        }
        return { error: errorMsg };
    }
}

// Fuzzwork search remains mostly the same as a fallback
async function searchFuzzworkForItem(lowerCaseItemName, originalItemName) {
    // ... (Fuzzwork logic - code from previous answer remains unchanged here) ...
    let cleanItemName = lowerCaseItemName.replace(/[^a-z0-9\s'-]/g, '');
    if (!cleanItemName) return null;
    const fuzzUrl = `https://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(cleanItemName)}`;
    try {
        const fuzzRes = await limiter.schedule(() => axios.get(fuzzUrl, {
            headers: { 'User-Agent': USER_AGENT },
            transformResponse: [(data) => data],
            validateStatus: (status) => status >= 200 && status < 500
        }));
        if (fuzzRes.status !== 200) {
            console.error(`[searchFuzzworkForItem] Fuzzwork Error for "${originalItemName}" (Cleaned: "${cleanItemName}"): HTTP ${fuzzRes.status}. Response: ${fuzzRes.data}`);
            return null;
        }
        if (typeof fuzzRes.data === 'string') {
            const potentialID = parseInt(fuzzRes.data.trim(), 10);
            if (!isNaN(potentialID) && potentialID > 0) {
                 console.log(`[searchFuzzworkForItem] Fuzzwork SUCCESS (string response) for "${originalItemName}": ${potentialID}`);
                 return potentialID;
            }
        }
        try {
            const jsonData = JSON.parse(fuzzRes.data);
             if (jsonData && typeof jsonData === 'object' && jsonData.typeID && !isNaN(parseInt(jsonData.typeID, 10))) {
                 const typeID = parseInt(jsonData.typeID, 10);
                 console.log(`[searchFuzzworkForItem] Fuzzwork SUCCESS (JSON object response) for "${originalItemName}": ${typeID}`);
                 return typeID;
             }
             if (jsonData && typeof jsonData === 'object' && Array.isArray(jsonData.typeID) && jsonData.typeID.length > 0) {
                const firstResultID = parseInt(jsonData.typeID[0]?.typeID, 10);
                if (!isNaN(firstResultID) && firstResultID > 0) {
                    console.log(`[searchFuzzworkForItem] Fuzzwork AMBIGUOUS result for "${originalItemName}", using first result: ${firstResultID}`);
                    return firstResultID;
                }
             }
        } catch (parseError) {
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
 * Gets the TypeID using improved ESI search, falling back to Fuzzwork.
 * Returns the TypeID number on success, null on failure/ambiguity.
 * Handles caching.
 * @param {string} itemName
 * @returns {Promise<number|null>}
 */
async function getItemTypeIDImproved(itemName, channel) {
    const lowerCaseItemName = itemName.toLowerCase().trim();
    if (!lowerCaseItemName) return null;

    // 1. Check Cache
    const cachedEntry = typeIDCache.get(lowerCaseItemName);
    if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_EXPIRY_MS)) {
        console.log(`[getItemTypeIDImproved] Cache HIT for "${itemName}" -> ${cachedEntry.typeID}`);
        return cachedEntry.typeID;
    }

    console.log(`[getItemTypeIDImproved] Cache MISS for "${itemName}". Searching ESI...`);

    // 2. Try Improved ESI Search
    let esiResult = await searchESIForItemImproved(lowerCaseItemName);

    if (esiResult.typeID) {
        console.log(`[getItemTypeIDImproved] ESI Found TypeID for "${itemName}": ${esiResult.typeID}`);
        typeIDCache.set(lowerCaseItemName, { typeID: esiResult.typeID, timestamp: Date.now() });
        return esiResult.typeID;
    }

    // *** NEW: Handle ESI Ambiguity ***
    if (esiResult.ambiguous) {
        console.log(`[getItemTypeIDImproved] ESI search for "${itemName}" was ambiguous.`);
        safeSay(channel, `❌ Found multiple possible matches for "${itemName}". Please be more specific.`);
        // Optionally, could try to resolve esiResult.potentialIDs to names here for suggestions, but keeping it simple first.
        return null; // Don't proceed if ambiguous
    }

    // 3. Fallback to Fuzzwork if ESI had an error or no results (but wasn't ambiguous)
    if (esiResult.error || !esiResult.typeID) { // Check error or simply not found
        console.log(`[getItemTypeIDImproved] ESI search failed or no results for "${itemName}". Falling back to Fuzzwork...`);
        let fuzzworkTypeID = await searchFuzzworkForItem(lowerCaseItemName, itemName);

        if (fuzzworkTypeID) {
            console.log(`[getItemTypeIDImproved] Fuzzwork Found TypeID for "${itemName}": ${fuzzworkTypeID}`);
            typeIDCache.set(lowerCaseItemName, { typeID: fuzzworkTypeID, timestamp: Date.now() });
            return fuzzworkTypeID;
        }
    }

    console.error(`[getItemTypeIDImproved] Failed to find unambiguous TypeID for "${itemName}" using ESI and Fuzzwork.`);
    // *** NEW: Suggestion Feature ***
    await suggestItemNames(lowerCaseItemName, channel); // Try to suggest alternatives
    return null; // Indicate failure
}

/**
 * If item lookup failed, tries a final fuzzy search and suggests names.
 * @param {string} lowerCaseItemName
 * @param {string} channel
 */
async function suggestItemNames(lowerCaseItemName, channel) {
    console.log(`[suggestItemNames] Trying to find suggestions for "${lowerCaseItemName}"`);
    const searchUrl = `${ESI_BASE_URL}/search/`;
    const params = {
        categories: 'inventory_type',
        datasource: DATASOURCE,
        language: 'en-us',
        search: lowerCaseItemName,
        strict: false // Force fuzzy
    };

    try {
        const esiRes = await limiter.schedule(() => axios.get(searchUrl, {
            params,
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: (status) => status === 200 || status === 404
        }));

        if (esiRes.status === 200 && esiRes.data.inventory_type?.length > 0) {
            const potentialIDs = esiRes.data.inventory_type.slice(0, 5); // Limit suggestions

            // Use /universe/ids POST endpoint to resolve names efficiently
            const idsUrl = `${ESI_BASE_URL}/universe/ids/`;
            const namesRes = await limiter.schedule(() => axios.post(idsUrl, potentialIDs, {
                 params: { datasource: DATASOURCE, language: 'en-us' },
                 headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
                 validateStatus: (status) => status === 200
            }));

            if (namesRes.data && namesRes.data.inventory_types?.length > 0) {
                const suggestions = namesRes.data.inventory_types.map(item => item.name);
                if (suggestions.length > 0) {
                    safeSay(channel, `❌ Could not find "${lowerCaseItemName}". Did you mean: ${suggestions.join(', ')}?`);
                    return; // Exit after suggesting
                }
            }
        }
    } catch (error) {
        // Log error but don't bother the user if suggestions fail
        console.error(`[suggestItemNames] Error fetching suggestions for "${lowerCaseItemName}": ${error.message}`);
    }

    // Default message if no suggestions found or error occurred
    safeSay(channel, `❌ Could not find an item matching "${lowerCaseItemName}". Check spelling?`);
}


/**
 * Fetches market data, filtering by stations within the Jita SYSTEM.
 * Handles PLEX and retries.
 * @param {string} itemName
 * @param {number} typeID
 * @param {string} channel
 * @param {number} [retryCount=0]
 */
async function fetchMarketDataFromESI(itemName, typeID, channel, retryCount = 0) {
    if (typeID === PLEX_TYPE_ID) {
        console.log(`[fetchMarketDataFromESI] Detected PLEX (TypeID: ${typeID}). Not on regional market.`);
        safeSay(channel, `PLEX prices are handled via the secure NES/PLEX Vault, not the Jita market. Check in-game.`);
        return;
    }

    // *** NEW: Get Jita System Station IDs (cached) ***
    const jitaStations = await getJitaStationIDs();
    if (!jitaStations) {
        safeSay(channel, `❌ Error fetching Jita station list. Cannot get market data.`);
        return;
    }
    const jitaStationSet = new Set(jitaStations); // Use Set for efficient lookup

    const marketOrdersURL = `${ESI_BASE_URL}/markets/${JITA_REGION_ID}/orders/`;
    const params = {
        datasource: DATASOURCE,
        order_type: 'all',
        type_id: typeID
    };

    console.log(`[fetchMarketDataFromESI] Fetching The Forge market orders for "${itemName}" (TypeID: ${typeID})`);

    try {
        const marketRes = await limiter.schedule(() => axios.get(marketOrdersURL, {
            params,
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: (status) => status >= 200 && status < 504
        }));

        // Handle 503 retries (same as before)
        if (marketRes.status === 503) {
            // ... (retry logic remains the same) ...
             const retryDelay = Math.pow(2, retryCount) * 1000 + Math.random() * 500;
             console.error(`[fetchMarketDataFromESI] ESI Temporarily Unavailable (503) for "${itemName}" (TypeID: ${typeID}). Retrying in ${Math.round(retryDelay / 1000)}s... (Attempt ${retryCount + 1})`);
             if (retryCount < 3) {
                 await new Promise(resolve => setTimeout(resolve, retryDelay));
                 return fetchMarketDataFromESI(itemName, typeID, channel, retryCount + 1);
             } else {
                 console.error(`[fetchMarketDataFromESI] ESI Unavailable (503) for "${itemName}" (TypeID: ${typeID}) after multiple retries.`);
                 safeSay(channel, `❌ ESI market data is temporarily unavailable for "${itemName}". Please try again later.`);
                 return;
             }
        }

        if (marketRes.status !== 200) {
             console.error(`[fetchMarketDataFromESI] Error fetching market orders for "${itemName}" (TypeID: ${typeID}). HTTP Status: ${marketRes.status}. Response: ${JSON.stringify(marketRes.data)}`);
             safeSay(channel, `❌ Error fetching market orders for "${itemName}": ESI returned HTTP ${marketRes.status}.`);
             return;
         }

        const allOrders = marketRes.data;

        // *** NEW: Filter by stations in the Jita SYSTEM using the Set ***
        const jitaSystemSellOrders = allOrders.filter(order =>
            !order.is_buy_order && jitaStationSet.has(order.location_id)
        );
        const jitaSystemBuyOrders = allOrders.filter(order =>
            order.is_buy_order && jitaStationSet.has(order.location_id)
        );

        let lowestSellPrice = Infinity;
        if (jitaSystemSellOrders.length > 0) {
            lowestSellPrice = jitaSystemSellOrders.reduce((min, order) => (order.price < min ? order.price : min), Infinity);
        } else {
             console.log(`[fetchMarketDataFromESI] No SELL orders found within Jita SYSTEM stations for "${itemName}" (TypeID: ${typeID})`);
        }

        let highestBuyPrice = 0;
         if (jitaSystemBuyOrders.length > 0) {
            highestBuyPrice = jitaSystemBuyOrders.reduce((max, order) => (order.price > max ? order.price : max), 0);
         } else {
             console.log(`[fetchMarketDataFromESI] No BUY orders found within Jita SYSTEM stations for "${itemName}" (TypeID: ${typeID})`);
         }

        const sellStr = lowestSellPrice !== Infinity ? formatISK(lowestSellPrice) : 'N/A';
        const buyStr = highestBuyPrice !== 0 ? formatISK(highestBuyPrice) : 'N/A';

        console.log(`[fetchMarketDataFromESI] Result for "${itemName}" (Jita System): Sell: ${sellStr}, Buy: ${buyStr}`);
        // *** UPDATED MESSAGE ***
        safeSay(channel, `"${itemName}" (Jita System): Sell: ${sellStr} ISK, Buy: ${buyStr} ISK`);

    } catch (error) {
        // ... (error handling remains the same) ...
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
    if (self) return;

    const commandArgs = message.trim().split(/\s+/);
    const command = commandArgs[0]?.toLowerCase();

    // --- !market command ---
    if (command === '!market') {
        const itemName = commandArgs.slice(1).join(' ');
        console.log(`[Twitch] Received !market command in ${channel} for: "${itemName}"`);

        if (!itemName) {
            safeSay(channel, 'Usage: !market <item name>');
            return;
        }

        try {
            // *** Use the IMPROVED TypeID getter ***
            const typeID = await getItemTypeIDImproved(itemName, channel); // Pass channel for potential ambiguity messages/suggestions

            if (typeID) { // Only proceed if an unambiguous ID was found
                await fetchMarketDataFromESI(itemName, typeID, channel);
            }
            // If typeID is null, getItemTypeIDImproved already sent an error/suggestion message
        } catch (error) {
            console.error(`[Twitch] Error processing !market command for "${itemName}": ${error}`);
            safeSay(channel, `❌ An unexpected error occurred while searching for "${itemName}".`);
        }
    }

    // --- !combat command ---
    else if (command === '!combat') {
        // ... (combat command logic remains the same) ...
        const siteName = commandArgs.slice(1).join(' ').toLowerCase();
        console.log(`[Twitch] Received !combat command in ${channel} for: "${siteName}"`);
        if (!siteName) {
            safeSay(channel, 'Usage: !combat <combat site name>'); return;
        }
        const siteData = combatSites[siteName];
        if (siteData) {
            safeSay(channel, `"${siteName}" Info: ${siteData.url} | Difficulty: ${siteData.difficulty} | Faction: ${siteData.foundIn} | Tier: ${siteData.tier}`);
        } else {
            const possibleMatches = Object.keys(combatSites).filter(key => key.includes(siteName)).slice(0, 3);
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
             // *** Use the IMPROVED TypeID getter ***
             const typeID = await getItemTypeIDImproved(itemName, channel); // Pass channel

             if (typeID) {
                 const eveRefUrl = `https://everef.net/type/${typeID}`;
                 safeSay(channel, `"${itemName}" Info [TypeID: ${typeID}]: ${eveRefUrl}`);
             }
             // If typeID is null, getItemTypeIDImproved already sent an error/suggestion message
         } catch (error) {
             console.error(`[Twitch] Error processing !info command for "${itemName}": ${error}`);
             safeSay(channel, `❌ An unexpected error occurred while looking up info for "${itemName}".`);
         }
    }
});

// --- Basic Health Check for Cloud Run/Express ---
app.get('/', (req, res) => {
    const twitchConnected = client.readyState() === "OPEN";
    const status = twitchConnected ? 200 : 503;
    const message = twitchConnected ? 'Eve Twitch Market Bot is running and connected to Twitch.' : 'Eve Twitch Market Bot is running BUT disconnected from Twitch.';
    console.log(`[Health Check] Status: ${status}, Twitch Connected: ${twitchConnected}`);
    res.status(status).send(message);
});

// Start the Express server
const port = process.env.PORT || 8080;
const server = app.listen(port, () => { // Capture server instance
    console.log(`Server listening on port ${port}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing Twitch client and HTTP server');
  client.disconnect()
    .then(() => {
        console.log('Twitch client disconnected.');
        server.close(() => { // Close the captured HTTP server instance
            console.log('HTTP server closed.');
            process.exit(0);
        });
    })
    .catch(err => {
        console.error('Error during shutdown:', err);
        process.exit(1);
    });

    // Force close after a timeout
    setTimeout(() => {
        console.error('Could not close connections in time, forcing shutdown');
        process.exit(1);
    }, 10000); // 10 seconds timeout
});
