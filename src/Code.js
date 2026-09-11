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
