/**
 * SheetService.js
 * Abstraction layer for Google Sheets operations.
 */

const SheetService = {
  getSpreadsheet() {
    const id = Config.getDataSpreadsheetId();
    return SpreadsheetApp.openById(id);
  },

  getSheet(sheetName) {
    const ss = this.getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`Sheet ${sheetName} not found.`);
    }
    return sheet;
  },

  /**
   * Appends a row using a lock to prevent concurrent write issues.
   */
  appendRow(sheetName, rowData) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000); // wait up to 10 seconds
      const sheet = this.getSheet(sheetName);
      sheet.appendRow(rowData);
    } catch (e) {
      console.error(`Failed to append row to ${sheetName}:`, e);
      throw e;
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Gets all rows as an array of objects (using header row as keys).
   */
  getRowsAsObjects(sheetName) {
    const sheet = this.getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    const headers = data[0];
    const rows = [];
    for (let i = 1; i < data.length; i++) {
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = data[i][j];
      }
      // Store row index for potential updates (1-indexed + 1 for header)
      obj._rowIndex = i + 1;
      rows.push(obj);
    }
    return rows;
  },

  /**
   * Finds a row by a specific column and value.
   */
  findRowIndex(sheetName, columnName, value) {
    const sheet = this.getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return -1;

    const headers = data[0];
    const colIndex = headers.indexOf(columnName);
    if (colIndex === -1) return -1;

    for (let i = 1; i < data.length; i++) {
      if (data[i][colIndex] === value) {
        return i + 1; // 1-indexed row number
      }
    }
    return -1;
  },

  /**
   * Updates an entire row given its index.
   */
  updateRow(sheetName, rowIndex, rowData) {
     const lock = LockService.getScriptLock();
     try {
       lock.waitLock(10000);
       const sheet = this.getSheet(sheetName);
       sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
     } catch (e) {
       console.error(`Failed to update row in ${sheetName}:`, e);
       throw e;
     } finally {
       lock.releaseLock();
     }
  },

  /**
   * Updates a single cell.
   */
  updateCell(sheetName, rowIndex, columnName, value) {
     const lock = LockService.getScriptLock();
     try {
       lock.waitLock(10000);
       const sheet = this.getSheet(sheetName);
       const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
       const colIndex = headers.indexOf(columnName);
       if (colIndex === -1) throw new Error(`Column ${columnName} not found`);

       sheet.getRange(rowIndex, colIndex + 1).setValue(value);
     } catch (e) {
       console.error(`Failed to update cell in ${sheetName}:`, e);
       throw e;
     } finally {
       lock.releaseLock();
     }
  }
};
