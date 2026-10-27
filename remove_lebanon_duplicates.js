// Remove duplicate Place IDs from Lebanon tab
// Run: node remove_lebanon_duplicates.js

const { google } = require('googleapis');
require('dotenv').config();

const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const sheets = google.sheets({ version: 'v4', auth });

async function removeRemainingDuplicates() {
  // Read fresh data
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Lebanon!A2:W',
  });
  const rows = resp.data.values || [];
  console.log('Total rows:', rows.length);

  const seen = new Map();
  const rowsToDelete = [];

  rows.forEach((row, i) => {
    const placeId = row[22]; // Column W (index 22)
    if (placeId && placeId.startsWith('ChIJ')) {
      if (!seen.has(placeId)) {
        seen.set(placeId, i + 2);
      } else {
        rowsToDelete.push(i + 2);
      }
    }
  });

  console.log('Duplicates found:', rowsToDelete.length);
  if (rowsToDelete.length === 0) {
    console.log('No duplicates to remove');
    return;
  }

  // Get sheet ID for Lebanon tab
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const lebanonSheet = meta.data.sheets.find(s => s.properties.title === 'Lebanon');
  const sheetId = lebanonSheet.properties.sheetId;

  // Delete from bottom to top (sort descending)
  const requests = rowsToDelete
    .sort((a, b) => b - a)
    .map(rowIndex => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: rowIndex - 1, // 0-indexed
          endIndex: rowIndex
        }
      }
    }));

  console.log('Sending batch update with', requests.length, 'requests...');
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { requests }
  });

  console.log('✅ Done! Deleted', rowsToDelete.length, 'duplicate rows');
}

removeRemainingDuplicates().catch(console.error);