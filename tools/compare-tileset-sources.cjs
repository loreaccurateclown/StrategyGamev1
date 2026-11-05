/**
 * Renders the same test layout twice — once sourcing each tile from the
 * individual `Tiles/tile_NNNN.png` files, once from the contiguous
 * `Tilemap/tilemap.png` — and stacks them into a single comparison PNG.
 *
 * Why: the contiguous sheet is sliced with 1 px spacing, and several coast
 * tiles appeared to carry stray pixels from neighbouring tiles. The individual
 * PNGs are the author's per-tile exports, so diffing the two renderings shows
 * whether those strays are real art or slicing artefacts.
 *
 * The decoder handles indexed PNGs at bit depths 1/2/4/8 because Kenney's
 * per-tile exports are palette-optimised (some are 2-bit, some RGBA).
 *
 * Usage: node tools/compare-tileset-sources.cjs [scale]
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const TILE = 16;
const SPACING = 1;
const COLUMNS = 18;
const SCALE = Math.max(1, Math.floor(Number(process.argv[2] ?? 6) || 6));

const ROOT = path.join(__dirname, "..", "assets", "import", "kenney_tiny-battle");
const SHEET_PATH = path.join(ROOT, "Tilemap", "tilemap.png");
const TILES_DIR = path.join(ROOT, "Tiles");

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

  const isIndexed = colorType === 3;
  const isGrey = colorType === 0;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  if (!isIndexed && bitDepth !== 8) {
    throw new Error(`Unsupported bit depth ${bitDepth} for colour type ${colorType}`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  // Bytes per pixel row, rounded up for sub-byte depths.
  const bitsPerPixel = channels * bitDepth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8)); // filter byte offset unit
  const out = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = previous[x];
      const c = x >= bpp ? previous[x - bpp] : 0;
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
      const dst = (y * width + x) * 4;
      if (isIndexed) {
        let index;
        if (bitDepth === 8) {
          index = line[x];
        } else {
          const pixelBit = x * bitDepth;
          const byte = line[pixelBit >> 3];
          const shift = 8 - bitDepth - (pixelBit & 7);
          index = (byte >> shift) & ((1 << bitDepth) - 1);
        }
        const entry = index * 3;
        out[dst] = palette[entry];
        out[dst + 1] = palette[entry + 1];
        out[dst + 2] = palette[entry + 2];
        out[dst + 3] = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] : 255;
      } else if (isGrey) {
        out[dst] = line[x];
        out[dst + 1] = line[x];
        out[dst + 2] = line[x];
        out[dst + 3] = 255;
      } else {
        const src = x * channels;
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
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- tile sources -----------------------------------------------------------

const sheet = decodePng(fs.readFileSync(SHEET_PATH));

/** Reads one tile out of the contiguous sheet (18 cols, 1 px spacing). */
function sheetTile(gid) {
  const index = gid - 1;
  const sx = (index % COLUMNS) * (TILE + SPACING);
  const sy = Math.floor(index / COLUMNS) * (TILE + SPACING);
  const out = Buffer.alloc(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const s = ((sy + y) * sheet.width + (sx + x)) * 4;
      const d = (y * TILE + x) * 4;
      out[d] = sheet.pixels[s];
      out[d + 1] = sheet.pixels[s + 1];
      out[d + 2] = sheet.pixels[s + 2];
      out[d + 3] = sheet.pixels[s + 3];
    }
  }
  return out;
}

const indivCache = new Map();
/** Reads one tile out of its individual Tiles/tile_NNNN.png file. */
function indivTile(gid) {
  if (indivCache.has(gid)) return indivCache.get(gid);
  const file = path.join(TILES_DIR, `tile_${String(gid - 1).padStart(4, "0")}.png`);
  const img = decodePng(fs.readFileSync(file));
  if (img.width !== TILE || img.height !== TILE) {
    throw new Error(`${file} is ${img.width}x${img.height}, expected ${TILE}x${TILE}`);
  }
  indivCache.set(gid, img.pixels);
  return img.pixels;
}

