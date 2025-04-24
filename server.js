const tmi = require('tmi.js');
const axios = require('axios');
const Bottleneck = require('bottleneck');
const express = require('express');

// Set up Express server for Cloud Run
const app = express();

// Set up rate limiter
const limiter = new Bottleneck({
    minTime: 500, // Allow slightly faster rate limiting for chained lookups
    maxConcurrent: 1
});

// --- Environment Variable Check ---
if (!process.env.TWITCH_OAUTH_TOKEN) {
    console.error("FATAL: Missing TWITCH_OAUTH_TOKEN. Check environment variables.");
    process.exit(1);
}
const USER_AGENT = process.env.USER_AGENT || 'EveTwitchMarketBot/1.4.0 (Maintainer: YourContactInfo@example.com)'; // PLEASE update contact info (Version Bumped)

// --- Twitch Client Setup ---
const client = new tmi.Client({
    options: { debug: false },
    identity: {
        username: 'Eve_twitch_market_bot', // Replace if needed
        password: process.env.TWITCH_OAUTH_TOKEN
    },
    channels: ['ne_x_is', 'contempoenterprises'] // Add/remove channels as needed
});

client.connect()
    .then(([server, port]) => console.log(`Twitch client connected to ${server}:${port}. Listening in: ${client.opts.channels.join(', ')}`))
    .catch((err) => {
        console.error("FATAL: Failed to connect to Twitch:", err);
        process.exit(1);
    });

console.log(`Using User-Agent: ${USER_AGENT}`);

// --- Caches ---
const typeIDCache = new Map();
const CACHE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour for TypeIDs
let jitaStationIDsCache = null;
let jitaCacheTimestamp = 0;
const JITA_CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours for Jita station list

// --- EVE Constants ---
const JITA_SYSTEM_ID = 30000142;
const JITA_REGION_ID = 10000002;
const PLEX_TYPE_ID = 44992;
const ESI_BASE_URL = 'https://esi.evetech.net/latest';
const DATASOURCE = 'tranquility';

// --- Combat Site Data --- (Truncated for brevity - ensure you have the full list)
const combatSites = {
    "angel hideaway": { url: "https://wiki.eveuniversity.org/Angel_Hideaway", difficulty: "4/10", foundIn: "Angel Cartel", tier: "Low" },
    // ... Add ALL other combat site entries here ...
    "teeming drone horde": { url: "https://wiki.eveuniversity.org/Teeming_Drone_Horde", difficulty: "?", foundIn: "Rogue Drones", tier: "High" },
};

// --- Helper Functions ---

async function safeSay(channel, message) {
    try {
        // Add slight delay before sending messages to avoid Twitch global rate limits if many commands come at once
        await new Promise(resolve => setTimeout(resolve, 300));
        await client.say(channel, message);
    } catch (err) {
        console.error(`[safeSay] Error sending message to ${channel}: ${err}`);
    }
}

