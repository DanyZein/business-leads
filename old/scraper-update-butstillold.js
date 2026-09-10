const axios = require("axios");
const { google } = require("googleapis");
const fs = require("fs");
require("dotenv").config();

// Files for "Memory"
const SEEN_LEADS_FILE = "seen_leads.json";
const PROGRESS_FILE = "progress.json";

// 1. Setup Auth
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// Helper to load/save JSON files
const loadJSON = (file, defaultVal) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : defaultVal;
const saveJSON = (file, data) =>
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

async function getLeadsForCity(cityName) {
  let allProcessedIds = []; // Temporary storage for this run
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
      textQuery: `Restaurants in ${cityName}`,
      pageToken: nextToken,
    };

    try {
      const response = await axios.post(url, body, { headers });
      const places = response.data.places || [];

      places.forEach((p) => {
        // 1. Check if we've EVER seen this before
        if (!seenIds.includes(p.id)) {
          const site = p.websiteUri || "";
          const isTarget =
            !site ||
            site.includes("facebook.com") ||
            site.includes("instagram.com");

          if (isTarget) {
            targetLeadsForCity.push(p);
          }
          // Add to temporary list so we mark it as seen AFTER the city is done
          allProcessedIds.push(p.id);
        }
      });

      nextToken = response.data.nextPageToken;
      if (nextToken) {
        console.log(
          `Fetched batch. Found ${targetLeadsForCity.length} potential leads so far...`
        );
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
    // Construct the direct Maps URL using the Place ID
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      lead.displayName.text
    )}&query_place_id=${lead.id}`;

    // Format the Address as a clickable formula
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
      lead.utcOffsetMinutes,
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
  const myCities = ["Dallas, Texas", "Austin, Texas", "Hillsboro, Texas"];
  let progress = loadJSON(PROGRESS_FILE, { lastCityIndex: 0 });
  let seenIds = loadJSON(SEEN_LEADS_FILE, []);

  for (let i = progress.lastCityIndex; i < myCities.length; i++) {
    const city = myCities[i];
    const { targetLeadsForCity, allProcessedIds } = await getLeadsForCity(city);

    if (targetLeadsForCity.length > 0) {
      await appendToSheet(targetLeadsForCity);
      console.log(
        `✅ Success: Added ${targetLeadsForCity.length} leads for ${city}.`
      );
    } else {
      console.log(
        `ℹ️ No new leads found for ${city} that match your criteria.`
      );
    }

    // ONLY NOW do we update the memory
    const updatedSeenIds = [...new Set([...seenIds, ...allProcessedIds])];
    saveJSON(SEEN_LEADS_FILE, updatedSeenIds);
    seenIds = updatedSeenIds; // Update local variable for next iteration

    progress.lastCityIndex = i + 1;
    saveJSON(PROGRESS_FILE, progress);
  }
  console.log("All cities finished!");
})();
