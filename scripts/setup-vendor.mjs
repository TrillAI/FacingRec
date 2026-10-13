// Copies the face-api browser bundle and model weights into public/ AND trill-face-rec/client/
// so both the Vite React app and the Trill PWA can serve them and cache them offline.
// Also generates valid 192x192, 512x512, maskable-512, and apple-touch-icon PNGs.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', '@vladmandic', 'face-api');

function copyFaceApiTo(baseDir) {
  const vendorDir = path.join(baseDir, 'vendor');
  const modelsDir = path.join(baseDir, 'models');
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.mkdirSync(modelsDir, { recursive: true });

  if (fs.existsSync(path.join(src, 'dist', 'face-api.js'))) {
    fs.copyFileSync(path.join(src, 'dist', 'face-api.js'), path.join(vendorDir, 'face-api.js'));
  }
  const modelSrc = path.join(src, 'model');
  if (fs.existsSync(modelSrc)) {
    for (const f of fs.readdirSync(modelSrc)) {
      fs.copyFileSync(path.join(modelSrc, f), path.join(modelsDir, f));
    }
  }
}

// Minimal pure-Node PNG generator for crisp geometric Trill Face Rec icons
function createPngBuffer(width, height, drawPixel) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const combined = Buffer.concat([typeBuf, data]);
    crcBuf.writeUInt32BE(crc32(combined), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawPixel(x, y, width, height);
      const idx = rowStart + 1 + x * 4;
      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = a;
    }
  }

  const idat = zlib.deflateSync(raw);
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', iend),
  ]);
}

function renderTrillIcon(size, maskable = false) {
  return createPngBuffer(size, size, (x, y, w, h) => {
    const nx = x / w;
    const ny = y / h;
    // Deep slate background (#0a0f1c -> #111a2e gradient)
    const bgR = Math.round(10 + ny * 8);
    const bgG = Math.round(15 + ny * 14);
    const bgB = Math.round(28 + ny * 22);

    const pad = maskable ? 0.24 : 0.16;
    const minB = pad;
    const maxB = 1 - pad;
    const stroke = maskable ? 0.045 : 0.055;
    const cornerLen = 0.14;

    // Corner brackets (sky blue #38bdf8 to indigo #6366f1)
    const inBoxX = nx >= minB && nx <= maxB;
    const inBoxY = ny >= minB && ny <= maxB;
    const nearLeft = nx >= minB && nx <= minB + stroke;
    const nearRight = nx <= maxB && nx >= maxB - stroke;
    const nearTop = ny >= minB && ny <= minB + stroke;
    const nearBottom = ny <= maxB && ny >= maxB - stroke;

    const cornerH = (nx >= minB && nx <= minB + cornerLen) || (nx <= maxB && nx >= maxB - cornerLen);
    const cornerV = (ny >= minB && ny <= minB + cornerLen) || (ny <= maxB && ny >= maxB - cornerLen);

    const isBracket =
      inBoxX &&
      inBoxY &&
      (((nearLeft || nearRight) && cornerV) || ((nearTop || nearBottom) && cornerH));

    if (isBracket) {
      return [56, 189, 248, 255]; // #38bdf8
    }

    // Center biometric reticle nodes
    const cx = 0.5;
    const cy = 0.5;
    const distCenter = Math.hypot(nx - cx, ny - cy);
    if (distCenter >= 0.11 && distCenter <= 0.145) {
      return [99, 102, 241, 255]; // #6366f1
    }
    if (distCenter <= 0.045) {
      return [34, 197, 94, 255]; // #22c55e match dot
    }

    return [bgR, bgG, bgB, 255];
  });
}

function writeIconsTo(iconsDir) {
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), renderTrillIcon(192, false));
  fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), renderTrillIcon(512, false));
  fs.writeFileSync(path.join(iconsDir, 'maskable-512.png'), renderTrillIcon(512, true));
  fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.png'), renderTrillIcon(180, false));
}

if (fs.existsSync(src)) {
  copyFaceApiTo(path.join(root, 'public'));
  copyFaceApiTo(path.join(root, 'trill-face-rec', 'client'));
  console.log('[setup-vendor] face-api bundle and models copied to public/ and trill-face-rec/client/');
} else {
  console.log('[setup-vendor] @vladmandic/face-api not installed yet; skipping model copy');
}

writeIconsTo(path.join(root, 'public', 'icons'));
writeIconsTo(path.join(root, 'trill-face-rec', 'client', 'icons'));

// Copy manifest and sw.js to public/ as well
const clientManifest = path.join(root, 'trill-face-rec', 'client', 'manifest.webmanifest');
if (fs.existsSync(clientManifest)) {
  fs.copyFileSync(clientManifest, path.join(root, 'public', 'manifest.webmanifest'));
}
const clientSw = path.join(root, 'trill-face-rec', 'client', 'sw.js');
if (fs.existsSync(clientSw)) {
  fs.copyFileSync(clientSw, path.join(root, 'public', 'sw.js'));
}
console.log('[setup-vendor] PWA icons, manifest, and service worker synchronized.');
