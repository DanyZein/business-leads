const axios = require("axios");
const { google } = require("googleapis");
const fs = require("fs");

const citiesData = require("./cities.js");
// const { places } = require("googleapis/build/src/apis/places/index.js");
require("dotenv").config();

// files
const SEEN_LEADS_FILE = "seen_leads.json";
const PROGRESS_FILE = "progress.json";

const TARGET_STATES = ["Maryland"];

const business = "Roofers";

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const loadJSON = (file, defaultVal) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : defaultVal;
const saveJSON = (file, data) =>
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

// --- THE FLATTENER ---
// This turns your complex object into a simple ["City, State"] list
function getCityList(targetStates = []) {
  let flatList = [];

  // If TARGET_STATES is empty, it uses ALL states in the file
  const statesToProcess =
    targetStates.length > 0 ? targetStates : Object.keys(citiesData);

  statesToProcess.forEach((state) => {
    // This works whether the key is "New York" or Alabama
    if (citiesData[state]) {
      citiesData[state].forEach((city) => {
        flatList.push(`${city}, ${state}`);
      });
    }
  });

  // CRITICAL: Sort ensures the order never changes between runs
  return flatList.sort();
}

// ... [Insert your existing getLeadsForCity and appendToSheet functions here] ...
// (They don't need to change)

async function getLeadsForCity(cityName) {
  // new addition
  let completedSuccessfully = true;

  let allProcessedIds = [];
  let targetLeadsForCity = [];
  let nextToken = null;

  let emptyRetries = 0;

  const seenIds = new Set(loadJSON(SEEN_LEADS_FILE, []));

  console.log(`--- Starting City: ${cityName} ---`);

  do {
    const url = "https://places.googleapis.com/v1/places:searchText";
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.MAPS_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.websiteUri,places.internationalPhoneNumber,places.formattedAddress,places.utcOffsetMinutes,places.primaryTypeDisplayName,nextPageToken",
    };

    const body = {
      textQuery: `${business} in ${cityName}`, // Uses the "City, State" format
      pageToken: nextToken,
    };

    try {
      const response = await axios.post(url, body, { headers });
      const places = response.data.places || [];

      const MAX_EMPTY_RETRIES = 3;

      // inside the try block, replace the empty page check:
      if (places.length === 0 && nextToken) {
        emptyRetries++;
        console.log(
          `Empty page, retrying token... (${emptyRetries}/${MAX_EMPTY_RETRIES})`,
        );
        if (emptyRetries >= MAX_EMPTY_RETRIES) {
          console.log(
            `Giving up on token after ${MAX_EMPTY_RETRIES} retries, moving on.`,
          );
          nextToken = null; // kills the loop
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      places.forEach((p) => {
        if (!seenIds.has(p.id)) {
          const site = p.websiteUri || "";
          const isTarget =
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
      completedSuccessfully = false;
      break;
    }
  } while (nextToken);

  return { targetLeadsForCity, allProcessedIds, completedSuccessfully };
}

async function appendToSheet(leads) {
  if (leads.length === 0) return;
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = TARGET_STATES[0];

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: "1hKbixQHN_vKxgy91w2kjvTppYHSGc2k4tqW-V69thP0",
    range: `${sheetName}!A:A`,
  });
  const startRow = (existing.data.values || []).length + 1; // next empty row

  const rows = leads.map((lead, i) => {
    const rowNum = startRow + i;

    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      lead.displayName.text,
    )}&query_place_id=${lead.id}`;
    const clickableAddress = `=HYPERLINK("${mapsUrl}", "${lead.formattedAddress}")`;

    //! old working timeformula without accounting for dst
    // const timeFormula = `=NOW() + (${lead.utcOffsetMinutes} / 1440)`;
    // const timeFormula = `=NOW() + (${utcCol}${rowNumber}/1440) + (${dstAdjCell}/1440)`;

    const timeFormula = `=NOW() + (AA${rowNum}/1440) + ($AC$2/1440)`;

    return [
      lead.displayName.text, //A
      lead.internationalPhoneNumber
        ? `'${lead.internationalPhoneNumber}`
        : "N/A", //B
      clickableAddress, //C
      "", //D
      "", //E
      lead.websiteUri || "NO WEBSITE", //F
      timeFormula, //G
      "Not Contacted", //H
      "", //I
      "", //J
      "", //k
      "", //L
      lead.primaryTypeDisplayName?.text || "Unknown", //M
      "", // N <-- new
      "", //O
      "", //P
      "", //Q
      "", //R
      "", //S
      "", //T
      "", //U
      "", //V
      "", //W
      "", //X
      "", //Y
      "", //Z
      lead.utcOffsetMinutes, //AA
      lead.id, //AB
      //AC
      ,
    ];
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: "1hKbixQHN_vKxgy91w2kjvTppYHSGc2k4tqW-V69thP0",
    range: `${sheetName}!A2`,
    // range: "Ohio!A2",
    valueInputOption: "USER_ENTERED",
    resource: { values: rows },
  });
}

// --- THE MAIN LOOP ---
(async () => {
  // 1. Generate the Master List
  const myCities = getCityList(TARGET_STATES);
  console.log(
    `Loaded ${myCities.length} cities for: ${TARGET_STATES.join(", ")}`,
  );

  // 2. Load the "Bookmark"
  let progress = loadJSON(PROGRESS_FILE, { lastCityIndex: 0 });
  let seenIds = loadJSON(SEEN_LEADS_FILE, []);

  // 3. Resume exactly where we left off
  // If progress.lastCityIndex is 5, loop starts at i = 5
  for (let i = progress.lastCityIndex; i < myCities.length; i++) {
    const city = myCities[i];

    // Run the scraper for this city
    const { targetLeadsForCity, allProcessedIds, completedSuccessfully } =
      await getLeadsForCity(city);

    if (!completedSuccessfully) {
      console.log(`❌ City failed, retrying later: ${city}`);
      break; // do NOT update progress or seen IDs
    }

    // Save Logic
    if (targetLeadsForCity.length > 0) {
      await appendToSheet(targetLeadsForCity);
      console.log(
        `✅ Success: Added ${targetLeadsForCity.length} leads for ${city}.`,
      );
    } else {
      console.log(`ℹ️ No new leads found for ${city}.`);
    }

    // Update Memory (Seen IDs)
    const updatedSeenIds = [...new Set([...seenIds, ...allProcessedIds])];
    saveJSON(SEEN_LEADS_FILE, [...updatedSeenIds]);
    seenIds = [...updatedSeenIds];
    // const updatedSeenIds = [...new Set([...seenIds, ...allProcessedIds])];
    // saveJSON(SEEN_LEADS_FILE, updatedSeenIds);
    // seenIds = updatedSeenIds;

    // Update Progress (The Bookmark)
    // We save (i + 1) so next time we start at the NEXT city
    progress.lastCityIndex = i + 1;
    saveJSON(PROGRESS_FILE, progress);

    console.log(
      `Progress saved. Completed ${i + 1}/${myCities.length} cities.`,
    );

    // Sleep to prevent rate limits
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("All cities in target list finished!");
})();
