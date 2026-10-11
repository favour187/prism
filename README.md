<div align="center">

# ◮ Prism

**An AI screen & code assistant** — chat normally, attach project files, or capture your screen on demand.

Powered by **Gemini primary + automatic Groq fallback** · Streaming responses · Vision + local OCR fallback · Groq Whisper speech-to-text · SQLite memory · React + Express

</div>

---

## Features

- **Streaming AI chat:** Gemini is primary; when Gemini is unavailable, rate-limited, or rejects a request before producing text, Prism retries with Groq.
- **Screen and image understanding:** Gemini vision first, Groq vision fallback, then local Tesseract OCR if both vision attempts fail.
- **OCR:** Tesseract runs on the server as a fallback for readable text in screenshots. OCR quality depends on image clarity and language.
- **Voice input:** Groq Whisper (whisper-large-v3-turbo) transcribes audio into text. This requires GROQ_API_KEY.
- **Spoken answers:** Uses the browser/device system speech engine.
- **Coding tools:** Markdown/code rendering, copy buttons, Explain / Fix / Improve / Generate actions.
- **Conversation memory:** Create, rename, delete, search, and revisit conversations.
- **File attachments:** Supported files are validated and text-extracted server-side.
- **Screen assistant:** On-demand screenshot capture, optional watch/narration features, and floating assistant controls where supported by the desktop/Android shell.
- **Writing desk:** Draft, transform, undo, copy/download, and send a draft to chat for review.
- **Privacy controls:** API keys remain server-side; captures are opt-in; data export and wipe controls are available.

## Provider setup

1. Create a Gemini API key in Google AI Studio: https://aistudio.google.com/
2. Create a Groq API key in Groq Console: https://console.groq.com/
3. Set GEMINI_API_KEY and GROQ_API_KEY in your server environment (Render: Dashboard → Prism → Environment).
4. Keep AI_PROVIDER=gemini and deploy the latest main branch.

Gemini uses the OpenAI-compatible endpoint at https://generativelanguage.googleapis.com/v1beta/openai with gemini-3.8-flash by default. Verify model availability and current free-tier quotas in Google AI Studio. Groq uses its configured chat/vision model as a backup and Whisper for transcription. Both providers' free quotas and model access can change.

## Local development

```bash
npm run setup
cp .env.example server/.env
# Add GEMINI_API_KEY and GROQ_API_KEY to server/.env
npm run dev
```

Open http://localhost:5173.

## Deploying to Render

The repository includes render.yaml. Set both GEMINI_API_KEY and GROQ_API_KEY as secrets when creating/updating the service. The keys must not be added to frontend variables or committed to Git.

## Verification status

The repository includes a smoke test suite using the mock provider. Passing those tests verifies app routes and UI/server integration, not live Gemini/Groq account access. Live provider behavior also depends on valid keys, quotas, model availability, and the deployed service. After deployment, verify:
- /api/health reports the app is healthy and provider readiness is true.
- A normal chat streams a response.
- A screenshot is analyzed; if both vision providers fail, OCR fallback is invoked.
- Voice input produces a transcript using Groq Whisper.
- Desktop/Android capture controls require their platform-specific permissions and are not guaranteed by the web build alone.

## Tests

```bash
npm test
npm run build
```
