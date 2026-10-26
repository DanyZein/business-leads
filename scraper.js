const axios = require("axios");
const { google } = require("googleapis");
const fs = require("fs");

const citiesData = require("./cities.js");
require("dotenv").config();

// ---------- Config ----------

const TARGET_STATES = ["Lebanon"];
const SHEET_NAME = TARGET_STATES[0];

// Each term is its own job. Keep terms short and canonical.
const SEARCH_TERMS = [
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
  "restaurant",
  "cafe",
  "salon",

  // Arabic variants
  "عيادة أسنان",
  "عزل مائي",
  "تسقيف",
];

// Free-tier guardrail.
// Text Search (New) is a Pro SKU (5,000 free/month) as long as you do NOT
// request Enterprise-only fields like rating or userRatingCount.
// 100/day × 30 ≈ 3,000, leaving headroom for retries and other states.
const DAILY_CALL_LIMIT = 30;

// ---------- Files ----------
const SEEN_LEADS_FILE = "seen_leads.json";
const PROGRESS_FILE = `progress_${SHEET_NAME}.json`;
const QUOTA_FILE = "quota.json";

// ---------- Sheets auth ----------
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// ---------- Helpers ----------
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

function getCityList(targetStates = []) {
  const flatList = [];
  const statesToProcess =
    targetStates.length > 0 ? targetStates : Object.keys(citiesData);

  statesToProcess.forEach((state) => {
    if (citiesData[state]) {
      citiesData[state].forEach((city) => {
        flatList.push(`${city}, ${state}`);
      });
    }
  });

  return flatList.sort();
}

// ---------- Scraper ----------
async function getLeadsForQuery(cityName, term) {
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
      // Pro-tier fields only. Do NOT add places.rating or
      // places.userRatingCount here — that would push every request
      // into the 1,000-call Enterprise bucket.
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.websiteUri," +
        "places.internationalPhoneNumber,places.formattedAddress," +
        "places.utcOffsetMinutes,places.primaryTypeDisplayName," +
        "places.businessStatus,nextPageToken",
    };

    const body = {
      textQuery: `${term} in ${cityName}`,
      pageToken: nextToken,
      regionCode: "LB",
      languageCode: "en",
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

        // Review count removed to stay in the Pro SKU.
        // Still require a phone and an open business.
        const realBusiness =
          !!p.internationalPhoneNumber &&
          p.businessStatus !== "CLOSED_PERMANENTLY";

        if (weakSite && realBusiness) {
          targetLeadsForCity.push({ ...p, _term: term });
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

// ---------- Sheets ----------
async function appendToSheet(leads) {
  if (leads.length === 0) return;
  const sheets = google.sheets({ version: "v4", auth });

  const rows = leads.map((lead) => {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      lead.displayName.text,
    )}&query_place_id=${lead.id}`;
    const clickableAddress = `=HYPERLINK("${mapsUrl}", "${lead.formattedAddress}")`;

    return [
      lead.displayName.text, // A
      lead.internationalPhoneNumber
        ? `'${lead.internationalPhoneNumber}`
        : "N/A", // B
      clickableAddress, // C
      "", // D
      "", // E
      lead.websiteUri || "NO WEBSITE", // F
      "Not Contacted", // G  ← moved from H
      "", // H
      "", // I
      "", // J
      "", // K
      lead.primaryTypeDisplayName?.text || "Unknown", // L  ← moved from M
      lead._term || "", // M  ← search term
      ...Array(9).fill(""), // N–Y (12 empties)
      lead.id, // Z  ← place ID moved from AB
    ];
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2`,
    valueInputOption: "USER_ENTERED",
    resource: { values: rows },
  });
}

// ---------- Main ----------
(async () => {
  const myCities = getCityList(TARGET_STATES);
  console.log(
    `Loaded ${myCities.length} cities for: ${TARGET_STATES.join(", ")}`,
  );

  const jobs = [];
  myCities.forEach((city) => {
    SEARCH_TERMS.forEach((term) => jobs.push({ city, term }));
  });
  console.log(
    `Total jobs: ${jobs.length} (${myCities.length} cities × ${SEARCH_TERMS.length} terms)`,
  );

  let progress = loadJSON(PROGRESS_FILE, { lastJobIndex: 0 });
  if (
    progress.lastCityIndex !== undefined ||
    typeof progress.lastJobIndex !== "number"
  ) {
    console.log(
      "Old progress format detected — resetting progress. (Job list changed.)",
    );
    progress = { lastJobIndex: 0 };
    saveJSON(PROGRESS_FILE, progress);
  }

  let seenIds = loadJSON(SEEN_LEADS_FILE, []);

  for (let i = progress.lastJobIndex; i < jobs.length; i++) {
    const { city, term } = jobs[i];

    if (callsLeft().left < 5) {
      console.log("Daily call limit reached, stopping for today.");
      break;
    }

    const { targetLeadsForCity, allProcessedIds, completedSuccessfully } =
      await getLeadsForQuery(city, term);

    if (!completedSuccessfully) {
      console.log(`❌ Job failed, will retry later: ${term} | ${city}`);
      break;
    }

    if (targetLeadsForCity.length > 0) {
      try {
        await appendToSheet(targetLeadsForCity);
        console.log(
          `✅ Added ${targetLeadsForCity.length} leads (${term} | ${city}).`,
        );
      } catch (e) {
        console.error(
          `Sheet write failed for ${term} | ${city}:`,
          e.message,
        );
        break;
      }
    } else {
      console.log(`ℹ️ No new leads (${term} | ${city}).`);
    }

    const updatedSeenIds = [...new Set([...seenIds, ...allProcessedIds])];
    saveJSON(SEEN_LEADS_FILE, updatedSeenIds);
    seenIds = updatedSeenIds;

    progress.lastJobIndex = i + 1;
    saveJSON(PROGRESS_FILE, progress);

    console.log(
      `Progress saved: ${i + 1}/${jobs.length} jobs (${city} × ${term}).`,
    );

    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("Done (or hit the daily limit).");
})();