function formatISK(price) {
    if (typeof price !== 'number' || isNaN(price)) return 'N/A';
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function getJitaStationIDs() {
    // ... (getJitaStationIDs function remains unchanged from previous answer) ...
    const now = Date.now();
    if (jitaStationIDsCache && (now - jitaCacheTimestamp < JITA_CACHE_EXPIRY_MS)) {
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
        if (response.data?.stations && Array.isArray(response.data.stations)) {
            jitaStationIDsCache = response.data.stations;
            jitaCacheTimestamp = now;
            console.log(`[getJitaStationIDs] Cached ${jitaStationIDsCache.length} station IDs for Jita system.`);
            return jitaStationIDsCache;
        } else {
            console.error("[getJitaStationIDs] Unexpected ESI response structure:", response.data);
            return null;
        }
    } catch (error) {
        console.error(`[getJitaStationIDs] Error fetching Jita system info: ${error.message}`);
        jitaStationIDsCache = null; // Don't cache failure
        jitaCacheTimestamp = 0;
        return null;
    }
}

// --- Core Logic: Type ID Lookup Sub-Functions ---

async function _esiSearch(lowerCaseItemName, strict = true) {
    const searchUrl = `${ESI_BASE_URL}/search/`;
    const params = { categories: 'inventory_type', datasource: DATASOURCE, language: 'en-us', search: lowerCaseItemName, strict };
    try {
        const esiRes = await limiter.schedule(() => axios.get(searchUrl, {
            params, headers: { 'User-Agent': USER_AGENT }, validateStatus: (s) => s === 200 || s === 404
        }));
        if (esiRes.status === 200 && esiRes.data.inventory_type?.length > 0) {
            return { success: true, ids: esiRes.data.inventory_type };
        }
        return { success: false, ids: [] }; // Not found or empty result
    } catch (error) {
        console.error(`[esiSearch - strict=${strict}] Error for "${lowerCaseItemName}": ${error.message}`);
        return { success: false, error: true }; // Indicate an actual error occurred
    }
}

async function _fuzzworkSearch(lowerCaseItemName, originalItemName) {
    // ... (Fuzzwork logic - mostly unchanged, just returns ID or null) ...
    let cleanItemName = lowerCaseItemName.replace(/[^a-z0-9\s'-]/g, '');
    if (!cleanItemName) return null;
    const fuzzUrl = `https://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(cleanItemName)}`;
    try {
        const fuzzRes = await limiter.schedule(() => axios.get(fuzzUrl, { headers: { 'User-Agent': USER_AGENT }, transformResponse: [(d) => d], validateStatus: (s) => s >= 200 && s < 500 }));
        if (fuzzRes.status !== 200) return null;
        if (typeof fuzzRes.data === 'string') {
            const potentialID = parseInt(fuzzRes.data.trim(), 10);
            if (!isNaN(potentialID) && potentialID > 0) return potentialID;
        }
        try {
            const jsonData = JSON.parse(fuzzRes.data);
             // Prioritize single, direct typeID if present
             if (jsonData?.typeID && typeof jsonData.typeID === 'number' && !isNaN(jsonData.typeID)) {
                return jsonData.typeID;
             }
             // Handle { typeName: '...', typeID: 123 } object format
             if(typeof jsonData === 'object' && jsonData !== null && jsonData.typeID && !isNaN(parseInt(jsonData.typeID, 10)) && !Array.isArray(jsonData.typeID)){
                 return parseInt(jsonData.typeID, 10);
             }
            // Handle ambiguous array { typeID: [ { typeName: '...', typeID: 1 }, ... ] } - take first
             if (Array.isArray(jsonData?.typeID) && jsonData.typeID.length > 0) {
                const firstResultID = parseInt(jsonData.typeID[0]?.typeID, 10);
                if (!isNaN(firstResultID) && firstResultID > 0) return firstResultID; // Return first match from Fuzzwork if ambiguous
            }
        } catch { /* Ignore parse error */ }
        return null; // Return null if parsing fails or format is unexpected
    } catch (error) {
        console.error(`[_fuzzworkSearch] Error for "${originalItemName}": ${error.message}`);
        return null; // Return null on error
    }
}

async function _getSuggestions(lowerCaseItemName) {
    console.log(`[_getSuggestions] Trying suggestions for "${lowerCaseItemName}"`);
    try {
        const esiResult = await _esiSearch(lowerCaseItemName, false); // Always fuzzy for suggestions
        if (esiResult.success && esiResult.ids.length > 0) {
            const potentialIDs = esiResult.ids.slice(0, 5); // Limit suggestions
            const idsUrl = `${ESI_BASE_URL}/universe/ids/`;
            const namesRes = await limiter.schedule(() => axios.post(idsUrl, potentialIDs, {
                params: { datasource: DATASOURCE, language: 'en-us' },
                headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
                validateStatus: (s) => s === 200
            }));
            if (namesRes.data?.inventory_types?.length > 0) {
                return namesRes.data.inventory_types.map(item => item.name);
            }
        }
    } catch (error) {
        console.error(`[_getSuggestions] Error fetching suggestions: ${error.message}`);
    }
    return []; // Return empty array if no suggestions found or error
}

// --- Core Logic: Master Type ID Lookup Orchestrator ---

/**
 * Tries ESI (strict, fuzzy) then Fuzzwork to find a TypeID.
 * Handles ambiguity and provides suggestions on failure.
 * Returns { typeID: number } on success,
 *         { ambiguous: true } if ESI fuzzy search yields multiple results,
 *         { error: string, suggestions?: string[] } on definitive failure.
 */
async function getMasterTypeID(itemName) {
    const lowerCaseItemName = itemName.toLowerCase().trim();
    if (!lowerCaseItemName) return { error: "No item name provided." };

    // 1. Check Cache
    const cachedEntry = typeIDCache.get(lowerCaseItemName);
    if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_EXPIRY_MS)) {
        console.log(`[getMasterTypeID] Cache HIT for "${itemName}" -> ${cachedEntry.typeID}`);
        return { typeID: cachedEntry.typeID };
    }
    console.log(`[getMasterTypeID] Cache MISS for "${itemName}". Searching APIs...`);

    // 2. ESI Strict Search
    let esiStrictResult = await _esiSearch(lowerCaseItemName, true);
    if (esiStrictResult.success && esiStrictResult.ids.length === 1) {
        const typeID = esiStrictResult.ids[0];
        console.log(`[getMasterTypeID] ESI Strict SUCCESS: ${typeID}`);
        typeIDCache.set(lowerCaseItemName, { typeID: typeID, timestamp: Date.now() });
        return { typeID: typeID };
    }
    if (esiStrictResult.error) { // Handle potential ESI errors early
         console.log(`[getMasterTypeID] ESI Strict search failed with an error.`);
         // Optionally try Fuzzwork immediately if ESI fails? Or continue to Fuzzy? Let's try Fuzzy first.
    }


    // 3. ESI Fuzzy Search (if Strict failed or returned multiple/zero)
    console.log(`[getMasterTypeID] ESI Strict failed or inconclusive. Trying ESI Fuzzy...`);
    let esiFuzzyResult = await _esiSearch(lowerCaseItemName, false);
    if (esiFuzzyResult.success) {
        if (esiFuzzyResult.ids.length === 1) {
            const typeID = esiFuzzyResult.ids[0];
            console.log(`[getMasterTypeID] ESI Fuzzy SUCCESS (single result): ${typeID}`);
            typeIDCache.set(lowerCaseItemName, { typeID: typeID, timestamp: Date.now() });
            return { typeID: typeID };
        } else if (esiFuzzyResult.ids.length > 1) {
            // *** AMBIGUOUS RESULT ***
            console.log(`[getMasterTypeID] ESI Fuzzy AMBIGUOUS (found ${esiFuzzyResult.ids.length})`);
            // We could try getting names here, but let's just report ambiguity first.
             return { ambiguous: true };
        }
        // If success but ids.length is 0, means ESI fuzzy found nothing.
    }
    if (esiFuzzyResult.error) {
        console.log(`[getMasterTypeID] ESI Fuzzy search failed with an error.`);
         // Proceed to Fuzzwork as a last resort if ESI is having issues
    }


    // 4. Fuzzwork Search (if ESI Fuzzy failed or found nothing)
    console.log(`[getMasterTypeID] ESI Fuzzy failed or no results. Trying Fuzzwork...`);
    let fuzzworkTypeID = await _fuzzworkSearch(lowerCaseItemName, itemName);
    if (fuzzworkTypeID) {
        console.log(`[getMasterTypeID] Fuzzwork SUCCESS: ${fuzzworkTypeID}`);
        typeIDCache.set(lowerCaseItemName, { typeID: fuzzworkTypeID, timestamp: Date.now() });
        return { typeID: fuzzworkTypeID };
    }

    // 5. All Failed - Get Suggestions
    console.error(`[getMasterTypeID] All lookup methods failed for "${itemName}". Getting suggestions...`);
    const suggestions = await _getSuggestions(lowerCaseItemName);
    if (suggestions.length > 0) {
        return { error: `Could not find "${itemName}".`, suggestions: suggestions };
    } else {
        return { error: `Could not find an item matching "${itemName}". Check spelling?` };
    }
}


// --- Core Logic: Market Data Fetching ---

async function fetchMarketDataFromESI(itemName, typeID, channel) { // Removed retryCount from public call
    // Internal recursive function for retries
    async function _fetchWithRetry(retryCount = 0) {
        if (typeID === PLEX_TYPE_ID) {
            console.log(`[fetchMarketDataFromESI] Detected PLEX (TypeID: ${typeID}). Not on regional market.`);
            safeSay(channel, `PLEX prices are handled via the secure NES/PLEX Vault, not the Jita market. Check in-game.`);
            return { handled: true }; // Indicate PLEX was handled
        }

        const jitaStations = await getJitaStationIDs();
        if (!jitaStations) {
            safeSay(channel, `❌ Error fetching Jita station list. Cannot get market data.`);
            return { error: true }; // Indicate error
        }
        const jitaStationSet = new Set(jitaStations);

        const marketOrdersURL = `${ESI_BASE_URL}/markets/${JITA_REGION_ID}/orders/`;
        const params = { datasource: DATASOURCE, order_type: 'all', type_id: typeID };
        console.log(`[fetchMarketDataFromESI] Fetching The Forge orders for "${itemName}" (TypeID: ${typeID})`);

        try {
            const marketRes = await limiter.schedule(() => axios.get(marketOrdersURL, { params, headers: { 'User-Agent': USER_AGENT }, validateStatus: (s) => s >= 200 && s < 504 }));

            if (marketRes.status === 503) {
                const retryDelay = Math.pow(2, retryCount) * 1000 + Math.random() * 500;
                console.error(`[fetchMarketDataFromESI] ESI 503 for "${itemName}". Retrying in ${Math.round(retryDelay / 1000)}s... (Attempt ${retryCount + 1})`);
                if (retryCount < 3) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    return _fetchWithRetry(retryCount + 1); // Recursive call
                } else {
                    safeSay(channel, `❌ ESI market data unavailable for "${itemName}" after retries.`);
                    return { error: true }; // Indicate error
                }
            }
            if (marketRes.status !== 200) {
                safeSay(channel, `❌ Error fetching market orders for "${itemName}": ESI HTTP ${marketRes.status}.`);
                return { error: true }; // Indicate error
            }

            const allOrders = marketRes.data;
            const jitaSystemSellOrders = allOrders.filter(o => !o.is_buy_order && jitaStationSet.has(o.location_id));
            const jitaSystemBuyOrders = allOrders.filter(o => o.is_buy_order && jitaStationSet.has(o.location_id));

            let lowestSellPrice = jitaSystemSellOrders.reduce((min, o) => (o.price < min ? o.price : min), Infinity);
            let highestBuyPrice = jitaSystemBuyOrders.reduce((max, o) => (o.price > max ? o.price : max), 0);

            const sellStr = lowestSellPrice !== Infinity ? formatISK(lowestSellPrice) : 'N/A';
            const buyStr = highestBuyPrice !== 0 ? formatISK(highestBuyPrice) : 'N/A';

            console.log(`[fetchMarketDataFromESI] Result for "${itemName}" (Jita System): Sell: ${sellStr}, Buy: ${buyStr}`);
            safeSay(channel, `"${itemName}" (Jita System): Sell: ${sellStr} ISK, Buy: ${buyStr} ISK`);
            return { success: true }; // Indicate success

        } catch (error) {
            console.error(`[fetchMarketDataFromESI] Error fetching market data for "${itemName}": ${error.message}`);
            safeSay(channel, `❌ Error fetching market data for "${itemName}".`);
            return { error: true }; // Indicate error
        }
    }
    // Initial call to the internal retry function
    return _fetchWithRetry();
}


