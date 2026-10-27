/**
 * Google Apps Script: Duplicate Checker for Place IDs
 *
 * INSTALLATION:
 * 1. Open your Google Sheet
 * 2. Extensions > Apps Script
 * 3. Delete any existing code, paste this in
 * 4. Save (Ctrl+S), name it "Duplicate Checker"
 * 5. Reload the sheet - you'll get a "🔍 Tools" menu
 *
 * USAGE:
 * - Click "🔍 Tools" > "Find Duplicates in Current Sheet"
 * - Click "🔍 Tools" > "Find Duplicates in All Sheets"
 * - Click "🔍 Tools" > "Highlight Duplicates (Conditional Format)"
 * - Click "🔍 Tools" > "Remove Duplicates (Keep First)"
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔍 Tools')
    .addItem('Find Duplicates in Current Sheet', 'findDuplicatesCurrentSheet')
    .addItem('Find Duplicates in All Sheets', 'findDuplicatesAllSheets')
    .addSeparator()
    .addItem('Highlight Duplicates (Conditional Format)', 'highlightDuplicates')
    .addItem('Remove Duplicates (Keep First)', 'removeDuplicatesKeepFirst')
    .addSeparator()
    .addItem('Show Unique Count per Column', 'showUniqueCounts')
    .addToUi();
}

/**
 * Find duplicates in the active sheet (Place ID column auto-detected)
 */
function findDuplicatesCurrentSheet() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const result = findDuplicatesInSheet(sheet);
  showDuplicateReport(sheet.getName(), result);
}

/**
 * Find duplicates in all sheets
 */
function findDuplicatesAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  let allResults = [];

  sheets.forEach(sheet => {
    const result = findDuplicatesInSheet(sheet);
    if (result.duplicates.length > 0) {
      allResults.push({ sheet: sheet.getName(), ...result });
    }
  });

  if (allResults.length === 0) {
    SpreadsheetApp.getUi().alert('✅ No duplicates found in any sheet!');
  } else {
    let msg = 'DUPLICATES FOUND:\n\n';
    allResults.forEach(r => {
      msg += `📋 ${r.sheet}: ${r.duplicates.length} duplicate Place IDs (${r.totalRows} rows, ${r.uniqueCount} unique)\n`;
      r.duplicates.slice(0, 5).forEach(d => {
        msg += `   • ${d.placeId} — rows ${d.rows.join(', ')}\n`;
      });
      if (r.duplicates.length > 5) msg += `   ... and ${r.duplicates.length - 5} more\n`;
      msg += '\n';
    });
    showLongMessage(msg, 'All Sheets Duplicate Report');
  }
}

/**
 * Core logic: find duplicates in a sheet
 */
function findDuplicatesInSheet(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { totalRows: 0, uniqueCount: 0, duplicates: [] };

  // Find Place ID column (look for "Place ID", "ID", or last column with ChIJ pattern)
  const headers = data[0];
  let placeIdCol = -1;

  headers.forEach((h, i) => {
    const hl = String(h).toLowerCase();
    if (hl.includes('place') && hl.includes('id')) placeIdCol = i;
    else if (hl === 'id' && placeIdCol === -1) placeIdCol = i;
  });

  // Fallback: scan for ChIJ pattern
  if (placeIdCol === -1) {
    for (let c = headers.length - 1; c >= 0; c--) {
      let found = false;
      for (let r = 1; r < Math.min(data.length, 20); r++) {
        const val = String(data[r][c] || '');
        if (val.startsWith('ChIJ')) { placeIdCol = c; found = true; break; }
      }
      if (found) break;
    }
  }

  if (placeIdCol === -1) {
    return { totalRows: data.length - 1, uniqueCount: 0, duplicates: [], error: 'No Place ID column found' };
  }

  const seen = new Map();
  const rows = data.slice(1); // Skip header

  rows.forEach((row, i) => {
    const placeId = String(row[placeIdCol] || '').trim();
    if (placeId.startsWith('ChIJ')) {
      if (!seen.has(placeId)) seen.set(placeId, []);
      seen.get(placeId).push(i + 2); // +2 for header + 1-indexed
    }
  });

  const duplicates = [];
  seen.forEach((indices, id) => {
    if (indices.length > 1) duplicates.push({ placeId: id, rows: indices });
  });

  return {
    totalRows: rows.length,
    uniqueCount: seen.size,
    placeIdColumn: String.fromCharCode(65 + placeIdCol) + (placeIdCol > 25 ? String.fromCharCode(65 + Math.floor(placeIdCol / 26) - 1) : ''),
    duplicates
  };
}

/**
 * Highlight duplicates with conditional formatting (red background)
 */
