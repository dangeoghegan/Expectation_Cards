/**
 * ============================================================================
 * TASK EXPECTATIONS - GOOGLE APPS SCRIPT BACKEND
 * ============================================================================
 * Application: Task Expectations
 * Repository: https://github.com/dangeoghegan/Expectation_Cards
 * Version: 2.0.0 (Consolidated Production Release)
 *
 * ----------------------------------------------------------------------------
 * DEPLOYMENT & ENVIRONMENT CONFIGURATION GUIDE
 * ----------------------------------------------------------------------------
 *
 * 1. REQUIRED ADVANCED GOOGLE SERVICES:
 *    - Google Classroom API (Identifier: Classroom, Version: v1)
 *    - Google Drive API (Identifier: Drive, Version: v2 or v3)
 *    (Enable in Apps Script Editor > Services > Add a service)
 *
 * 2. REQUIRED GOOGLE CLOUD APIS (in attached Google Cloud Project):
 *    - Google Classroom API (classroom.googleapis.com)
 *    - Google Drive API (drive.googleapis.com)
 *    - Generative Language API (generativelanguage.googleapis.com) [if using Gemini API]
 *
 * 3. REQUIRED OAUTH SCOPES:
 *    - https://www.googleapis.com/auth/script.external_request
 *    - https://www.googleapis.com/auth/spreadsheets
 *    - https://www.googleapis.com/auth/drive
 *    - https://www.googleapis.com/auth/classroom.courses.readonly
 *    - https://www.googleapis.com/auth/classroom.rosters.readonly
 *    - https://www.googleapis.com/auth/classroom.coursework.students
 *    - https://www.googleapis.com/auth/userinfo.email
 *
 * 4. RECOMMENDED WEB APP DEPLOYMENT SETTINGS:
 *    - Execute as: User accessing the web app (USER_ACCESSING)
 *      Note: Running as USER_ACCESSING ensures Session.getActiveUser().getEmail()
 *      identifies the specific teacher or student accessing the portal, allowing
 *      strict per-user permission enforcement and Classroom API calls as the teacher.
 *    - Who has access: Anyone within your Google Workspace domain (DOMAIN)
 *      or Anyone (if students access via managed accounts).
 *
 * 5. USER IDENTITY LIMITATION & DOMAIN POLICY:
 *    - Google Workspace requires Session.getActiveUser().getEmail() to authenticate.
 *    - In personal Gmail accounts or unauthenticated containers, getEmail() returns empty.
 *    - In such cases, validateUser_() halts access and returns a descriptive error.
 *    - For secure student isolation, deploy within a managed Google Workspace domain.
 *
 * 6. PRIVACY & RETENTION CONFIGURATION:
 *    - Audio recordings are saved to a restricted Drive folder and automatically
 *      cleaned up after AUDIO_RETENTION_DAYS (or immediately after transcription
 *      if DELETE_AUDIO_AFTER_TRANSCRIPTION=true).
 *    - Transcripts and card details are stored in the private bound Google Sheet.
 *
 * 7. SCRIPT PROPERTIES (File > Project Properties > Script Properties):
 *    - APP_BASE_URL (Required): Web app execution URL.
 *    - GEMINI_API_KEY (Required for AI): Google Gemini API key.
 *    - ALLOWED_TEACHER_DOMAIN: e.g. "school.nsw.edu.au"
 *    - ALLOWED_TEACHER_EMAILS: Comma-separated list of approved teacher emails.
 *    - EXPECTATION_CARDS_ROOT_FOLDER_ID: Drive folder ID for app files.
 *    - EXPECTATION_CARDS_AUDIO_FOLDER_ID: Drive folder ID for transient audio.
 *    - AUDIO_RETENTION_DAYS: Default 30.
 *    - DELETE_AUDIO_AFTER_TRANSCRIPTION: "true" (default) or "false".
 *    - ENABLE_CLASSROOM_DELIVERY: "true" (default) or "false".
 * ============================================================================
 */

// ============================================================================
// SECTION 1: CONFIGURATION & CONSTANTS
// ============================================================================

const CONFIG = {
  VERSION: '2.0.0',
  APP_NAME: 'Task Expectations',
  DEFAULT_AUDIO_RETENTION_DAYS: 30,
  SHEET_NAMES: {
    SETTINGS: 'Settings',
    CARDS: 'Cards',
    CARD_RECIPIENTS: 'CardRecipients',
    TASKS: 'Tasks',
    GROUPS: 'Groups',
    AUDIT_LOG: 'AuditLog',
    RECORDINGS: 'Recordings'
  },
  MAX_AUDIO_PAYLOAD_BYTES: 25 * 1024 * 1024 // 25 MB
};

/**
 * Configuration Helper wrapper around PropertiesService.
 */
const Config = {
  get(key, defaultValue = null) {
    try {
      const val = PropertiesService.getScriptProperties().getProperty(key);
      return val !== null && val !== undefined ? val : defaultValue;
    } catch (e) {
      console.warn(`Could not read property ${key}:`, e);
      return defaultValue;
    }
  },

  set(key, value) {
    PropertiesService.getScriptProperties().setProperty(key, String(value));
  },

  getRequired(key) {
    const val = this.get(key);
    if (!val) {
      throw new Error(`Missing required configuration: ${key}. Please configure Script Properties.`);
    }
    return val;
  },

  getAppBaseUrl() {
    return this.get('APP_BASE_URL') || ScriptApp.getService().getUrl() || 'https://script.google.com/macros/s/AKfycbzemO95HbJpupSgeBiLqTxnSkpnul9SWQ1XKTFNWlWlPChxM1wGkWfgmTlBSj7p7s2FLQ/exec';
  },

  getGeminiApiKey() {
    return this.get('GEMINI_API_KEY') || '';
  },

  getAudioFolderId() {
    return this.get('EXPECTATION_CARDS_AUDIO_FOLDER_ID') || '';
  },

  getRootFolderId() {
    return this.get('EXPECTATION_CARDS_ROOT_FOLDER_ID') || '';
  },

  getTeacherAllowlist() {
    const raw = this.get('ALLOWED_TEACHER_EMAILS') || this.get('TEACHER_EMAIL_ALLOWLIST') || '';
    return raw ? raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean) : [];
  },

  getAllowedDomain() {
    return (this.get('ALLOWED_TEACHER_DOMAIN') || this.get('AUTHORISED_DOMAIN') || '').trim().toLowerCase();
  },

  getAudioRetentionDays() {
    return parseInt(this.get('AUDIO_RETENTION_DAYS') || String(CONFIG.DEFAULT_AUDIO_RETENTION_DAYS), 10);
  },

  getDeleteAudioAfterTranscription() {
    const val = this.get('DELETE_AUDIO_AFTER_TRANSCRIPTION');
    return val === null ? true : val === 'true';
  },

  isClassroomDeliveryEnabled() {
    const val = this.get('ENABLE_CLASSROOM_DELIVERY');
    return val === null ? true : val === 'true';
  }
};

// ============================================================================
// SECTION 2: WEB APP ENTRY & ROUTING
// ============================================================================

