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
