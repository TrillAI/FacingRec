// Copies the face-api browser bundle and model weights into client/ so the PWA
// can serve them itself (and cache them offline). Safe to re-run.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', '@vladmandic', 'face-api');
const clientVendor = path.join(root, 'client', 'vendor');
const clientModels = path.join(root, 'client', 'models');

if (!fs.existsSync(src)) {
  console.log('[setup-vendor] @vladmandic/face-api not installed yet; skipping');
  process.exit(0);
}
fs.mkdirSync(clientVendor, { recursive: true });
fs.mkdirSync(clientModels, { recursive: true });
fs.copyFileSync(path.join(src, 'dist', 'face-api.js'), path.join(clientVendor, 'face-api.js'));
for (const f of fs.readdirSync(path.join(src, 'model'))) {
  fs.copyFileSync(path.join(src, 'model', f), path.join(clientModels, f));
}
console.log('[setup-vendor] face-api bundle and models copied to client/');
