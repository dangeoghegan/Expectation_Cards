# 1. Architecture Explanation

The **Expectation Cards** application is designed as a serverless Google Workspace application using **Google Apps Script** as the backend host and **HTML Service** for the frontend.

- **Backend (Apps Script):** Acts as the central orchestrator. It handles routing (`doGet`), provides RPC endpoints for the frontend (`google.script.run`), and manages interactions with Google services.
- **Database (Google Sheets):** Used for persistent, schema-driven data storage (`SheetService.js`). It stores cards, versions, checklist items, audit logs, and delivery records. LockService is implemented to handle concurrent writes.
- **File Storage (Google Drive):** Used temporarily or permanently (based on config) to store `.webm` audio blobs recorded by the teacher.
- **AI Processing (Gemini API):** Audio files are sent to the Gemini File API and transcribed. The transcript is then passed back to Gemini with a strict schema to extract a structured JSON representation of the expectation card. It handles merging of existing cards.
- **Delivery (Google Classroom API):** Integrates as an Advanced Service. It fetches courses and rosters. Upon sending a card, it attaches a unique, stable link (tokenized) to a student's submission in an assignment, or creates a new targeted assignment if required.
- **Frontend (Vanilla JS/HTML/CSS):** Designed mobile-first. It uses separate HTML files for layout (`TeacherApp`, `StudentCard`), CSS (`Styles`), and JavaScript (`ClientJS`).

# 2. Repository/File Tree

```text
/
  README.md
  .gitignore
  appsscript.json
  package.json
  src/
    Code.js
    Config.js
    Auth.js
    ClassroomService.js
    CardService.js
    GeminiService.js
    DriveService.js
    SheetService.js
    AuditService.js
    Validation.js
    Utils.js
    Setup.js
    Index.html
    TeacherApp.html
    StudentCard.html
    Styles.html
    ClientJS.html
  tests/
    test-data.json
    manual-test-checklist.md
```

# 3. Code Files

## `src/Config.js`
```javascript
/**
 * Config.js
 * Application configuration management using PropertiesService.
 */

const Config = {
  get(key) {
    return PropertiesService.getScriptProperties().getProperty(key);
  },

  getAll() {
    return PropertiesService.getScriptProperties().getProperties();
  },

  set(key, value) {
    PropertiesService.getScriptProperties().setProperty(key, value);
  },

  getRequired(key) {
    const val = this.get(key);
    if (!val) {
      throw new Error(`Missing required configuration: ${key}`);
    }
    return val;
  },

  // Explicit getters for critical properties
  getGeminiApiKey() { return this.getRequired('GEMINI_API_KEY'); },
  getDataSpreadsheetId() { return this.getRequired('DATA_SPREADSHEET_ID'); },
  getRootFolderId() { return this.getRequired('EXPECTATION_CARDS_ROOT_FOLDER_ID'); },
  getAudioFolderId() { return this.getRequired('EXPECTATION_CARDS_AUDIO_FOLDER_ID'); },
  getExportsFolderId() { return this.get('EXPECTATION_CARDS_EXPORTS_FOLDER_ID') || this.getRootFolderId(); },
  getTeacherAllowlist() {
    const list = this.get('TEACHER_EMAIL_ALLOWLIST');
    return list ? list.split(',').map(e => e.trim().toLowerCase()) : [];
  },
  getAuthorisedDomain() { return this.get('AUTHORISED_DOMAIN'); },
  getAudioRetentionDays() { return parseInt(this.get('AUDIO_RETENTION_DAYS') || '30', 10); },
  getDeleteAudioAfterTranscription() { return this.get('DELETE_AUDIO_AFTER_TRANSCRIPTION') === 'true'; },
  getAppBaseUrl() { return this.getRequired('APP_BASE_URL'); }
};
```

## `src/Auth.js`
```javascript
/**
 * Auth.js
 * Handles authentication and authorization.
 */

const Auth = {
  /**
   * Returns the email of the active user.
   */
  getActiveUserEmail() {
    return Session.getActiveUser().getEmail().toLowerCase();
  },

  /**
   * Checks if the active user is an authorized teacher.
   */
  isTeacher() {
    const email = this.getActiveUserEmail();
    const allowlist = Config.getTeacherAllowlist();
    const domain = Config.getAuthorisedDomain();

    if (allowlist.length > 0 && allowlist.includes(email)) {
      return true;
    }
    if (domain && email.endsWith(`@${domain}`)) {
      return true;
    }
    return false;
  },

  /**
   * Throws an error if the user is not a teacher.
   */
  requireTeacher() {
    if (!this.isTeacher()) {
      AuditService.log('ACCESS_DENIED', null, null, this.getActiveUserEmail(), { reason: 'Not in teacher allowlist or domain' });
      throw new Error('Unauthorized: Teacher access required.');
    }
  },

  /**
   * Verifies a student is authorized to view a specific card.
   * @param {string} studentEmail - Email of the student attempting access.
   * @param {string} expectedEmail - Email of the student who owns the card.
   */
  isAuthorizedStudent(studentEmail, expectedEmail) {
    if (!studentEmail || !expectedEmail) return false;
    return studentEmail.toLowerCase() === expectedEmail.toLowerCase();
  }
};
```

## `src/Utils.js`
```javascript
/**
 * Utils.js
 * General utility functions.
 */

const Utils = {
  /**
   * Generates a unique, unguessable token.
   */
  generateToken() {
    return Utilities.getUuid() + '-' + Date.now().toString(36);
  },

  /**
   * Generates a short UUID.
   */
  generateId() {
    return Utilities.getUuid();
  },

  /**
   * Safe JSON parse.
   */
  parseJsonSafe(str, fallback = null) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return fallback;
    }
  },

  /**
   * Formats a date to ISO string safely.
   */
  toISOStringSafe(date) {
    if (!date) return null;
    if (date instanceof Date) return date.toISOString();
    return new Date(date).toISOString();
  },

  /**
   * Sleeps for a given number of milliseconds. Useful for API rate limits.
   */
  sleep(ms) {
    Utilities.sleep(ms);
  }
};
```

## `src/Validation.js`
```javascript
/**
 * Validation.js
 * Validates data schemas, especially Gemini API output.
 */

const Validation = {
  /**
   * Validates the generated card structure from Gemini.
   */
  validateCardStructure(card) {
    if (!card || typeof card !== 'object') return false;
    if (typeof card.title !== 'string') return false;

    if (card.tasks && !Array.isArray(card.tasks)) return false;
    if (card.successCriteria && !Array.isArray(card.successCriteria)) return false;

    if (card.tasks) {
      for (const task of card.tasks) {
        if (typeof task.text !== 'string') return false;
        if (task.substeps && !Array.isArray(task.substeps)) return false;
        if (task.substeps) {
           for (const step of task.substeps) {
              if (typeof step !== 'string' && typeof step.text !== 'string') return false;
           }
        }
      }
    }

    return true;
  },

  /**
   * Repairs or normalizes common Gemini JSON quirks.
   */
  repairCardData(card) {
    // If substeps is an array of strings, convert to objects
    if (card.tasks) {
      card.tasks.forEach(task => {
        if (task.substeps) {
          task.substeps = task.substeps.map(step => {
            if (typeof step === 'string') return { text: step };
            return step;
          });
        }
      });
    }

    // Similarly for success criteria
    if (card.successCriteria) {
      card.successCriteria = card.successCriteria.map(criterion => {
        if (typeof criterion === 'string') return { text: criterion };
        return criterion;
      });
    }

    return card;
  }
};
```

## `src/AuditService.js`
```javascript
/**
 * AuditService.js
 * Handles logging of important events for security and debugging.
 */

const AuditService = {
  log(eventType, cardId, versionId, actorEmail, eventData) {
    try {
      SheetService.appendRow('AuditLog', [
        Utils.generateId(),
        eventType,
        cardId || '',
        versionId || '',
        actorEmail || Auth.getActiveUserEmail(),
        JSON.stringify(eventData || {}),
        new Date().toISOString()
      ]);
    } catch (e) {
      console.error('Audit log failed:', e);
    }
  }
};
```

## `src/SheetService.js`
```javascript
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
```

## `src/DriveService.js`
```javascript
/**
 * DriveService.js
 * Handles file saving (audio) to Google Drive.
 */

const AppDriveService = {
  getAudioFolder() {
    const folderId = Config.getAudioFolderId();
    return DriveApp.getFolderById(folderId);
  },

  /**
   * Saves base64 encoded audio to Drive.
   * @param {string} base64Data
   * @param {string} mimeType
   * @param {string} filename
   * @returns {string} The ID of the saved file.
   */
  saveAudio(base64Data, mimeType, filename) {
    try {
      const folder = this.getAudioFolder();

      // Remove data URL prefix if present
      const base64Str = base64Data.split(',').pop();
      const blob = Utilities.newBlob(Utilities.base64Decode(base64Str), mimeType, filename);

      const file = folder.createFile(blob);
      return file.getId();
    } catch (e) {
      console.error('Failed to save audio to Drive', e);
      throw new Error('Failed to save audio recording.');
    }
  },

  /**
   * Deletes a file from Drive if it exists.
   */
  deleteAudio(fileId) {
    try {
      if (!fileId) return;
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (e) {
      console.warn('Failed to delete audio file:', fileId, e);
    }
  },

  /**
   * Retrieves a file as a blob.
   */
  getFileBlob(fileId) {
    try {
       return DriveApp.getFileById(fileId).getBlob();
    } catch (e) {
      console.error('Failed to get file blob:', fileId, e);
      throw new Error('Failed to retrieve audio file.');
    }
  }
};
```

