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
