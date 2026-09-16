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
    appBaseUrl: 'https://script.google.com/macros/s/AKfycbxLNjG5jEtD-6Nm1JKWIRD-dfdKSw_Ox1ofmV_5wnThNOXGthOVKvcSOoT07NnOTXZjqA/exec',
    gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbxLNjG5jEtD-6Nm1JKWIRD-dfdKSw_Ox1ofmV_5wnThNOXGthOVKvcSOoT07NnOTXZjqA/exec',
    allowedDomain: 'school.edu.au',
    audioRetentionDays: 30,
    deleteAudioAfterTranscription: true,
    classroomDeliveryEnabled: true,
    teacherName: 'Mr. Smith',
    geminiApiKey: process.env.GEMINI_API_KEY || ''
  },
  courses: [
    { id: 'course-dummy-test', name: '🧪 My Google Classroom (Dummy Test Class)', section: 'Period 1 (Test)', room: 'Room 101' },
    { id: 'course-101', name: 'Year 10 Design & Technology', section: 'Period 2', room: 'Workshop 3' },
    { id: 'course-102', name: 'Year 11 Industrial Technology (Timber)', section: 'Period 4', room: 'Timber Lab' },
    { id: 'course-103', name: 'Year 9 STEM Workshop', section: 'Period 1', room: 'Room 12' }
  ],
  courseWork: {
    'course-dummy-test': [
      { id: 'lesson-dt-1', title: 'Lesson 1: Workshop Safety Orientation & PPE Check', description: 'Practical induction on eye protection, dust filtration, and machinery boundaries.' },
      { id: 'lesson-dt-2', title: 'Lesson 2: Material Selection & Marking Out', description: 'Grain direction inspection and pencil gauge dimensioning for timber project.' }
    ],
    'course-101': [
      { id: 'lesson-101-1', title: 'Unit 3: Chair Joinery & Dry Fit Assembly', description: 'Inspect mortise and tenon joints, verify square angles, and dry clamp before gluing.' },
      { id: 'lesson-101-2', title: 'Unit 4: Progressive Timber Sanding & Grain Smoothing', description: '120-grit rough cleanup followed by 240-grit satin finish preparation.' },
      { id: 'lesson-101-3', title: 'Unit 5: Clear Satin Varnish & Safe Workshop Clean Up', description: 'Light wire wool de-nibbing and application of first protective varnish coat.' }
    ],
    'course-102': [
      { id: 'lesson-102-1', title: 'Major Project Milestone 2: Frame Construction', description: 'Assembly of structural elements and dowel reinforcement.' },
      { id: 'lesson-102-2', title: 'Surface Preparation & Finishing Schedule', description: 'Abrasive schedule and grain-raising damp wipe.' }
    ],
    'course-103': [
      { id: 'lesson-103-1', title: 'Robotics Sprint 1: Chassis Assembly & Motor Mounting', description: 'Secure DC geared motors and calibrate optical sensors.' }
    ]
  },
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

  getCourseLessons(courseId) {
    const lessons = db.courseWork[courseId] || [
      { id: `lesson-${courseId}-1`, title: 'Lesson 1: Workshop Core Competency & Task Setup', description: 'Essential practical skills and work safety.' },
      { id: `lesson-${courseId}-2`, title: 'Lesson 2: Individual Practical Execution & Assessment', description: 'Student practical work and step-by-step checklist.' }
    ];
    return {
      ok: true,
      data: { lessons: lessons }
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

  postCardToClassroom(cardId, teacherName) {
    const card = db.cards.find(c => c.cardId === cardId);
    if (!card) return { ok: false, error: { message: 'Card not found.' } };

    const tName = teacherName || db.settings.teacherName || 'Teacher';
    const now = new Date().toISOString();
    card.status = 'SENT';
    card.sentAt = now;
    card.classroomAnnouncementId = 'announcement-' + Date.now();
    card.classroomAlternateLink = 'https://classroom.google.com';

    // Format greeting for Stream announcement
    let greeting = 'Class';
    const recipients = card.recipients || [];
    const isWholeClass = recipients.some(r => r.studentUserId === 'ALL_STUDENTS' || r.studentEmail === 'all@classroom.local');
    if (!isWholeClass && recipients.length === 1) {
      greeting = recipients[0].studentName || 'Student';
    } else if (!isWholeClass && recipients.length > 1) {
      greeting = recipients.map(r => r.studentName || 'Student').join(', ');
    } else {
      greeting = card.className || 'Class';
    }

    const taskTitle = card.taskTitle || card.title || 'Practical Task';
    const streamText = [
      `Hello ${greeting},`,
      '',
      `Open the Expectation Card linked for "${taskTitle}".`,
      '',
      'Kind Regards,',
      tName
    ].join('\n');

    card.announcementText = streamText;

    (card.recipients || []).forEach(r => {
      r.deliveryStatus = 'SENT';
      r.sentAt = now;
    });

    return {
      ok: true,
      data: {
        cardId: cardId,
        status: 'SENT',
        classroomAnnouncementId: card.classroomAnnouncementId,
        classroomAlternateLink: card.classroomAlternateLink,
        announcementText: streamText,
        recipientCount: (card.recipients || []).length,
        message: 'Expectation card successfully posted to Google Classroom Stream Announcement!'
      }
    };
  },

  testClassroomDelivery(courseId, teacherName) {
    const course = db.courses.find(c => c.id === courseId) || { name: 'Test Course' };
    const annId = 'ann-test-' + Date.now();
    const tName = teacherName || db.settings.teacherName || 'Teacher';
    const streamText = [
      `Hello ${course.name},`,
      '',
      'Open the Expectation Card linked for "Test Task Expectations".',
      '',
      'Kind Regards,',
      tName
    ].join('\n');

    return {
      ok: true,
      data: {
        classroomAnnouncementId: annId,
        alternateLink: 'https://classroom.google.com',
        title: '🧪 Task Expectations Stream Announcement',
        announcementText: streamText,
        message: `Stream announcement successfully published to Google Classroom for ${course.name}!`
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

  completeStudentCard(cardId, studentId, studentName) {
    const card = db.cards.find(c => c.cardId === cardId || c.cardId === 'card-demo-1') || db.cards[0];
    const now = new Date().toISOString();
    if (card && card.recipients) {
      const rec = card.recipients.find(r => r.studentUserId === studentId || r.studentName === studentName) || card.recipients[0];
      if (rec) {
        rec.completedAt = now;
        rec.acknowledgedAt = rec.acknowledgedAt || now;
      }
    }
    return {
      ok: true,
      data: {
        cardId: cardId,
        studentId: studentId,
        studentName: studentName || 'Student',
        completedAt: now,
        message: 'Student completion recorded and teacher alerted.'
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

  async generateExpectationsFromTranscript(payload = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `You are an expert pedagogical assistant converting spoken teacher conversation notes and classroom context into clear, structured, student-friendly task expectations with actionable steps and sub-steps.
Class: ${payload.className || 'Class'}
Task Title: ${payload.taskTitle || 'Activity'}
Task Context / Instructions: ${payload.taskContext || ''}
Teacher Notes: ${payload.teacherNotes || ''}
Transcript: """${payload.transcript || ''}"""

CRITICAL:
- Turn the instructions and context into 2 to 5 actionable steps.
- Each step MUST have 1 to 4 concrete sub-steps detailing what the student actually does.
- All steps and sub-steps must be grounded in the teacher's task title, context, and transcript.

Return JSON matching:
{
  "cardTitle": "string",
  "studentFriendlySummary": "string (1-2 sentences)",
  "steps": [
    {
      "id": "step-1",
      "text": "string (overarching step description)",
      "required": true,
      "subSteps": [
        { "id": "sub-1-1", "text": "string (specific action)" }
      ]
    }
  ],
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
        if (json && json.steps && json.steps.length > 0) {
          // Normalize sub-steps
          json.steps.forEach((s, idx) => {
            s.id = s.id || `step-${idx + 1}`;
            s.required = s.required !== false;
            if (!Array.isArray(s.subSteps)) {
              s.subSteps = [];
            } else {
              s.subSteps.forEach((sub, sIdx) => {
                if (typeof sub === 'string') s.subSteps[sIdx] = { id: `sub-${idx + 1}-${sIdx + 1}`, text: sub };
                else sub.id = sub.id || `sub-${idx + 1}-${sIdx + 1}`;
              });
            }
          });
          return { ok: true, data: { cardData: json } };
        }
      } catch (err) {
        console.warn('Gemini generation API call error, using intelligent parser fallback:', err.message);
      }
    }

    // Intelligent synthesizer based on teacher's actual inputs
    const taskTitle = (payload.taskTitle || '').trim();
    const taskContext = (payload.taskContext || '').trim();
    const transcript = (payload.transcript || '').trim();
    const teacherNotes = (payload.teacherNotes || '').trim();

    const title = taskTitle || (transcript.match(/for\s+([a-zA-Z0-9\s]{3,30})/i) ? transcript.match(/for\s+([a-zA-Z0-9\s]{3,30})/i)[1].trim() : 'Task Expectations');
    const cardTitle = title.endsWith('Expectations') ? title : `${title} Expectations`;

    // Combine all instructions from teacher
    const combinedInstructions = [taskContext, transcript, teacherNotes].filter(Boolean).join('\n');
    const rawLines = combinedInstructions.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    const numberedItems = rawLines.filter(l => /^(?:\d+[\.\)]|[-*•])\s+/.test(l));

    const steps = [];

    if (numberedItems.length >= 2) {
      numberedItems.forEach((item, idx) => {
        const cleanItem = item.replace(/^(?:\d+[\.\)]|[-*•])\s+/, '').trim();
        const parts = cleanItem.split(/[:;]\s+|\.\s+/).map(p => p.trim()).filter(Boolean);
        const stepText = parts[0] || cleanItem;
        const subSteps = parts.slice(1).map((sub, sIdx) => ({
          id: `sub-${idx + 1}-${sIdx + 1}`,
          text: sub
        }));
        if (subSteps.length === 0) {
          subSteps.push({ id: `sub-${idx + 1}-1`, text: `Execute: ${stepText}` });
        }
        steps.push({
          id: `step-${idx + 1}`,
          text: stepText,
          required: true,
          subSteps: subSteps
        });
      });
    } else {
      const sentences = combinedInstructions
        ? combinedInstructions.split(/(?<=[.!?])\s+/).map(s => s.trim().replace(/\.$/, '')).filter(s => s.length > 5)
        : [];

      if (sentences.length >= 3) {
        steps.push({
          id: 'step-1',
          text: `Phase 1: Setup & Initial Work`,
          required: true,
          subSteps: [
            { id: 'sub-1-1', text: 'Gather required tools and workspace equipment' },
            { id: 'sub-1-2', text: sentences[0] }
          ]
        });
        steps.push({
          id: 'step-2',
          text: `Phase 2: Core Task Execution`,
          required: true,
          subSteps: [
            { id: 'sub-2-1', text: sentences[1] },
            { id: 'sub-2-2', text: sentences[2] || 'Check accuracy against criteria' }
          ]
        });
        steps.push({
          id: 'step-3',
          text: `Phase 3: Review & Final Submission`,
          required: true,
          subSteps: [
            { id: 'sub-3-1', text: sentences[3] || 'Self-check completed work against success criteria' },
            { id: 'sub-3-2', text: 'Tidy workstation and notify teacher of completion' }
          ]
        });
      } else if (sentences.length > 0) {
        sentences.forEach((s, idx) => {
          steps.push({
            id: `step-${idx + 1}`,
            text: `Step ${idx + 1}: ${s}`,
            required: true,
            subSteps: [
              { id: `sub-${idx + 1}-1`, text: `Complete: ${s}` },
              { id: `sub-${idx + 1}-2`, text: 'Verify step is complete to quality standard' }
            ]
          });
        });
        steps.push({
          id: `step-${steps.length + 1}`,
          text: 'Final Verification & Pack Down',
          required: true,
          subSteps: [
            { id: `sub-${steps.length + 1}-1`, text: 'Review all steps are complete' },
            { id: `sub-${steps.length + 1}-2`, text: 'Clean and pack up work bench' }
          ]
        });
      } else {
        const baseTitle = taskTitle || 'Task';
        steps.push({
          id: 'step-1',
          text: `Stage 1: Preparation for ${baseTitle}`,
          required: true,
          subSteps: [
            { id: 'sub-1-1', text: 'Review task requirements and gather required equipment' },
            { id: 'sub-1-2', text: 'Confirm safety guidelines and workspace cleanliness' }
          ]
        });
        steps.push({
          id: 'step-2',
          text: `Stage 2: Execute ${baseTitle}`,
          required: true,
          subSteps: [
            { id: 'sub-2-1', text: `Complete the primary sequence for ${baseTitle}` },
            { id: 'sub-2-2', text: 'Inspect workmanship against quality criteria' }
          ]
        });
        steps.push({
          id: 'step-3',
          text: 'Stage 3: Pack Down & Completion',
          required: true,
          subSteps: [
            { id: 'sub-3-1', text: 'Return all tools and materials to storage' },
            { id: 'sub-3-2', text: 'Check off all expectation card items on the student portal' }
          ]
        });
      }
    }

    const summary = taskContext
      ? (taskContext.length > 180 ? taskContext.substring(0, 177) + '...' : taskContext)
      : `Follow the step-by-step checklist below to complete ${taskTitle || 'your task'} smoothly and safely.`;

    return {
      ok: true,
      data: {
        cardData: {
          cardTitle: cardTitle,
          studentFriendlySummary: summary,
          steps: steps,
          successCriteria: [
            `All steps for ${taskTitle || 'this task'} completed according to criteria`,
            'High standard of workmanship and safety observed',
            'Tools and workspace cleaned and packed away'
          ],
          materials: [
            { label: 'Required tools and workshop materials', url: '' }
          ],
          checkInQuestion: `What is the first step you will complete today for ${taskTitle || 'your task'}?`,
          teacherMessage: 'Take your time, work carefully, and let me know if you need assistance!',
          teacherOnlyNotes: teacherNotes || ''
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
