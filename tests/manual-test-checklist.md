# Manual Testing Checklist

## Core Workflows
- [ ] **1. Select one student and attach a card to an existing assignment.**
- [ ] **2. Select multiple students and attach separate personalised cards.**
- [ ] **3. Select all students in a class.**
- [ ] **4. Create a linked expectation assignment for selected students when no task exists.**
- [ ] **5. Record audio, transcribe it, generate a card, edit it, and send it.**

## Card Structure & Content Rules
- [ ] **6. Generate a standalone single-checkbox task with no sub-steps.**
- [ ] **7. Generate a parent task with multiple checkbox sub-steps.**
- [ ] **12. Verify timing is absent unless explicitly mentioned in the transcript.**

## Student Interface & UX
- [ ] **8. Expand one parent task and verify another open parent task collapses.**
- [ ] **9. Check and uncheck sub-steps and verify automatic parent completion behaviour.**
- [ ] **10. Confirm that completed tasks remain expandable.**

## Data Persistence & Versioning
- [ ] **11. Update a card from a second recorded conversation and verify completed items persist.**

## Security & Privacy
- [ ] **13. Confirm unauthorised students cannot access another student’s card.** (Test by modifying the token in the URL or logging in as a different student).
- [ ] **14. Confirm audio deletion follows the retention setting.** (Check Drive folder after transcription if `DELETE_AUDIO_AFTER_TRANSCRIPTION` is true).

## Error Handling
- [ ] **15. Simulate a failed Classroom delivery for one student and verify other deliveries are still reported correctly.** (e.g., By temporarily removing a student's permission on an assignment).
- [ ] Microphone permission denied fallback.
- [ ] Gemini API timeout or invalid response fallback.
- [ ] Apps Script concurrent lock verification (Test by simulating rapid multiple edits on a single checklist).
