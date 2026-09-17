<div align="center">

# ◮ Prism

**An AI screen & code assistant** — inspired by Arc's screen assistant, built for developers.
Chat normally, attach project files, or capture your screen **on demand** and ask about what you see.

Powered by **Featherless AI** · Streaming SSE · Vision + OCR fallback · SQLite memory · React + Express

</div>

---

## Features

### 💬 Core chat
- Natural streaming conversations (SSE, token-by-token) with Featherless-hosted models.
- Markdown rendering with **syntax-highlighted code blocks**, copy buttons, and per-block **Explain / Fix / Improve** actions.
- **Multiple conversations**, full history, rename/delete, and **search across titles and message content**.
- Conversation + project context is kept per session (configurable memory window).

### 🛠 Developer-first coding experience
- Exceptional at debugging, code generation, refactoring, architecture, APIs, Git, terminals, IDEs, web, mobile, databases, DevOps.
- Automatic language detection, complete corrected code (formatting/indentation preserved, no gratuitous rewrites), alternative-implementation comparisons.
- **Attach real project files** (code, PDF, DOCX) — they're text-extracted server-side and injected as authoritative codebase context, so you don't have to rely on screenshots.
- `Explain` / `Fix` / `Improve` / `Generate` actions (from the composer _or_ hovering any code block).

### 🎤 Voice (hears you, speaks back)
- Tap the 🎤, talk, tap again — Prism **transcribes your speech** (backend STT; audio never stored) into the message box
- Prism **speaks the answers aloud** (system voice; markdown-aware: code blocks are summarized, not spelled out) — toggle 🔊/🔇 in the header
- Works in the web app, the desktop overlay, and the Android panel

