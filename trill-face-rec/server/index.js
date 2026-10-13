// Trill Face Rec server: serves the PWA and the REST API.
'use strict';

const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const compression = require('compression');
const apiRouter = require('./routes');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_DIR = path.join(__dirname, '..', 'client');

const app = express();
app.disable('x-powered-by');
app.set('etag', 'strong');
app.use(compression());
app.use(express.json({ limit: '2mb' }));

// Security headers. Camera is allowed only for same origin.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});

app.use('/api', apiRouter);

// Service worker and manifest must never be served stale.
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.set('Service-Worker-Allowed', '/');
  res.type('application/javascript').sendFile(path.join(CLIENT_DIR, 'sw.js'));
});

app.use('/models', express.static(path.join(CLIENT_DIR, 'models'), {
  maxAge: '7d', immutable: false,
}));

app.use(express.static(CLIENT_DIR, {
  extensions: ['html'],
  setHeaders(res, file) {
    if (file.endsWith('.html') || file.endsWith('.webmanifest')) {
      res.set('Cache-Control', 'no-cache');
    } else {
      res.set('Cache-Control', 'public, max-age=3600');
    }
  },
}));

// Anything else -> app shell (hash-based routing lives client-side).
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

let server;
const certPath = process.env.TLS_CERT;
const keyPath = process.env.TLS_KEY;
if (certPath && keyPath) {
  server = https.createServer({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  }, app);
} else {
  server = http.createServer(app);
}

server.listen(PORT, HOST, () => {
  const scheme = server instanceof https.Server ? 'https' : 'http';
  console.log(`Trill Face Rec running at ${scheme}://localhost:${PORT}`);
  if (scheme === 'http') {
    console.log('Note: phones need HTTPS for camera access. Set TLS_CERT and TLS_KEY, or use a tunnel.');
  }
  if (process.env.TRILL_API_KEY) console.log('API key protection: ON');
});
