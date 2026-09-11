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