/**
 * Serves the single-page application.
 * Supports:
 * - Default Teacher Dashboard: https://.../exec
 * - Direct Student Card: https://.../exec?mode=student&card=CARD_ID
 * - Token link compatibility: https://.../exec?token=TOKEN
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const mode = params.mode === 'student' || params.token || params.card ? 'student' : 'teacher';
    const cardId = params.card || '';
    const token = params.token || '';

    // Search for HTML file across Apps Script naming variations (case-sensitive in GAS)
    const fileCandidates = ['index', 'Index', 'index.html', 'Index.html', 'src/Index', 'src/index'];
    let template = null;

    for (let i = 0; i < fileCandidates.length; i++) {
      try {
        template = HtmlService.createTemplateFromFile(fileCandidates[i]);
        if (template) break;
      } catch (candidateErr) {
        // Continue checking next candidate
      }
    }

    if (!template) {
      // Friendly setup prompt if HTML file has not yet been added to the Apps Script project
      return HtmlService.createHtmlOutput(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Task Expectations - Setup Required</title>
          <style>
            :root {
              --primary: #1e40af;
              --primary-light: #eff6ff;
              --text: #0f172a;
              --muted: #475569;
              --border: #e2e8f0;
              --bg: #f8fafc;
              --success: #059669;
            }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 2rem 1rem; line-height: 1.5; }
            .container { max-width: 680px; margin: 0 auto; background: white; border: 1px solid var(--border); border-radius: 12px; padding: 2rem; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
            .status-banner { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.75rem; color: #065f46; font-size: 0.95rem; }
            h1 { font-size: 1.35rem; margin-bottom: 0.5rem; color: var(--text); }
            p { color: var(--muted); font-size: 0.95rem; margin-bottom: 1rem; }
            ol { padding-left: 1.25rem; margin-bottom: 1.5rem; color: var(--text); font-size: 0.925rem; }
            li { margin-bottom: 0.75rem; }
            code { background: #f1f5f9; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.875rem; color: #0f172a; font-family: ui-monospace, monospace; border: 1px solid #e2e8f0; }
            .btn { display: inline-flex; align-items: center; justify-content: center; background: var(--primary); color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; font-size: 0.9rem; font-weight: 500; cursor: pointer; text-decoration: none; }
            .btn:hover { opacity: 0.9; }
            .note { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 0.75rem 1rem; font-size: 0.85rem; color: #92400e; margin-top: 1rem; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="status-banner">
              <span style="font-size: 1.5rem;">✅</span>
              <div>
                <strong>Authorisation & Backend Script Active!</strong><br>
                <code>Code.gs</code> is successfully running in your Google Workspace environment.
              </div>
            </div>
            <h1>One Final Step: Add the Frontend HTML File</h1>
            <p>Google Apps Script requires the HTML interface file (<code>index.html</code>) to be present in your Apps Script project editor to render the dashboard:</p>
            <ol>
              <li>Open your Google Apps Script project at <a href="https://script.google.com" target="_blank" rel="noopener noreferrer" style="color: var(--primary); font-weight: 600;">script.google.com</a> (or in your Sheet: <strong>Extensions &gt; Apps Script</strong>).</li>
              <li>In the left sidebar, click the <strong>+</strong> icon next to <strong>Files</strong> and select <strong>HTML</strong>.</li>
              <li>Type <code>index</code> as the file name and press Enter (Apps Script will create <code>index.html</code>).</li>
              <li>Copy the entire content of <code>index.html</code> (or <code>Index.html</code>) from your GitHub repository and paste it into the editor.</li>
              <li>Click the <strong>Save</strong> icon (💾).</li>
              <li>Click <strong>Deploy &gt; Manage deployments</strong>, click the <strong>Edit (pencil)</strong> icon, select <strong>New version</strong> from the Version dropdown, and click <strong>Deploy</strong>.</li>
            </ol>
            <div class="note">
              💡 <strong>Why does this happen?</strong> Google Apps Script projects require both the server script (<code>Code.gs</code>) and the frontend template (<code>index.html</code>) in the project files list. Once added and saved as a new version, refresh this page to load the full application!
            </div>
            <div style="margin-top: 1.5rem; text-align: right;">
              <button type="button" class="btn" onclick="window.location.reload();">🔄 Refresh Page</button>
            </div>
          </div>
        </body>
        </html>
      `).setTitle('Task Expectations - Setup Required').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    template.mode = mode;
    template.cardId = cardId;
    template.token = token;
    template.appBaseUrl = Config.getAppBaseUrl();

    const output = template.evaluate();
    output.setTitle('Task Expectations');
    output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    output.addMetaTag('viewport', 'width=device-width, initial-scale=1');
    return output;
  } catch (err) {
    console.error('Fatal doGet error:', err);
    return HtmlService.createHtmlOutput(
      `<div style="font-family:sans-serif;padding:24px;color:#d93025;">
        <h2>Task Expectations Application Error</h2>
        <p>${sanitiseHtml_(err.message)}</p>
        <p>Please check your deployment settings and script authorization.</p>
      </div>`
    );
  }
}

/**
 * Web App HTTP POST Endpoint (supports external RPC callers and headless automation).
 */
function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (pErr) {
        payload = {};
      }
    }

    const funcName = payload.funcName || (e && e.parameter && e.parameter.funcName);
    const args = payload.args || [];

    const publicMethods = {
      getCurrentUser: () => getCurrentUser(),
      getAppBootstrapData: () => getAppBootstrapData(),
      getTeacherCourses: () => getTeacherCourses(),
      getCourseRoster: (cId) => getCourseRoster(cId),
      getTasksForClass: (cId) => getTasksForClass(cId),
      getGroupsForClass: (cId) => getGroupsForClass(cId),
      getTeacherCards: (f) => getTeacherCards(f),
      getCard: (id) => getCard(id),
      createDraftCard: (data) => createDraftCard(data),
      postCardToClassroom: (id) => postCardToClassroom(id),
      retryCardDelivery: (id) => retryCardDelivery(id),
      archiveCard: (id) => archiveCard(id),
      duplicateCard: (id) => duplicateCard(id),
      getStudentCard: (id, t) => getStudentCard(id, t),
      acknowledgeCard: (id, txt) => acknowledgeCard(id, txt),
      transcribeAudio: (d) => transcribeAudio(d),
      generateExpectationsFromTranscript: (d) => generateExpectationsFromTranscript(d),
      getSettings: () => getSettings(),
      saveSettings: (s) => saveSettings(s)
    };

    if (funcName && publicMethods[funcName]) {
      const result = publicMethods[funcName].apply(null, args);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    } else {
      return ContentService.createTextOutput(JSON.stringify({
        ok: false,
        error: { message: `RPC function '${funcName}' not supported or not found.` }
      })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: { message: err.message || 'doPost execution error' }
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================================
// SECTION 3: AUTHORISATION AND IDENTITY
// ============================================================================

/**
 * Returns current authenticated user and authorization context.
 */
function getCurrentUser() {
  try {
    let email = '';
    try {
      email = Session.getActiveUser().getEmail().toLowerCase().trim();
    } catch (e) {
      email = '';
    }

    const isTeacher = isUserTeacher_(email);
    return successResponse({
      email: email,
      isTeacher: isTeacher,
      hasEmail: Boolean(email),
      appVersion: CONFIG.VERSION
    });
  } catch (err) {
    return handleServerError(err, 'getCurrentUser');
  }
}

/**
 * Validates active user has teacher privileges. Throws error if not.
 */
function validateTeacherAccess() {
  const email = Session.getActiveUser().getEmail().toLowerCase().trim();
  if (!email) {
    logAuditEvent('ACCESS_DENIED', { reason: 'No active user email returned by Session.getActiveUser()' });
    throw new Error('Authentication required: Could not determine active Google account. Please ensure you are logged into your school account.');
  }

  if (!isUserTeacher_(email)) {
    logAuditEvent('TEACHER_ACCESS_DENIED', { email: email, reason: 'User not in allowlist or approved domain' });
    throw new Error(`Teacher authorization required. The account (${email}) is not authorized for teacher access.`);
  }

  return email;
}

/**
 * Checks whether an email address is authorized as a teacher.
 */
function isUserTeacher_(email) {
  if (!email) return false;
  const allowlist = Config.getTeacherAllowlist();
  const domain = Config.getAllowedDomain();

  // If user is the creator/effective user of the script, always authorize
  try {
    const effectiveEmail = Session.getEffectiveUser().getEmail().toLowerCase().trim();
    if (effectiveEmail && effectiveEmail === email) {
      return true;
    }
  } catch (e) {}

  // If both allowlist and domain are empty, default to active user being teacher (initial setup)
  if (allowlist.length === 0 && !domain) {
    return true;
  }

  if (allowlist.includes(email)) {
    return true;
  }

  if (domain && email.endsWith(`@${domain}`)) {
    return true;
  }

  return false;
}

// ============================================================================
// SECTION 4: SETUP AND SCHEMA MANAGEMENT
// ============================================================================

/**
 * Initializes or verifies the Google Sheets database and Drive folders.
 * Safe to run repeatedly; does not delete existing data.
 */
function setupApp() {
  try {
    validateTeacherAccess();
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('No active spreadsheet bound to this script.');

    // Schema definitions
    const schema = {
      [CONFIG.SHEET_NAMES.SETTINGS]: ['Key', 'Value', 'Notes', 'UpdatedAt', 'UpdatedBy'],
      [CONFIG.SHEET_NAMES.CARDS]: [
        'CardId', 'CreatedAt', 'UpdatedAt', 'CreatedByEmail', 'ClassId', 'ClassName',
        'TaskId', 'TaskTitle', 'TaskContext', 'Transcript', 'CardTitle', 'StudentFriendlySummary',
        'TeacherMessage', 'ExpectationsJson', 'SuccessCriteriaJson', 'MaterialsJson',
        'CheckInQuestion', 'TeacherOnlyNotes', 'ReviewDate', 'Status',
        'ClassroomCourseWorkId', 'ClassroomAlternateLink', 'DeliveryError', 'SentAt', 'ArchivedAt'
      ],
      [CONFIG.SHEET_NAMES.CARD_RECIPIENTS]: [
        'RecipientId', 'CardId', 'StudentGoogleUserId', 'StudentEmail', 'StudentName',
        'ClassId', 'ClassroomSubmissionId', 'ClassroomDeliveryStatus',
        'SentAt', 'ViewedAt', 'AcknowledgedAt', 'AcknowledgementText', 'LastError'
      ],
      [CONFIG.SHEET_NAMES.TASKS]: [
        'TaskId', 'ClassId', 'TaskName', 'Description', 'DefaultSuccessCriteriaJson',
        'DefaultMaterialsJson', 'IsActive', 'CreatedAt', 'UpdatedAt'
      ],
      [CONFIG.SHEET_NAMES.GROUPS]: [
        'GroupId', 'ClassId', 'GroupName', 'StudentEmailsJson', 'CreatedAt', 'UpdatedAt', 'CreatedByEmail'
      ],
      [CONFIG.SHEET_NAMES.AUDIT_LOG]: [
        'AuditId', 'Timestamp', 'ActorEmail', 'Action', 'CardId', 'RecipientId', 'DetailsJson'
      ],
      [CONFIG.SHEET_NAMES.RECORDINGS]: [
        'RecordingId', 'CardId', 'DriveFileId', 'Filename', 'MimeType', 'SizeBytes', 'CreatedAt', 'DeletedAt'
      ]
    };

    const createdSheets = [];
    for (const [sheetName, headers] of Object.entries(schema)) {
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        sheet.appendRow(headers);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8f0fe');
        sheet.setFrozenRows(1);
        createdSheets.push(sheetName);
      } else {
        // Ensure header row exists
        const existingHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
        if (existingHeaders.length === 0 || !existingHeaders[0]) {
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8f0fe');
          sheet.setFrozenRows(1);
        }
      }
    }

    // Remove default blank 'Sheet1' if present
    const defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
      ss.deleteSheet(defaultSheet);
    }

    // Drive Folders Setup
    let rootFolderId = Config.getRootFolderId();
    let audioFolderId = Config.getAudioFolderId();

    if (!rootFolderId) {
      const rootFolder = DriveApp.createFolder('Task Expectations Store');
      rootFolderId = rootFolder.getId();
      Config.set('EXPECTATION_CARDS_ROOT_FOLDER_ID', rootFolderId);

      const audioFolder = rootFolder.createFolder('Audio Recordings (Transient)');
      audioFolderId = audioFolder.getId();
      Config.set('EXPECTATION_CARDS_AUDIO_FOLDER_ID', audioFolderId);
    }

    // Set default properties if missing
    if (!Config.get('AUDIO_RETENTION_DAYS')) Config.set('AUDIO_RETENTION_DAYS', '30');
    if (!Config.get('DELETE_AUDIO_AFTER_TRANSCRIPTION')) Config.set('DELETE_AUDIO_AFTER_TRANSCRIPTION', 'true');
    if (!Config.get('ENABLE_CLASSROOM_DELIVERY')) Config.set('ENABLE_CLASSROOM_DELIVERY', 'true');

    lock.releaseLock();

    logAuditEvent('APP_SETUP', {
      createdSheets: createdSheets,
      spreadsheetId: ss.getId(),
      rootFolderId: rootFolderId
    });

    return successResponse({
      message: 'Setup completed successfully.',
      spreadsheetUrl: ss.getUrl(),
      createdSheets: createdSheets,
      rootFolderId: rootFolderId,
      audioFolderId: audioFolderId
    });
  } catch (err) {
    return handleServerError(err, 'setupApp');
  }
}

