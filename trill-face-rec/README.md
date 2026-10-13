# Trill Face Rec

A full-stack, installable (PWA) face recognition app. Recognition runs on the device
(TensorFlow.js via face-api.js), so it is fast, works on phones and desktops, and keeps
working offline with the last synced gallery.

## Features

- **Live recognition**: real-time camera feed with a box around every face. Box color changes with the result:
  green = recognized, amber = possible match, red = unknown. Optional per-person colors.
- **Tap to enroll**: tap any face in the live feed to add it to a person (new or existing).
- **Analyze photo**: drop or take a photo; every face is detected (accurate SSD detector) and identified.
- **People management**: add, edit (name, notes, color), delete people; upload photos or capture
  samples from the camera; remove individual samples.
- **Recognition log**: history of recognized / possible / unknown events, stats, and offline queue sync.
- **Settings**: match threshold, fast/accurate detector, resolution, camera, mirror, HUD, API key,
  offline model download, install prompt.
- **PWA**: installable, offline app shell, cached models, responsive from phone to desktop.

## Architecture

| Layer | Tech |
| --- | --- |
| Frontend | Vanilla ES modules (no build step), face-api.js 1.7 (TensorFlow.js) |
| PWA | `manifest.webmanifest`, service worker (`client/sw.js`), IndexedDB offline cache |
| Backend | Node.js, Express 5, `compression` |
| Storage | SQLite (better-sqlite3, WAL mode), thumbnails on disk |
| Auth (optional) | Shared API key via `TRILL_API_KEY` |

How recognition works:

1. Each face gets a 128-d embedding on the device.
2. Enrolled people are stored server-side as embeddings (plus a thumbnail).
3. Devices sync the gallery (`GET /api/gallery`) and cache it in IndexedDB.
4. A face is matched to the closest enrolled embedding. Distance ≤ threshold = recognized.
   If the second-best person is nearly as close, the result is "possible" instead of recognized.
5. Results are smoothed over the last 5 frames per face, so boxes don't flicker.

## Quick start

Requirements: Node.js 18+ (20 recommended) and a C/C++ toolchain for `better-sqlite3` if no prebuilt binary exists.

```bash
cd trill-face-rec
npm install          # also copies face-api + models into client/ (postinstall)
npm start            # http://localhost:3000
```

Open `http://localhost:3000` in a browser. Camera access works on `localhost`.

### Use it on a phone

Phones only allow camera access over **HTTPS**. Choose one:

- **Tunnel (quickest)**: `npx cloudflared tunnel --url http://localhost:3000` or ngrok, then open the HTTPS URL.
- **Built-in HTTPS**: create a certificate and run
  `TLS_CERT=cert.pem TLS_KEY=key.pem npm start`, then open `https://<your-lan-ip>:3000`.
- Then on the phone: **Share → Add to Home Screen** (iOS) or the browser's **Install app** (Android).

### Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP(S) port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | SQLite DB and face thumbnails |
| `TRILL_API_KEY` | _(unset)_ | If set, every API call requires header `x-api-key` |
| `TLS_CERT` / `TLS_KEY` | _(unset)_ | PEM files to serve HTTPS directly |

If you expose the server beyond your own network, set `TRILL_API_KEY` and use HTTPS.

## Project layout

```
server/
  index.js        Express app: static PWA, API, HTTPS option
  routes.js       REST API (people, faces, gallery, events, stats)
  db.js           SQLite schema and helpers
client/
  index.html, css/styles.css, manifest.webmanifest, sw.js, icons/
  vendor/face-api.js     browser bundle (copied at install)
  models/                face detection / landmark / recognition weights (copied at install)
  js/
    app.js        router, navigation, boot, connectivity
    engine.js     models, detection, matching, tracking, drawing (the core)
    enroll.js     enrollment helpers and "who is this?" dialog
    gallery.js    gallery fetch + offline cache
    events.js     recognition log + offline queue
    api.js, store.js, settings.js, camera.js, util.js
    views/        live, upload, people, log, settings-view
scripts/setup-vendor.js   copies face-api assets into client/
test/api.test.js          end-to-end API tests
```

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Liveness, and whether an API key is required (public) |
| GET | `/api/stats` | Counts: people, samples, events, events today |
| GET / POST | `/api/people` | List / create (`name`, `notes`, `color`) |
| GET / PATCH / DELETE | `/api/people/:id` | Read / update / delete (cascades to samples) |
| GET / POST | `/api/people/:id/faces` | List / add sample (`descriptor[128]`, optional `image` data URL) |
| GET / DELETE | `/api/faces/:id/thumb`, `/api/faces/:id` | Thumbnail / delete sample |
| GET | `/api/gallery` | All descriptors grouped by person (device sync) |
| GET / POST / DELETE | `/api/events` | Recognition log |

## Tests

```bash
npm test
```

Runs 12 API tests against a real server instance: auth, validation, conflicts, enrollment,
gallery float round-trip, rename propagation, cascade delete, and static/PWA assets.

## Accuracy notes

- Use 3–5 samples per person, from different angles and lighting. This matters more than any tuning.
- Default threshold is 0.50 (face-api's own default is 0.60). Lower it if you see false matches.
- For small or distant faces, switch the detector to **Accurate** in Settings.
- Recognition quality depends on image quality. Poor lighting, heavy occlusion, or very small faces reduce it.

## Privacy

Face embeddings and thumbnails stay on your server. Recognition itself runs on the device.
Sample thumbnails are served only with the API key when one is configured.
Check local laws (for example GDPR or BIPA) before recognizing people who haven't consented.
