# Expectation Cards

A production-ready, mobile-first web application for high-school teachers to record spoken expectations, use Gemini to generate a structured checklist, and deliver it to students via Google Classroom.

## Architecture & Technology Stack
- **Backend:** Google Apps Script (Standalone) running on the V8 engine.
- **Frontend:** Apps Script HTML Service (HTML/CSS/Vanilla JS) built for mobile-first.
- **Database:** Google Sheets (`SheetService.js`).
- **File Storage:** Google Drive (`DriveService.js`) for audio recordings.
- **AI Processing:** Gemini API (`GeminiService.js`) for audio transcription and JSON extraction.
- **Integrations:** Google Classroom API (Advanced Service).

## Setup & Deployment Instructions

### 1. Google Sheet Setup
1. Create a new Google Sheet (e.g., named "Expectation Cards DB").
2. In the Google Sheet, go to **Extensions** > **Apps Script**.

### 2. Apps Script Setup
1. Clone this repository to your local machine.
2. Run `npm install` to get the clasp dependency.
3. Authenticate clasp: `npx clasp login`
4. Link to your bound Apps Script project: `npx clasp clone <script-id>` (Find the script ID in the Apps Script URL or Project Settings).
5. Ensure the local files override the cloned default files, and push the code: `npx clasp push`
6. In the Apps Script Editor, go to **Services** (left sidebar) and add:
   - `Classroom API (v1)`
   - `Drive API (v2)`
7. Refresh your Google Sheet. You should see a new custom menu: **Expectation Cards**.
8. Click **Expectation Cards** > **Setup Application** to initialize the required sheets and Drive folders. (You will need to authorize the script).
9. Go to **Project Settings** (gear icon) > **Script Properties**.
10. Ensure the following Script Properties are set:

| Property Name | Example Value | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | `AIzaSy...` | Get from Google AI Studio. |
| `EXPECTATION_CARDS_ROOT_FOLDER_ID` | (auto-generated) | Root Drive Folder ID. |
| `EXPECTATION_CARDS_AUDIO_FOLDER_ID`| (auto-generated) | Audio Storage Folder ID. |
| `TEACHER_EMAIL_ALLOWLIST` | `teacher@school.edu` | Comma-separated list of authorised teachers. |
| `AUTHORISED_DOMAIN` | `school.edu` | (Optional) Workspace domain to authorise all teachers. |
| `APP_BASE_URL` | `https://script.google.com/.../exec` | The published Web App URL. |
| `AUDIO_RETENTION_DAYS` | `30` | Days to keep fallback audio. |
| `DELETE_AUDIO_AFTER_TRANSCRIPTION` | `true` | Set to true to delete audio immediately after processing. |

### 3. Deployment
1. Click **Deploy** > **New deployment**.
2. Select type **Web app**.
3. **Execute as:** User accessing the web app.
4. **Who has access:** Anyone (or "Anyone within [Your Domain]").
5. Click **Deploy** and copy the resulting Web App URL to the `APP_BASE_URL` property.

## Testing
Refer to `tests/manual-test-checklist.md` for full acceptance test scenarios.

## Known Limitations
- The `ClassroomService.attachLinkToSubmission` method may require specific Workspace admin configurations depending on how student submission modifications are restricted by the school's policy.
- Large audio recordings (over several minutes) might hit Apps Script 6-minute execution limits or urlfetch payload limits.
- iOS Safari requires explicit user interaction to start the Web Audio API or `getUserMedia`.

## File Structure
- `src/Code.js`: Main entry and WebApp routing.
- `src/Setup.js`: Installation logic.
- `src/Config.js`, `src/Auth.js`, `src/Utils.js`, `src/Validation.js`: Core utilities.
- `src/*Service.js`: API and data abstraction layers.
- `src/*.html`: Frontend UI.
- `tests/`: Testing resources.
