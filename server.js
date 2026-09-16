const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// In-Memory Database Store (Emulating Google Sheets & Classroom Backend)
const db = {
  settings: {
    appBaseUrl: 'https://script.google.com/macros/s/AKfycbzemO95HbJpupSgeBiLqTxnSkpnul9SWQ1XKTFNWlWlPChxM1wGkWfgmTlBSj7p7s2FLQ/exec',
    gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbzemO95HbJpupSgeBiLqTxnSkpnul9SWQ1XKTFNWlWlPChxM1wGkWfgmTlBSj7p7s2FLQ/exec',
    allowedDomain: 'school.edu.au',
    audioRetentionDays: 30,
    deleteAudioAfterTranscription: true,
    classroomDeliveryEnabled: true,
    geminiApiKey: process.env.GEMINI_API_KEY || ''
  },
  courses: [
    { id: 'course-101', name: 'Year 10 Design & Technology', section: 'Period 2', room: 'Workshop 3' },
    { id: 'course-102', name: 'Year 11 Industrial Technology (Timber)', section: 'Period 4', room: 'Timber Lab' },
    { id: 'course-103', name: 'Year 9 STEM Workshop', section: 'Period 1', room: 'Room 12' }
  ],
  students: {
    'course-101': [
      { userId: 'student-1', name: 'Jimmy Chen', email: 'jimmy.chen@school.edu.au' },
      { userId: 'student-2', name: 'Sarah Taylor', email: 'sarah.taylor@school.edu.au' },
      { userId: 'student-3', name: 'Liam O\'Connor', email: 'liam.oconnor@school.edu.au' },
      { userId: 'student-4', name: 'Emma Wilson', email: 'emma.wilson@school.edu.au' },
      { userId: 'student-5', name: 'Noah Patel', email: 'noah.patel@school.edu.au' }
    ],
    'course-102': [
      { userId: 'student-6', name: 'Alex Johnson', email: 'alex.johnson@school.edu.au' },
      { userId: 'student-7', name: 'Chloe Davies', email: 'chloe.davies@school.edu.au' }
    ],
    'course-103': [
      { userId: 'student-8', name: 'Ben Miller', email: 'ben.miller@school.edu.au' },
      { userId: 'student-9', name: 'Maya Lin', email: 'maya.lin@school.edu.au' }
    ]
  },
  cards: [
    {
      cardId: 'card-demo-1',
      title: 'Chair Sanding Expectations',
      studentFriendlySummary: 'Complete the two-stage sanding sequence smoothly before the end of this lesson.',
      teacherMessage: 'Looking forward to starting varnish next lesson!',
      checkInQuestion: 'What grit sandpaper will you start with?',
      teacherOnlyNotes: 'Ensure Jimmy wears safety glasses during sanding.',
      classId: 'course-101',
      className: 'Year 10 Design & Technology',
      taskId: 'task-woodwork-1',
      taskTitle: 'Timber Chair Construction',
      taskContext: 'Dry fit and surface preparation stage',
      transcript: 'Okay Jimmy, so by the end of this lesson I need you to have finished sanding the main body of the chair. Make sure you use the 120 grit paper first, and then the 240 grit so it\'s perfectly smooth. Also, you have to remember to put the tools back in the cabinet when you are done. If you get all that done, we can start on the varnish next lesson.',
      steps: [
        { id: 'step-1', text: 'Sand the main chair frame using 120 grit sandpaper first', required: true },
        { id: 'step-2', text: 'Follow up with 240 grit sandpaper for a smooth finish', required: true },
        { id: 'step-3', text: 'Return sandpaper and tools to the workshop cabinet when finished', required: true }
      ],
      successCriteria: [
        'Surface is completely smooth with no rough edges',
        'Tools and sandpaper returned to workshop cabinet'
      ],
      materials: [
        { label: '120 and 240 grit sandpaper', url: '' },
        { label: 'Dust mask and safety glasses', url: '' }
      ],
      status: 'SENT',
      classroomCourseWorkId: 'cw-101-1',
      classroomAlternateLink: 'https://classroom.google.com/c/demo/a/demo/details',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 1800000).toISOString(),
      sentAt: new Date(Date.now() - 1800000).toISOString(),
      createdByEmail: 'teacher@school.edu.au',
      recipients: [
        {
          recipientId: 'rec-1',
          studentName: 'Jimmy Chen',
          studentEmail: 'jimmy.chen@school.edu.au',
          studentUserId: 'student-1',
          deliveryStatus: 'SENT',
          sentAt: new Date(Date.now() - 1800000).toISOString(),
          viewedAt: new Date(Date.now() - 900000).toISOString(),
          acknowledgedAt: new Date(Date.now() - 600000).toISOString(),
          acknowledgementText: 'Starting with 120 grit now!',
          lastError: ''
        }
      ]
    }
  ],
  tasks: [
    {
      taskId: 'template-1',
      classId: 'course-101',
      taskName: 'Timber Surface Sanding & Finishing',
      description: 'Prep and sand wooden joint surfaces prior to staining or varnishing.',
      defaultSuccessCriteria: ['Surface free of scratches', 'Grain raised and smoothed'],
      defaultMaterials: ['120 grit sandpaper', '240 grit sandpaper', 'Sanding block']
    },
    {
      taskId: 'template-2',
      classId: 'course-101',
      taskName: 'Workshop Clean Up and Tool Audit',
      description: 'Standard end of period tool return and bench sweep.',
      defaultSuccessCriteria: ['All clamps returned to rack', 'Bench brushed down'],
      defaultMaterials: ['Bench brush', 'Dust pan']
    }
  ],
  groups: [
    {
      groupId: 'grp-1',
      classId: 'course-101',
      groupName: 'Table 1 Workshop Group',
      studentEmails: ['jimmy.chen@school.edu.au', 'sarah.taylor@school.edu.au']
    }
  ],
  auditLogs: []
};

