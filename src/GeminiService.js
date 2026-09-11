/**
 * GeminiService.js
 * Integrates with the Gemini API for audio transcription and structured extraction.
 */

const GeminiService = {
  getApiUrl(model, method) {
    const apiKey = Config.getGeminiApiKey();
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}?key=${apiKey}`;
  },

  /**
   * Uploads file to Gemini File API and returns the file URI.
   */
  uploadFile(blob) {
    const apiKey = Config.getGeminiApiKey();
    const url = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;

    const bytes = blob.getBytes();
    const mimeType = blob.getContentType() || 'audio/webm';

    // Simple one-off upload (suitable for small audio files < 2GB)
    const options = {
      method: 'post',
      contentType: mimeType,
      headers: {
        'X-Goog-Upload-Protocol': 'raw',
        'X-Goog-Upload-Command': 'upload',
        'X-Goog-Upload-Header-Content-Length': bytes.length.toString(),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      payload: bytes,
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200) {
      console.error('Gemini File Upload Error:', response.getContentText());
      throw new Error('Failed to upload audio to Gemini for processing.');
    }

    const json = JSON.parse(response.getContentText());
    return {
      name: json.file.name,
      uri: json.file.uri
    };
  },

  /**
   * Waits for a file to be processed by Gemini (required for audio).
   */
  waitForFileProcessing(fileName) {
     const apiKey = Config.getGeminiApiKey();
     const url = `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`;

     let state = 'PROCESSING';
     let attempts = 0;
     while (state === 'PROCESSING' && attempts < 10) {
       const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
       if (res.getResponseCode() !== 200) throw new Error('Failed to check file state.');
       const json = JSON.parse(res.getContentText());
       state = json.state;
       if (state === 'ACTIVE') return true;
       if (state === 'FAILED') throw new Error('Gemini failed to process the audio file.');
       Utils.sleep(2000);
       attempts++;
     }
     if (state !== 'ACTIVE') throw new Error('Timeout waiting for Gemini to process audio.');
     return true;
  },

  /**
   * Transcribes audio using Gemini 1.5 Pro.
   */
  transcribeAudio(blob) {
    const fileInfo = this.uploadFile(blob);
    this.waitForFileProcessing(fileInfo.name);

    const url = this.getApiUrl('gemini-1.5-pro', 'generateContent');
    const payload = {
      contents: [{
        parts: [
          { fileData: { fileUri: fileInfo.uri, mimeType: blob.getContentType() } },
          { text: "Please provide a highly accurate transcript of this spoken conversation between a teacher and a student. Ignore filler words. Format as clear paragraphs." }
        ]
      }],
      generationConfig: {
         temperature: 0.2
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || !json.candidates) {
      console.error('Gemini Transcription Error:', json);
      throw new Error('Failed to transcribe audio.');
    }

    return json.candidates[0].content.parts[0].text;
  },

  /**
   * Generates structured JSON Expectation Card from transcript.
   * If existingCard is provided, merges new requirements into it, preserving existing IDs and completed items.
   */
  generateCardFromTranscript(transcript, existingCard = null) {
    const url = this.getApiUrl('gemini-1.5-pro', 'generateContent');

    const schema = {
      type: "object",
      properties: {
        title: { type: "string", description: "A concise title for the expectation card." },
        timingInfo: { type: "string", description: "Timing or check-in explicitly mentioned. Omit if absent." },
        teacherNote: { type: "string", description: "A general note or encouragement from the teacher, if applicable." },
        tasks: {
          type: "array",
          description: "List of parent tasks.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "A unique stable ID for this task (e.g. UUID)." },
              text: { type: "string", description: "The task description." },
              substeps: {
                type: "array",
                description: "Optional list of sub-steps for this task. Only include if genuinely necessary.",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", description: "A unique stable ID for this sub-step." },
                    text: { type: "string", description: "The sub-step description." }
                  },
                  required: ["id", "text"]
                }
              }
            },
            required: ["id", "text"]
          }
        },
        successCriteria: {
          type: "array",
          description: "List of success criteria.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "A unique stable ID." },
              text: { type: "string", description: "The success criterion description." }
            },
            required: ["id", "text"]
          }
        }
      },
      required: ["title", "tasks"]
    };

    let promptText = `
You are an expert teacher assistant extracting structured expectations from a conversation transcript.
Use Australian English.
CRITICAL RULES:
- Distinguish teacher expectations from casual conversation.
- Ignore filler words, false starts, and irrelevant discussion.
- Do not infer personal, behavioural, wellbeing, disciplinary, medical, or sensitive content.
- Only create task-related, observable expectations clearly supported by the transcript.
- Do not invent details or deadlines.
- Include timing/check-in ONLY if explicitly stated (e.g., "by end of lesson").
- Preserve uncertainty for teacher review rather than guessing.
- Create concise, student-friendly wording.
- Small standalone actions should be single tasks with no sub-steps.
`;

    if (existingCard) {
      promptText += `
- You are UPDATING an existing card.
- KEEP all previously completed items.
- KEEP still-relevant incomplete items.
- ADD genuinely new requirements from the latest conversation.
- DO NOT reactivate completed items unless explicitly stated.
- RETAIN the exact existing 'id' for any task, substep, or success criterion that is kept or updated. Do not generate new IDs for existing items.

Existing Card JSON (for reference):
${JSON.stringify(existingCard, null, 2)}
`;
    }

    promptText += `
Transcript:
"""
${transcript}
"""
    `;

    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: schema
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || !json.candidates) {
      console.error('Gemini Card Gen Error:', json);
      throw new Error('Failed to generate structured card.');
    }

    const rawResult = json.candidates[0].content.parts[0].text;
    let cardData = Utils.parseJsonSafe(rawResult);

    if (!cardData) {
      throw new Error('Gemini returned invalid JSON structure.');
    }

    return Validation.repairCardData(cardData);
  }
};