// --- Twitch Event Listener ---

client.on('message', async (channel, userstate, message, self) => {
    if (self) return;

    const commandArgs = message.trim().split(/\s+/);
    const command = commandArgs[0]?.toLowerCase();

    // --- Unified Item Lookup Logic ---
    async function handleItemCommand(itemName, action) {
        if (!itemName) {
            safeSay(channel, `Usage: ${command} <item name>`); return;
        }
        try {
            const result = await getMasterTypeID(itemName); // Use the master lookup

            if (result.typeID) {
                if (action === 'market') {
                    await fetchMarketDataFromESI(itemName, result.typeID, channel);
                } else if (action === 'info') {
                    const eveRefUrl = `https://everef.net/type/${result.typeID}`;
                    safeSay(channel, `"${itemName}" Info [TypeID: ${result.typeID}]: ${eveRefUrl}`);
                }
            } else if (result.ambiguous) {
                safeSay(channel, `❌ Found multiple possible matches for "${itemName}". Please be more specific.`);
            } else if (result.error) {
                let errorMsg = result.error;
                if (result.suggestions && result.suggestions.length > 0) {
                    errorMsg += ` Did you mean: ${result.suggestions.join(', ')}?`;
                }
                safeSay(channel, `❌ ${errorMsg}`);
            }
        } catch (error) {
            console.error(`[Twitch] Unexpected error processing ${command} for "${itemName}": ${error}`);
            safeSay(channel, `❌ Unexpected error processing command for "${itemName}".`);
        }
    }

    // --- Command Routing ---
    if (command === '!market') {
        const itemName = commandArgs.slice(1).join(' ');
        console.log(`[Twitch] !market command in ${channel} for: "${itemName}"`);
        await handleItemCommand(itemName, 'market');
    }
    else if (command === '!info') {
        const itemName = commandArgs.slice(1).join(' ');
        console.log(`[Twitch] !info command in ${channel} for: "${itemName}"`);
        await handleItemCommand(itemName, 'info');
    }
    else if (command === '!combat') {
        // ... (combat command logic remains unchanged) ...
        const siteName = commandArgs.slice(1).join(' ').toLowerCase();
        console.log(`[Twitch] !combat command in ${channel} for: "${siteName}"`);
        if (!siteName) { safeSay(channel, 'Usage: !combat <combat site name>'); return; }
        const siteData = combatSites[siteName];
        if (siteData) {
            safeSay(channel, `"${siteName}" Info: ${siteData.url} | Difficulty: ${siteData.difficulty} | Faction: ${siteData.foundIn} | Tier: ${siteData.tier}`);
        } else {
            const possibleMatches = Object.keys(combatSites).filter(key => key.includes(siteName)).slice(0, 3);
            let response = `❌ Combat site "${siteName}" not found.`;
            if (possibleMatches.length > 0) response += ` Did you mean: ${possibleMatches.join(', ')}?`;
            safeSay(channel, response);
        }
    }
});

// --- Express Server & Health Check ---
// ... (Express server, health check, and graceful shutdown remain unchanged) ...
app.get('/', (req, res) => {
    const twitchConnected = client.readyState() === "OPEN";
    const status = twitchConnected ? 200 : 503;
    const message = twitchConnected ? 'Eve Twitch Market Bot running: Twitch Connected.' : 'Eve Twitch Market Bot running: Twitch DISCONNECTED.';
    console.log(`[Health Check] Status: ${status}, Twitch Connected: ${twitchConnected}`);
    res.status(status).send(message);
});

const port = process.env.PORT || 8080;
const server = app.listen(port, () => console.log(`Server listening on port ${port}`));

process.on('SIGTERM', () => {
  console.log('SIGTERM received: closing Twitch client and HTTP server...');
  client.disconnect()
    .catch(err => console.error('Error disconnecting Twitch:', err))
    .finally(() => {
        console.log('Twitch client disconnected (or failed).');
        server.close((err) => {
            if (err) {
                console.error('Error closing HTTP server:', err); process.exit(1);
            } else {
                console.log('HTTP server closed.'); process.exit(0);
            }
        });
    });
    setTimeout(() => { console.error('Graceful shutdown timeout, forcing exit.'); process.exit(1); }, 10000);
});
