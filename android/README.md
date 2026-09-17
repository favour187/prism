# Prism for Android

A **chat-first, Arc-style floating screen assistant** for Android: opening the
app goes straight into a chat/answer panel, a **thin line** at the screen edge
reopens it anytime, and screen questions are answered in seconds — without
leaving whatever app you're in.

## How it works

```
FloatingService (foreground service)
 ├── Edge handle — thin draggable line, always above other apps (SYSTEM_ALERT_WINDOW)
 ├── Panel — overlay window hosting the Prism web overlay (/?overlay=1&android=1) in a WebView
 ├── CapturePermissionActivity — transparent host for the MediaProjection consent dialog
 └── One-frame capture pipeline — ImageReader + VirtualDisplay, torn down after every frame
```

Opening **Prism** wakes the assistant automatically (when display-over-apps is
granted and the server URL is valid) and finishes the launch into the panel.
The panel's WebView talks to native code through a `@JavascriptInterface`
bridge (`window.prismAndroid.requestCapture(...)` in the web app → native
captures a frame → result injected back as
`window.__prismCaptureResult(token, dataUrl)`).

## Speed

- **⚡ Answer** captures the screen and fires the prompt immediately — one tap,
  no typing.
- Captures are compressed as **JPEG** (not PNG), so each frame is smaller and
  reaches the server faster.

## Privacy model (matches the desktop/web apps)

- **Nothing is recorded or monitored continuously.** Each capture is exactly one
  frame: consent dialog → capture → projection torn down.
- The panel hides itself while capturing so it never appears in screenshots.
- Screenshots go only to your configured Prism server (Featherless key stays
  server-side).
- Region capture = one full frame, then you drag-crop inside the panel.

## Permissions

| Permission | Why |
|---|---|
| `SYSTEM_ALERT_WINDOW` | Display the edge handle/panel over other apps |
| `FOREGROUND_SERVICE` (+`SPECIAL_USE`, `MEDIA_PROJECTION`) | Persistent overlay host; brief mediaProjection type swap during each capture (required on Android 14+) |
| `POST_NOTIFICATIONS` | Persistent foreground notification (visible, with a Stop action) |
| `INTERNET` | The panel loads your Prism web app |

## Build

The APK is **built by GitHub Actions** on every push to `main` that touches
`android/` — grab it from
**Actions → Android APK → Artifacts → `prism-android-debug`**
(a debug-signed APK; sideload it: enable "Install unknown apps").

To build locally instead:

```bash
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

A signed release can be enabled via the `build-release` job in
`.github/workflows/android.yml` — add `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
repository secrets and uncomment the job.

## Run

1. Install the APK, open **Prism** → grant **“Display over other apps”**.
2. The assistant wakes itself and opens the panel. (If the server URL is
   invalid, fix it and tap **Save server**.)
3. Tap **⚡ Answer** to capture your screen and get an instant answer, type a
   question, or tap the thin edge line to reopen the panel after switching apps.