## `src/ClassroomService.js`
```javascript
/**
 * ClassroomService.js
 * Integrates with Google Classroom API (Advanced Service).
 */

const ClassroomService = {
  /**
   * Lists active courses for the current user where they are a teacher.
   */
  listCourses() {
    try {
      const response = Classroom.Courses.list({
        courseStates: ['ACTIVE'],
        teacherId: 'me'
      });
      return (response.courses || []).map(course => ({
        id: course.id,
        name: course.name,
        section: course.section || ''
      }));
    } catch (e) {
      console.error('Error listing courses:', e);
      throw new Error('Failed to retrieve Classroom courses.');
    }
  },

  /**
   * Lists students in a specific course.
   */
  listStudents(courseId) {
    try {
      const response = Classroom.Courses.Students.list(courseId);
      return (response.students || []).map(student => ({
        userId: student.userId,
        email: student.profile.emailAddress,
        name: student.profile.name.fullName
      }));
    } catch (e) {
      console.error(`Error listing students for course ${courseId}:`, e);
      throw new Error('Failed to retrieve course roster.');
    }
  },

  /**
   * Lists assignments (coursework) for a course.
   */
  listAssignments(courseId) {
    try {
      const response = Classroom.Courses.CourseWork.list(courseId, {
        courseWorkStates: ['PUBLISHED', 'DRAFT']
      });
      return (response.courseWork || []).filter(cw => cw.workType === 'ASSIGNMENT').map(cw => ({
        id: cw.id,
        title: cw.title,
        state: cw.state
      }));
    } catch (e) {
      console.error(`Error listing assignments for course ${courseId}:`, e);
      throw new Error('Failed to retrieve course assignments.');
    }
  },

  /**
   * Creates a new assignment.
   */
  createAssignment(courseId, title, assigneeMode, studentIds = []) {
    try {
      const courseWork = {
        title: title,
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        assigneeMode: assigneeMode, // 'ALL_STUDENTS' or 'INDIVIDUAL_STUDENTS'
      };

      if (assigneeMode === 'INDIVIDUAL_STUDENTS' && studentIds.length > 0) {
        courseWork.individualStudentsOptions = {
          studentIds: studentIds
        };
      }

      const response = Classroom.Courses.CourseWork.create(courseWork, courseId);
      return {
        id: response.id,
        title: response.title
      };
    } catch (e) {
      console.error(`Error creating assignment for course ${courseId}:`, e);
      throw new Error('Failed to create linked assignment.');
    }
  },

  /**
   * Attaches a link to a specific student's submission.
   * Note: Classroom API requires the caller to be the student OR the teacher to modify attachments,
   * but attaching links to student submissions programmatically as a teacher has specific rules.
   * We attach it to the coursework if it's an individual assignment, or we use StudentSubmissions.modifyAttachments.
   */
  attachLinkToSubmission(courseId, courseWorkId, userId, linkUrl, linkTitle) {
    try {
      // Find the specific submission for this user
      const response = Classroom.Courses.CourseWork.StudentSubmissions.list(courseId, courseWorkId, {
        userId: userId
      });

      if (!response.studentSubmissions || response.studentSubmissions.length === 0) {
        throw new Error(`No submission found for student ${userId}`);
      }

      const submission = response.studentSubmissions[0];

      // Modify attachments
      const modifyReq = {
        addAttachments: [{
          link: {
            url: linkUrl,
            title: linkTitle
          }
        }]
      };

      Classroom.Courses.CourseWork.StudentSubmissions.modifyAttachments(
        modifyReq,
        courseId,
        courseWorkId,
        submission.id
      );

      return {
        submissionId: submission.id,
        status: 'SUCCESS'
      };
    } catch (e) {
      console.error(`Error attaching link to submission:`, e);
      return {
         status: 'ERROR',
         error: e.message
      };
    }
  }
};
```

## `src/GeminiService.js`
```javascript
/**
 * GeminiService.js
 * Integrates with the Gemini API for audio transcription and structured extraction.
 */

const GeminiService = {
  getApiUrl(model, method) {
    const apiKey = Config.getGeminiApiKey();
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}?key=${apiKey}`;
  },

  /**
   * Uploads file to Gemini File API and returns the file URI.
   */
  uploadFile(blob) {
    const apiKey = Config.getGeminiApiKey();
    const url = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;

    const bytes = blob.getBytes();
    const mimeType = blob.getContentType() || 'audio/webm';

    // Simple one-off upload (suitable for small audio files < 2GB)
    const options = {
      method: 'post',
      contentType: mimeType,
      headers: {
        'X-Goog-Upload-Protocol': 'raw',
        'X-Goog-Upload-Command': 'upload',
        'X-Goog-Upload-Header-Content-Length': bytes.length.toString(),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      payload: bytes,
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200) {
      console.error('Gemini File Upload Error:', response.getContentText());
      throw new Error('Failed to upload audio to Gemini for processing.');
    }

    const json = JSON.parse(response.getContentText());
    return {
      name: json.file.name,
      uri: json.file.uri
    };
  },

  /**
   * Waits for a file to be processed by Gemini (required for audio).
   */
  waitForFileProcessing(fileName) {
     const apiKey = Config.getGeminiApiKey();
     const url = `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`;

     let state = 'PROCESSING';
     let attempts = 0;
     while (state === 'PROCESSING' && attempts < 10) {
       const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
       if (res.getResponseCode() !== 200) throw new Error('Failed to check file state.');
       const json = JSON.parse(res.getContentText());
       state = json.state;
       if (state === 'ACTIVE') return true;
       if (state === 'FAILED') throw new Error('Gemini failed to process the audio file.');
       Utils.sleep(2000);
       attempts++;
     }
     if (state !== 'ACTIVE') throw new Error('Timeout waiting for Gemini to process audio.');
     return true;
  },

  /**
   * Transcribes audio using Gemini 1.5 Pro.
   */
  transcribeAudio(blob) {
    const fileInfo = this.uploadFile(blob);
    this.waitForFileProcessing(fileInfo.name);

    const url = this.getApiUrl('gemini-1.5-pro', 'generateContent');
    const payload = {
      contents: [{
        parts: [
          { fileData: { fileUri: fileInfo.uri, mimeType: blob.getContentType() } },
          { text: "Please provide a highly accurate transcript of this spoken conversation between a teacher and a student. Ignore filler words. Format as clear paragraphs." }
        ]
      }],
      generationConfig: {
         temperature: 0.2
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || !json.candidates) {
      console.error('Gemini Transcription Error:', json);
      throw new Error('Failed to transcribe audio.');
    }

    return json.candidates[0].content.parts[0].text;
  },

  /**
   * Generates structured JSON Expectation Card from transcript.
   * If existingCard is provided, merges new requirements into it, preserving existing IDs and completed items.
   */
  generateCardFromTranscript(transcript, existingCard = null) {
    const url = this.getApiUrl('gemini-1.5-pro', 'generateContent');

    const schema = {
      type: "object",
      properties: {
        title: { type: "string", description: "A concise title for the expectation card." },
        timingInfo: { type: "string", description: "Timing or check-in explicitly mentioned. Omit if absent." },
        teacherNote: { type: "string", description: "A general note or encouragement from the teacher, if applicable." },
        tasks: {
          type: "array",
          description: "List of parent tasks.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "A unique stable ID for this task (e.g. UUID)." },
              text: { type: "string", description: "The task description." },
              substeps: {
                type: "array",
                description: "Optional list of sub-steps for this task. Only include if genuinely necessary.",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", description: "A unique stable ID for this sub-step." },
                    text: { type: "string", description: "The sub-step description." }
                  },
                  required: ["id", "text"]
                }
              }
            },
            required: ["id", "text"]
          }
        },
        successCriteria: {
          type: "array",
          description: "List of success criteria.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "A unique stable ID." },
              text: { type: "string", description: "The success criterion description." }
            },
            required: ["id", "text"]
          }
        }
      },
      required: ["title", "tasks"]
    };

    let promptText = `
You are an expert teacher assistant extracting structured expectations from a conversation transcript.
Use Australian English.
CRITICAL RULES:
- Distinguish teacher expectations from casual conversation.
- Ignore filler words, false starts, and irrelevant discussion.
- Do not infer personal, behavioural, wellbeing, disciplinary, medical, or sensitive content.
- Only create task-related, observable expectations clearly supported by the transcript.
- Do not invent details or deadlines.
- Include timing/check-in ONLY if explicitly stated (e.g., "by end of lesson").
- Preserve uncertainty for teacher review rather than guessing.
- Create concise, student-friendly wording.
- Small standalone actions should be single tasks with no sub-steps.
`;

    if (existingCard) {
      promptText += `
- You are UPDATING an existing card.
- KEEP all previously completed items.
- KEEP still-relevant incomplete items.
- ADD genuinely new requirements from the latest conversation.
- DO NOT reactivate completed items unless explicitly stated.
- RETAIN the exact existing 'id' for any task, substep, or success criterion that is kept or updated. Do not generate new IDs for existing items.

Existing Card JSON (for reference):
${JSON.stringify(existingCard, null, 2)}
`;
    }

    promptText += `
Transcript:
"""
${transcript}
"""
    `;

    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: schema
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || !json.candidates) {
      console.error('Gemini Card Gen Error:', json);
      throw new Error('Failed to generate structured card.');
    }

    const rawResult = json.candidates[0].content.parts[0].text;
    let cardData = Utils.parseJsonSafe(rawResult);

    if (!cardData) {
      throw new Error('Gemini returned invalid JSON structure.');
    }

    return Validation.repairCardData(cardData);
  }
};
```

## `src/CardService.js`
```javascript
/**
 * CardService.js
 * Core business logic for managing Expectation Cards.
 */