// ============================================================================
// SECTION 5: GOOGLE SHEETS DATA HELPERS
// ============================================================================

const SheetHelper = {
  getSheet(sheetName) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('No active spreadsheet bound.');
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`Sheet '${sheetName}' not found. Please run setupApp() to initialize.`);
    }
    return sheet;
  },

  getAllRowsAsObjects(sheetName) {
    const sheet = this.getSheet(sheetName);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) return [];

    const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = data[0].map(h => String(h).trim());
    const rows = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // Skip completely blank rows
      if (!row.some(val => val !== '' && val !== null && val !== undefined)) continue;

      const obj = { _rowIndex: i + 1 };
      for (let j = 0; j < headers.length; j++) {
        const header = headers[j];
        if (header) {
          obj[header] = row[j] !== undefined ? row[j] : '';
        }
      }
      rows.push(obj);
    }
    return rows;
  },

  appendRow(sheetName, rowData) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      const sheet = this.getSheet(sheetName);
      sheet.appendRow(rowData);
    } finally {
      lock.releaseLock();
    }
  },

  updateRowByColumn(sheetName, idColumnName, idValue, newRowData) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      const sheet = this.getSheet(sheetName);
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow <= 1) return false;

      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
      const colIdx = headers.indexOf(idColumnName);
      if (colIdx === -1) throw new Error(`Column '${idColumnName}' not found in sheet '${sheetName}'`);

      const colValues = sheet.getRange(2, colIdx + 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < colValues.length; i++) {
        if (String(colValues[i][0]) === String(idValue)) {
          const targetRow = i + 2;
          sheet.getRange(targetRow, 1, 1, newRowData.length).setValues([newRowData]);
          return true;
        }
      }
      return false;
    } finally {
      lock.releaseLock();
    }
  },

  updateFieldByColumn(sheetName, idColumnName, idValue, fieldName, fieldValue) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      const sheet = this.getSheet(sheetName);
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow <= 1) return false;

      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
      const idIdx = headers.indexOf(idColumnName);
      const fieldIdx = headers.indexOf(fieldName);
      if (idIdx === -1) throw new Error(`Column '${idColumnName}' not found.`);
      if (fieldIdx === -1) throw new Error(`Column '${fieldName}' not found.`);

      const idValues = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < idValues.length; i++) {
        if (String(idValues[i][0]) === String(idValue)) {
          const targetRow = i + 2;
          sheet.getRange(targetRow, fieldIdx + 1).setValue(fieldValue);
          return true;
        }
      }
      return false;
    } finally {
      lock.releaseLock();
    }
  }
};

// ============================================================================
// SECTION 6: GOOGLE CLASSROOM INTEGRATION
// ============================================================================

const ClassroomHelper = {
  /**
   * Retrieves active Google Classroom courses where the user is a teacher.
   */
  listCourses() {
    try {
      let response = null;
      try {
        response = Classroom.Courses.list({
          courseStates: ['ACTIVE'],
          teacherId: 'me',
          pageSize: 50
        });
      } catch (teacherErr) {
        console.warn('Teacher-scoped course list encountered error, querying active courses:', teacherErr);
        response = Classroom.Courses.list({
          courseStates: ['ACTIVE'],
          pageSize: 50
        });
      }

      let courses = (response && response.courses) || [];
      if (courses.length === 0) {
        try {
          const generalResp = Classroom.Courses.list({ pageSize: 50 });
          courses = (generalResp && generalResp.courses) || [];
        } catch (e) {}
      }

      return courses.map(course => ({
        id: course.id,
        name: course.name,
        section: course.section || '',
        room: course.room || '',
        alternateLink: course.alternateLink || ''
      }));
    } catch (err) {
      console.error('Error in ClassroomHelper.listCourses:', err);
      throw new Error(`Unable to list Google Classroom courses: ${err.message}. Ensure the Google Classroom API is enabled under Services and in the Google Cloud Console.`);
    }
  },

  /**
   * Retrieves student roster for a course.
   */
  listStudents(courseId) {
    try {
      const students = [];
      let pageToken = null;
      do {
        const response = Classroom.Courses.Students.list(courseId, {
          pageSize: 100,
          pageToken: pageToken
        });
        if (response.students) {
          response.students.forEach(s => {
            students.push({
              userId: s.userId,
              name: (s.profile && s.profile.name && s.profile.name.fullName) || 'Student',
              email: (s.profile && s.profile.emailAddress) ? s.profile.emailAddress.toLowerCase() : '',
              photoUrl: (s.profile && s.profile.photoUrl) || ''
            });
          });
        }
        pageToken = response.nextPageToken;
      } while (pageToken);

      return students.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      console.error(`Error listing roster for course ${courseId}:`, err);
      throw new Error(`Failed to load student roster for classroom course ${courseId}.`);
    }
  },

  /**
   * Creates an ungraded Coursework item targeted to specific students or all students.
   * Directs students to their personal task expectation card.
   */
  createCourseWorkItem(courseId, cardTitle, studentFriendlySummary, webAppCardUrl, studentUserIds = []) {
    try {
      const isIndividual = Array.isArray(studentUserIds) && studentUserIds.length > 0;
      const title = `Task Expectations: ${cardTitle}`.substring(0, 250);

      const description = [
        studentFriendlySummary || 'Please review your task expectations card.',
        '',
        '👉 Open your Expectations Card:',
        webAppCardUrl,
        '',
        'Review the steps and check criteria as you complete your work.'
      ].join('\n');

      const courseWorkPayload = {
        title: title,
        description: description,
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        maxPoints: 0, // Ungraded expectation card
        assigneeMode: isIndividual ? 'INDIVIDUAL_STUDENTS' : 'ALL_STUDENTS',
        materials: [
          {
            link: {
              url: webAppCardUrl,
              title: `Open Expectations Card: ${cardTitle}`.substring(0, 100)
            }
          }
        ]
      };

      if (isIndividual) {
        courseWorkPayload.individualStudentsOptions = {
          studentIds: studentUserIds
        };
      }

      const created = Classroom.Courses.CourseWork.create(courseWorkPayload, courseId);
      return {
        id: created.id,
        alternateLink: created.alternateLink || '',
        title: created.title
      };
    } catch (err) {
      console.error('Error creating coursework item in Classroom:', err);
      throw new Error(`Failed to post task expectations to Google Classroom: ${err.message}`);
    }
  }
};