function highlightDuplicates() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const result = findDuplicatesInSheet(sheet);

  if (result.error) {
    SpreadsheetApp.getUi().alert('Error: ' + result.error);
    return;
  }

  if (result.duplicates.length === 0) {
    SpreadsheetApp.getUi().alert('✅ No duplicates to highlight!');
    return;
  }

  // Clear existing conditional formats
  const rules = sheet.getConditionalFormatRules();
  rules.forEach(r => sheet.removeConditionalFormatRule(rules.indexOf(r)));

  // Build ranges for duplicate rows
  const ranges = [];
  result.duplicates.forEach(d => {
    // Highlight all but first occurrence
    d.rows.slice(1).forEach(rowNum => {
      ranges.push(sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()));
    });
  });

  // Apply in batches (API limit)
  const batchSize = 100;
  for (let i = 0; i < ranges.length; i += batchSize) {
    const batch = ranges.slice(i, i + batchSize);
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .setRanges(batch)
      .whenFormulaSatisfied('=TRUE')
      .setBackground('#ffcccc')
      .setFontColor('#cc0000')
      .build();
    sheet.addConditionalFormatRule(rule);
  }

  SpreadsheetApp.getUi().alert(`🎨 Highlighted ${result.duplicates.length} duplicate Place IDs (${ranges.length} rows) in red.\nFirst occurrence of each kept white.`);
}

/**
 * Remove duplicate rows (keep first occurrence)
 */
function removeDuplicatesKeepFirst() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const result = findDuplicatesInSheet(sheet);

  if (result.error) {
    SpreadsheetApp.getUi().alert('Error: ' + result.error);
    return;
  }

  if (result.duplicates.length === 0) {
    SpreadsheetApp.getUi().alert('✅ No duplicates to remove!');
    return;
  }

  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Confirm Removal',
    `This will delete ${result.duplicates.length} duplicate Place IDs (${result.duplicates.reduce((sum, d) => sum + d.rows.length - 1, 0)} rows total).\nFirst occurrence of each will be kept.\n\nProceed?`,
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  // Collect all rows to delete (all but first occurrence)
  const rowsToDelete = [];
  result.duplicates.forEach(d => {
    d.rows.slice(1).forEach(r => rowsToDelete.push(r));
  });

  // Sort descending to delete from bottom up
  rowsToDelete.sort((a, b) => b - a);

  // Delete in chunks
  const chunkSize = 50;
  for (let i = 0; i < rowsToDelete.length; i += chunkSize) {
    const chunk = rowsToDelete.slice(i, i + chunkSize);
    chunk.forEach(rowNum => sheet.deleteRow(rowNum));
    SpreadsheetApp.flush(); // Apply changes
  }

  ui.alert(`✅ Removed ${rowsToDelete.length} duplicate rows.\n${result.uniqueCount} unique Place IDs remain.`);
}

/**
 * Show unique count for each column (quick data quality check)
 */
function showUniqueCounts() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    SpreadsheetApp.getUi().alert('Sheet is empty');
    return;
  }

  const headers = data[0];
  const rows = data.slice(1);
  let msg = `📊 Column Analysis for "${sheet.getName()}" (${rows.length} rows):\n\n`;

  headers.forEach((header, c) => {
    const values = rows.map(r => String(r[c] || '')).filter(v => v);
    const unique = new Set(values).size;
    const nonEmpty = values.length;
    msg += `${String.fromCharCode(65 + c)}${c > 25 ? String.fromCharCode(65 + Math.floor(c / 26) - 1) : ''}: ${header}\n`;
    msg += `   ${nonEmpty} filled / ${unique} unique ${unique < nonEmpty ? `⚠️ ${nonEmpty - unique} duplicates` : '✅'}\n\n`;
  });

  showLongMessage(msg, 'Column Analysis');
}

/**
 * Helper: show duplicate report
 */
function showDuplicateReport(sheetName, result) {
  if (result.error) {
    SpreadsheetApp.getUi().alert('Error: ' + result.error);
    return;
  }

  if (result.duplicates.length === 0) {
    SpreadsheetApp.getUi().alert(`✅ "${sheetName}": No duplicates found!\n${result.totalRows} rows, ${result.uniqueCount} unique Place IDs`);
    return;
  }

  let msg = `⚠️ "${sheetName}": ${result.duplicates.length} duplicate Place IDs\n`;
  msg += `${result.totalRows} rows, ${result.uniqueCount} unique\n\n`;
  result.duplicates.slice(0, 10).forEach(d => {
    msg += `• ${d.placeId} — rows ${d.rows.join(', ')}\n`;
  });
  if (result.duplicates.length > 10) msg += `\n... and ${result.duplicates.length - 10} more`;

  showLongMessage(msg, `Duplicates in ${sheetName}`);
}

/**
 * Helper: show long message in a dialog
 */
function showLongMessage(text, title) {
  const html = HtmlService.createHtmlOutput(
    `<pre style="font-family:monospace;font-size:12px;white-space:pre-wrap;padding:10px">${text}</pre>`
  )
    .setWidth(600)
    .setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}