// RPC Service Handlers matching Code.gs
const rpcHandlers = {
  getCurrentUser() {
    return {
      ok: true,
      data: {
        email: 'teacher@school.edu.au',
        isTeacher: true,
        hasEmail: true,
        appVersion: '2.0.0'
      }
    };
  },

  getAppBootstrapData() {
    return {
      ok: true,
      data: {
        teacherEmail: 'teacher@school.edu.au',
        settings: db.settings,
        courses: db.courses
      }
    };
  },

  getTeacherCourses() {
    return {
      ok: true,
      data: { courses: db.courses }
    };
  },

  getCourseRoster(courseId) {
    const list = db.students[courseId] || [];
    return {
      ok: true,
      data: { students: list }
    };
  },

  getTasksForClass(classId) {
    return {
      ok: true,
      data: { tasks: db.tasks.filter(t => !classId || t.classId === classId) }
    };
  },

  getGroupsForClass(classId) {
    return {
      ok: true,
      data: { groups: db.groups.filter(g => !classId || g.classId === classId) }
    };
  },

  getTeacherCards(filters = {}) {
    let list = [...db.cards];
    if (filters.status && filters.status !== 'ALL') {
      list = list.filter(c => c.status === filters.status);
    }
    const summary = list.map(c => {
      const recs = c.recipients || [];
      return {
        cardId: c.cardId,
        title: c.title,
        className: c.className,
        classId: c.classId,
        status: c.status,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        sentAt: c.sentAt,
        recipientCount: recs.length,
        acknowledgedCount: recs.filter(r => Boolean(r.acknowledgedAt)).length,
        viewedCount: recs.filter(r => Boolean(r.viewedAt)).length,
        classroomLink: c.classroomAlternateLink || '',
        hasDeliveryError: Boolean(c.deliveryError)
      };
    });
    return {
      ok: true,
      data: { cards: summary }
    };
  },

  getCard(cardId) {
    const card = db.cards.find(c => c.cardId === cardId);
    if (!card) {
      return { ok: false, error: { message: 'Expectation card not found.' } };
    }
    return {
      ok: true,
      data: card
    };
  },

  createDraftCard(payload) {
    const cardId = payload.cardId || 'card-' + Date.now();
    const now = new Date().toISOString();

    let existing = db.cards.find(c => c.cardId === cardId);
    const recipients = (payload.recipients || []).map(r => ({
      recipientId: 'rec-' + (r.userId || Math.random().toString(36).substring(2, 6)),
      studentName: r.name,
      studentEmail: r.email,
      studentUserId: r.userId,
      deliveryStatus: 'PENDING',
      sentAt: '',
      viewedAt: '',
      acknowledgedAt: '',
      acknowledgementText: '',
      lastError: ''
    }));

    if (existing) {
      Object.assign(existing, {
        title: payload.cardTitle || existing.title,
        studentFriendlySummary: payload.studentFriendlySummary || existing.studentFriendlySummary,
        steps: payload.steps || existing.steps,
        successCriteria: payload.successCriteria || existing.successCriteria,
        materials: payload.materials || existing.materials,
        checkInQuestion: payload.checkInQuestion || existing.checkInQuestion,
        teacherMessage: payload.teacherMessage || existing.teacherMessage,
        teacherOnlyNotes: payload.teacherOnlyNotes || existing.teacherOnlyNotes,
        updatedAt: now
      });
    } else {
      existing = {
        cardId: cardId,
        title: payload.cardTitle || 'Task Expectations',
        studentFriendlySummary: payload.studentFriendlySummary || '',
        steps: payload.steps || [],
        successCriteria: payload.successCriteria || [],
        materials: payload.materials || [],
        checkInQuestion: payload.checkInQuestion || '',
        teacherMessage: payload.teacherMessage || '',
        teacherOnlyNotes: payload.teacherOnlyNotes || '',
        classId: payload.classId || '',
        className: payload.className || '',
        taskTitle: payload.taskTitle || '',
        taskContext: payload.taskContext || '',
        transcript: payload.transcript || '',
        status: payload.status || 'DRAFT',
        createdAt: now,
        updatedAt: now,
        createdByEmail: 'teacher@school.edu.au',
        recipients: recipients
      };
      db.cards.unshift(existing);
    }

    return {
      ok: true,
      data: { cardId: cardId, message: 'Draft card saved.' }
    };
  },

  postCardToClassroom(cardId) {
    const card = db.cards.find(c => c.cardId === cardId);
    if (!card) return { ok: false, error: { message: 'Card not found.' } };

    const now = new Date().toISOString();
    card.status = 'SENT';
    card.sentAt = now;
    card.classroomCourseWorkId = 'cw-' + Date.now();
    card.classroomAlternateLink = 'https://classroom.google.com';

    (card.recipients || []).forEach(r => {
      r.deliveryStatus = 'SENT';
      r.sentAt = now;
    });

    return {
      ok: true,
      data: {
        cardId: cardId,
        status: 'SENT',
        classroomCourseWorkId: card.classroomCourseWorkId,
        classroomAlternateLink: card.classroomAlternateLink,
        recipientCount: card.recipients.length,
        message: 'Card posted to Google Classroom.'
      }
    };
  },

  retryCardDelivery(cardId) {
    return this.postCardToClassroom(cardId);
  },

  archiveCard(cardId) {
    const card = db.cards.find(c => c.cardId === cardId);
    if (card) {
      card.status = 'ARCHIVED';
      card.archivedAt = new Date().toISOString();
    }
    return { ok: true, data: { cardId: cardId, message: 'Card archived.' } };
  },

  duplicateCard(cardId) {
    const card = db.cards.find(c => c.cardId === cardId);
    if (!card) return { ok: false, error: { message: 'Card not found.' } };
    const copy = JSON.parse(JSON.stringify(card));
    copy.cardId = 'card-' + Date.now();
    copy.title = `${copy.title} (Copy)`;
    copy.status = 'DRAFT';
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = new Date().toISOString();
    copy.sentAt = '';
    copy.classroomCourseWorkId = '';
    copy.classroomAlternateLink = '';
    db.cards.unshift(copy);
    return { ok: true, data: { cardId: copy.cardId, message: 'Card duplicated.' } };
  },

  getStudentCard(cardId) {
    // If empty or demo token, default to first card
    const card = db.cards.find(c => c.cardId === cardId || c.cardId === 'card-demo-1') || db.cards[0];
    if (!card) return { ok: false, error: { message: 'Card not found.' } };

    // Record viewed timestamp on student recipient
    if (card.recipients && card.recipients.length > 0 && !card.recipients[0].viewedAt) {
      card.recipients[0].viewedAt = new Date().toISOString();
    }

    const firstRec = (card.recipients && card.recipients[0]) || {};

    return {
      ok: true,
      data: {
        cardId: card.cardId,
        cardTitle: card.title,
        studentFriendlySummary: card.studentFriendlySummary,
        taskTitle: card.taskTitle,
        taskContext: card.taskContext,
        teacherMessage: card.teacherMessage,
        steps: card.steps,
        successCriteria: card.successCriteria,
        materials: card.materials,
        checkInQuestion: card.checkInQuestion,
        studentName: firstRec.studentName || 'Student',
        isAcknowledged: Boolean(firstRec.acknowledgedAt),
        acknowledgedAt: firstRec.acknowledgedAt || null,
        acknowledgementText: firstRec.acknowledgementText || ''
      }
    };
  },

  acknowledgeCard(cardId, acknowledgementText = '') {
    const card = db.cards.find(c => c.cardId === cardId || c.cardId === 'card-demo-1') || db.cards[0];
    if (!card) return { ok: false, error: { message: 'Card not found.' } };

    const now = new Date().toISOString();
    if (card.recipients && card.recipients.length > 0) {
      card.recipients[0].acknowledgedAt = now;
      card.recipients[0].acknowledgementText = acknowledgementText;
    }
    return {
      ok: true,
      data: {
        cardId: card.cardId,
        acknowledgedAt: now,
        acknowledgementText: acknowledgementText,
        message: 'Expectations acknowledged!'
      }
    };
  },

  async transcribeAudio(payload) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && payload.base64Audio) {
      try {
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const cleanBase64 = payload.base64Audio.split(',').pop();

        const resp = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: payload.mimeType || 'audio/webm', data: cleanBase64 } },
              { text: 'Provide a clean, accurate verbatim transcript of the teacher and student conversation in this audio. Remove filler words (um, ah).' }
            ]
          }]
        });
        return { ok: true, data: { transcript: resp.text } };
      } catch (err) {
        console.warn('Gemini transcription API call error, using fallback:', err.message);
      }
    }

    return {
      ok: true,
      data: {
        transcript: 'Okay Jimmy, so by the end of this lesson I need you to finish sanding the main body of the chair. Make sure you use the 120 grit paper first, and then the 240 grit so it\'s perfectly smooth. Also, you have to remember to put the tools back in the cabinet when you are done. If you get all that done, we can start on the varnish next lesson.'
      }
    };
  },

  async generateExpectationsFromTranscript(payload) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `You are an expert pedagogical assistant converting spoken teacher conversation notes into clear, structured, student-friendly task expectations.
Class: ${payload.className || 'Class'}
Task: ${payload.taskTitle || 'Activity'}
Transcript: """${payload.transcript || ''}"""

Return JSON matching:
{
  "cardTitle": "string",
  "studentFriendlySummary": "string (1-2 sentences)",
  "steps": [{ "id": "step-1", "text": "string", "required": true }],
  "successCriteria": ["string"],
  "materials": [{ "label": "string", "url": "" }],
  "checkInQuestion": "string",
  "teacherMessage": "string",
  "teacherOnlyNotes": "string"
}`;

        const resp = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json' }
        });

        const json = JSON.parse(resp.text);
        return { ok: true, data: { cardData: json } };
      } catch (err) {
        console.warn('Gemini generation API call error, using fallback:', err.message);
      }
    }

    // Default structured draft
    return {
      ok: true,
      data: {
        cardData: {
          cardTitle: payload.taskTitle ? `${payload.taskTitle} Expectations` : 'Chair Sanding Expectations',
          studentFriendlySummary: 'Complete the two-stage sanding sequence smoothly before the end of this lesson.',
          steps: [
            { id: 'step-1', text: 'Sand the main chair frame using 120 grit sandpaper first', required: true },
            { id: 'step-2', text: 'Follow up with 240 grit sandpaper for a perfectly smooth surface', required: true },
            { id: 'step-3', text: 'Return sandpaper and tools to the workshop cabinet when finished', required: true }
          ],
          successCriteria: [
            'Surface is completely smooth with no rough edges or scratches',
            'Tools and materials returned to the cabinet'
          ],
          materials: [
            { label: '120 and 240 grit sandpaper', url: '' },
            { label: 'Safety glasses and dust mask', url: '' }
          ],
          checkInQuestion: 'What grit sandpaper will you start with?',
          teacherMessage: 'Looking forward to starting varnish next lesson!',
          teacherOnlyNotes: 'Student needs reminder on wearing safety glasses at all times.'
        }
      }
    };
  },

  getSettings() {
    return { ok: true, data: db.settings };
  },

  saveSettings(payload) {
    Object.assign(db.settings, payload);
    return { ok: true, data: { message: 'Settings saved.' } };
  }
};

// RPC Endpoint
app.post('/api/rpc', async (req, res) => {
  const { funcName, args = [] } = req.body;
  if (!rpcHandlers[funcName]) {
    return res.status(404).json({ error: `RPC method '${funcName}' not found` });
  }
  try {
    const result = await rpcHandlers[funcName](...args);
    res.json({ result });
  } catch (err) {
    console.error(`RPC [${funcName}] error:`, err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Serve the single consolidated index.html file
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html not found');
  }
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Fallback route
app.use((req, res) => {
  res.redirect('/');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Task Expectations server listening on http://0.0.0.0:${PORT}`);
});