/**
 * Server endpoint: Get teacher's Classroom courses.
 */
function getTeacherCourses() {
  try {
    validateTeacherAccess();
    const courses = ClassroomHelper.listCourses();
    return successResponse({ courses: courses });
  } catch (err) {
    return handleServerError(err, 'getTeacherCourses');
  }
}

/**
 * Server endpoint: Get student roster for a class.
 */
function getCourseRoster(courseId) {
  try {
    validateTeacherAccess();
    if (!courseId) throw new Error('Class/Course ID is required.');
    const students = ClassroomHelper.listStudents(courseId);
    return successResponse({ students: students });
  } catch (err) {
    return handleServerError(err, 'getCourseRoster');
  }
}

// ============================================================================
// SECTION 7: CARD LIFECYCLE (CREATE, REVIEW, SEND, RETRY, ARCHIVE)
// ============================================================================

/**
 * Bootstrap data required by the Teacher UI on initial load.
 */
function getAppBootstrapData() {
  try {
    const teacherEmail = validateTeacherAccess();
    const settings = {
      appBaseUrl: Config.getAppBaseUrl(),
      hasGeminiApiKey: Boolean(Config.getGeminiApiKey()),
      deleteAudioAfterTranscription: Config.getDeleteAudioAfterTranscription(),
      audioRetentionDays: Config.getAudioRetentionDays(),
      classroomDeliveryEnabled: Config.isClassroomDeliveryEnabled()
    };

    let courses = [];
    try {
      courses = ClassroomHelper.listCourses();
    } catch (e) {
      console.warn('Could not load courses during bootstrap:', e);
    }

    return successResponse({
      teacherEmail: teacherEmail,
      settings: settings,
      courses: courses
    });
  } catch (err) {
    return handleServerError(err, 'getAppBootstrapData');
  }
}

/**
 * Creates or updates a draft card in the Sheets database.
 */
function createDraftCard(payload) {
  try {
    const teacherEmail = validateTeacherAccess();
    if (!payload) throw new Error('Card payload is required.');

    const cardId = payload.cardId || generateUuid_();
    const now = new Date().toISOString();

    const title = sanitiseText_(payload.cardTitle || 'Task Expectations');
    const summary = sanitiseText_(payload.studentFriendlySummary || '');
    const teacherMessage = sanitiseText_(payload.teacherMessage || '');
    const checkInQuestion = sanitiseText_(payload.checkInQuestion || '');
    const teacherOnlyNotes = sanitiseText_(payload.teacherOnlyNotes || '');
    const reviewDate = sanitiseText_(payload.reviewDate || '');

    const expectationsJson = JSON.stringify(Array.isArray(payload.steps) ? payload.steps : []);
    const successCriteriaJson = JSON.stringify(Array.isArray(payload.successCriteria) ? payload.successCriteria : []);
    const materialsJson = JSON.stringify(Array.isArray(payload.materials) ? payload.materials : []);

    const existingCards = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.CARDS).filter(c => c.CardId === cardId);
    const isUpdate = existingCards.length > 0;

    const rowData = [
      cardId,
      isUpdate ? existingCards[0].CreatedAt : now,
      now, // UpdatedAt
      teacherEmail,
      payload.classId || '',
      payload.className || '',
      payload.taskId || '',
      payload.taskTitle || '',
      payload.taskContext || '',
      payload.transcript || '',
      title,
      summary,
      teacherMessage,
      expectationsJson,
      successCriteriaJson,
      materialsJson,
      checkInQuestion,
      teacherOnlyNotes,
      reviewDate,
      payload.status || 'DRAFT',
      isUpdate ? existingCards[0].ClassroomCourseWorkId || '' : '',
      isUpdate ? existingCards[0].ClassroomAlternateLink || '' : '',
      isUpdate ? existingCards[0].DeliveryError || '' : '',
      isUpdate ? existingCards[0].SentAt || '' : '',
      isUpdate ? existingCards[0].ArchivedAt || '' : ''
    ];

    if (isUpdate) {
      SheetHelper.updateRowByColumn(CONFIG.SHEET_NAMES.CARDS, 'CardId', cardId, rowData);
    } else {
      SheetHelper.appendRow(CONFIG.SHEET_NAMES.CARDS, rowData);
    }

    // Save recipients if supplied
    if (Array.isArray(payload.recipients) && payload.recipients.length > 0) {
      saveCardRecipients_(cardId, payload.classId, payload.recipients);
    }

    logAuditEvent(isUpdate ? 'DRAFT_UPDATED' : 'DRAFT_CREATED', {
      cardId: cardId,
      recipientCount: (payload.recipients || []).length
    });

    return successResponse({
      cardId: cardId,
      message: isUpdate ? 'Draft card updated.' : 'Draft card saved.'
    });
  } catch (err) {
    return handleServerError(err, 'createDraftCard');
  }
}

/**
 * Helper: Saves recipients associated with a card, preserving existing states.
 */
function saveCardRecipients_(cardId, classId, recipients) {
  const existingRecipients = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.CARD_RECIPIENTS)
    .filter(r => r.CardId === cardId);

  const existingMap = {};
  existingRecipients.forEach(r => {
    existingMap[r.StudentGoogleUserId || r.StudentEmail] = r;
  });

  const now = new Date().toISOString();
  recipients.forEach(student => {
    const key = student.userId || student.email;
    const existing = existingMap[key];

    if (!existing) {
      const recipientId = generateUuid_();
      const row = [
        recipientId,
        cardId,
        student.userId || '',
        (student.email || '').toLowerCase(),
        student.name || '',
        classId || '',
        '', // ClassroomSubmissionId
        'PENDING', // ClassroomDeliveryStatus
        '', // SentAt
        '', // ViewedAt
        '', // AcknowledgedAt
        '', // AcknowledgementText
        ''  // LastError
      ];
      SheetHelper.appendRow(CONFIG.SHEET_NAMES.CARD_RECIPIENTS, row);
    }
  });
}

/**
 * Retrieves teacher cards matching optional status or class filters.
 */
function getTeacherCards(filters = {}) {
  try {
    const teacherEmail = validateTeacherAccess();
    let cards = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.CARDS);

    // Filter cards created by this teacher
    cards = cards.filter(c => String(c.CreatedByEmail).toLowerCase() === teacherEmail.toLowerCase());

    if (filters.classId) {
      cards = cards.filter(c => String(c.ClassId) === String(filters.classId));
    }
    if (filters.status) {
      cards = cards.filter(c => String(c.Status).toUpperCase() === String(filters.status).toUpperCase());
    }

    // Attach recipient summaries
    const allRecipients = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.CARD_RECIPIENTS);
    const cardList = cards.map(c => {
      const recipients = allRecipients.filter(r => r.CardId === c.CardId);
      const ackCount = recipients.filter(r => Boolean(r.AcknowledgedAt)).length;
      const viewedCount = recipients.filter(r => Boolean(r.ViewedAt)).length;

      return {
        cardId: c.CardId,
        title: c.CardTitle || 'Untitled Card',
        className: c.ClassName || 'Class',
        classId: c.ClassId,
        status: c.Status,
        createdAt: c.CreatedAt,
        updatedAt: c.UpdatedAt,
        sentAt: c.SentAt,
        archivedAt: c.ArchivedAt,
        recipientCount: recipients.length,
        acknowledgedCount: ackCount,
        viewedCount: viewedCount,
        classroomLink: c.ClassroomAlternateLink || '',
        hasDeliveryError: Boolean(c.DeliveryError),
        deliveryError: c.DeliveryError || ''
      };
    });

    // Sort newest first
    cardList.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());

    return successResponse({ cards: cardList });
  } catch (err) {
    return handleServerError(err, 'getTeacherCards');
  }
}

