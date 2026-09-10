const axios = require("axios");
const { google } = require("googleapis");
const fs = require("fs");
// 1. Import the city data
const citiesData = require("../cities.js");
require("dotenv").config();

const SEEN_LEADS_FILE = "seen_leads.json";
const PROGRESS_FILE = "progress.json";

// --- CONFIGURATION ---
// Leave empty [] to search ALL states (WARNING: High API Usage),
// or add specific states to focus your credit on.
const TARGET_STATES = ["Texas", "New Jersey"];
// ---------------------

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const loadJSON = (file, defaultVal) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : defaultVal;
const saveJSON = (file, data) =>
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

// 2. The Flattener Helper
function getCityList(targetStates = []) {
  let flatList = [];

  // Decide: Specific states or ALL states?
  const statesToProcess =
    targetStates.length > 0 ? targetStates : Object.keys(citiesData);

  statesToProcess.forEach((state) => {
    // Check if state exists in our file to avoid crashing
    if (citiesData[state]) {
      citiesData[state].forEach((city) => {
        flatList.push(`${city}, ${state}`);
      });
    }
  });

  // CRITICAL: Sort alphabetically so "Index 5" is always the same city
  return flatList.sort();
}

async function getLeadsForCity(cityName) {
  let allProcessedIds = [];
  let targetLeadsForCity = [];
  let nextToken = null;
  const seenIds = loadJSON(SEEN_LEADS_FILE, []);

  console.log(`--- Starting City: ${cityName} ---`);

  do {
    const url = "https://places.googleapis.com/v1/places:searchText";
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.MAPS_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.websiteUri,places.internationalPhoneNumber,places.formattedAddress,places.utcOffsetMinutes,nextPageToken",
    };

    const body = {
      textQuery: `Restaurants in ${cityName}`, // Uses the "City, State" format
      pageToken: nextToken,
    };

    try {
      const response = await axios.post(url, body, { headers });
      const places = response.data.places || [];

      places.forEach((p) => {
        if (!seenIds.includes(p.id)) {
          const site = p.websiteUri || "";
          const isTarget =
            !site ||
            site.includes("facebook.com") ||
            site.includes("instagram.com");

          if (isTarget) {
            targetLeadsForCity.push(p);
          }
          allProcessedIds.push(p.id);
        }
      });

      nextToken = response.data.nextPageToken;
      if (nextToken) {
        console.log(`Fetched batch...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (error) {
      console.error("Error fetching batch:", error.message);
      break;
    }
  } while (nextToken);

  return { targetLeadsForCity, allProcessedIds };
}

async function appendToSheet(leads) {
  if (leads.length === 0) return;
  const sheets = google.sheets({ version: "v4", auth });

  const rows = leads.map((lead) => {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      lead.displayName.text
    )}&query_place_id=${lead.id}`;
    const clickableAddress = `=HYPERLINK("${mapsUrl}", "${lead.formattedAddress}")`;
    const timeFormula = `=NOW() + (${lead.utcOffsetMinutes} / 1440)`;

    return [
      lead.displayName.text,
      lead.internationalPhoneNumber
        ? `'${lead.internationalPhoneNumber}`
        : "N/A",
      clickableAddress,
      lead.websiteUri || "NO WEBSITE",
      timeFormula,
      "Call",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "", // Padding for Columns G-N
      lead.utcOffsetMinutes, // Column O
    ];
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: "1SuTSpYZPgL1Ugmf0QY4qWnvWh_Aqr4iATpqXi9mIKcU",
    range: "Master!A1",
    valueInputOption: "USER_ENTERED",
    resource: { values: rows },
  });
}

(async () => {
  // 3. Generate the Dynamic List
  const myCities = getCityList(TARGET_STATES);

  console.log(`Loaded ${myCities.length} cities to process.`);

  let progress = loadJSON(PROGRESS_FILE, { lastCityIndex: 0 });
  let seenIds = loadJSON(SEEN_LEADS_FILE, []);

  // Loop using the progress index
  for (let i = progress.lastCityIndex; i < myCities.length; i++) {
    const city = myCities[i];

    // Safety check in case list length changed
    if (!city) break;

    const { targetLeadsForCity, allProcessedIds } = await getLeadsForCity(city);

    if (targetLeadsForCity.length > 0) {
      await appendToSheet(targetLeadsForCity);
      console.log(
        `✅ Success: Added ${targetLeadsForCity.length} leads for ${city}.`
      );
    } else {
      console.log(`ℹ️ No new leads found for ${city}.`);
    }

    const updatedSeenIds = [...new Set([...seenIds, ...allProcessedIds])];
    saveJSON(SEEN_LEADS_FILE, updatedSeenIds);
    seenIds = updatedSeenIds;

    // Update Progress
    progress.lastCityIndex = i + 1;
    saveJSON(PROGRESS_FILE, progress);

    // Optional: Small pause between cities to be nice to the API
    console.log(`Waiting 2 seconds before next city...`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("All cities in target list finished!");
})();
