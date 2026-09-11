/**
 * Setup.js
 * Run once to initialize Google Sheets, Drive Folders, and Script Properties.
 */

function installApp() {
  Logger.log('Starting installation...');

  // 1. Ensure Properties exist
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GEMINI_API_KEY')) props.setProperty('GEMINI_API_KEY', 'REPLACE_ME');
  if (!props.getProperty('TEACHER_EMAIL_ALLOWLIST')) props.setProperty('TEACHER_EMAIL_ALLOWLIST', Session.getActiveUser().getEmail());
  if (!props.getProperty('AUDIO_RETENTION_DAYS')) props.setProperty('AUDIO_RETENTION_DAYS', '30');
  if (!props.getProperty('DELETE_AUDIO_AFTER_TRANSCRIPTION')) props.setProperty('DELETE_AUDIO_AFTER_TRANSCRIPTION', 'true');

  // 2. Setup Drive
  let rootId = props.getProperty('EXPECTATION_CARDS_ROOT_FOLDER_ID');
  let audioId = props.getProperty('EXPECTATION_CARDS_AUDIO_FOLDER_ID');

  if (!rootId) {
    const root = DriveApp.createFolder('Expectation Cards App');
    rootId = root.getId();
    props.setProperty('EXPECTATION_CARDS_ROOT_FOLDER_ID', rootId);

    const audio = root.createFolder('Audio Recordings');
    audioId = audio.getId();
    props.setProperty('EXPECTATION_CARDS_AUDIO_FOLDER_ID', audioId);
  }

  // 3. Setup Sheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Initialize Sheets with Headers
  const requiredSheets = {
    'Settings': ['key', 'value', 'updatedAt'],
    'Cards': ['cardId', 'currentVersionId', 'status', 'courseId', 'courseName', 'courseWorkId', 'courseWorkTitle', 'studentId', 'studentEmail', 'studentName', 'stableCardToken', 'title', 'transcriptId', 'audioDriveFileId', 'createdAt', 'updatedAt', 'sentAt', 'createdByEmail'],
    'CardVersions': ['versionId', 'cardId', 'versionNumber', 'cardJson', 'transcriptText', 'source', 'createdAt', 'createdByEmail'],
    'ChecklistItems': ['itemId', 'cardId', 'versionId', 'parentItemId', 'itemType', 'displayOrder', 'text', 'completed', 'completedAt', 'completedByEmail', 'createdAt', 'updatedAt'],
    'Deliveries': ['deliveryId', 'cardId', 'courseId', 'courseWorkId', 'studentId', 'studentEmail', 'studentSubmissionId', 'stableCardUrl', 'deliveryMethod', 'deliveryStatus', 'deliveredAt', 'errorMessage', 'classroomResponseJson'],
    'Recordings': ['recordingId', 'cardId', 'driveFileId', 'filename', 'mimeType', 'sizeBytes', 'durationSeconds', 'retained', 'createdAt', 'deletedAt'],
    'AuditLog': ['auditId', 'eventType', 'cardId', 'versionId', 'actorEmail', 'eventDataJson', 'createdAt']
  };

  for (const [sheetName, headers] of Object.entries(requiredSheets)) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f3f3f3');
      sheet.setFrozenRows(1);
    }
  }

  // Remove default 'Sheet1' if it exists and is empty
  const sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1) {
    ss.deleteSheet(sheet1);
  }

  Logger.log('Installation complete.');
  Logger.log(`Spreadsheet URL: ${ss.getUrl()}`);
  Logger.log(`Please set GEMINI_API_KEY in Script Properties.`);
}