const CardService = {

  /**
   * Generates a new draft card from an audio recording.
   * Handles saving to Drive, Transcribing, and Gemini processing.
   * Merges with existing card if an existingCard payload is provided.
   */
  processAudioToDraftCard(base64Audio, mimeType, courseId = null, courseWorkId = null, studentId = null) {
    Auth.requireTeacher();

    const filename = `Recording_${Utils.generateId()}.webm`;
    const fileId = DriveService.saveAudio(base64Audio, mimeType, filename);
    const blob = DriveService.getFileBlob(fileId);

    let transcript, cardData;
    try {
      let existingCard = null;
      if (courseId && courseWorkId && studentId) {
         existingCard = this.getLatestCardForStudent(courseId, courseWorkId, studentId);
      }

      transcript = GeminiService.transcribeAudio(blob);
      cardData = GeminiService.generateCardFromTranscript(transcript, existingCard);
    } catch (e) {
      // Clean up Drive file if processing fails and we aren't retaining it for debugging
      if (Config.getDeleteAudioAfterTranscription()) {
         DriveService.deleteAudio(fileId);
      }
      throw e;
    }

    // Check retention policy immediately after successful transcription
    if (Config.getDeleteAudioAfterTranscription()) {
        DriveService.deleteAudio(fileId);
    }

    return {
      audioFileId: fileId,
      transcript: transcript,
      cardData: cardData
    };
  },

  /**
   * Internal: Retrieves the latest card JSON for a specific student and assignment for merging.
   */
  getLatestCardForStudent(courseId, courseWorkId, studentId) {
    const existingCards = SheetService.getRowsAsObjects('Cards').filter(c =>
      c.courseId === courseId && c.courseWorkId === courseWorkId && c.studentId === studentId
    );
    if (existingCards.length === 0) return null;

    const card = existingCards[0];
    const versions = SheetService.getRowsAsObjects('CardVersions').filter(v => v.versionId === card.currentVersionId);
    if (versions.length === 0) return null;

    // We get the raw JSON but we also want to embed the completion state for Gemini context
    const versionData = Utils.parseJsonSafe(versions[0].cardJson, {});
    const items = SheetService.getRowsAsObjects('ChecklistItems').filter(i => i.versionId === card.currentVersionId);

    const completionMap = {};
    items.forEach(i => {
       completionMap[i.itemId] = i.completed === true || i.completed === 'true' || i.completed === 'TRUE';
    });

    // Annotate JSON with completion status
    if (versionData.tasks) {
       versionData.tasks.forEach(t => {
          t.completed = !!completionMap[t.id];
          if (t.substeps) {
             t.substeps.forEach(s => s.completed = !!completionMap[s.id]);
          }
       });
    }
    if (versionData.successCriteria) {
       versionData.successCriteria.forEach(c => {
          c.completed = !!completionMap[c.id];
       });
    }
    return versionData;
  },

  /**
   * Publishes (sends) a teacher-reviewed card to one or more students.
   */
  publishCard(payload) {
    Auth.requireTeacher();
    const { courseId, courseName, courseWorkId, courseWorkTitle, students, cardData, transcript, createNewAssignment, newAssignmentTitle } = payload;

    let activeCourseWorkId = courseWorkId;
    let activeCourseWorkTitle = courseWorkTitle;

    // 1. Create a linked assignment if requested
    if (createNewAssignment) {
      const studentIds = students.map(s => s.userId);
      const newAssignment = ClassroomService.createAssignment(courseId, newAssignmentTitle, 'INDIVIDUAL_STUDENTS', studentIds);
      activeCourseWorkId = newAssignment.id;
      activeCourseWorkTitle = newAssignment.title;
    }

    const results = [];

    // 2. Process each student
    for (const student of students) {
      try {
        const result = this.upsertCardForStudent(courseId, courseName, activeCourseWorkId, activeCourseWorkTitle, student, cardData, transcript);

        // 3. Attach link to Classroom
        const linkUrl = `${Config.getAppBaseUrl()}?token=${result.token}`;
        const deliveryResult = ClassroomService.attachLinkToSubmission(courseId, activeCourseWorkId, student.userId, linkUrl, cardData.title);

        // Log Delivery
        SheetService.appendRow('Deliveries', [
          Utils.generateId(), result.cardId, courseId, activeCourseWorkId, student.userId, student.email,
          deliveryResult.submissionId || '', linkUrl, 'CLASSROOM_LINK', deliveryResult.status,
          new Date().toISOString(), deliveryResult.error || '', JSON.stringify(deliveryResult)
        ]);

        results.push({ student: student.name, status: 'SUCCESS' });
      } catch (e) {
        console.error(`Failed to publish card for student ${student.email}:`, e);
        results.push({ student: student.name, status: 'ERROR', message: e.message });
      }
    }

    return results;
  },

  /**
   * Internal: Upserts a card for a specific student, handling versioning.
   */
  upsertCardForStudent(courseId, courseName, courseWorkId, courseWorkTitle, student, cardData, transcript) {
    const existingCards = SheetService.getRowsAsObjects('Cards').filter(c =>
      c.courseId === courseId && c.courseWorkId === courseWorkId && c.studentId === student.userId
    );

    let cardRowIndex = -1;
    let cardId;
    let token;
    let versionNumber = 1;

    const now = new Date().toISOString();
    const userEmail = Auth.getActiveUserEmail();

    if (existingCards.length > 0) {
      // Update existing
      const existing = existingCards[0];
      cardRowIndex = existing._rowIndex;
      cardId = existing.cardId;
      token = existing.stableCardToken;

      // Calculate new version
      const versions = SheetService.getRowsAsObjects('CardVersions').filter(v => v.cardId === cardId);
      versionNumber = versions.length + 1;

      // Update card record
      SheetService.updateRow('Cards', cardRowIndex, [
        cardId, `${cardId}_v${versionNumber}`, 'PUBLISHED', courseId, courseName, courseWorkId, courseWorkTitle,
        student.userId, student.email, student.name, token, cardData.title, '', '',
        existing.createdAt, now, now, userEmail
      ]);
    } else {
      // Create new
      cardId = Utils.generateId();
      token = Utils.generateToken();
      SheetService.appendRow('Cards', [
        cardId, `${cardId}_v${versionNumber}`, 'PUBLISHED', courseId, courseName, courseWorkId, courseWorkTitle,
        student.userId, student.email, student.name, token, cardData.title, '', '',
        now, now, now, userEmail
      ]);
    }

    const versionId = `${cardId}_v${versionNumber}`;

    // Save version history
    SheetService.appendRow('CardVersions', [
      versionId, cardId, versionNumber, JSON.stringify(cardData), transcript || '', 'TEACHER_PUBLISH', now, userEmail
    ]);

    // Save checklist items
    this.saveChecklistItems(cardId, versionId, cardData);

    AuditService.log(existingCards.length > 0 ? 'CARD_UPDATED' : 'CARD_CREATED', cardId, versionId, userEmail, { targetStudent: student.email });

    return { cardId, token };
  },

  /**
   * Internal: Saves flattened checklist items to the DB, carrying over completion status from previous version if applicable.
   */
  saveChecklistItems(cardId, versionId, cardData) {
    // 1. Fetch previous items to retain completion state if IDs match
    const prevItems = SheetService.getRowsAsObjects('ChecklistItems').filter(i => i.cardId === cardId);
    const prevCompletionMap = {};
    prevItems.forEach(i => {
      if (i.completed === true || i.completed === 'true' || i.completed === 'TRUE') {
        prevCompletionMap[i.itemId] = {
           completedAt: i.completedAt,
           completedByEmail: i.completedByEmail
        };
      }
    });

    const now = new Date().toISOString();
    let displayOrder = 0;

    // Tasks and Substeps
    if (cardData.tasks) {
      cardData.tasks.forEach(task => {
        const isTaskCompleted = !!prevCompletionMap[task.id];
        SheetService.appendRow('ChecklistItems', [
          task.id, cardId, versionId, '', 'task', displayOrder++, task.text,
          isTaskCompleted, isTaskCompleted ? prevCompletionMap[task.id].completedAt : '', isTaskCompleted ? prevCompletionMap[task.id].completedByEmail : '',
          now, now
        ]);

        if (task.substeps) {
          task.substeps.forEach(step => {
            const isStepCompleted = !!prevCompletionMap[step.id];
            SheetService.appendRow('ChecklistItems', [
              step.id, cardId, versionId, task.id, 'substep', displayOrder++, step.text,
              isStepCompleted, isStepCompleted ? prevCompletionMap[step.id].completedAt : '', isStepCompleted ? prevCompletionMap[step.id].completedByEmail : '',
              now, now
            ]);
          });
        }
      });
    }

    // Success Criteria
    if (cardData.successCriteria) {
      cardData.successCriteria.forEach(crit => {
        const isCritCompleted = !!prevCompletionMap[crit.id];
        SheetService.appendRow('ChecklistItems', [
          crit.id, cardId, versionId, '', 'successCriterion', displayOrder++, crit.text,
          isCritCompleted, isCritCompleted ? prevCompletionMap[crit.id].completedAt : '', isCritCompleted ? prevCompletionMap[crit.id].completedByEmail : '',
          now, now
        ]);
      });
    }
  },

  /**
   * Retrieves a student's card for display via token.
   */
  getStudentCardByToken(token, userEmail) {
    const cards = SheetService.getRowsAsObjects('Cards').filter(c => c.stableCardToken === token);
    if (cards.length === 0) {
      AuditService.log('CARD_ACCESS_DENIED_NOT_FOUND', null, null, userEmail, { token });
      throw new Error('Card not found.');
    }

    const card = cards[0];

    // Authorization check
    if (!Auth.isAuthorizedStudent(userEmail, card.studentEmail) && !Auth.isTeacher()) {
      AuditService.log('CARD_ACCESS_DENIED_UNAUTHORIZED', card.cardId, card.currentVersionId, userEmail, { expected: card.studentEmail });
      throw new Error('You are not authorized to view this card.');
    }

    const versions = SheetService.getRowsAsObjects('CardVersions').filter(v => v.versionId === card.currentVersionId);
    if (versions.length === 0) throw new Error('Card version not found.');

    const versionData = Utils.parseJsonSafe(versions[0].cardJson, {});

    const items = SheetService.getRowsAsObjects('ChecklistItems').filter(i => i.versionId === card.currentVersionId);

    // Reconstruct hierarchical data with completion state
    const reconstructedTasks = [];
    const reconstructedCriteria = [];

    const itemsById = {};
    items.forEach(item => {
      // Normalize string booleans from Sheets
      const isCompleted = item.completed === true || item.completed === 'true' || item.completed === 'TRUE';
      const obj = { id: item.itemId, text: item.text, completed: isCompleted };
      itemsById[item.itemId] = { data: obj, meta: item };
    });

    items.sort((a, b) => Number(a.displayOrder) - Number(b.displayOrder)).forEach(item => {
      if (item.itemType === 'task') {
        const taskObj = itemsById[item.itemId].data;
        taskObj.substeps = [];
        reconstructedTasks.push(taskObj);
      } else if (item.itemType === 'substep') {
        const parentTaskMeta = itemsById[item.parentItemId];
        if (parentTaskMeta) {
          parentTaskMeta.data.substeps.push(itemsById[item.itemId].data);
        }
      } else if (item.itemType === 'successCriterion') {
        reconstructedCriteria.push(itemsById[item.itemId].data);
      }
    });

    AuditService.log('CARD_VIEWED', card.cardId, card.currentVersionId, userEmail, null);

    return {
      id: card.cardId,
      title: card.title,
      studentName: card.studentName,
      timingInfo: versionData.timingInfo,
      teacherNote: versionData.teacherNote,
      updatedAt: card.updatedAt,
      tasks: reconstructedTasks,
      successCriteria: reconstructedCriteria
    };
  },

  /**
   * Toggles completion status of a specific item.
   */
  toggleItemCompletion(cardId, itemId, completed) {
    const userEmail = Auth.getActiveUserEmail();

    // Verify authorization
    const cards = SheetService.getRowsAsObjects('Cards').filter(c => c.cardId === cardId);
    if (cards.length === 0) throw new Error('Card not found.');
    const card = cards[0];

    if (!Auth.isAuthorizedStudent(userEmail, card.studentEmail) && !Auth.isTeacher()) {
      throw new Error('Unauthorized.');
    }

    const items = SheetService.getRowsAsObjects('ChecklistItems').filter(i => i.versionId === card.currentVersionId);
    const targetItem = items.find(i => i.itemId === itemId);

    if (!targetItem) throw new Error('Item not found.');

    const now = new Date().toISOString();
    const completedVal = completed ? 'TRUE' : 'FALSE';
    const completedAtVal = completed ? now : '';
    const completedByVal = completed ? userEmail : '';

    // Update target item
    SheetService.updateRow('ChecklistItems', targetItem._rowIndex, [
      targetItem.itemId, targetItem.cardId, targetItem.versionId, targetItem.parentItemId, targetItem.itemType,
      targetItem.displayOrder, targetItem.text, completedVal, completedAtVal, completedByVal,
      targetItem.createdAt, now
    ]);

    // Automatic parent/child logic
    if (targetItem.itemType === 'substep') {
      const parentId = targetItem.parentItemId;
      const parentItem = items.find(i => i.itemId === parentId);
      const siblingSteps = items.filter(i => i.parentItemId === parentId);

      // Update local state for logic check
      targetItem.completed = completed;

      const allSiblingsCompleted = siblingSteps.every(s => s.completed === true || s.completed === 'true' || s.completed === 'TRUE');

      // Auto-complete parent if all steps done, OR auto-uncomplete parent if a step is undone
      if (parentItem) {
        if (completed && allSiblingsCompleted) {
           SheetService.updateRow('ChecklistItems', parentItem._rowIndex, [
             parentItem.itemId, parentItem.cardId, parentItem.versionId, parentItem.parentItemId, parentItem.itemType,
             parentItem.displayOrder, parentItem.text, 'TRUE', now, userEmail, parentItem.createdAt, now
           ]);
        } else if (!completed && (parentItem.completed === true || parentItem.completed === 'true' || parentItem.completed === 'TRUE')) {
           SheetService.updateRow('ChecklistItems', parentItem._rowIndex, [
             parentItem.itemId, parentItem.cardId, parentItem.versionId, parentItem.parentItemId, parentItem.itemType,
             parentItem.displayOrder, parentItem.text, 'FALSE', '', '', parentItem.createdAt, now
           ]);
        }
      }
    }

    AuditService.log('ITEM_TOGGLED', cardId, card.currentVersionId, userEmail, { itemId, completed });

    return { success: true, timestamp: now };
  }
};
```

## `src/Setup.js`
```javascript
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
  let ssId = props.getProperty('DATA_SPREADSHEET_ID');
  let ss;
  if (!ssId) {
    ss = SpreadsheetApp.create('Expectation Cards Database');
    ssId = ss.getId();
    props.setProperty('DATA_SPREADSHEET_ID', ssId);
    // Move to root folder
    DriveApp.getFileById(ssId).moveTo(DriveApp.getFolderById(rootId));
  } else {
    ss = SpreadsheetApp.openById(ssId);
  }

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
```

## `src/Code.js`
```javascript
/**
 * Code.js
 * Main entry point for the Web App and RPC endpoints.
 */

