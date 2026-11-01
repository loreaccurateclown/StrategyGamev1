/**
 * Renders three horizontal-bridge treatments over a water strait so the user
 * can pick the one that reads best as a bridge.
 *
 *   A = gid 131 (plain bridge)
 *   B = gid 149 (deck underside with struts)
 *   C = gid 149 deck + gid 74 (water with pillar reflections) directly beneath
 *
 * Output: tools/tiles/bridge-compare.png
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const TILE = 16;
const SPACING = 1;
const COLUMNS = 18;
const SCALE = 5;
const SHEET = path.join(__dirname, "..", "assets", "import", "kenney_tiny-battle", "Tilemap", "tilemap.png");

function decodePng(buffer) {
  let offset = 8, width = 0, height = 0, colorType = 0, palette = null, paletteAlpha = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "PLTE") palette = data;
    else if (type === "tRNS") paletteAlpha = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const isIndexed = colorType === 3;
  const channels = colorType === 6 ? 4 : colorType === 3 ? 1 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 0xff;
      else if (filter === 2) line[x] = (line[x] + b) & 0xff;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      if (isIndexed) {
        const e = line[s] * 3;
        out[d] = palette[e]; out[d + 1] = palette[e + 1]; out[d + 2] = palette[e + 2];
        out[d + 3] = paletteAlpha && line[s] < paletteAlpha.length ? paletteAlpha[line[s]] : 255;
      } else {
        out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2];
        out[d + 3] = channels === 4 ? line[s + 3] : 255;
      }
    }
    previous = line;
  }
  return { width, height, pixels: out };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}

const sheet = decodePng(fs.readFileSync(SHEET));
function blit(gid, flipH, flipV, img, dx, dy, w) {
  const idx = gid - 1;
  const sx = (idx % COLUMNS) * (TILE + SPACING);
  const sy = Math.floor(idx / COLUMNS) * (TILE + SPACING);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const fx = flipH ? TILE - 1 - x : x;
    const fy = flipV ? TILE - 1 - y : y;
    const s = ((sy + fy) * sheet.width + (sx + fx)) * 4;
    const a = sheet.pixels[s + 3];
    if (a === 0) continue;
    const d = ((dy + y) * w + (dx + x)) * 4;
    img[d] = sheet.pixels[s]; img[d + 1] = sheet.pixels[s + 1]; img[d + 2] = sheet.pixels[s + 2]; img[d + 3] = 255;
  }
}

// 21 x 7 panel: grass sides, water strait in middle, road crossing at row 3.
function bridgePanel(bridgeGid, reflection) {
  const COLS = 21, ROWS = 7;
  const w = COLS * TILE, h = ROWS * TILE;
  const img = Buffer.alloc(w * h * 4);
  for (let i = 0; i < img.length; i += 4) { img[i] = 0x1d; img[i + 1] = 0x1d; img[i + 2] = 0x1d; img[i + 3] = 0xff; }
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    let gid = 1; // grass
    if (x >= 8 && x <= 12) gid = 38; // water strait
    if (y === 3) gid = 111; // horizontal road
    // bridge over water
    if (y === 3 && x >= 8 && x <= 12) gid = bridgeGid;
    // reflection water beneath the deck
    if (reflection && y === 4 && x >= 8 && x <= 12) gid = 74;
    blit(gid, false, false, img, x * TILE, y * TILE, w);
  }
  return { w, h, img };
}

const A = bridgePanel(131, false);
const B = bridgePanel(149, false);
const C = bridgePanel(149, true);
const gap = 8;
const totalW = A.w;
const totalH = A.h * 3 + gap * 2;
const out = Buffer.alloc(totalW * totalH * 4);
for (let i = 0; i < out.length; i += 4) { out[i] = 0xff; out[i + 1] = 0xff; out[i + 2] = 0xff; out[i + 3] = 0xff; }
A.img.copy(out, 0);
B.img.copy(out, (A.h + gap) * totalW * 4);
C.img.copy(out, (A.h + gap) * 2 * totalW * 4);

const uw = totalW * SCALE, uh = totalH * SCALE;
const up = Buffer.alloc(uw * uh * 4);
for (let y = 0; y < uh; y++) {
  const srcRow = Math.floor(y / SCALE) * totalW * 4;
  for (let x = 0; x < uw; x++) {
    const s = srcRow + Math.floor(x / SCALE) * 4;
    const d = (y * uw + x) * 4;
    up[d] = out[s]; up[d + 1] = out[s + 1]; up[d + 2] = out[s + 2]; up[d + 3] = out[s + 3];
  }
}
const outPath = path.join(__dirname, "tiles", "bridge-compare.png");
fs.writeFileSync(outPath, encodePng(uw, uh, up));
console.log("wrote " + outPath + "  (top=A:131, middle=B:149, bottom=C:149+74 reflection)");
