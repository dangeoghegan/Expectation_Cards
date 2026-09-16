# Task Expectations

A production-ready, mobile-first Google Apps Script web application for high-school teachers to record spoken expectations during one-on-one or small group conversations, use Google Gemini to generate structured checklists, and deliver actionable expectation cards directly to students via Google Classroom.

- **Repository:** `https://github.com/dangeoghegan/Expectation_Cards.git`
- **Active Web App (GAS URL):** `https://script.google.com/macros/s/AKfycbzemO95HbJpupSgeBiLqTxnSkpnul9SWQ1XKTFNWlWlPChxM1wGkWfgmTlBSj7p7s2FLQ/exec`

### 📍 Google Apps Script (GAS) URL Locations in Codebase
For future reference and updates, the GAS Web App URL is maintained in the following locations:
1. **`index.html` (Top Configuration):** Inside `<script>`, under `window.CONFIG.GAS_WEB_APP_URL` (Line ~1050).
2. **`index.html` (HTML Meta Tag):** Inside `<head>`, `<meta name="gas-web-app-url" content="...">` (Line ~10).
3. **`index.html` (UI Buttons & Links):** Top header action link `id="btn-open-gas-app"`, Step 1 connection banner `id="link-open-gas-step1"`, and the Settings modal input `id="settings-gas-url"`.
4. **`Code.gs` (Server Default):** `Config.getAppBaseUrl()` fallback (Line ~112).
5. **`server.js` (Dev Server Config):** `db.settings.appBaseUrl` and `db.settings.gasWebAppUrl` (Line ~14).

---

## 🔑 Google Classroom API Live Access
- **Authentication Requirement:** Google Classroom API endpoints (`Classroom.Courses.list` and `Classroom.Courses.Students.list`) execute with the credentials of the logged-in user (`Execute as: User accessing the web app`).
- **Live Classroom vs. Preview Sandbox:**
  - When accessing the app via the **Active Web App URL** (`https://script.google.com/macros/s/AKfycbzemO95HbJpupSgeBiLqTxnSkpnul9SWQ1XKTFNWlWlPChxM1wGkWfgmTlBSj7p7s2FLQ/exec`), `google.script.run` connects directly to the teacher's live Google Workspace session and queries their active courses and student rosters.
  - When accessing the app in the local/cloud preview sandbox, live Google auth tokens cannot be read directly from an unauthenticated iframe container, so the app displays a prominent status banner and "Open in Google Classroom" link leading straight to the authenticated web app.
- **Required Google Cloud & Apps Script Services:**
  - **Apps Script Services:** `Classroom v1` (Identifier: `Classroom`) and `Drive v2` (Identifier: `Drive`).
  - **Google Cloud Console APIs:** Ensure the linked GCP project has the **Google Classroom API** (`classroom.googleapis.com`) enabled.
  - **OAuth Scopes in `appsscript.json`:**
    - `https://www.googleapis.com/auth/classroom.courses.readonly`
    - `https://www.googleapis.com/auth/classroom.rosters.readonly`
    - `https://www.googleapis.com/auth/classroom.coursework.students`
    - `https://www.googleapis.com/auth/classroom.profile.emails`

---

## 🏗️ Architecture & Philosophy

The application strictly follows a clean, single front-end and single back-end architecture for seamless deployment in Google Apps Script and local Node.js environments:

- **Single Front-End File (`index.html`):**
  - Self-contained HTML5, CSS custom properties, and vanilla JavaScript.
  - Zero external JS frameworks or runtime dependencies (no React, Vue, npm packages, or bundlers).
  - Responsive, accessible design with mobile-first student view and desktop/tablet teacher dashboard.
  - Interactive audio recorder with duration timer, audio playback, manual transcript editing, and sample audio fallback.
  - Multi-step guided teacher workflow (Class selection, Student roster multi-select, Task templates, Conversation recording, Gemini AI draft generation, Review & Edit editor, Classroom delivery).
  - Distraction-free, mobile-first student portal with real-time checklist toggles, success criteria, material badges, reflection check-in, and acknowledgement button.
  - Full compatibility with Apps Script `google.script.run` and local Express RPC bridge.

- **Single Back-End File (`Code.gs`):**
  - Fully structured into 15 clearly delineated service sections.
  - Implements transactional locking via `LockService` for Google Sheets data integrity.
  - Full Google Classroom integration creating targeted Coursework items without sending unsolicited emails.
  - Pluggable Gemini 2.5 Flash audio transcription and structured JSON generation.
  - Automated audio retention cleanup and privacy protection.
  - Strict server-side authorization ensuring students can only view their own cards and never see teacher-only notes.

- **Apps Script Manifest (`appsscript.json`):**
  - Declares required OAuth scopes and Advanced Services (`Classroom v1` and `Drive v2`).

---

## 📋 Google Sheets Schema (`setupApp`)

Running `setupApp()` initializes the following schema in the bound Google Spreadsheet:

