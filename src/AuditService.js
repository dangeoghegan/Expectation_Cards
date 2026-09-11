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
