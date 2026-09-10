import dotenv from "dotenv";
import axios from "axios";
// const authorize = require("./auth");
// const appendBusinesses = require("./sheets");
import authorize from "./auth.js";
import appendBusinesses from "./sheets.js";

dotenv.config();

// ==========================
// CONFIG
// ==========================

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Seattle coordinates (downtown-ish)
const LOCATION = "47.6062,-122.3321";
const RADIUS = 5000; // meters
const KEYWORD = "restaurant";

// ==========================
// 1. SEARCH FOR PLACES
// ==========================

async function searchPlaces(pageToken = null) {
  const url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";

  const params = {
    key: GOOGLE_API_KEY,
    location: LOCATION,
    radius: RADIUS,
    keyword: KEYWORD,
  };

  if (pageToken) {
    params.pagetoken = pageToken;
  }

  const response = await axios.get(url, { params });
  return response.data;
}

// ==========================
// 2. GET PLACE DETAILS
// ==========================

async function getPlaceDetails(placeId) {
  const url = "https://maps.googleapis.com/maps/api/place/details/json";

  const params = {
    key: GOOGLE_API_KEY,
    place_id: placeId,
    fields: [
      "name",
      "formatted_address",
      "formatted_phone_number",
      "website",
      "opening_hours",
      "url",
    ].join(","),
  };

  const response = await axios.get(url, { params });
  return response.data.result;
}

// ==========================
// 3. MAIN LOOP
// ==========================

function shouldKeepBusiness(details) {
  if (!details.website) return true;
  if (details.website.includes("facebook.com")) return true;
  return false;
}

async function run() {
  const auth = await authorize();
  const spreadsheetId = "1SuTSpYZPgL1Ugmf0QY4qWnvWh_Aqr4iATpqXi9mIKcU";

  let pageToken = null;
  let pageCount = 0;
  let processed = 0;
  const MAX_RESULTS = 30;

  do {
    const data = await searchPlaces(pageToken);
    pageCount++;

    console.log(`\n--- PAGE ${pageCount} ---`);

    for (const place of data.results) {
      const details = await getPlaceDetails(place.place_id);

      const business = {
        name: details.name || "",
        phone: details.formatted_phone_number || "",
        address: details.formatted_address || "",
        website: details.website || "",
        mapsLink: details.url || "",
        openingHours: details.opening_hours?.weekday_text || [],
      };

      if (shouldKeepBusiness(details)) {
        const row = [
          business.name,
          business.phone,
          business.address,
          business.mapsLink,
          business.openingHours.join(" | "),
        ];

        await appendBusinesses(auth, spreadsheetId, [row]);
        console.log(business);
      }
      processed++;
      if (processed >= MAX_RESULTS) {
        console.log("Reached limit, stopping.");
        return;
      }
    }

    pageToken = data.next_page_token;

    if (pageToken) {
      // Google requires a short delay before next page
      await new Promise((r) => setTimeout(r, 2000));
    }
  } while (pageToken);
}

run().catch(console.error);