/**
 * Standard HTTP GET handler.
 */
function doGet(e) {
  // If no setup, fail gracefully
  try { Config.getDataSpreadsheetId(); } catch(err) {
    return ContentService.createTextOutput("App not configured. Please run installApp().");
  }

  // Routing: If token is provided, show student card. Otherwise, show teacher app.
  const token = e.parameter.token;

  if (token) {
    const template = HtmlService.createTemplateFromFile('Index');
    template.mode = 'student';
    template.token = token;
    return template.evaluate()
      .setTitle('Expectation Card')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } else {
    // Requires teacher access
    try {
      Auth.requireTeacher();
    } catch (err) {
      return ContentService.createTextOutput("Unauthorized: You do not have permission to access the Teacher Dashboard.");
    }
    const template = HtmlService.createTemplateFromFile('Index');
    template.mode = 'teacher';
    return template.evaluate()
      .setTitle('Expectation Cards - Teacher Dashboard')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
}

/**
 * Utility to include HTML partials.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * ==========================================
 * RPC ENDPOINTS (Callable from google.script.run)
 * ==========================================
 */

function getTeacherData() {
  Auth.requireTeacher();
  return {
    email: Auth.getActiveUserEmail(),
    courses: ClassroomService.listCourses()
  };
}

function getCourseDetails(courseId) {
  Auth.requireTeacher();
  return {
    students: ClassroomService.listStudents(courseId),
    assignments: ClassroomService.listAssignments(courseId)
  };
}

function processAudioUpload(base64Audio, mimeType, courseId, courseWorkId, studentId) {
  Auth.requireTeacher();
  return CardService.processAudioToDraftCard(base64Audio, mimeType, courseId, courseWorkId, studentId);
}

function publishCard(payload) {
  Auth.requireTeacher();
  return CardService.publishCard(payload);
}

function getStudentCard(token) {
  return CardService.getStudentCardByToken(token, Auth.getActiveUserEmail());
}

function toggleChecklistItem(cardId, itemId, completed) {
  return CardService.toggleItemCompletion(cardId, itemId, completed);
}

function getSettings() {
  Auth.requireTeacher();
  return {
    retentionDays: Config.getAudioRetentionDays(),
    deleteAfterTranscription: Config.getDeleteAudioAfterTranscription()
  };
}

function saveSettings(settings) {
  Auth.requireTeacher();
  if (settings.retentionDays !== undefined) {
    Config.set('AUDIO_RETENTION_DAYS', settings.retentionDays.toString());
  }
  if (settings.deleteAfterTranscription !== undefined) {
    Config.set('DELETE_AUDIO_AFTER_TRANSCRIPTION', settings.deleteAfterTranscription ? 'true' : 'false');
  }
  return true;
}
```

## `src/Index.html`
```html
<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <?!= include('Styles'); ?>
  </head>
  <body>
    <div id="app-container">
      <div id="loading-overlay" class="hidden">
        <div class="spinner"></div>
        <p id="loading-message">Loading...</p>
      </div>

      <? if (mode === 'teacher') { ?>
        <?!= include('TeacherApp'); ?>
      <? } else { ?>
        <?!= include('StudentCard'); ?>
      <? } ?>
    </div>

    <script>
      // Global app configuration injected from server
      window.APP_MODE = '<?= mode ?>';
      window.APP_TOKEN = '<?= typeof token !== "undefined" ? token : "" ?>';
    </script>
    <?!= include('ClientJS'); ?>
  </body>
</html>
```

## `src/Styles.html`
```html
<style>
  :root {
    --primary: #1a73e8;
    --primary-hover: #1557b0;
    --bg: #f8f9fa;
    --surface: #ffffff;
    --text-main: #202124;
    --text-muted: #5f6368;
    --border: #dadce0;
    --success: #0f9d58;
    --error: #d93025;
    --focus: rgba(26, 115, 232, 0.3);
  }

  * { box-sizing: border-box; }

  body {
    font-family: 'Roboto', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background-color: var(--bg);
    color: var(--text-main);
    margin: 0;
    padding: 0;
    line-height: 1.5;
  }

  /* Typography */
  h1, h2, h3 { margin: 0 0 1rem 0; color: var(--text-main); }
  p { margin: 0 0 1rem 0; }

  /* Layout */
  .container { max-width: 800px; margin: 0 auto; padding: 1rem; }
  .card { background: var(--surface); border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); padding: 1.5rem; margin-bottom: 1rem; }
  .hidden { display: none !important; }

  /* Buttons */
  button {
    background: var(--primary);
    color: white;
    border: none;
    padding: 0.75rem 1.25rem;
    border-radius: 4px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }
  button:hover:not(:disabled) { background: var(--primary-hover); }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  button.secondary { background: white; color: var(--primary); border: 1px solid var(--primary); }
  button.secondary:hover { background: #f1f3f4; }
  button.danger { background: white; color: var(--error); border: 1px solid var(--error); }
  button.icon-btn { background: none; border: none; padding: 0.5rem; color: var(--text-muted); cursor: pointer; }
  button.icon-btn:hover { background: #f1f3f4; border-radius: 50%; }

  /* Forms */
  label { display: block; font-weight: 500; margin-bottom: 0.5rem; }
  select, input[type="text"], textarea {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 1rem;
    margin-bottom: 1rem;
  }
  select:focus, input:focus, textarea:focus { outline: 2px solid var(--focus); }

  /* Utilities */
  .flex { display: flex; }
  .flex-col { flex-direction: column; }
  .items-center { align-items: center; }
  .justify-between { justify-content: space-between; }
  .gap-2 { gap: 0.5rem; }
  .gap-4 { gap: 1rem; }
  .mt-4 { margin-top: 1rem; }
  .mb-2 { margin-bottom: 0.5rem; }
  .text-sm { font-size: 0.875rem; }
  .text-muted { color: var(--text-muted); }
  .text-center { text-align: center; }
  .text-error { color: var(--error); }

  /* Loading Overlay */
  #loading-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(255,255,255,0.9);
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    z-index: 1000;
  }
  .spinner {
    border: 4px solid var(--border); border-top: 4px solid var(--primary);
    border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite;
  }
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

  /* Checkbox Styles */
  .checkbox-wrapper { display: flex; align-items: flex-start; gap: 0.75rem; margin-bottom: 0.75rem; }
  .checkbox-wrapper input[type="checkbox"] { width: 1.25rem; height: 1.25rem; margin-top: 0.1rem; cursor: pointer; }
  .checkbox-wrapper label { font-weight: normal; margin-bottom: 0; cursor: pointer; flex: 1; }
  .checkbox-wrapper.completed label { text-decoration: line-through; color: var(--text-muted); }

  /* Accordion (Student Card) */
  .accordion-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.75rem; background: #f8f9fa; border: 1px solid var(--border);
    border-radius: 4px; cursor: pointer; margin-bottom: 0.5rem;
    font-family: inherit; font-size: inherit; color: inherit;
  }
  .accordion-header:hover { background: #f1f3f4; }
  .accordion-content { padding: 0.75rem 0.75rem 0.75rem 2.5rem; display: none; }
  .accordion-content.open { display: block; }
  .chevron { transition: transform 0.2s; }
  .chevron.open { transform: rotate(180deg); }
  .pointer-events-none { pointer-events: none; }

  /* Record UI */
  .record-btn {
    width: 80px; height: 80px; border-radius: 50%;
    background: var(--error); color: white; border: none;
    font-size: 1rem; cursor: pointer; display: flex; justify-content: center; align-items: center;
    margin: 0 auto; transition: transform 0.1s;
  }
  .record-btn:active { transform: scale(0.95); }
  .record-btn.recording { animation: pulse 1.5s infinite; background: #b31412; }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(217, 48, 37, 0.4); }
    70% { box-shadow: 0 0 0 20px rgba(217, 48, 37, 0); }
    100% { box-shadow: 0 0 0 0 rgba(217, 48, 37, 0); }
  }

  /* Roster Selection */
  .roster-list { max-height: 300px; overflow-y: auto; border: 1px solid var(--border); border-radius: 4px; padding: 0.5rem; }
  .roster-item { display: flex; align-items: center; padding: 0.5rem; border-bottom: 1px solid var(--bg); }
  .roster-item:last-child { border-bottom: none; }

  /* Editor UI */
  .editor-section { border: 1px dashed var(--border); padding: 1rem; margin-bottom: 1rem; border-radius: 4px; }
  .editor-item { display: flex; gap: 0.5rem; align-items: flex-start; margin-bottom: 0.5rem; }
  .editor-item input { flex: 1; margin-bottom: 0; }

  .reorder-btn { background: none; border: none; font-size: 1.2rem; cursor: pointer; color: var(--text-muted); padding: 0 0.5rem; }
  .reorder-btn:hover { color: var(--primary); }

  .badge { background: #e8f0fe; color: var(--primary); padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; font-weight: 500;}

  /* Accessibility focus */
  *:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
</style>
```

## `src/ClientJS.html`
```html
<script>
/**
 * ClientJS.html
 * Shared utility functions for frontend.
 */

const UI = {
  showLoading(message = 'Loading...') {
    document.getElementById('loading-message').textContent = message;
    document.getElementById('loading-overlay').classList.remove('hidden');
  },

  hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
  },

  showError(message) {
    // Basic error handling - could be enhanced to a toast
    alert(`Error: ${message}`);
  },

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(screenId);
    if (target) {
      target.classList.remove('hidden');
    }
  },

  escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g,
      tag => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;'
        }[tag] || tag)
    );
  }
};