/**
 * Retrieves full card details for teacher editing or tracking.
 */
function getCard(cardId) {
  try {
    const teacherEmail = validateTeacherAccess();
    if (!cardId) throw new Error('Card ID is required.');

    const cards = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.CARDS).filter(c => c.CardId === cardId);
    if (cards.length === 0) throw new Error('Expectation card not found.');
    const card = cards[0];

    // Authorization: card creator or teacher
    if (String(card.CreatedByEmail).toLowerCase() !== teacherEmail.toLowerCase()) {
      throw new Error('Unauthorized to view this card.');
    }

    const recipients = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.CARD_RECIPIENTS).filter(r => r.CardId === cardId);

    return successResponse({
      cardId: card.CardId,
      classId: card.ClassId,
      className: card.ClassName,
      taskId: card.TaskId,
      taskTitle: card.TaskTitle,
      taskContext: card.TaskContext,
      transcript: card.Transcript,
      cardTitle: card.CardTitle,
      studentFriendlySummary: card.StudentFriendlySummary,
      teacherMessage: card.TeacherMessage,
      steps: parseJsonSafe_(card.ExpectationsJson, []),
      successCriteria: parseJsonSafe_(card.SuccessCriteriaJson, []),
      materials: parseJsonSafe_(card.MaterialsJson, []),
      checkInQuestion: card.CheckInQuestion,
      teacherOnlyNotes: card.TeacherOnlyNotes,
      reviewDate: card.ReviewDate,
      status: card.Status,
      classroomCourseWorkId: card.ClassroomCourseWorkId,
      classroomAlternateLink: card.ClassroomAlternateLink,
      deliveryError: card.DeliveryError,
      sentAt: card.SentAt,
      createdAt: card.CreatedAt,
      updatedAt: card.UpdatedAt,
      recipients: recipients.map(r => ({
        recipientId: r.RecipientId,
        studentName: r.StudentName,
        studentEmail: r.StudentEmail,
        studentUserId: r.StudentGoogleUserId,
        deliveryStatus: r.ClassroomDeliveryStatus,
        sentAt: r.SentAt,
        viewedAt: r.ViewedAt,
        acknowledgedAt: r.AcknowledgedAt,
        acknowledgementText: r.AcknowledgementText,
        lastError: r.LastError
      }))
    });
  } catch (err) {
    return handleServerError(err, 'getCard');
  }
}

/**
 * Posts a saved card to Google Classroom and marks it as SENT.
 * Idempotent: Can safely be retried if previously failed.
 */
function postCardToClassroom(cardId) {
  try {
    validateTeacherAccess();
    if (!cardId) throw new Error('Card ID is required.');

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);

    const cards = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.CARDS).filter(c => c.CardId === cardId);
    if (cards.length === 0) throw new Error('Card not found.');
    const card = cards[0];

    const recipients = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.CARD_RECIPIENTS).filter(r => r.CardId === cardId);
    if (recipients.length === 0) {
      throw new Error('Cannot send card: No recipients are assigned to this card.');
    }

    const now = new Date().toISOString();
    const studentUserIds = recipients.map(r => r.StudentGoogleUserId).filter(Boolean);

    // Build the secure, unguessable student card link
    const baseUrl = Config.getAppBaseUrl();
    const studentCardUrl = `${baseUrl}?mode=student&card=${encodeURIComponent(cardId)}`;

    let courseWorkItem = null;
    let deliveryError = '';

    // Check if CourseWork item already exists to prevent duplicates on retry
    if (card.ClassroomCourseWorkId) {
      try {
        courseWorkItem = Classroom.Courses.CourseWork.get(card.ClassId, card.ClassroomCourseWorkId);
      } catch (e) {
        console.warn('Existing coursework item not found or inaccessible, creating fresh one:', e);
        courseWorkItem = null;
      }
    }

    if (!courseWorkItem) {
      try {
        courseWorkItem = ClassroomHelper.createCourseWorkItem(
          card.ClassId,
          card.CardTitle || 'Expectations',
          card.StudentFriendlySummary || '',
          studentCardUrl,
          studentUserIds
        );
      } catch (postErr) {
        deliveryError = postErr.message || 'Classroom posting failed';
        console.error('Classroom posting failure:', postErr);
      }
    }

    // Update card record
    const newStatus = courseWorkItem ? 'SENT' : 'DELIVERY_FAILED';
    SheetHelper.updateFieldByColumn(CONFIG.SHEET_NAMES.CARDS, 'CardId', cardId, 'Status', newStatus);
    SheetHelper.updateFieldByColumn(CONFIG.SHEET_NAMES.CARDS, 'CardId', cardId, 'UpdatedAt', now);
    SheetHelper.updateFieldByColumn(CONFIG.SHEET_NAMES.CARDS, 'CardId', cardId, 'DeliveryError', deliveryError);

    if (courseWorkItem) {
      SheetHelper.updateFieldByColumn(CONFIG.SHEET_NAMES.CARDS, 'CardId', cardId, 'ClassroomCourseWorkId', courseWorkItem.id);
      SheetHelper.updateFieldByColumn(CONFIG.SHEET_NAMES.CARDS, 'CardId', cardId, 'ClassroomAlternateLink', courseWorkItem.alternateLink || '');
      SheetHelper.updateFieldByColumn(CONFIG.SHEET_NAMES.CARDS, 'CardId', cardId, 'SentAt', now);
    }

    // Update recipient delivery statuses
    recipients.forEach(r => {
      SheetHelper.updateFieldByColumn(
        CONFIG.SHEET_NAMES.CARD_RECIPIENTS,
        'RecipientId',
        r.RecipientId,
        'ClassroomDeliveryStatus',
        courseWorkItem ? 'SENT' : 'FAILED'
      );
      if (courseWorkItem) {
        SheetHelper.updateFieldByColumn(CONFIG.SHEET_NAMES.CARD_RECIPIENTS, 'RecipientId', r.RecipientId, 'SentAt', now);
      } else {
        SheetHelper.updateFieldByColumn(CONFIG.SHEET_NAMES.CARD_RECIPIENTS, 'RecipientId', r.RecipientId, 'LastError', deliveryError);
      }
    });

    lock.releaseLock();

    logAuditEvent(courseWorkItem ? 'CARD_SENT' : 'CLASSROOM_DELIVERY_FAILED', {
      cardId: cardId,
      recipientCount: recipients.length,
      classroomCourseWorkId: courseWorkItem ? courseWorkItem.id : null,
      error: deliveryError
    });

    if (!courseWorkItem) {
      return errorResponse('CLASSROOM_DELIVERY_FAILED', `Card saved, but posting to Google Classroom failed: ${deliveryError}`, { cardId });
    }

    return successResponse({
      cardId: cardId,
      status: 'SENT',
      classroomCourseWorkId: courseWorkItem.id,
      classroomAlternateLink: courseWorkItem.alternateLink || '',
      recipientCount: recipients.length,
      message: 'Card successfully posted to Google Classroom.'
    });
  } catch (err) {
    return handleServerError(err, 'postCardToClassroom');
  }
}

/**
 * Retries delivery for a failed card.
 */
function retryCardDelivery(cardId) {
  logAuditEvent('CLASSROOM_DELIVERY_RETRIED', { cardId: cardId });
  return postCardToClassroom(cardId);
}

/**
 * Archives a card.
 */
function archiveCard(cardId) {
  try {
    validateTeacherAccess();
    if (!cardId) throw new Error('Card ID is required.');
    const now = new Date().toISOString();

    SheetHelper.updateFieldByColumn(CONFIG.SHEET_NAMES.CARDS, 'CardId', cardId, 'Status', 'ARCHIVED');
    SheetHelper.updateFieldByColumn(CONFIG.SHEET_NAMES.CARDS, 'CardId', cardId, 'ArchivedAt', now);
    SheetHelper.updateFieldByColumn(CONFIG.SHEET_NAMES.CARDS, 'CardId', cardId, 'UpdatedAt', now);

    logAuditEvent('CARD_ARCHIVED', { cardId: cardId });
    return successResponse({ cardId: cardId, message: 'Card archived.' });
  } catch (err) {
    return handleServerError(err, 'archiveCard');
  }
}

