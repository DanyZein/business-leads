// const { google } = require("googleapis");
import { google } from "googleapis";

export default async function appendBusinesses(auth, spreadsheetId, rows) {
  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: rows,
    },
  });
}

