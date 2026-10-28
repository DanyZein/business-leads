const axios = require("axios");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const citiesData = require("./cities.js");
require("dotenv").config();

// ============================================================================
// MARKET CONFIGURATION
// ============================================================================
const MARKET = process.env.MARKET || "LEBANON"; // "US" or "LEBANON"

const marketConfig = {
  US: {
    regionCode: "US",
    languageCode: "en",
    dailyCallLimit: 30,
    searchTerms: [
      // Tier 1: dental / aesthetic / medical
      "dental clinic",
      "dentist",
      "dermatology clinic",
      "plastic surgery clinic",
      "aesthetic clinic",
      "medical center",

      // Tier 2: solar / construction
      "solar panel installer",
      "roofing contractor",
      "waterproofing",
      "insulation contractor",
      "interior fit out",
      "aluminum and glass",

      // Tier 3: real estate
      "real estate agency",
      "real estate developer",

      // Volume filler
      "cafe",
      "salon",
    ],
  },
  LEBANON: {
    regionCode: "LB",
    languageCode: "en",
    dailyCallLimit: 30,
    searchTerms: [
      //! tier 1
      "dental clinic",
      "dentist",
      "dermatology clinic",
      "plastic surgery clinic",
      "aesthetic clinic",
      "medical center",

      //! tier 2
      "solar panel installer",
      "roofing contractor",
      "waterproofing",
      "insulation contractor",
      "interior fit out",
      "aluminum and glass",

      //! ter 3
      "real estate agency",
      "real estate developer",

      //! volume filler
      "cafe",
      "salon",

      //! arabic variants
      "عيادة أسنان",
      "عزل مائي",
      "تسقيف",
    ],
  },
};

const config = marketConfig[MARKET] || marketConfig.LEBANON;
const REGION_CODE = config.regionCode;
const LANGUAGE_CODE = config.languageCode;
const DAILY_CALL_LIMIT = config.dailyCallLimit;
const SEARCH_TERMS = config.searchTerms;

// ============================================================================
// STATE SELECTION (CLI args > env > default)
// ============================================================================
// Usage:
//   node scraper.js                    # Lebanon (default), all cities
//   MARKET=US node scraper.js          # US, all states
//   MARKET=US STATE=California node scraper.js
//   MARKET=US STATE="California,Texas" node scraper.js
//   node scraper.js California Texas   # CLI args also work

function getTargetStates() {
  // 1. CLI args (non-flag arguments)
  const cliStates = process.argv.slice(2).filter(arg => !arg.startsWith("--") && !arg.includes("="));

  // 2. Env var
  const envStates = process.env.STATE?.split(",").map(s => s.trim()).filter(Boolean) || [];

  // 3. Default: all states for the market
  const defaultStates = MARKET === "US"
    ? Object.keys(citiesData).filter(s => s !== "Lebanon")
    : ["Lebanon"];

  const selected = cliStates.length > 0 ? cliStates : (envStates.length > 0 ? envStates : defaultStates);

  // Validate
  const invalid = selected.filter(s => !citiesData[s]);
  if (invalid.length > 0) {
    console.error(`❌ Invalid state(s): ${invalid.join(", ")}`);
    console.error(`Available: ${Object.keys(citiesData).join(", ")}`);
    process.exit(1);
  }

  return selected;
}

const TARGET_STATES = getTargetStates();

// ============================================================================
// FILE PATHS (per-market, per-state)
// ============================================================================
const DATA_DIR = ".data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const QUOTA_FILE = path.join(DATA_DIR, `quota_${MARKET.toLowerCase()}.json`);
const SEEN_LEADS_FILE = path.join(DATA_DIR, `seen_leads_${MARKET.toLowerCase()}.json`);

// Per-state files will be: .data/progress_California_us.json, .data/progress_Lebanon_lebanon.json
function getProgressFile(state) {
  const safeState = state.replace(/[^a-zA-Z0-9]/g, "_");
  return path.join(DATA_DIR, `progress_${safeState}_${MARKET.toLowerCase()}.json`);
}

// ============================================================================
// GOOGLE AUTH
// ============================================================================
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
if (!SPREADSHEET_ID) {
  console.error("❌ SPREADSHEET_ID not set in .env");
  process.exit(1);
}

// ============================================================================
// HELPERS
// ============================================================================
const loadJSON = (file, defaultVal) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : defaultVal;

const saveJSON = (file, data) =>
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

function callsLeft() {
  const today = new Date().toISOString().slice(0, 10);
  const q = loadJSON(QUOTA_FILE, { date: today, used: 0 });
  if (q.date !== today) {
    q.date = today;
    q.used = 0;
  }
  return { q, left: DAILY_CALL_LIMIT - q.used };
}
function spendCall() {
  const { q } = callsLeft();
  q.used++;
  saveJSON(QUOTA_FILE, q);
}

