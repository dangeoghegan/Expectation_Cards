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