/**
 * Duplicates an existing card as a new draft.
 */
function duplicateCard(cardId) {
  try {
    validateTeacherAccess();
    const sourceResp = getCard(cardId);
    if (!sourceResp.ok) throw new Error(sourceResp.error.message);
    const source = sourceResp.data;

    const newPayload = {
      classId: source.classId,
      className: source.className,
      taskId: source.taskId,
      taskTitle: source.taskTitle,
      taskContext: source.taskContext,
      transcript: source.transcript,
      cardTitle: `${source.cardTitle} (Copy)`,
      studentFriendlySummary: source.studentFriendlySummary,
      teacherMessage: source.teacherMessage,
      steps: source.steps,
      successCriteria: source.successCriteria,
      materials: source.materials,
      checkInQuestion: source.checkInQuestion,
      teacherOnlyNotes: source.teacherOnlyNotes,
      reviewDate: source.reviewDate,
      status: 'DRAFT'
    };

    return createDraftCard(newPayload);
  } catch (err) {
    return handleServerError(err, 'duplicateCard');
  }
}

// ============================================================================
// SECTION 8: STUDENT PORTAL FUNCTIONS
// ============================================================================

/**
 * Validates a student's permission to view a specific card.
 * Throws an error if the user's active email is not an authorized recipient.
 */
function validateStudentCardAccess(cardId) {
  let userEmail = '';
  try {
    userEmail = Session.getActiveUser().getEmail().toLowerCase().trim();
  } catch (e) {
    userEmail = '';
  }

  if (!userEmail) {
    throw new Error('Student authorization failed: Please sign in with your school Google account.');
  }

  // Allow teachers to preview student card
  if (isUserTeacher_(userEmail)) {
    return { userEmail: userEmail, isTeacherPreview: true, recipient: null };
  }

  const recipients = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.CARD_RECIPIENTS)
    .filter(r => r.CardId === cardId && String(r.StudentEmail).toLowerCase() === userEmail);

  if (recipients.length === 0) {
    logAuditEvent('STUDENT_ACCESS_DENIED', {
      cardId: cardId,
      userEmail: userEmail,
      reason: 'User email not found in recipient list for this card'
    });
    throw new Error('Access denied: You are not a registered recipient for this expectation card.');
  }

  return { userEmail: userEmail, isTeacherPreview: false, recipient: recipients[0] };
}

/**
 * Retrieves student-safe view of a card.
 * CRITICAL: Teacher-only notes, other recipients, and raw transcripts are completely stripped.
 */
function getStudentCard(cardId) {
  try {
    if (!cardId) throw new Error('Card ID is required.');
    const access = validateStudentCardAccess(cardId);

    const cards = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.CARDS).filter(c => c.CardId === cardId);
    if (cards.length === 0) throw new Error('Card not found.');
    const card = cards[0];

    // Mark as viewed on server if accessed by the student
    if (!access.isTeacherPreview && access.recipient && !access.recipient.ViewedAt) {
      markCardViewedInternal_(access.recipient.RecipientId);
    }

    const steps = parseJsonSafe_(card.ExpectationsJson, []);
    const successCriteria = parseJsonSafe_(card.SuccessCriteriaJson, []);
    const materials = parseJsonSafe_(card.MaterialsJson, []);

    return successResponse({
      cardId: card.CardId,
      cardTitle: card.CardTitle,
      studentFriendlySummary: card.StudentFriendlySummary,
      taskTitle: card.TaskTitle,
      taskContext: card.TaskContext,
      teacherMessage: card.TeacherMessage,
      steps: steps,
      successCriteria: successCriteria,
      materials: materials,
      checkInQuestion: card.CheckInQuestion,
      reviewDate: card.ReviewDate,
      studentName: access.recipient ? access.recipient.StudentName : 'Student',
      isAcknowledged: access.recipient ? Boolean(access.recipient.AcknowledgedAt) : false,
      acknowledgedAt: access.recipient ? access.recipient.AcknowledgedAt : null,
      acknowledgementText: access.recipient ? access.recipient.AcknowledgementText : '',
      isTeacherPreview: access.isTeacherPreview
    });
  } catch (err) {
    return handleServerError(err, 'getStudentCard');
  }
}

/**
 * Internal helper to mark card as viewed.
 */
function markCardViewedInternal_(recipientId) {
  try {
    const now = new Date().toISOString();
    SheetHelper.updateFieldByColumn(CONFIG.SHEET_NAMES.CARD_RECIPIENTS, 'RecipientId', recipientId, 'ViewedAt', now);
    logAuditEvent('CARD_VIEWED', { recipientId: recipientId });
  } catch (e) {
    console.warn('Failed to record card viewed timestamp:', e);
  }
}

/**
 * Student acknowledgement endpoint.
 */
function acknowledgeCard(cardId, acknowledgementText = '') {
  try {
    if (!cardId) throw new Error('Card ID is required.');
    const access = validateStudentCardAccess(cardId);

    if (access.isTeacherPreview) {
      return successResponse({ message: 'Teacher preview mode: Acknowledgement simulated.' });
    }

    const now = new Date().toISOString();
    const cleanAck = sanitiseText_(acknowledgementText || 'Acknowledged');

    SheetHelper.updateFieldByColumn(
      CONFIG.SHEET_NAMES.CARD_RECIPIENTS,
      'RecipientId',
      access.recipient.RecipientId,
      'AcknowledgedAt',
      now
    );
    SheetHelper.updateFieldByColumn(
      CONFIG.SHEET_NAMES.CARD_RECIPIENTS,
      'RecipientId',
      access.recipient.RecipientId,
      'AcknowledgementText',
      cleanAck
    );

    logAuditEvent('CARD_ACKNOWLEDGED', {
      cardId: cardId,
      recipientId: access.recipient.RecipientId,
      studentEmail: access.userEmail
    });

    return successResponse({
      cardId: cardId,
      acknowledgedAt: now,
      acknowledgementText: cleanAck,
      message: 'Thank you! Your task expectations have been acknowledged.'
    });
  } catch (err) {
    return handleServerError(err, 'acknowledgeCard');
  }
}

// ============================================================================
// SECTION 9: RECORDING AND TRANSCRIPTION PROVIDERS
// ============================================================================

/**
 * Saves teacher audio recording to Drive and invokes the configured transcription provider.
 */