function getCityList(states = []) {
  const flatList = [];
  const statesToProcess = states.length > 0 ? states : Object.keys(citiesData);

  statesToProcess.forEach((state) => {
    if (citiesData[state]) {
      citiesData[state].forEach((city) => {
        flatList.push({ city, state, key: `${city}, ${state}` });
      });
    }
  });

  // Sort by state, then city for deterministic ordering
  return flatList.sort((a, b) => {
    if (a.state !== b.state) return a.state.localeCompare(b.state);
    return a.city.localeCompare(b.city);
  });
}

// ============================================================================
// SHEET TAB MANAGEMENT
// ============================================================================
async function ensureSheetTabExists(sheets, tabName) {
  try {
    // Try to read the tab - if it exists, this succeeds
    await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tabName}!A1:A1`,
    });
    return true; // Tab exists
  } catch (error) {
    if (error.code === 400 || error.message?.includes("Unable to parse range")) {
      // Tab doesn't exist - create it
      console.log(`  📋 Creating sheet tab: "${tabName}"`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: tabName,
                gridProperties: { frozenRowCount: 1 }
              }
            }
          }]
        }
      });

      // Add headers
      const headers = [
        "Business Name",      // A
        "Phone",              // B
        "Address (clickable)", // C
        "", "",               // D, E
        "Website",            // F
        "Status",             // G
        "", "", "", "",       // H-K
        "Business Type",      // L
        "Search Term",        // M
        "State",              // N
        "", "", "", "", "", "", "", "", "", // O-Y
        "Place ID"            // Z
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tabName}!A1:Z1`,
        valueInputOption: "USER_ENTERED",
        resource: { values: [headers] }
      });

      return true;
    }
    throw error;
  }
}