/**
 * Wraps google.script.run in a Promise.
 */
function rpc(funcName, ...args) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(err => {
        console.error(`RPC ${funcName} failed:`, err);
        reject(err);
      })[funcName](...args);
  });
}

/**
 * Audio Recording Manager
 */
class AudioRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;
    this.startTime = null;
    this.timerInterval = null;
  }

  async requestPermission() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return true;
    } catch (err) {
      console.error('Microphone permission denied', err);
      return false;
    }
  }

  start(onTimeUpdate) {
    if (!this.stream) throw new Error("No audio stream available");

    // Try to record in webm/opus, fallback to whatever browser supports
    const options = { mimeType: 'audio/webm;codecs=opus' };
    try {
      this.mediaRecorder = new MediaRecorder(this.stream, MediaRecorder.isTypeSupported(options.mimeType) ? options : undefined);
    } catch (e) {
      this.mediaRecorder = new MediaRecorder(this.stream); // Fallback
    }

    this.audioChunks = [];

    this.mediaRecorder.ondataavailable = event => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.start();
    this.startTime = Date.now();

    if (onTimeUpdate) {
      this.timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        onTimeUpdate(`${mins}:${secs}`);
      }, 1000);
    }
  }

  stop() {
    return new Promise(resolve => {
      if (!this.mediaRecorder) return resolve(null);

      this.mediaRecorder.onstop = () => {
        clearInterval(this.timerInterval);
        const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });

        // Convert to Base64 for Apps Script payload
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          resolve({ base64: reader.result, mimeType: mimeType, blobUrl: URL.createObjectURL(audioBlob) });
        };
      };

      this.mediaRecorder.stop();
    });
  }

  cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }
}

// Global initialization
document.addEventListener('DOMContentLoaded', () => {
  if (window.APP_MODE === 'teacher') {
    if (typeof TeacherApp !== 'undefined' && TeacherApp.init) TeacherApp.init();
  } else if (window.APP_MODE === 'student') {
    if (typeof StudentApp !== 'undefined' && StudentApp.init) StudentApp.init(window.APP_TOKEN);
  }
});
</script>
```

## `src/TeacherApp.html`
```html
<!-- TeacherApp.html -->
<div class="container screen" id="screen-setup">
  <div class="flex justify-between items-center">
    <h2>Expectation Cards</h2>
    <button class="icon-btn" onclick="TeacherApp.openSettings()" title="Settings">⚙️</button>
  </div>
  <div class="card">
    <label for="course-select">Select a Class</label>
    <select id="course-select">
      <option value="">Loading courses...</option>
    </select>
  </div>
</div>

<div class="container screen hidden" id="screen-settings">
  <h2><button class="icon-btn" onclick="TeacherApp.closeSettings()">←</button> Settings</h2>
  <div class="card flex flex-col gap-4">
    <div>
      <label class="checkbox-wrapper">
        <input type="checkbox" id="setting-delete-audio">
        <span>Delete Audio Immediately After Transcription</span>
      </label>
      <p class="text-sm text-muted">If checked, audio files are deleted from Drive as soon as Gemini finishes generating the card. If unchecked, files are kept for the retention period below.</p>
    </div>

    <div>
      <label for="setting-retention-days">Audio Retention Days (if not deleting immediately)</label>
      <input type="number" id="setting-retention-days" min="1" max="365">
    </div>

    <button onclick="TeacherApp.saveSettings()">Save Settings</button>
  </div>
</div>

<div class="container screen hidden" id="screen-roster">
  <h2><button class="icon-btn" onclick="TeacherApp.backToSetup()">←</button> <span id="course-title-display"></span></h2>

  <div class="card flex flex-col gap-4">
    <div>
      <label>Select Delivery Assignment</label>
      <select id="assignment-select" class="mb-2">
        <option value="">Loading assignments...</option>
      </select>

      <div id="new-assignment-container" class="hidden">
        <input type="text" id="new-assignment-title" placeholder="New Assignment Title (Gemini generated or type your own)">
      </div>
    </div>

    <div>
      <div class="flex justify-between items-center mb-2">
        <label>Select Students</label>
        <button class="secondary text-sm" onclick="TeacherApp.toggleSelectAll()">Select All</button>
      </div>
      <div class="roster-list" id="roster-list">
        <!-- Injected via JS -->
      </div>
    </div>

    <button id="btn-next-record" disabled onclick="TeacherApp.goToRecord()">Next: Record</button>
  </div>
</div>

<div class="container screen hidden" id="screen-record">
  <h2><button class="icon-btn" onclick="UI.showScreen('screen-roster')">←</button> Record Expectations</h2>
  <div class="card text-center flex flex-col gap-4 items-center">
    <p>Speak clearly about what the selected student(s) need to achieve.</p>

    <div id="recording-timer" style="font-size: 2rem; font-family: monospace;">00:00</div>

    <button id="btn-record" class="record-btn" onclick="TeacherApp.toggleRecording()">Record</button>
    <p id="record-status" class="text-muted">Press to start</p>

    <div id="playback-container" class="hidden flex flex-col gap-2 w-full mt-4">
      <audio id="audio-preview" controls class="w-full"></audio>
      <div class="flex justify-between gap-4">
        <button class="danger w-full" onclick="TeacherApp.discardRecording()">Discard</button>
        <button class="w-full" onclick="TeacherApp.processRecording()">Process with Gemini</button>
      </div>
    </div>
  </div>
</div>

<div class="container screen hidden" id="screen-editor">
  <h2><button class="icon-btn" onclick="UI.showScreen('screen-record')">←</button> Review & Edit Card</h2>
  <div class="card mb-4" id="editor-context-panel" style="background: #f8f9fa;">
    <!-- Rendered context (selected assignment, students) -->
  </div>
  <div class="card" id="editor-container">
    <!-- Generated by JS -->
  </div>
  <div class="flex justify-between gap-4 mt-4">
    <button class="secondary" onclick="TeacherApp.previewCard()">Preview Mobile</button>
    <button onclick="TeacherApp.sendCard()">Send to Student(s)</button>
  </div>
</div>

<div class="container screen hidden" id="screen-results">
  <h2>Delivery Results</h2>
  <div class="card" id="results-container">
    <!-- Generated by JS -->
  </div>
  <button class="mt-4" onclick="location.reload()">Start Over</button>
</div>