// --- test layout ------------------------------------------------------------

const GRASS = 1;
const WATER = 38;
const CORNERS = { tl: 19, tr: 21, bl: 22, br: 23 };
const EDGES = { n: 20, s: 56, w: 37, e: 39 };
const COLS = 13;
const ROWS = 9;

function buildLayout() {
  const cells = new Array(COLS * ROWS).fill(GRASS);
  const rect = { x: 2, y: 2, w: 8, h: 5 };
  for (let r = rect.y; r < rect.y + rect.h; r++) {
    for (let c = rect.x; c < rect.x + rect.w; c++) {
      const top = r === rect.y;
      const bottom = r === rect.y + rect.h - 1;
      const left = c === rect.x;
      const right = c === rect.x + rect.w - 1;
      let gid = WATER;
      if (top && left) gid = CORNERS.tl;
      else if (top && right) gid = CORNERS.tr;
      else if (bottom && left) gid = CORNERS.bl;
      else if (bottom && right) gid = CORNERS.br;
      else if (top) gid = EDGES.n;
      else if (bottom) gid = EDGES.s;
      else if (left) gid = EDGES.w;
      else if (right) gid = EDGES.e;
      cells[r * COLS + c] = gid;
    }
  }
  return cells;
}

function render(cells, sourceFn) {
  const w = COLS * TILE;
  const h = ROWS * TILE;
  const img = Buffer.alloc(w * h * 4);
  for (let i = 0; i < img.length; i += 4) {
    img[i] = 0x1d;
    img[i + 1] = 0x1d;
    img[i + 2] = 0x1d;
    img[i + 3] = 0xff;
  }
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const gid = cells[row * COLS + col];
      const tile = sourceFn(gid);
      const dx = col * TILE;
      const dy = row * TILE;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const s = (y * TILE + x) * 4;
          const a = tile[s + 3];
          if (a === 0) continue;
          const d = ((dy + y) * w + (dx + x)) * 4;
          img[d] = tile[s];
          img[d + 1] = tile[s + 1];
          img[d + 2] = tile[s + 2];
          img[d + 3] = 255;
        }
      }
    }
  }
  return { w, h, img };
}

const cells = buildLayout();
const fromSheet = render(cells, sheetTile);
const fromIndiv = render(cells, indivTile);

// Stack: individual on top, contiguous sheet below, 4 px divider.
const GAP = 4;
const totalW = fromSheet.w;
const totalH = fromIndiv.h + GAP + fromSheet.h;
const stacked = Buffer.alloc(totalW * totalH * 4);
for (let i = 0; i < stacked.length; i += 4) {
  stacked[i] = 0xff;
  stacked[i + 1] = 0x00;
  stacked[i + 2] = 0x00;
  stacked[i + 3] = 0xff;
}
fromIndiv.img.copy(stacked, 0);
fromSheet.img.copy(stacked, (fromIndiv.h + GAP) * totalW * 4);

// Nearest-neighbour upscale.
const uw = totalW * SCALE;
const uh = totalH * SCALE;
const up = Buffer.alloc(uw * uh * 4);
for (let y = 0; y < uh; y++) {
  const srcRow = Math.floor(y / SCALE) * totalW * 4;
  for (let x = 0; x < uw; x++) {
    const s = srcRow + Math.floor(x / SCALE) * 4;
    const d = (y * uw + x) * 4;
    up[d] = stacked[s];
    up[d + 1] = stacked[s + 1];
    up[d + 2] = stacked[s + 2];
    up[d + 3] = stacked[s + 3];
  }
}

const outPath = path.join(__dirname, "previews", "compare-indiv-vs-sheet.png");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, encodePng(uw, uh, up));
console.log(`wrote ${outPath}  ${uw}x${uh}px  (top = individual tiles, bottom = contiguous sheet, red divider)`);