// ============================================================================
// SCRAPER CORE
// ============================================================================
async function getLeadsForCity(cityName, state, term) {
  let completedSuccessfully = true;
  const allProcessedIds = [];
  const targetLeadsForCity = [];
  let nextToken = null;

  const seenIds = new Set(loadJSON(SEEN_LEADS_FILE, []));

  let emptyRetries = 0;
  const MAX_EMPTY_RETRIES = 2;

  console.log(`--- ${term} | ${cityName} ---`);

  do {
    const url = "https://places.googleapis.com/v1/places:searchText";
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.MAPS_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.websiteUri," +
        "places.internationalPhoneNumber,places.formattedAddress," +
        "places.utcOffsetMinutes,places.primaryTypeDisplayName," +
        "places.businessStatus,nextPageToken",
    };

    const body = {
      textQuery: `${term} in ${cityName}`,
      pageToken: nextToken,
      regionCode: REGION_CODE,
      languageCode: LANGUAGE_CODE,
    };

    try {
      spendCall();
      const response = await axios.post(url, body, { headers });
      const places = response.data.places || [];

      if (places.length === 0 && nextToken) {
        emptyRetries++;
        console.log(
          `  empty page, retrying token (${emptyRetries}/${MAX_EMPTY_RETRIES})...`,
        );
        if (emptyRetries >= MAX_EMPTY_RETRIES) {
          console.log("  giving up on this token, moving on.");
          nextToken = null;
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      emptyRetries = 0;

      places.forEach((p) => {
        if (seenIds.has(p.id)) return;

        const site = p.websiteUri || "";
        const weakSite =
          !site ||
          site.includes("sites.google.com") ||
          site.includes("linktr.ee") ||
          site.includes("wixsite.com") ||
          site.includes("square.site") ||
          site.includes("toasttab.com") ||
          site.includes("menupix.com") ||
          site.includes("fb.me") ||
          site.includes("m.facebook.com") ||
          site.includes("facebook.com") ||
          site.includes("instagram.com");

        const realBusiness =
          !!p.internationalPhoneNumber &&
          p.businessStatus !== "CLOSED_PERMANENTLY";

        if (weakSite && realBusiness) {
          targetLeadsForCity.push({ ...p, _term: term, _state: state });
        }
        allProcessedIds.push(p.id);
      });

      nextToken = response.data.nextPageToken;
      if (nextToken) {
        console.log("  fetched batch, following nextPageToken...");
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (error) {
      console.error("Error fetching batch:", error.message);
      completedSuccessfully = false;
      break;
    }
  } while (nextToken);

  return { targetLeadsForCity, allProcessedIds, completedSuccessfully };
}

// ============================================================================
// SHEET APPEND (per-state tab)
// ============================================================================
async function appendToSheet(sheets, state, leads) {
  if (leads.length === 0) return;

  // Ensure tab exists
  await ensureSheetTabExists(sheets, state);

  const rows = leads.map((lead) => {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      lead.displayName.text,
    )}&query_place_id=${lead.id}`;
    const clickableAddress = `=HYPERLINK("${mapsUrl}", "${lead.formattedAddress}")`;

    return [
      lead.displayName.text,                                    // A
      lead.internationalPhoneNumber ? `'${lead.internationalPhoneNumber}` : "N/A", // B
      clickableAddress,                                          // C
      "", "",                                                    // D, E
      lead.websiteUri || "NO WEBSITE",                          // F
      "Not Contacted",                                           // G
      "", "", "", "",                                            // H-K
      lead.primaryTypeDisplayName?.text || "Unknown",           // L
      lead._term || "",                                          // M
      lead._state || state,                                      // N (State)
      ...Array(8).fill(""),                                      // O-Y
      lead.id,                                                   // Z
    ];
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${state}!A2`,
    valueInputOption: "USER_ENTERED",
    resource: { values: rows },
  });
}

// ============================================================================
// MAIN - Per-State Processing
// ============================================================================
(async () => {
  console.log(`=== Market: ${MARKET} ===`);
  console.log(`Target states: ${TARGET_STATES.join(", ")}`);
  console.log(`Search terms: ${SEARCH_TERMS.length}`);
  console.log(`Region: ${REGION_CODE} | Daily limit: ${DAILY_CALL_LIMIT}`);

  const allCities = getCityList(TARGET_STATES);
  console.log(`Total cities: ${allCities.length}`);

  // Group cities by state for per-state processing
  const citiesByState = {};
  allCities.forEach(({ city, state, key }) => {
    if (!citiesByState[state]) citiesByState[state] = [];
    citiesByState[state].push({ city, state, key });
  });

  const sheets = google.sheets({ version: "v4", auth });
  let seenIds = loadJSON(SEEN_LEADS_FILE, []);

  // Process each state independently
  for (const state of TARGET_STATES) {
    const stateCities = citiesByState[state] || [];
    if (stateCities.length === 0) {
      console.log(`⚠️ No cities found for ${state}, skipping`);
      continue;
    }

    console.log(`\n========== STATE: ${state} (${stateCities.length} cities) ==========`);

    // Load THIS state's progress
    const progressFile = getProgressFile(state);
    let progress = loadJSON(progressFile, { lastJobIndex: 0 });

    // Build jobs for this state: city × term
    const stateJobs = [];
    stateCities.forEach(({ city, state: s, key }) => {
      SEARCH_TERMS.forEach((term) => stateJobs.push({ city, state: s, key, term }));
    });
    console.log(`Jobs for ${state}: ${stateJobs.length} (${stateCities.length} cities × ${SEARCH_TERMS.length} terms)`);

    // Resume from this state's checkpoint
    for (let i = progress.lastJobIndex; i < stateJobs.length; i++) {
      const { city, key, term } = stateJobs[i];

      if (callsLeft().left < 5) {
        console.log("\n🛑 Daily call limit reached, stopping for today.");
        console.log(`   Progress saved for ${state} at job ${i}/${stateJobs.length}`);
        console.log(`   Resume with: ${process.argv.join(" ")}`);
        process.exit(0);
      }

      const { targetLeadsForCity, allProcessedIds, completedSuccessfully } =
        await getLeadsForCity(key, state, term);

      if (!completedSuccessfully) {
        console.log(`❌ Job failed, will retry later: ${term} | ${key}`);
        break;
      }

      if (targetLeadsForCity.length > 0) {
        try {
          await appendToSheet(sheets, state, targetLeadsForCity);
          console.log(`✅ Added ${targetLeadsForCity.length} leads (${term} | ${key}).`);
        } catch (e) {
          console.error(`Sheet write failed for ${term} | ${key}:`, e.message);
          break;
        }
      } else {
        console.log(`ℹ️ No new leads (${term} | ${key}).`);
      }

      // Update global dedupe
      const updatedSeenIds = [...new Set([...seenIds, ...allProcessedIds])];
      saveJSON(SEEN_LEADS_FILE, updatedSeenIds);
      seenIds = updatedSeenIds;

      // Update THIS state's progress
      progress.lastJobIndex = i + 1;
      saveJSON(progressFile, progress);

      console.log(`Progress ${state}: ${i + 1}/${stateJobs.length} jobs`);

      await new Promise((r) => setTimeout(r, 2000));
    }

    console.log(`✅ Completed ${state}`);
  }

  console.log("\n🎉 All selected states processed (or daily limit reached).");
})();