1. **`Settings`:** `Key`, `Value`, `Notes`, `UpdatedAt`, `UpdatedBy`
2. **`Cards`:** `CardId`, `CreatedAt`, `UpdatedAt`, `CreatedByEmail`, `ClassId`, `ClassName`, `TaskId`, `TaskTitle`, `TaskContext`, `Transcript`, `CardTitle`, `StudentFriendlySummary`, `TeacherMessage`, `ExpectationsJson`, `SuccessCriteriaJson`, `MaterialsJson`, `CheckInQuestion`, `TeacherOnlyNotes`, `ReviewDate`, `Status`, `ClassroomCourseWorkId`, `ClassroomAlternateLink`, `DeliveryError`, `SentAt`, `ArchivedAt`
3. **`CardRecipients`:** `RecipientId`, `CardId`, `StudentGoogleUserId`, `StudentEmail`, `StudentName`, `ClassId`, `ClassroomSubmissionId`, `ClassroomDeliveryStatus`, `SentAt`, `ViewedAt`, `AcknowledgedAt`, `AcknowledgementText`, `LastError`
4. **`Tasks`:** `TaskId`, `ClassId`, `TaskName`, `Description`, `DefaultSuccessCriteriaJson`, `DefaultMaterialsJson`, `IsActive`, `CreatedAt`, `UpdatedAt`
5. **`Groups`:** `GroupId`, `ClassId`, `GroupName`, `StudentEmailsJson`, `CreatedAt`, `UpdatedAt`, `CreatedByEmail`
6. **`AuditLog`:** `AuditId`, `Timestamp`, `ActorEmail`, `Action`, `CardId`, `RecipientId`, `DetailsJson`
7. **`Recordings`:** `RecordingId`, `CardId`, `DriveFileId`, `Filename`, `MimeType`, `SizeBytes`, `CreatedAt`, `DeletedAt`

---

## 🚀 Setup & Deployment Guide

### 1. Create Google Sheet & Bound Apps Script
1. Create a new Google Sheet in your Google Workspace drive (e.g. `Task Expectations Store`).
2. In the Google Sheet, navigate to **Extensions** > **Apps Script**.

### 2. Add Required Advanced Services & Cloud APIs
1. In the Apps Script Editor, click **Services (+)** on the left sidebar:
   - Add **Google Classroom API** (Identifier: `Classroom`, Version: `v1`).
   - Add **Google Drive API** (Identifier: `Drive`, Version: `v2`).
2. In the attached Google Cloud Project (via Project Settings), ensure the following APIs are enabled:
   - Google Classroom API (`classroom.googleapis.com`)
   - Google Drive API (`drive.googleapis.com`)
   - Generative Language API (`generativelanguage.googleapis.com`)

### 3. Push Files via Clasp
1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/dangeoghegan/Expectation_Cards.git
   cd Expectation_Cards
   npm install
   ```
2. Login and link to your Apps Script project:
   ```bash
   npx clasp login
   npx clasp clone <SCRIPT_ID>
   ```
3. Push files to Apps Script:
   ```bash
   npx clasp push
   ```

### 4. Configure Script Properties
In Apps Script Editor, go to **Project Settings** (gear icon) > **Script Properties** and configure:

| Property Name | Example Value | Description |
|---|---|---|
| `GEMINI_API_KEY` | `AIzaSy...` | Required for Gemini audio transcription and expectation drafting. |
| `APP_BASE_URL` | `https://script.google.com/.../exec` | Web App deployment URL. |
| `ALLOWED_TEACHER_DOMAIN` | `school.nsw.edu.au` | Google Workspace domain authorized for teachers. |
| `ALLOWED_TEACHER_EMAILS` | `teacher1@school.edu,teacher2@school.edu` | Optional allowlist of specific teacher emails. |
| `EXPECTATION_CARDS_ROOT_FOLDER_ID` | `1abc...` | (Auto-created during `setupApp()`) Drive folder for app storage. |
| `EXPECTATION_CARDS_AUDIO_FOLDER_ID` | `1xyz...` | (Auto-created during `setupApp()`) Transient audio folder. |
| `AUDIO_RETENTION_DAYS` | `30` | Number of days before un-deleted audio files are purged. |
| `DELETE_AUDIO_AFTER_TRANSCRIPTION` | `true` | When `true`, transient audio files are trashed immediately following transcription. |
| `ENABLE_CLASSROOM_DELIVERY` | `true` | Set to `true` to enable direct Google Classroom Coursework creation. |

### 5. Deploy Web App
1. Click **Deploy** > **New deployment**.
2. Select type **Web app**.
3. Set **Execute as:** `User accessing the web app` (MANDATORY: identifies student or teacher email via `Session.getActiveUser().getEmail()`).
4. Set **Who has access:** `Anyone within [Your Domain]` (or `Anyone` if students access through school Google accounts).
5. Click **Deploy** and copy the Web App URL into `APP_BASE_URL`.

---

## 💻 Local Development & Testing

This project includes an Express server that emulates all `Code.gs` server handlers and serves `index.html`:

```bash
npm run dev
```

Visit `http://localhost:3000` to interact with the teacher dashboard, record test audio, test AI card generation, and preview the student portal.

---

## 🔒 Privacy & Safety Guidelines
- **Teacher Review Required:** AI-generated cards are strictly drafts for teacher review. Nothing is ever sent to a student automatically.
- **Student Privacy:** Students can only view their own cards via authorized email or secure card tokens. Raw audio, transcripts, and teacher-only notes are never sent or visible to students.
- **No Unsolicited Emails:** Task expectations are posted directly as Coursework in Google Classroom.

---

## 🧪 Acceptance Testing
Refer to `tests/manual-test-checklist.md` for the full test verification suite.
