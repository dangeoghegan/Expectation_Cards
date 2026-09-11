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