function transcribeAudio(payload) {
  try {
    validateTeacherAccess();
    if (!payload || !payload.base64Audio) {
      throw new Error('Audio recording data is required.');
    }

    const base64Data = payload.base64Audio.split(',').pop();
    const mimeType = payload.mimeType || 'audio/webm';
    const filename = `Expectation_Audio_${generateUuid_()}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;

    // Validate size limit
    const approximateBytes = (base64Data.length * 3) / 4;
    if (approximateBytes > CONFIG.MAX_AUDIO_PAYLOAD_BYTES) {
      throw new Error(`Audio recording payload exceeds maximum allowed size (${Math.round(CONFIG.MAX_AUDIO_PAYLOAD_BYTES / 1048576)} MB).`);
    }

    // Save transient audio to Drive
    let driveFileId = null;
    try {
      driveFileId = saveAudioRecordingInternal_(base64Data, mimeType, filename);
    } catch (driveErr) {
      console.warn('Drive saving error, proceeding with direct transcription:', driveErr);
    }

    let transcript = '';
    try {
      transcript = transcribeWithConfiguredProvider_(base64Data, mimeType);
    } catch (transErr) {
      console.error('Transcription provider error:', transErr);
      throw new Error(`Transcription failed: ${transErr.message}. You can type or paste your conversation directly into the transcript box.`);
    }

    // Check audio retention policy
    if (driveFileId && Config.getDeleteAudioAfterTranscription()) {
      deleteAudioFileInternal_(driveFileId);
    }

    return successResponse({
      transcript: transcript,
      audioFileId: driveFileId,
      message: 'Audio transcribed successfully.'
    });
  } catch (err) {
    return handleServerError(err, 'transcribeAudio');
  }
}

/**
 * Internal Drive helper for audio persistence.
 */
function saveAudioRecordingInternal_(base64Str, mimeType, filename) {
  let audioFolder = null;
  const folderId = Config.getAudioFolderId();
  if (folderId) {
    try { audioFolder = DriveApp.getFolderById(folderId); } catch (e) { audioFolder = null; }
  }
  if (!audioFolder) {
    audioFolder = DriveApp.getRootFolder();
  }

  const blob = Utilities.newBlob(Utilities.base64Decode(base64Str), mimeType, filename);
  const file = audioFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.NONE); // Strictly private

  logAuditEvent('AUDIO_SAVED', { fileId: file.getId(), filename: filename });
  return file.getId();
}

/**
 * Internal helper to safely delete an audio file.
 */
function deleteAudioFileInternal_(fileId) {
  try {
    if (!fileId) return;
    DriveApp.getFileById(fileId).setTrashed(true);
    logAuditEvent('AUDIO_DELETED_RETENTION', { fileId: fileId });
  } catch (e) {
    console.warn(`Could not trash audio file ${fileId}:`, e);
  }
}

/**
 * Pluggable transcription provider dispatch.
 */
function transcribeWithConfiguredProvider_(base64Audio, mimeType) {
  const geminiKey = Config.getGeminiApiKey();
  if (geminiKey) {
    return transcribeWithGemini_(base64Audio, mimeType, geminiKey);
  }
  throw new Error('No transcription provider configured. Please configure GEMINI_API_KEY in Script Properties, or enter the transcript manually.');
}

/**
 * Transcribes audio using Gemini Multimodal API.
 */
function transcribeWithGemini_(base64Audio, mimeType, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'audio/webm',
              data: base64Audio
            }
          },
          {
            text: 'You are an accurate, objective transcriptionist in a high school classroom setting. Provide a clean, accurate, verbatim transcript of the teacher and student conversation in this audio. Remove filler words (um, ah). Do not add any conversational commentary, assumptions, or analysis.'
          }
        ]
      }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code !== 200) {
    let msg = `Gemini API returned code ${code}`;
    try {
      const errJson = JSON.parse(text);
      if (errJson.error && errJson.error.message) msg = errJson.error.message;
    } catch (e) {}
    throw new Error(msg);
  }

  const result = JSON.parse(text);
  const candidates = result.candidates;
  if (!candidates || candidates.length === 0 || !candidates[0].content) {
    throw new Error('Gemini did not return any transcription candidates.');
  }

  const parts = candidates[0].content.parts || [];
  return parts.map(p => p.text).join('\n').trim();
}

// ============================================================================
// SECTION 10: AI GENERATION PROVIDERS
// ============================================================================

/**
 * Generates structured, teacher-reviewable Expectation Card JSON from a transcript.
 * MANDATORY PRINCIPLE: Output is strictly a draft for teacher review, never automatically sent.
 */
function generateExpectationsFromTranscript(payload) {
  try {
    validateTeacherAccess();
    if (!payload || (!payload.transcript && !payload.teacherNotes)) {
      throw new Error('A transcript or teacher notes are required to generate task expectations.');
    }

    const apiKey = Config.getGeminiApiKey();
    if (!apiKey) {
      throw new Error('Gemini API key is not configured. Please set GEMINI_API_KEY in Script Properties.');
    }

    const transcript = sanitiseText_(payload.transcript || '');
    const className = sanitiseText_(payload.className || 'Class');
    const taskTitle = sanitiseText_(payload.taskTitle || 'Activity');
    const taskContext = sanitiseText_(payload.taskContext || '');
    const teacherNotes = sanitiseText_(payload.teacherNotes || '');

    const systemPrompt = [
      'You are an expert pedagogical assistant helping high school teachers convert spoken conversation notes into clear, structured, student-friendly task expectations.',
      'Language: Australian / UK English.',
      'CRITICAL SAFETY & PRIVACY RULES:',
      '- Respond with valid JSON ONLY matching the requested schema. No markdown backticks, no markdown formatting outside JSON.',
      '- Do NOT invent marks, consequences, behaviour allegations, disciplinary measures, medical details, or accommodations not stated.',
      '- Do NOT invent dates or deadlines unless explicitly stated by the teacher (e.g. "by the end of this period").',
      '- Turn vague directions into 3 to 7 concrete, actionable, observable checklist steps.',
      '- Tone: Supportive, clear, respectful, direct, and empowering.',
      '- Student-friendly summary must be 1 to 2 concise sentences.',
      '- Flag any teacher ambiguity or incomplete instructions in teacherOnlyNotes so the teacher can review them.'
    ].join('\n');

    const userPrompt = [
      `Class: ${className}`,
      `Task Title: ${taskTitle}`,
      taskContext ? `Task Context: ${taskContext}` : '',
      teacherNotes ? `Teacher Specific Notes: ${teacherNotes}` : '',
      '',
      `Transcript of conversation:\n"""\n${transcript}\n"""`,
      '',
      'Return a single JSON object with EXACTLY this structure:',
      '{',
      '  "cardTitle": "string (clear student-friendly card title)",',
      '  "studentFriendlySummary": "string (1-2 sentences summarizing expectations)",',
      '  "steps": [',
      '    {',
      '      "id": "step-1",',
      '      "text": "string (actionable, clear instruction)",',
      '      "required": true,',
      '      "dueDate": ""',
      '    }',
      '  ],',
      '  "successCriteria": [',
      '    "string (observable criteria of done)"',
      '  ],',
      '  "materials": [',
      '    {',
      '      "label": "string (tool or resource needed)",',
      '      "url": ""',
      '    }',
      '  ],',
      '  "checkInQuestion": "string (a quick reflection question)",',
      '  "teacherMessage": "string (encouraging teacher note)",',
      '  "teacherOnlyNotes": "string (private reminders for teacher review only, NOT visible to students)"',
      '}'
    ].filter(Boolean).join('\n');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const requestBody = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    };

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code !== 200) {
      throw new Error(`Gemini generation failed (HTTP ${code}): ${text}`);
    }

    const resultJson = JSON.parse(text);
    const rawContent = resultJson.candidates[0].content.parts[0].text;
    const cardData = validateAndNormalizeCardStructure_(JSON.parse(rawContent));

    logAuditEvent('AI_CARD_GENERATED', { taskTitle: taskTitle });

    return successResponse({
      cardData: cardData,
      message: 'Expectation card draft generated for review.'
    });
  } catch (err) {
    return handleServerError(err, 'generateExpectationsFromTranscript');
  }
}

/**
 * Regenerates or refines an existing expectation card with teacher prompt instructions.
 */
function regenerateExpectations(payload) {
  return generateExpectationsFromTranscript(payload);
}

/**
 * Validates and repairs AI card structure.
 */
function validateAndNormalizeCardStructure_(card) {
  if (!card || typeof card !== 'object') card = {};

  card.cardTitle = sanitiseText_(card.cardTitle || 'Task Expectations');
  card.studentFriendlySummary = sanitiseText_(card.studentFriendlySummary || '');
  card.teacherMessage = sanitiseText_(card.teacherMessage || '');
  card.checkInQuestion = sanitiseText_(card.checkInQuestion || 'What step will you start first?');
  card.teacherOnlyNotes = sanitiseText_(card.teacherOnlyNotes || '');

  // Normalize steps
  if (!Array.isArray(card.steps) || card.steps.length === 0) {
    card.steps = [{ id: 'step-1', text: 'Follow teacher spoken instructions.', required: true, dueDate: '' }];
  } else {
    card.steps = card.steps.map((s, idx) => ({
      id: s.id || `step-${idx + 1}`,
      text: typeof s === 'string' ? s : sanitiseText_(s.text || ''),
      required: s.required !== undefined ? Boolean(s.required) : true,
      dueDate: s.dueDate || ''
    })).filter(s => s.text.length > 0);
  }

  // Normalize success criteria
  if (!Array.isArray(card.successCriteria)) card.successCriteria = [];
  card.successCriteria = card.successCriteria.map(c => typeof c === 'string' ? sanitiseText_(c) : sanitiseText_(c.text || '')).filter(Boolean);

  // Normalize materials
  if (!Array.isArray(card.materials)) card.materials = [];
  card.materials = card.materials.map(m => typeof m === 'string' ? { label: sanitiseText_(m), url: '' } : { label: sanitiseText_(m.label || ''), url: m.url || '' }).filter(m => m.label.length > 0);

  return card;
}

// ============================================================================
// SECTION 11: DRIVE AND RETENTION HANDLING
// ============================================================================

/**
 * Maintenance function: Cleans up audio files older than AUDIO_RETENTION_DAYS.
 * Can be installed as a time-driven trigger (e.g. daily).
 */
function cleanupExpiredAudio() {
  try {
    const retentionDays = Config.getAudioRetentionDays();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const folderId = Config.getAudioFolderId();
    if (!folderId) return successResponse({ message: 'No audio folder configured.' });

    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    let deletedCount = 0;

    while (files.hasNext()) {
      const file = files.next();
      if (file.getDateCreated() < cutoffDate) {
        file.setTrashed(true);
        deletedCount++;
      }
    }

    logAuditEvent('CLEANUP_EXPIRED_AUDIO', {
      deletedCount: deletedCount,
      retentionDays: retentionDays
    });

    return successResponse({ deletedCount: deletedCount });
  } catch (err) {
    return handleServerError(err, 'cleanupExpiredAudio');
  }
}

// ============================================================================
// SECTION 12: TASK TEMPLATES & STUDENT GROUPS
// ============================================================================

/**
 * Gets saved task templates for a class.
 */
function getTasksForClass(classId) {
  try {
    validateTeacherAccess();
    const rows = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.TASKS);
    const tasks = rows.filter(t => !classId || t.ClassId === classId || !t.ClassId).map(t => ({
      taskId: t.TaskId,
      classId: t.ClassId,
      taskName: t.TaskName,
      description: t.Description,
      successCriteria: parseJsonSafe_(t.DefaultSuccessCriteriaJson, []),
      materials: parseJsonSafe_(t.DefaultMaterialsJson, []),
      isActive: t.IsActive === true || t.IsActive === 'TRUE'
    }));
    return successResponse({ tasks: tasks });
  } catch (err) {
    return handleServerError(err, 'getTasksForClass');
  }
}

/**
 * Saves or updates a reusable task template.
 */
function saveTask(taskPayload) {
  try {
    validateTeacherAccess();
    if (!taskPayload || !taskPayload.taskName) throw new Error('Task template name is required.');

    const taskId = taskPayload.taskId || generateUuid_();
    const now = new Date().toISOString();

    const row = [
      taskId,
      taskPayload.classId || '',
      sanitiseText_(taskPayload.taskName),
      sanitiseText_(taskPayload.description || ''),
      JSON.stringify(taskPayload.successCriteria || []),
      JSON.stringify(taskPayload.materials || []),
      'TRUE',
      now,
      now
    ];

    const existing = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.TASKS).filter(t => t.TaskId === taskId);
    if (existing.length > 0) {
      SheetHelper.updateRowByColumn(CONFIG.SHEET_NAMES.TASKS, 'TaskId', taskId, row);
    } else {
      SheetHelper.appendRow(CONFIG.SHEET_NAMES.TASKS, row);
    }

    return successResponse({ taskId: taskId, message: 'Task template saved.' });
  } catch (err) {
    return handleServerError(err, 'saveTask');
  }
}

/**
 * Retrieves saved reusable student groups for a class.
 */
function getGroupsForClass(classId) {
  try {
    validateTeacherAccess();
    const rows = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.GROUPS);
    const groups = rows.filter(g => !classId || g.ClassId === classId).map(g => ({
      groupId: g.GroupId,
      classId: g.ClassId,
      groupName: g.GroupName,
      studentEmails: parseJsonSafe_(g.StudentEmailsJson, []),
      createdAt: g.CreatedAt
    }));
    return successResponse({ groups: groups });
  } catch (err) {
    return handleServerError(err, 'getGroupsForClass');
  }
}

/**
 * Saves a reusable student group.
 */
function saveGroup(groupPayload) {
  try {
    const teacherEmail = validateTeacherAccess();
    if (!groupPayload || !groupPayload.groupName) throw new Error('Group name is required.');

    const groupId = groupPayload.groupId || generateUuid_();
    const now = new Date().toISOString();

    const row = [
      groupId,
      groupPayload.classId || '',
      sanitiseText_(groupPayload.groupName),
      JSON.stringify(groupPayload.studentEmails || []),
      now,
      now,
      teacherEmail
    ];

    const existing = SheetHelper.getAllRowsAsObjects(CONFIG.SHEET_NAMES.GROUPS).filter(g => g.GroupId === groupId);
    if (existing.length > 0) {
      SheetHelper.updateRowByColumn(CONFIG.SHEET_NAMES.GROUPS, 'GroupId', groupId, row);
    } else {
      SheetHelper.appendRow(CONFIG.SHEET_NAMES.GROUPS, row);
    }

    return successResponse({ groupId: groupId, message: 'Group saved.' });
  } catch (err) {
    return handleServerError(err, 'saveGroup');
  }
}

// ============================================================================
// SECTION 13: AUDIT LOGGING
// ============================================================================

/**
 * Logs a sensitive lifecycle action without storing transcripts or raw audio.
 */
function logAuditEvent(action, details = {}) {
  try {
    let actorEmail = '';
    try { actorEmail = Session.getActiveUser().getEmail().toLowerCase().trim(); } catch (e) {}

    // Safe details sanitisation (remove sensitive personal content or audio bytes)
    const cleanDetails = Object.assign({}, details);
    delete cleanDetails.base64Audio;
    delete cleanDetails.transcript;
    delete cleanDetails.teacherNotes;

    const row = [
      generateUuid_(),
      new Date().toISOString(),
      actorEmail || 'anonymous',
      action,
      cleanDetails.cardId || '',
      cleanDetails.recipientId || '',
      JSON.stringify(cleanDetails)
    ];

    // Append to AuditLog sheet if available
    try {
      SheetHelper.appendRow(CONFIG.SHEET_NAMES.AUDIT_LOG, row);
    } catch (e) {
      console.log(`[Audit: ${action}]`, JSON.stringify(cleanDetails));
    }
  } catch (err) {
    console.warn('Audit logging failure:', err);
  }
}

// ============================================================================
// SECTION 14: VALIDATION, SANITISATION & ERROR HELPERS
// ============================================================================

function sanitiseText_(text) {
  if (text === null || text === undefined) return '';
  return String(text).trim();
}

function sanitiseHtml_(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseJsonSafe_(jsonStr, fallback = null) {
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    return fallback;
  }
}

function generateUuid_() {
  return Utilities.getUuid();
}

/**
 * Consistent success response helper.
 */
function successResponse(data = {}) {
  return {
    ok: true,
    data: data
  };
}

/**
 * Consistent error response helper.
 */
function errorResponse(code, message, details = {}) {
  return {
    ok: false,
    error: {
      code: code || 'ERROR',
      message: message || 'An unexpected error occurred.',
      details: details || {}
    }
  };
}

/**
 * Standard server error handler wrapper.
 */
function handleServerError(err, context = '') {
  console.error(`Server error in ${context}:`, err);
  return errorResponse(
    'SERVER_ERROR',
    err && err.message ? err.message : 'A server error occurred. Please try again or contact your administrator.',
    { context: context }
  );
}

// ============================================================================
// SECTION 15: SETTINGS GET/SAVE (FOR TEACHER DASHBOARD)
// ============================================================================

function getSettings() {
  try {
    validateTeacherAccess();
    return successResponse({
      appBaseUrl: Config.getAppBaseUrl(),
      allowedDomain: Config.getAllowedDomain(),
      audioRetentionDays: Config.getAudioRetentionDays(),
      deleteAudioAfterTranscription: Config.getDeleteAudioAfterTranscription(),
      classroomDeliveryEnabled: Config.isClassroomDeliveryEnabled(),
      hasGeminiApiKey: Boolean(Config.getGeminiApiKey())
    });
  } catch (err) {
    return handleServerError(err, 'getSettings');
  }
}

function saveSettings(payload) {
  try {
    validateTeacherAccess();
    if (!payload) throw new Error('Settings payload required.');

    if (payload.audioRetentionDays !== undefined) {
      Config.set('AUDIO_RETENTION_DAYS', String(payload.audioRetentionDays));
    }
    if (payload.deleteAudioAfterTranscription !== undefined) {
      Config.set('DELETE_AUDIO_AFTER_TRANSCRIPTION', String(payload.deleteAudioAfterTranscription));
    }
    if (payload.geminiApiKey) {
      Config.set('GEMINI_API_KEY', String(payload.geminiApiKey).trim());
    }
    if (payload.allowedDomain !== undefined) {
      Config.set('ALLOWED_TEACHER_DOMAIN', String(payload.allowedDomain).trim().toLowerCase());
    }

    return successResponse({ message: 'Settings saved successfully.' });
  } catch (err) {
    return handleServerError(err, 'saveSettings');
  }
}
