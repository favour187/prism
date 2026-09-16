# Prism for Android

An **Arc-style floating screen assistant** for Android: a bubble that displays
over other apps, one-tap screenshot, and answers in a mini panel — without
leaving whatever app you're in.

## How it works

```
FloatingService (foreground service)
 ├── Bubble — draggable, always above other apps (SYSTEM_ALERT_WINDOW)
 ├── Panel — overlay window hosting the Prism web overlay (/?overlay=1&android=1) in a WebView
 ├── CapturePermissionActivity — transparent host for the MediaProjection consent dialog
 └── One-frame capture pipeline — ImageReader + VirtualDisplay, torn down after every frame
```

The panel's WebView talks to native code through a `@JavascriptInterface`
bridge (`window.prismAndroid.requestCapture(...)` in the web app → native
captures a frame → result injected back as
`window.__prismCaptureResult(token, dataUrl)`).

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
| `SYSTEM_ALERT_WINDOW` | Display the bubble/panel over other apps |
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

1. Install the APK, open **Prism**.
2. Grant **“Display over other apps”**.
3. (Optional) Change the server URL — defaults to the deployed instance.
4. Tap **Start floating assistant** → switch to any app → tap the bubble →
   capture Screen or Region → ask → the answer streams in the small panel.