<script>
const TeacherApp = {
  data: {
    courses: [],
    students: [],
    assignments: [],
    selectedCourse: null,
    selectedStudents: [],
    selectedAssignmentId: null,
    audioData: null,
    draftCard: null,
    transcript: ''
  },
  recorder: new AudioRecorder(),

  async init() {
    UI.showLoading('Loading your classes...');
    try {
      const res = await rpc('getTeacherData');
      this.data.courses = res.courses;

      const select = document.getElementById('course-select');
      select.innerHTML = '<option value="">-- Choose a class --</option>';
      this.data.courses.forEach(c => {
      select.innerHTML += `<option value="${UI.escapeHTML(c.id)}">${UI.escapeHTML(c.name)} ${UI.escapeHTML(c.section)}</option>`;
      });

      select.addEventListener('change', (e) => this.loadCourseDetails(e.target.value));
      UI.hideLoading();
    } catch (e) {
      UI.hideLoading();
      UI.showError(e.message || "Failed to initialize.");
    }
  },

  async loadCourseDetails(courseId) {
    if (!courseId) return;

    const course = this.data.courses.find(c => c.id === courseId);
    this.data.selectedCourse = course;
    document.getElementById('course-title-display').textContent = `${UI.escapeHTML(course.name)} ${UI.escapeHTML(course.section)}`;

    UI.showLoading('Loading roster and assignments...');
    try {
      const details = await rpc('getCourseDetails', courseId);
      this.data.students = details.students;
      this.data.assignments = details.assignments;

      this.renderAssignmentSelect();
      this.renderRosterList();

      UI.showScreen('screen-roster');
      UI.hideLoading();
    } catch (e) {
      UI.hideLoading();
      UI.showError(e.message);
    }
  },

  backToSetup() {
    UI.showScreen('screen-setup');
    document.getElementById('course-select').value = '';
    this.data.selectedCourse = null;
  },

  async openSettings() {
    UI.showLoading('Loading settings...');
    try {
      const settings = await rpc('getSettings');
      document.getElementById('setting-delete-audio').checked = settings.deleteAfterTranscription;
      document.getElementById('setting-retention-days').value = settings.retentionDays;
      UI.showScreen('screen-settings');
      UI.hideLoading();
    } catch (e) {
      UI.hideLoading();
      UI.showError(e.message);
    }
  },

  closeSettings() {
    UI.showScreen('screen-setup');
  },

  async saveSettings() {
    UI.showLoading('Saving settings...');
    try {
      const payload = {
        deleteAfterTranscription: document.getElementById('setting-delete-audio').checked,
        retentionDays: parseInt(document.getElementById('setting-retention-days').value, 10)
      };
      await rpc('saveSettings', payload);
      UI.hideLoading();
      this.closeSettings();
    } catch (e) {
      UI.hideLoading();
      UI.showError(e.message);
    }
  },

  renderAssignmentSelect() {
    const select = document.getElementById('assignment-select');
    select.innerHTML = '<option value="">-- Create Linked Expectation Assignment --</option>';
    this.data.assignments.forEach(a => {
      select.innerHTML += `<option value="${UI.escapeHTML(a.id)}">${UI.escapeHTML(a.title)}</option>`;
    });

    select.addEventListener('change', (e) => {
      const container = document.getElementById('new-assignment-container');
      if (e.target.value === '') {
        container.classList.remove('hidden');
      } else {
        container.classList.add('hidden');
      }
      this.updateNextButton();
    });

    // Default to create new
    document.getElementById('new-assignment-container').classList.remove('hidden');
  },

  renderRosterList() {
    const list = document.getElementById('roster-list');
    list.innerHTML = '';
    this.data.students.forEach(s => {
      list.innerHTML += `
        <div class="roster-item checkbox-wrapper">
          <input type="checkbox" id="student-${UI.escapeHTML(s.userId)}" value="${UI.escapeHTML(s.userId)}" onchange="TeacherApp.updateSelectedStudents()">
          <label for="student-${UI.escapeHTML(s.userId)}">
            <div>${UI.escapeHTML(s.name)}</div>
            <div class="text-sm text-muted">${UI.escapeHTML(s.email)}</div>
          </label>
        </div>
      `;
    });
    this.updateSelectedStudents();
  },

  toggleSelectAll() {
    const checkboxes = document.querySelectorAll('#roster-list input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(c => c.checked);
    checkboxes.forEach(c => c.checked = !allChecked);
    this.updateSelectedStudents();
  },

  updateSelectedStudents() {
    const selected = Array.from(document.querySelectorAll('#roster-list input[type="checkbox"]:checked')).map(c => c.value);
    this.data.selectedStudents = this.data.students.filter(s => selected.includes(s.userId));
    this.updateNextButton();
  },

  updateNextButton() {
    const btn = document.getElementById('btn-next-record');
    btn.disabled = this.data.selectedStudents.length === 0;
  },

  async goToRecord() {
    const hasPerm = await this.recorder.requestPermission();
    if (!hasPerm) {
      UI.showError("Microphone access is required to record expectations.");
      return;
    }

    this.data.selectedAssignmentId = document.getElementById('assignment-select').value;
    UI.showScreen('screen-record');
  },

  isRecording: false,

  async toggleRecording() {
    const btn = document.getElementById('btn-record');
    const status = document.getElementById('record-status');
    const timer = document.getElementById('recording-timer');

    if (!this.isRecording) {
      // Start
      this.isRecording = true;
      btn.classList.add('recording');
      btn.textContent = 'Stop';
      status.textContent = 'Recording...';
      document.getElementById('playback-container').classList.add('hidden');

      this.recorder.start((timeStr) => {
        timer.textContent = timeStr;
      });
    } else {
      // Stop
      this.isRecording = false;
      btn.classList.remove('recording');
      btn.textContent = 'Record';
      status.textContent = 'Processing audio...';

      const result = await this.recorder.stop();
      this.data.audioData = result;

      const audioEl = document.getElementById('audio-preview');
      audioEl.src = result.blobUrl;

      document.getElementById('playback-container').classList.remove('hidden');
      status.textContent = 'Review your recording';
    }
  },

  discardRecording() {
    this.data.audioData = null;
    document.getElementById('playback-container').classList.add('hidden');
    document.getElementById('recording-timer').textContent = '00:00';
    document.getElementById('record-status').textContent = 'Press to start';
  },

  async processRecording() {
    if (!this.data.audioData) return;

    UI.showLoading('Uploading and asking Gemini to create card...');
    try {
      // Pass the selected context in case we're editing an existing card
      let studentId = this.data.selectedStudents.length === 1 ? this.data.selectedStudents[0].userId : null;
      let courseId = this.data.selectedCourse ? this.data.selectedCourse.id : null;
      let courseWorkId = this.data.selectedAssignmentId;

      const res = await rpc('processAudioUpload', this.data.audioData.base64, this.data.audioData.mimeType, courseId, courseWorkId, studentId);

      this.data.draftCard = res.cardData;
      this.data.transcript = res.transcript;

      // Propose title if creating new assignment
      if (!this.data.selectedAssignmentId) {
        document.getElementById('new-assignment-title').value = this.data.draftCard.title || 'Expectation Task';
      }

      this.renderEditor();
      UI.showScreen('screen-editor');
      UI.hideLoading();

      // Cleanup media stream
      this.recorder.cleanup();
    } catch (e) {
      UI.hideLoading();
      UI.showError(e.message);
    }
  },

  renderEditor() {
    // Render the context panel
    const contextPanel = document.getElementById('editor-context-panel');
    let assignmentTitle = this.data.selectedAssignmentId ? this.data.assignments.find(a=>a.id===this.data.selectedAssignmentId)?.title : document.getElementById('new-assignment-title').value;
    let contextHtml = `
      <div class="flex justify-between items-center">
        <div>
          <strong>Assignment:</strong> ${UI.escapeHTML(assignmentTitle)} <br>
          <strong>Students:</strong> ${this.data.selectedStudents.length} selected
        </div>
        <button class="secondary text-sm" onclick="TeacherApp.changeDeliverySettings()">Change</button>
      </div>
    `;
    contextPanel.innerHTML = contextHtml;

    const c = this.data.draftCard;
    const container = document.getElementById('editor-container');

    let html = `
      <label>Card Title</label>
      <input type="text" id="edit-title" value="${UI.escapeHTML(c.title || '')}">

      <div class="editor-section">
        <label>Transcript (Read Only)</label>
        <textarea readonly rows="3" class="text-sm text-muted bg-gray-100">${UI.escapeHTML(this.data.transcript)}</textarea>
      </div>

      <div class="editor-section">
        <label>Timing / Check-in</label>
        <input type="text" id="edit-timing" value="${UI.escapeHTML(c.timingInfo || '')}" placeholder="e.g. By end of lesson (Leave blank if none)">
      </div>

      <div class="editor-section" id="edit-tasks-container">
        <div class="flex justify-between mb-2">
          <label>Required Tasks</label>
          <button class="secondary text-sm" onclick="TeacherApp.addTask()">+ Add Task</button>
        </div>
    `;

    c.tasks.forEach((task, tIdx) => {
      html += `
        <div class="editor-item flex-col bg-white p-2 rounded mb-2 border border-gray-200" data-tidx="${tIdx}">
          <div class="flex w-full gap-2 items-center">
             <div class="flex flex-col">
               <button class="reorder-btn" onclick="TeacherApp.moveTask(${tIdx}, -1)" ${tIdx === 0 ? 'disabled' : ''}>▲</button>
               <button class="reorder-btn" onclick="TeacherApp.moveTask(${tIdx}, 1)" ${tIdx === c.tasks.length - 1 ? 'disabled' : ''}>▼</button>
             </div>
             <input type="text" class="task-input flex-1" value="${UI.escapeHTML(task.text)}" onchange="TeacherApp.updateTask(${tIdx}, this.value)">
             <button class="secondary text-sm" onclick="TeacherApp.toggleTaskType(${tIdx})" title="Toggle sub-steps on/off">⇌</button>
             <button class="danger text-sm" onclick="TeacherApp.removeTask(${tIdx})">X</button>
          </div>
          <div class="pl-8 w-full mt-2" id="substeps-${tIdx}">
      `;
      if (task.substeps) {
        task.substeps.forEach((sub, sIdx) => {
          html += `
            <div class="editor-item w-full flex items-center mb-1">
              <button class="reorder-btn text-sm" onclick="TeacherApp.moveSubstep(${tIdx}, ${sIdx}, -1)" ${sIdx === 0 ? 'disabled' : ''}>▲</button>
              <button class="reorder-btn text-sm" onclick="TeacherApp.moveSubstep(${tIdx}, ${sIdx}, 1)" ${sIdx === task.substeps.length - 1 ? 'disabled' : ''}>▼</button>
              <span class="text-muted mr-1">↳</span>
              <input type="text" class="substep-input flex-1 text-sm" value="${UI.escapeHTML(sub.text)}" onchange="TeacherApp.updateSubstep(${tIdx}, ${sIdx}, this.value)">
              <button class="icon-btn text-sm" onclick="TeacherApp.removeSubstep(${tIdx}, ${sIdx})">x</button>
            </div>
          `;
        });
        html += `<button class="secondary text-sm mt-1" onclick="TeacherApp.addSubstep(${tIdx})">+ Sub-step</button>`;
      }
      html += `
          </div>
        </div>
      `;
    });

    html += `</div>`; // End tasks container

    html += `
      <div class="editor-section" id="edit-criteria-container">
        <div class="flex justify-between mb-2">
          <label>Success Criteria</label>
          <button class="secondary text-sm" onclick="TeacherApp.addCriterion()">+ Add Criterion</button>
        </div>
    `;

    if (c.successCriteria) {
      c.successCriteria.forEach((crit, cIdx) => {
        html += `
          <div class="editor-item">
             <div class="flex flex-col">
               <button class="reorder-btn" onclick="TeacherApp.moveCriterion(${cIdx}, -1)" ${cIdx === 0 ? 'disabled' : ''}>▲</button>
               <button class="reorder-btn" onclick="TeacherApp.moveCriterion(${cIdx}, 1)" ${cIdx === c.successCriteria.length - 1 ? 'disabled' : ''}>▼</button>
             </div>
             <input type="text" class="crit-input flex-1" value="${UI.escapeHTML(crit.text)}" onchange="TeacherApp.updateCriterion(${cIdx}, this.value)">
             <button class="danger text-sm" onclick="TeacherApp.removeCriterion(${cIdx})">X</button>
          </div>
        `;
      });
    }

    html += `</div>`;

    html += `
      <div class="editor-section">
        <label>Teacher Note</label>
        <textarea id="edit-note" rows="2" placeholder="Optional encouragement or note">${UI.escapeHTML(c.teacherNote || '')}</textarea>
      </div>
    `;

    container.innerHTML = html;
  },

  // Change delivery settings from review screen
  changeDeliverySettings() {
    this.syncFormToDraft();
    UI.showScreen('screen-roster');
  },

  // Basic CRUD & Reordering for editor state
  moveArrayItem(arr, idx, offset) {
    if (idx + offset < 0 || idx + offset >= arr.length) return;
    const temp = arr[idx];
    arr[idx] = arr[idx + offset];
    arr[idx + offset] = temp;
  },
  updateTask(tIdx, val) { this.data.draftCard.tasks[tIdx].text = val; },
  removeTask(tIdx) { this.data.draftCard.tasks.splice(tIdx, 1); this.renderEditor(); },
  addTask() {
    this.data.draftCard.tasks.push({ id: Utils.generateId(), text: 'New Task', substeps: [] });
    this.renderEditor();
  },
  moveTask(tIdx, offset) {
    this.syncFormToDraft();
    this.moveArrayItem(this.data.draftCard.tasks, tIdx, offset);
    this.renderEditor();
  },
  toggleTaskType(tIdx) {
    this.syncFormToDraft();
    const task = this.data.draftCard.tasks[tIdx];
    if (task.substeps) {
       // Convert to standalone (remove substeps)
       delete task.substeps;
    } else {
       // Convert to parent (add substeps array)
       task.substeps = [{ id: Utils.generateId(), text: 'New step' }];
    }
    this.renderEditor();
  },
  updateSubstep(tIdx, sIdx, val) { this.data.draftCard.tasks[tIdx].substeps[sIdx].text = val; },
  removeSubstep(tIdx, sIdx) { this.data.draftCard.tasks[tIdx].substeps.splice(sIdx, 1); this.renderEditor(); },
  addSubstep(tIdx) {
    if(!this.data.draftCard.tasks[tIdx].substeps) this.data.draftCard.tasks[tIdx].substeps = [];
    this.data.draftCard.tasks[tIdx].substeps.push({ id: Utils.generateId(), text: 'New step' });
    this.renderEditor();
  },
  moveSubstep(tIdx, sIdx, offset) {
    this.syncFormToDraft();
    this.moveArrayItem(this.data.draftCard.tasks[tIdx].substeps, sIdx, offset);
    this.renderEditor();
  },
  updateCriterion(cIdx, val) { this.data.draftCard.successCriteria[cIdx].text = val; },
  removeCriterion(cIdx) { this.data.draftCard.successCriteria.splice(cIdx, 1); this.renderEditor(); },
  addCriterion() {
    if(!this.data.draftCard.successCriteria) this.data.draftCard.successCriteria = [];
    this.data.draftCard.successCriteria.push({ id: Utils.generateId(), text: 'New criterion' });
    this.renderEditor();
  },
  moveCriterion(cIdx, offset) {
    this.syncFormToDraft();
    this.moveArrayItem(this.data.draftCard.successCriteria, cIdx, offset);
    this.renderEditor();
  },

  syncFormToDraft() {
    this.data.draftCard.title = document.getElementById('edit-title').value;
    this.data.draftCard.timingInfo = document.getElementById('edit-timing').value;
    this.data.draftCard.teacherNote = document.getElementById('edit-note').value;
  },

  previewCard() {
    alert("Preview functionality not fully implemented in this demo snippet. It would render the StudentCard.html layout safely.");
  },

  async sendCard() {
    this.syncFormToDraft();

    const isNewAssign = !this.data.selectedAssignmentId;
    const newTitle = isNewAssign ? document.getElementById('new-assignment-title').value : null;

    const payload = {
      courseId: this.data.selectedCourse.id,
      courseName: this.data.selectedCourse.name,
      courseWorkId: this.data.selectedAssignmentId,
      courseWorkTitle: this.data.selectedAssignmentId ? this.data.assignments.find(a=>a.id === this.data.selectedAssignmentId).title : null,
      students: this.data.selectedStudents,
      cardData: this.data.draftCard,
      transcript: this.data.transcript,
      createNewAssignment: isNewAssign,
      newAssignmentTitle: newTitle
    };

    UI.showLoading('Publishing and attaching to Google Classroom...');
    try {
      const results = await rpc('publishCard', payload);
      this.renderResults(results);
      UI.showScreen('screen-results');
      UI.hideLoading();
    } catch (e) {
      UI.hideLoading();
      UI.showError(e.message);
    }
  },

  renderResults(results) {
    const container = document.getElementById('results-container');
    let html = '<ul>';
    results.forEach(r => {
      const color = r.status === 'SUCCESS' ? 'text-success' : 'text-error';
      html += `<li><strong>${UI.escapeHTML(r.student)}</strong>: <span class="${color}">${r.status}</span> ${r.message ? `(${UI.escapeHTML(r.message)})` : ''}</li>`;
    });
    html += '</ul>';
    container.innerHTML = html;
  }
};
</script>
```

## `src/StudentCard.html`
```html
<!-- StudentCard.html -->
<div class="container screen" id="screen-student-card">
  <div id="card-content">
    <!-- Generated by JS -->
  </div>
</div>

<script>
const StudentApp = {
  cardId: null,

  async init(token) {
    if (!token) {
      document.getElementById('card-content').innerHTML = '<div class="card"><h2 class="text-error">Invalid Link</h2><p>No token provided.</p></div>';
      return;
    }

    UI.showLoading('Loading your expectations...');
    try {
      const data = await rpc('getStudentCard', token);
      this.cardId = data.id;
      this.renderCard(data);
      UI.hideLoading();
    } catch (e) {
      UI.hideLoading();
      document.getElementById('card-content').innerHTML = `<div class="card"><h2 class="text-error">Access Denied</h2><p>${e.message}</p></div>`;
    }
  },

  renderCard(data) {
    const container = document.getElementById('card-content');

    let totalItems = 0;
    let completedItems = 0;

    // Calculate progress (tasks + criteria, ignoring substeps for top level progress, OR count all checkable items. Let's count tasks + criteria)
    data.tasks.forEach(t => { totalItems++; if(t.completed) completedItems++; });
    if(data.successCriteria) { data.successCriteria.forEach(c => { totalItems++; if(c.completed) completedItems++; }); }

    let html = `
      <div style="margin-bottom: 1rem; text-align: right;">
         <span class="badge">Last updated: ${UI.escapeHTML(new Date(data.updatedAt).toLocaleDateString())}</span>
      </div>
      <h2>${UI.escapeHTML(data.title)}</h2>
      <p class="text-muted">For: ${UI.escapeHTML(data.studentName)}</p>

      <div class="card mb-4 bg-blue-50" style="background: #e8f0fe; border: 1px solid #c2d7fa;">
         <strong>Progress:</strong> ${completedItems} of ${totalItems} major items complete
      </div>
    `;

    if (data.timingInfo) {
      html += `
        <div class="card mb-4" style="border-left: 4px solid var(--primary);">
          <strong>Timing / Check-in:</strong><br>
          ${UI.escapeHTML(data.timingInfo)}
        </div>
      `;
    }

    if (data.tasks && data.tasks.length > 0) {
      html += `<h3>Required Tasks</h3>`;
      data.tasks.forEach((task, tIdx) => {
        const hasSubsteps = task.substeps && task.substeps.length > 0;
        const taskChecked = task.completed ? 'checked' : '';
        const taskClass = task.completed ? 'completed' : '';

        if (!hasSubsteps) {
          // Single standalone checkbox
          html += `
            <div class="card checkbox-wrapper ${taskClass}" id="wrap-${UI.escapeHTML(task.id)}">
              <input type="checkbox" id="${UI.escapeHTML(task.id)}" ${taskChecked} onchange="StudentApp.toggleItem('${UI.escapeHTML(task.id)}', this.checked)">
              <label for="${UI.escapeHTML(task.id)}">${UI.escapeHTML(task.text)}</label>
            </div>
          `;
        } else {
          // Accordion for parent task
          let subCompleted = 0;
          task.substeps.forEach(s => { if(s.completed) subCompleted++; });
          const progressText = `${subCompleted} of ${task.substeps.length} complete`;

          html += `
            <div class="card" style="padding: 0; margin-bottom: 1rem;">
              <button class="accordion-header w-full ${taskClass}" onclick="StudentApp.toggleAccordion('${UI.escapeHTML(task.id)}')" aria-expanded="false" style="text-align: left; border:none; width: 100%;">
                <div class="flex items-center gap-2 pointer-events-none">
                  <input type="checkbox" id="${UI.escapeHTML(task.id)}" ${taskChecked} onchange="StudentApp.toggleItem('${UI.escapeHTML(task.id)}', this.checked); event.stopPropagation();" disabled style="pointer-events: auto;">
                  <div>
                    <div style="${task.completed ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${UI.escapeHTML(task.text)}</div>
                    <div class="text-sm text-muted">${progressText}</div>
                  </div>
                </div>
                <div class="chevron pointer-events-none" id="icon-${UI.escapeHTML(task.id)}">▼</div>
              </button>
              <div class="accordion-content" id="content-${UI.escapeHTML(task.id)}">
          `;

          task.substeps.forEach(sub => {
            const subChecked = sub.completed ? 'checked' : '';
            const subClass = sub.completed ? 'completed' : '';
            html += `
                <div class="checkbox-wrapper ${subClass}" id="wrap-${UI.escapeHTML(sub.id)}">
                  <input type="checkbox" id="${UI.escapeHTML(sub.id)}" ${subChecked} onchange="StudentApp.toggleItem('${UI.escapeHTML(sub.id)}', this.checked)">
                  <label for="${UI.escapeHTML(sub.id)}">${UI.escapeHTML(sub.text)}</label>
                </div>
            `;
          });

          html += `
              </div>
            </div>
          `;
        }
      });
    }

    if (data.successCriteria && data.successCriteria.length > 0) {
      html += `<h3 class="mt-4">Success Criteria</h3>`;
      data.successCriteria.forEach(crit => {
        const critChecked = crit.completed ? 'checked' : '';
        const critClass = crit.completed ? 'completed' : '';
        html += `
          <div class="card checkbox-wrapper ${critClass}" id="wrap-${UI.escapeHTML(crit.id)}">
            <input type="checkbox" id="${UI.escapeHTML(crit.id)}" ${critChecked} onchange="StudentApp.toggleItem('${UI.escapeHTML(crit.id)}', this.checked)">
            <label for="${UI.escapeHTML(crit.id)}">${UI.escapeHTML(crit.text)}</label>
          </div>
        `;
      });
    }

    if (data.teacherNote) {
      html += `
        <div class="card mt-4" style="background: #fef7e0; border: 1px solid #fbbc04;">
          <strong>Teacher Note:</strong><br>
          ${UI.escapeHTML(data.teacherNote)}
        </div>
      `;
    }

    container.innerHTML = html;
  },

  toggleAccordion(id) {
    // Close others
    document.querySelectorAll('.accordion-content.open').forEach(el => {
      if (el.id !== `content-${id}`) {
        el.classList.remove('open');
        document.getElementById(el.id.replace('content-', 'icon-')).classList.remove('open');
        document.getElementById(el.id.replace('content-', 'icon-')).parentElement.setAttribute('aria-expanded', 'false');
      }
    });

    // Toggle target
    const content = document.getElementById(`content-${id}`);
    const icon = document.getElementById(`icon-${id}`);
    const header = content.parentElement.querySelector('.accordion-header');

    if (content.classList.contains('open')) {
      content.classList.remove('open');
      icon.classList.remove('open');
      header.setAttribute('aria-expanded', 'false');
    } else {
      content.classList.add('open');
      icon.classList.add('open');
      header.setAttribute('aria-expanded', 'true');
    }
  },

  async toggleItem(itemId, isChecked) {
    // Optimistic UI update
    const wrap = document.getElementById(`wrap-${itemId}`);
    if (wrap) {
      if (isChecked) wrap.classList.add('completed');
      else wrap.classList.remove('completed');
    }

    try {
      // In a full implementation, we'd debounce this or show a subtle 'saving...' state
      await rpc('toggleChecklistItem', this.cardId, itemId, isChecked);

      // We reload the full state to ensure logic (parent autocomplete, progress bars) is perfectly synced
      const data = await rpc('getStudentCard', window.APP_TOKEN);

      // Preserve open accordion state
      const openAccordion = document.querySelector('.accordion-content.open');
      const openId = openAccordion ? openAccordion.id.replace('content-', '') : null;

      this.renderCard(data);

      if (openId) {
        const newContent = document.getElementById(`content-${openId}`);
        if(newContent) {
           newContent.classList.add('open');
           document.getElementById(`icon-${openId}`).classList.add('open');
        }
      }

    } catch (e) {
      UI.showError("Failed to save check. " + e.message);
      // Revert optimistic update
      const cb = document.getElementById(itemId);
      if (cb) cb.checked = !isChecked;
      if (wrap) {
        if (!isChecked) wrap.classList.add('completed');
        else wrap.classList.remove('completed');
      }
    }
  }
};
</script>
```

# 4. Setup & Deployment Instructions

### 1. Google Cloud Project & APIs
1. Create a Standard Google Cloud Project in the [Google Cloud Console](https://console.cloud.google.com).
2. Enable the following APIs:
   - Google Classroom API
   - Google Drive API
   - Google Sheets API
   - Generative Language API (Gemini)
3. Associate this Google Cloud Project number with your Apps Script project (Project Settings > Google Cloud Platform (GCP) Project).

### 2. Apps Script & Code Setup
1. Clone the repository and run `npm install`.
2. Login to clasp: `npx clasp login`
3. Create a project: `npx clasp create --type standalone`
4. Push code: `npx clasp push`
5. Open the editor: `npx clasp open`
6. In the Apps Script Editor, go to **Services** (+) and add:
   - `Classroom API (v1)`
   - `Drive API (v2)`
7. Run the `installApp` function in `src/Setup.js`. Allow the OAuth permissions. This will generate the Spreadsheet and Drive folders.

### 3. Deployment
1. Click **Deploy** -> **New deployment**.
2. Select **Web app**.
3. **Execute as:** `User accessing the web app`.
4. **Who has access:** `Anyone within [Your Domain]` (or `Anyone` if testing personal accounts).
5. Deploy and copy the Web App URL.

### 4. Configuration
1. Go to Project Settings (gear icon) > Script Properties.
2. Ensure properties are configured (see section 5 below).
3. Set `APP_BASE_URL` to the deployed Web App URL you just copied.
4. Set `GEMINI_API_KEY` obtained from Google AI Studio.

# 5. Script Properties Configuration

| Property Name | Example Value | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | `AIzaSy...` | Required. Your Gemini API key. |
| `DATA_SPREADSHEET_ID` | `1AbCdE...` | Generated by `installApp()`. ID of the Sheets database. |
| `EXPECTATION_CARDS_ROOT_FOLDER_ID` | `1xyz...` | Generated by `installApp()`. Drive Root Folder ID. |
| `EXPECTATION_CARDS_AUDIO_FOLDER_ID`| `1abc...` | Generated by `installApp()`. Drive Audio Folder ID. |
| `TEACHER_EMAIL_ALLOWLIST` | `teacher1@school.edu, teacher2@...` | Comma-separated list of authorised teachers. |
| `AUTHORISED_DOMAIN` | `school.edu` | (Optional) Domain to authorise all teachers from. |
| `APP_BASE_URL` | `https://script.google.com/a/.../exec` | The published Web App URL. |
| `AUDIO_RETENTION_DAYS` | `30` | Days to keep audio before cleanup (requires cron trigger). |
| `DELETE_AUDIO_AFTER_TRANSCRIPTION` | `true` | If true, deletes Drive audio file immediately after Gemini transcription. |

# 6. Required OAuth Scopes and `appsscript.json`

```json
{
  "timeZone": "Australia/Sydney",
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "Classroom",
        "serviceId": "classroom",
        "version": "v1"
      },
      {
        "userSymbol": "Drive",
        "serviceId": "drive",
        "version": "v2"
      }
    ]
  },
  "exceptionLogging": "STACKDRIVER",
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.rosters.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.students",
    "https://www.googleapis.com/auth/userinfo.email"
  ],
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_ACCESSING",
    "access": "ANYONE"
  }
}
```

# 7. Manual Testing Checklist

```markdown
# Manual Testing Checklist

## Core Workflows
- [ ] **1. Select one student and attach a card to an existing assignment.**
- [ ] **2. Select multiple students and attach separate personalised cards.**
- [ ] **3. Select all students in a class.**
- [ ] **4. Create a linked expectation assignment for selected students when no task exists.**
- [ ] **5. Record audio, transcribe it, generate a card, edit it, and send it.**

## Card Structure & Content Rules
- [ ] **6. Generate a standalone single-checkbox task with no sub-steps.**
- [ ] **7. Generate a parent task with multiple checkbox sub-steps.**
- [ ] **12. Verify timing is absent unless explicitly mentioned in the transcript.**

## Student Interface & UX
- [ ] **8. Expand one parent task and verify another open parent task collapses.**
- [ ] **9. Check and uncheck sub-steps and verify automatic parent completion behaviour.**
- [ ] **10. Confirm that completed tasks remain expandable.**

## Data Persistence & Versioning
- [ ] **11. Update a card from a second recorded conversation and verify completed items persist.**

## Security & Privacy
- [ ] **13. Confirm unauthorised students cannot access another student’s card.** (Test by modifying the token in the URL or logging in as a different student).
- [ ] **14. Confirm audio deletion follows the retention setting.** (Check Drive folder after transcription if `DELETE_AUDIO_AFTER_TRANSCRIPTION` is true).

## Error Handling
- [ ] **15. Simulate a failed Classroom delivery for one student and verify other deliveries are still reported correctly.** (e.g., By temporarily removing a student's permission on an assignment).
- [ ] Microphone permission denied fallback.
- [ ] Gemini API timeout or invalid response fallback.
- [ ] Apps Script concurrent lock verification (Test by simulating rapid multiple edits on a single checklist).
```

# 8. Known Limitations and Enhancements

**Known Limitations:**
- **Classroom Submission Modification:** Depending on school Workspace policies, modifying student submissions programmatically as a teacher using `modifyAttachments` can sometimes hit permission errors. The fallback is creating targeted individual assignments.
- **Audio Recording on iOS:** Safari requires user interaction to initialize audio contexts. The application requires a button press to start, which adheres to this, but microphone permission flows can sometimes be rigid on iOS webviews within the Classroom app.
- **Execution Limits:** Apps Script has a 6-minute execution limit per invocation. Extremely long audio files may hit urlfetch timeouts or execution limits.
- **Concurrent DB Writes:** While `LockService` is implemented to prevent immediate data corruption in Sheets, high concurrency (50+ students updating cards at the exact same millisecond) could still theoretically result in lock timeouts.

**Next-Step Enhancements:**
- **Cron Jobs (Time-Driven Triggers):** Add a script to run daily and clean up old audio files based on `AUDIO_RETENTION_DAYS`.
- **Toast Notifications:** Replace standard `alert()` dialogs in the frontend with non-blocking toast notifications.
- **WebSocket/Polling Sync:** Currently, saving a checkbox forces a local reload of the data model. Implementing a lightweight polling mechanism could sync state if a student has the card open on two devices.
- **Teacher Dashboard Metrics:** Build a view for the teacher to quickly see an aggregate summary of class completion percentage across an assignment.
