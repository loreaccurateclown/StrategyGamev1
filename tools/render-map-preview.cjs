/**
 * Renders a generated map JSON + the Kenney tileset into a PNG, without a
 * browser or Phaser. Composites every non-collision layer in file order, the
 * same way BattleScene does.
 *
 * Usage:
 *   node tools/render-map-preview.cjs [map.json] [--scale N]
 *
 * Defaults: public/assets/maps/level_01.json, scale 2 (nearest-neighbour).
 * Output: tools/map-preview.png (gitignored).
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

// ---------------------------------------------------------------------------
// PNG decoding (same hand-rolled decoder as tools/tile-rgb.cjs — the Kenney
// sheet is an indexed PNG, colourType 3, with PLTE/tRNS).
// ---------------------------------------------------------------------------

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = null;
  let paletteAlpha = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") paletteAlpha = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`Unsupported bit depth ${bitDepth}`);
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
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      } else if (filter !== 0) throw new Error(`Bad filter ${filter}`);
    }
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      if (isIndexed) {
        const entry = line[src] * 3;
        out[dst] = palette[entry];
        out[dst + 1] = palette[entry + 1];
        out[dst + 2] = palette[entry + 2];
        out[dst + 3] = paletteAlpha && line[src] < paletteAlpha.length ? paletteAlpha[line[src]] : 255;
      } else {
        out[dst] = line[src];
        out[dst + 1] = line[src + 1];
        out[dst + 2] = line[src + 2];
        out[dst + 3] = channels === 4 ? line[src + 3] : 255;
      }
    }
    previous = line;
  }
  return { width, height, pixels: out };
}

// ---------------------------------------------------------------------------
// PNG encoding (RGB8, filter 0 — zlib is Node's built-in).
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const b of buffer) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Map compositing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const mapArg = args.find((a) => !a.startsWith("--"));
const scaleArg = args.find((a) => a.startsWith("--scale"));
const scale = Math.max(1, Math.floor(Number((scaleArg ?? "--scale=2").split("=")[1] ?? 2) || 2));

const MAP_PATH = mapArg
  ? path.resolve(mapArg)
  : path.join(__dirname, "..", "public", "assets", "maps", "level_01.json");

const map = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));
const tileset = map.tilesets[0];
if (!tileset) throw new Error("map has no tileset");

const pngPath = path.join(path.dirname(MAP_PATH), tileset.image);
const sheet = decodePng(fs.readFileSync(pngPath));

const tileW = map.tilewidth;
const tileH = map.tileheight;
const margin = tileset.margin ?? 0;
const spacing = tileset.spacing ?? 0;
const columns = tileset.columns;
const firstgid = tileset.firstgid ?? 1;

const boardW = map.width;
const boardH = map.height;
const outW = boardW * tileW;
const outH = boardH * tileH;
// Background colour matches main.ts (only visible through transparent pixels,
// e.g. the partially transparent forest canopy corners).
const board = Buffer.alloc(outW * outH * 4);
for (let i = 0; i < board.length; i += 4) {
  board[i] = 0x1d;
  board[i + 1] = 0x1d;
  board[i + 2] = 0x1d;
  board[i + 3] = 0xff;
}

let rendered = 0;
let skipped = 0;
for (const layer of map.layers) {
  if (layer.type !== "tilelayer") continue;
  if (layer.name.includes("collisions")) {
    skipped++;
    continue;
  }
  rendered++;
  for (let i = 0; i < layer.data.length; i++) {
    const gid = layer.data[i];
    if (gid === 0) continue;
    const tileIndex = gid - firstgid;
    if (tileIndex < 0) throw new Error(`gid ${gid} < firstgid ${firstgid} in "${layer.name}"`);
    const sx = margin + (tileIndex % columns) * (tileW + spacing);
    const sy = margin + Math.floor(tileIndex / columns) * (tileH + spacing);
    const dx = (i % boardW) * tileW;
    const dy = Math.floor(i / boardW) * tileH;
    for (let y = 0; y < tileH; y++) {
      for (let x = 0; x < tileW; x++) {
        const s = ((sy + y) * sheet.width + (sx + x)) * 4;
        const a = sheet.pixels[s + 3];
        if (a === 0) continue;
        const d = ((dy + y) * outW + (dx + x)) * 4;
        if (a === 255) {
          board[d] = sheet.pixels[s];
          board[d + 1] = sheet.pixels[s + 1];
          board[d + 2] = sheet.pixels[s + 2];
        } else {
          const inv = 255 - a;
          board[d] = (sheet.pixels[s] * a + board[d] * inv) / 255;
          board[d + 1] = (sheet.pixels[s + 1] * a + board[d + 1] * inv) / 255;
          board[d + 2] = (sheet.pixels[s + 2] * a + board[d + 2] * inv) / 255;
        }
      }
    }
  }
}

// Nearest-neighbour integer upscale.
let finalBoard = board;
let finalW = outW;
let finalH = outH;
if (scale > 1) {
  finalW = outW * scale;
  finalH = outH * scale;
  finalBoard = Buffer.alloc(finalW * finalH * 4);
  for (let y = 0; y < finalH; y++) {
    const sy = Math.floor(y / scale) * outW * 4;
    const dy = y * finalW * 4;
    for (let x = 0; x < finalW; x++) {
      const s = sy + Math.floor(x / scale) * 4;
      finalBoard[dy + x * 4] = board[s];
      finalBoard[dy + x * 4 + 1] = board[s + 1];
      finalBoard[dy + x * 4 + 2] = board[s + 2];
      finalBoard[dy + x * 4 + 3] = board[s + 3];
    }
  }
}

const outPath = path.join(__dirname, "map-preview.png");
fs.writeFileSync(outPath, encodePng(finalW, finalH, finalBoard));
console.log(
  `Rendered ${rendered} layers (${skipped} collision skipped): ` +
    `${boardW}x${boardH} @ ${tileW}px -> ${finalW}x${finalH}px (scale ${scale})`
);
console.log(`Wrote ${path.relative(path.join(__dirname, ".."), outPath)}`);