### 📸 Screen assistant — one bar, everywhere
- **Ctrl/⌘ + Shift + A** toggles the floating assistant panel (always-on-top in the desktop/Android apps).
- **One universal command bar — in the overlay AND the main app**: type to ask · **`/`** opens the command palette (assistant, voice, files, spoken answers…) · typed text surfaces **inline write-style chips** that rewrite it in place (Enter sends, Esc restores).
- **Write tab in the main app** (the "other things"): a full writing desk — draft anything, transform with style chips or a **free-form instruction** ("make this a polite rejection email"), undo freely, then copy / insert / download / **Discuss in chat** for a review pass.
- **Click, never hotkeys (if you don't want them)**: the assistant toggles from a **thin edge line** at the screen edge (draggable), and the desktop app adds an obvious **circle launcher** into the main app. Hotkeys still work everywhere for power users.
- **Arc-style writing, system-wide (desktop)**: select text in **any app** → **Ctrl/⌘+Shift+R** → a floating bar rewrites it → **Enter pastes it straight back** into that app. **Ctrl/⌘+Shift+G** asks about the selection. **Ctrl/⌘+Shift+W** toggles Watch from anywhere.
- **◉ Watch mode** (opt-in): samples your screen and keeps a screenshot **only when something visibly moves** — with optional ✨ **narration**, the vision model describes each change in the thread as it happens. Sensitivity low/med/high.
- **Panel sizing**: live measurements, S/M/L presets, drag-to-resize (desktop).
- **Privacy by design: no continuous recording.** Captures — single or motion-triggered — only happen when you start them.
- Captures route through the vision model → **OCR fallback** (Tesseract) when vision is unavailable, so terminal output / error dialogs still get analyzed.

### 🔐 Security & privacy
- Featherless API keys exist **only on the server** — the browser never sees them.
- Upload validation: extension/MIME/magic-byte checks, size limits, and blocking of secret material (`.env`, keys, certs).
- Rate limiting (general / chat / upload tiers), Helmet CSP, structured error envelopes.
- Settings → Privacy: **export all your data** or **wipe everything** in one click.

---

## Architecture

```
Client (React SPA / optional Electron shell)
   │  REST + SSE, no secrets
   ▼
Backend API (Express, helmet, rate limits, validation)
   ▼
AI Orchestrator
   ├── Featherless AI        (primary — OpenAI-compatible /v1/chat/completions)
   ├── Vision routing        (screenshots & attached images → vision model)
   ├── OCR fallback          (tesseract.js, when vision unavailable)
   ├── Conversation memory   (SQLite: conversations / messages / attachments)
   ├── File & context proc.  (code, PDF, DOCX → text; images → normalized buffers)
   └── Tool system           (Explain / Fix / Improve / Generate prompt tools)
```

**Swappable providers:** the orchestrator only depends on `server/providers/base.js`.
Implement the same interface to move off Featherless later without touching the rest of the app.

---

## Quick start (local)

```bash
# 1. install everything
npm run setup

# 2. configure the server
cp .env.example server/.env        # then edit it
#    set FEATHERLESS_API_KEY=your_key_here
#    (or, just to try the UI without a key, set AI_PROVIDER=mock — clearly flagged in the UI)

# 3. run (server: 4000, client dev server with proxy: 5173)
npm run dev
```

Open http://localhost:5173 — chat, press **Ctrl/⌘+Shift+A**, attach a file, ship.

### Production (single process, how Render runs it)

```bash
npm run build   # installs deps + builds client into client/dist
npm start       # Express serves both /api/* and the built SPA on $PORT
```

## Deploying to Render

This repo includes [`render.yaml`](render.yaml) (Blueprint):

1. Push this repo to GitHub.
2. Render dashboard → **New → Blueprint** → pick the repo.
3. Set the secret `FEATHERLESS_API_KEY` when prompted (it's marked `sync: false`).
4. Done — health checks hit `/api/health`, and a 1 GB disk is mounted at `/var/data` for the SQLite DB + uploads (`DATA_DIR=/var/data`).

Without a disk, everything still works — data is just ephemeral per deploy.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `FEATHERLESS_API_KEY` | — | **Required** (server-side secret) |
| `FEATHERLESS_BASE_URL` | `https://api.featherless.ai/v1` | OpenAI-compatible endpoint |
| `FEATHERLESS_CHAT_MODEL` | `Qwen/Qwen2.5-Coder-32B-Instruct` | Default chat model |
| `FEATHERLESS_VISION_MODEL` | `Qwen/Qwen2.5-VL-72B-Instruct` | Vision model for screenshots/images |
| `AI_PROVIDER` | `featherless` | `featherless` or `mock` (dev/CI only; visibly flagged in UI) |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Bind address |
| `DATA_DIR` | `server/data` | SQLite DB + uploads location |
| `MAX_UPLOAD_MB`, `MAX_UPLOAD_FILES` | `12`, `6` | Upload limits |
| `HISTORY_MESSAGES` | `24` | Memory window per conversation |
| `MAX_CONTEXT_FILES_CHARS`, `MAX_FILE_CHARS` | `180000`, `40000` | File context budgets |
| `RATE_LIMIT_*` | see `.env.example` | Rate limiting tiers |
| `CORS_ORIGINS` | — | Extra origins when the frontend is hosted elsewhere |

## API overview

| Route | Description |
|---|---|
| `POST /api/chat` | Streaming chat turn (SSE events: `meta` / `delta` / `notice` / `done` / `error`) — supports `attachmentIds`, `screenshots` (data URLs), `action` + `selection`, `model` |
| `POST /api/chat/regenerate` | Re-answer the last user question in a conversation — deletes the previous assistant reply and re-streams. Body: `{ conversationId, model? }` |
| `GET /api/conversations?query=` | List / search conversations |
| `POST /api/conversations` · `GET/PATCH/DELETE /api/conversations/:id` | CRUD + history |
| `POST /api/uploads` | Validated multipart uploads; text extraction; image normalization |
| `GET /api/uploads/:id/raw` | Inline preview of uploaded images |
| `GET /api/config` | Non-secret public config (provider readiness, models, limits) |
| `GET /api/health` | Liveness/readiness |
| `GET /api/privacy/export` · `DELETE /api/privacy/data` | Data export / wipe |

## Android app (floating over other apps)

`android/` is a native Kotlin app — the Arc-style bubble on your phone:

- **Draggable bubble displayed over all your other apps** (foreground service + overlay windows)
- Tap the bubble → mini assistant panel opens on top of whatever you're doing
- **Screenshot in one tap** — Android's own MediaProjection consent dialog gates each capture; exactly one frame is taken, then the projection is torn down (never continuous)
- **Region capture** = capture a frame, then drag-crop inside the panel
- The answer **streams inside the small panel**; the panel hides itself during capture
- **The APK is built by GitHub Actions** — see **Actions → Android APK → Artifacts** after every push

Setup & build details: [`android/README.md`](android/README.md).

## Desktop app (Arc-style floating assistant)

The `desktop/` folder is a real Electron app — this is the experience closest to Arc's screen assistant:

- **Frameless, always-on-top mini window** that floats over all your apps
- **True global hotkey** Ctrl/⌘+Shift+A → toggles it from anywhere in the OS
- **Direct capture** (no browser picker dialogs): whole screen, a picker of your open windows, or a **drag-select region** with a transparent snipping overlay
- The panel hides itself while capturing so it never appears in your screenshots, then comes back
- Answer streams in the small toggle window; pin/unpin, hide, and ⤢ opens the full chat
- Still privacy-first: one frame per explicit click, never continuous recording

```bash
cd desktop
npm install          # downloads Electron (~100 MB)
npm start            # uses the deployed app (https://prism-yks3.onrender.com)
# or against your local stack:
PRISM_URL=http://localhost:5173 npm run dev
```

Environment knobs: `PRISM_URL`, `PRISM_SHORTCUT`, `PRISM_WIDTH`, `PRISM_HEIGHT`.

The same compact UI is also available in any browser at **`/?overlay=1`** (uses the browser's native picker for captures — the Electron build skips the dialogs).

**Installers are built by GitHub Actions** on every push that touches `desktop/` —
**Actions → Desktop installers → Artifacts**:

| Platform | Artifact |
|---|---|
| Windows | `prism-desktop-win-x64.exe` (NSIS installer) + `.exe` portable |
| macOS | `.dmg` + `.zip` (unsigned — right-click → Open) |
| Linux | `.AppImage` + `.deb` |

To build locally: `cd desktop && npm install && npm run dist`.

> macOS: grant **Screen Recording** to Prism on first capture. Quit with `Ctrl/⌘+Shift+Q`.

## Tests

```bash
npm test   # boots the real server (mock provider) and runs 31 end-to-end checks:
           # SSE streaming, persistence, uploads (+secret blocking), vision path,
           # code actions, search, privacy export, rate limits, error envelopes
```

## Project structure

```
prism/
├── server/                 # Express backend
│   ├── providers/          # base interface · featherless · mock (dev-only)
│   ├── memory/store.js     # SQLite: conversations, messages, attachments
│   ├── orchestrator.js     # memory → files → vision/OCR → provider → persistence
│   ├── tools/              # Explain / Fix / Improve / Generate prompt tools
│   ├── utils/              # images (sharp), ocr (tesseract), file processor
│   ├── routes/ middleware/ # chat (SSE), conversations, uploads, system, limits
│   └── tests/smoke.test.mjs
├── client/                 # React (Vite) SPA
│   └── src/components/     # sidebar, chat, code blocks, composer, screen assistant…
├── desktop/                # optional Electron shell (global hotkey, always-on-top)
├── render.yaml             # Render Blueprint
└── .env.example
```

## Notes

- The `mock` provider exists **only** for keyless local development/CI (`AI_PROVIDER=mock`) and is visibly badged in the UI. Production uses Featherless.
- Models are user-selectable per-chat in the header; defaults come from env. Pick whichever chat/vision models your Featherless account exposes.
- **Server model list is cached** for 10 minutes per process, so repeated `/api/config` hits (web app + overlay + Android + desktop) don't re-list from the provider.

## Keyboard shortcuts (Arc-style)

| Shortcut | Where | Action |
|---|---|---|
| `Ctrl/⌘+Shift+A` | web + desktop global | Toggle the screen assistant / floating panel |
| `Ctrl/⌘+K` | web + desktop global | Command bar — focus search / overlay input |
| `Ctrl/⌘+N` | web | New conversation |
| `Ctrl/⌘+J` | web | Toggle the sidebar |
| `Ctrl/⌘+,` | web | Settings |
| `Ctrl/⌘+Shift+R` | desktop global | Rewrite the selected text in any app (inline write bar) |
| `Ctrl/⌘+Shift+G` | desktop global | Ask about the selected text |
| `Ctrl/⌘+Shift+W` | desktop global | Toggle Watch mode |
| `Ctrl/⌘+Shift+Q` | desktop | Quit |

## Quality: local build & test

```bash
npm run build   # client (Vite) → client/dist
npm test        # 44 end-to-end checks (mock provider)
```

## Deployment notes

- `node`: **20.x** (see `.nvmrc`)

