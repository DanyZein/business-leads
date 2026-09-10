const axios = require("axios");
const { google } = require("googleapis");
require("dotenv").config();

// 1. Setup Auth for Google Sheets
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json", // Your Service Account Key file
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SHEET_ID = "1SuTSpYZPgL1Ugmf0QY4qWnvWh_Aqr4iATpqXi9mIKcU";

async function getLeads(query) {
  const url = "https://places.googleapis.com/v1/places:searchText";
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": process.env.MAPS_API_KEY,

    "X-Goog-FieldMask":
      "places.id,places.displayName,places.websiteUri,places.internationalPhoneNumber,places.formattedAddress,places.utcOffsetMinutes",
    //   "places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber",
  };

  const body = { textQuery: query };

  try {
    const response = await axios.post(url, body, { headers });
    const places = response.data.places || [];
    // console.log(places);
    console.dir(places, { depth: null, colors: true });
    // The Filter: No website OR it's a Facebook link
    return places.filter((place) => {
      const site = place.websiteUri || "";
      return (
        !site || site.includes("facebook.com") || site.includes("instagram.com")
      );
    });
  } catch (error) {
    console.error("Error fetching from Places API:", error.response.data);
    return [];
  }
}

async function appendToSheet(leads) {
  const sheets = google.sheets({ version: "v4", auth });
  const rows = leads.map((lead) => [
    lead.displayName.text,
    lead.nationalPhoneNumber || "N/A",
    lead.formattedAddress,
    lead.websiteUri || "NO WEBSITE",
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Sheet1!A1",
    valueInputOption: "USER_ENTERED",
    resource: { values: rows },
  });
  console.log(`Successfully added ${leads.length} leads!`);
}

// Run it
(async () => {
  console.log("Searching for Thai restaurants in North Jersey...");
  const leads = await getLeads("Restaurants in Newark, NJ");
  if (leads.length > 0) {
    await appendToSheet(leads);
    console.log(leads);
  } else {
    // console.log("No leads found matching criteria.");
    console.log(leads);
  }
})();
