/**
 * Traffic controller - single onEdit entry point
 */
function onEdit(e) {
  if (!e) return;
  const range = e.range;
  const row = range.getRow();
  if (row <= 1) return; // ignore header row
  // run modules
  handleFollowUpDate(e);
  handleRowRouting(e);
}

/**
 * MODULE: compute Follow-up date = contactDate + 4 days
 * Uses the actual cell value (Date object) so it works when the cell is a date.
 */
function handleFollowUpDate(e) {
  const CONTACT_DATE_COL = 11; // K
  const FOLLOW_UP_COL = 12;    // L

  const range = e.range;
  if (range.getColumn() !== CONTACT_DATE_COL) return;

  const sheet = range.getSheet();
  const contactValue = range.getValue(); // get actual typed/cell value

  // accept only actual Date objects
  if (!(contactValue instanceof Date) || isNaN(contactValue.getTime())) return;

  const followUpDate = new Date(contactValue);
  followUpDate.setDate(contactValue.getDate() + 4);
  followUpDate.setHours(0, 0, 0, 0); // normalize to midnight

  const targetCell = sheet.getRange(range.getRow(), FOLLOW_UP_COL);
  const targetVal = targetCell.getValue();

  // Only write if empty
  if (targetVal === '' || targetVal === null) {
    targetCell.setValue(followUpDate);
  }
}

/**
 * MODULE: move row to Dead/Done sheet when status changes
 */
function handleRowRouting(e) {
  const STATUS_COL = 8; // H
  const statusMap = {
    "dead lead": "Dead",
    "closed lost": "Dead",
    "closed won": "Done"
  };

  const range = e.range;
  if (range.getColumn() !== STATUS_COL) return;

  const sheet = range.getSheet();
  const sheetName = sheet.getName();

  // read and normalize status text
  const rawStatus = range.getValue();
  if (rawStatus === '' || rawStatus === null) return;
  const statusText = String(rawStatus).trim().toLowerCase();

  const targetSheetName = statusMap[statusText];
  if (!targetSheetName) return;

  // don't move if already in the target sheet
  if (sheetName === targetSheetName) return;

  const ss = e.source;

  // obtain a script lock to avoid race conditions
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(30000); // 30s
  if (!gotLock) {
    // couldn't obtain lock; bail safely
    Logger.log("Could not obtain lock for row routing. Try again.");
    return;
  }

  try {
    // ensure target sheet exists and has headers
    let targetSheet = ss.getSheetByName(targetSheetName);
    const lastCol = sheet.getLastColumn();

    if (!targetSheet) {
      targetSheet = ss.insertSheet(targetSheetName);
      // copy headers (values and formatting optional)
      const headers = sheet.getRange(1, 1, 1, lastCol);
      headers.copyTo(targetSheet.getRange(1, 1));
    } else {
      // if headers missing (sheet empty), copy them
      if (targetSheet.getLastRow() === 0) {
        const headers = sheet.getRange(1, 1, 1, lastCol);
        headers.copyTo(targetSheet.getRange(1, 1));
      }
    }

    // get source row values and paste into next free row (values only)
    const rowIndex = range.getRow();
    const rowValues = sheet.getRange(rowIndex, 1, 1, lastCol).getValues();
    const destRow = Math.max( targetSheet.getLastRow() + 1, 2 ); // ensure not overwriting header
    targetSheet.getRange(destRow, 1, 1, lastCol).setValues(rowValues);

    // delete source row AFTER copying
    sheet.deleteRow(rowIndex);

  } catch (err) {
    Logger.log("Error in handleRowRouting: " + err);
  } finally {
    lock.releaseLock();
  }
}
