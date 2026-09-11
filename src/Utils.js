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
