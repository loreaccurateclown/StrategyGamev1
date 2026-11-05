/**
 * Renders the shoreline autotile truth table.
 *
 * Every one of the 16 four-neighbour cases is drawn IN CONTEXT: a 5x5 patch of
 * the map where the centre tile is the water cell, and grass is placed on the
 * sides named by the mask bits (N=8, S=4, W=2, E=1). Each patch is labelled with
 * its mask key in hex, and outlined red when the tileset has no art for it.
 *
 * The point of the context is that a shore tile is meaningless on its own — the
 * question is whether the bank lines up with the grass next to it.
 *
 * Usage: node tools/render-shore-mask.cjs [--scale 3]
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const palette = require("../assets/generator/palette.json");
const { shoreGid, SHORE_CASES } = require("../scripts/lib/shore-mask.cjs");

const TILE = 16;
const SPACING = 1;
const COLUMNS = 18;
const SHEET = path.join(__dirname, "..", "assets", "import", "kenney_tiny-battle", "Tilemap", "tilemap.png");
const OUT = path.join(__dirname, "previews", "shore-mask.png");

const GRASS = 1;
const WATER_FILL = palette.terrain.water.fill;
const FLIP_H = palette.flipFlags.horizontal;
const FLIP_V = palette.flipFlags.vertical;
const GID_MASK = palette.gidMask;

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? Number(process.argv[at + 1]) : fallback;
}

const SCALE = flag("scale", 3);
const PATCH_TILES = 5;
const PATCH = PATCH_TILES * TILE * SCALE;
const GUTTER = 12;
const LABEL_H = 22;
const CELL = PATCH + LABEL_H;
const COLS = 4;
const ROWS = 4;
const WIDTH = COLS * PATCH + (COLS + 1) * GUTTER;
const HEIGHT = ROWS * CELL + (ROWS + 1) * GUTTER;

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let paletteData = null;
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
    } else if (type === "PLTE") paletteData = data;
    else if (type === "tRNS") paletteAlpha = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const isIndexed = colorType === 3;
  const channels = isIndexed ? 1 : colorType === 6 ? 4 : 3;
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
      } else if (filter !== 0) throw new Error(`bad filter ${filter}`);
    }
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      if (isIndexed) {
        const entry = line[src] * 3;
        out[dst] = paletteData[entry];
        out[dst + 1] = paletteData[entry + 1];
        out[dst + 2] = paletteData[entry + 2];
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

const sheet = decodePng(fs.readFileSync(SHEET));

const canvas = Buffer.alloc(WIDTH * HEIGHT * 4);
function setPixel(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const i = (y * WIDTH + x) * 4;
  canvas[i] = r;
  canvas[i + 1] = g;
  canvas[i + 2] = b;
  canvas[i + 3] = 255;
}
for (let i = 0; i < WIDTH * HEIGHT; i++) {
  canvas[i * 4] = 32;
  canvas[i * 4 + 1] = 34;
  canvas[i * 4 + 2] = 42;
  canvas[i * 4 + 3] = 255;
}

function fillRect(x, y, w, h, r, g, b) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPixel(xx, yy, r, g, b);
}

/** Blits one tile, honouring Tiled's flip flags. */
function drawTile(gid, originX, originY) {
  const flippedH = (gid & FLIP_H) !== 0;
  const flippedV = (gid & FLIP_V) !== 0;
  const base = gid & GID_MASK;
  const index = base - 1;
  const sx = (index % COLUMNS) * (TILE + SPACING);
  const sy = Math.floor(index / COLUMNS) * (TILE + SPACING);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const tx = sx + (flippedH ? TILE - 1 - x : x);
      const ty = sy + (flippedV ? TILE - 1 - y : y);
      const src = (ty * sheet.width + tx) * 4;
      const alpha = sheet.pixels[src + 3];
      const dstX = originX + x * SCALE;
      const dstY = originY + y * SCALE;
      if (alpha < 32) continue;
      fillRect(dstX, dstY, SCALE, SCALE, sheet.pixels[src], sheet.pixels[src + 1], sheet.pixels[src + 2]);
    }
  }
}

// 3x5 hex digits, so each patch can be labelled with its mask key without
// dragging in the full bitmap font from render-labeled-map.cjs.
const GLYPHS = {
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "001", "001", "001"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
};

function drawText(text, x, y, scale, r, g, b) {
  let cursor = x;
  for (const char of text) {
    const glyph = GLYPHS[char];
    if (glyph) {
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 3; gx++) {
          if (glyph[gy][gx] === "1") fillRect(cursor + gx * scale, y + gy * scale, scale, scale, r, g, b);
        }
      }
    }
    cursor += 4 * scale;
  }
}

const table = [];
for (let key = 0; key <= 15; key++) {
  const col = key % COLS;
  const row = Math.floor(key / COLS);
  const x0 = GUTTER + col * (PATCH + GUTTER);
  const y0 = GUTTER + row * (CELL + GUTTER);

  const land = { n: (key & 8) !== 0, s: (key & 4) !== 0, w: (key & 2) !== 0, e: (key & 1) !== 0 };
  const centre = shoreGid(land);

  // Context: open water everywhere, grass on the land sides, centre tile on top.
  for (let ty = 0; ty < PATCH_TILES; ty++) {
    for (let tx = 0; tx < PATCH_TILES; tx++) {
      drawTile(WATER_FILL, x0 + tx * TILE * SCALE, y0 + ty * TILE * SCALE);
    }
  }
  const neighbours = [
    { isLand: land.n, tx: 2, ty: 1 },
    { isLand: land.s, tx: 2, ty: 3 },
    { isLand: land.w, tx: 1, ty: 2 },
    { isLand: land.e, tx: 3, ty: 2 },
  ];
  for (const n of neighbours) {
    if (n.isLand) drawTile(GRASS, x0 + n.tx * TILE * SCALE, y0 + n.ty * TILE * SCALE);
  }
  drawTile(centre, x0 + 2 * TILE * SCALE, y0 + 2 * TILE * SCALE);

  const entry = SHORE_CASES[key];
  const outline = entry.exact ? [64, 92, 72] : [150, 58, 58];
  fillRect(x0 - 2, y0 - 2, PATCH + 4, 2, ...outline);
  fillRect(x0 - 2, y0 + PATCH, PATCH + 4, 2, ...outline);
  fillRect(x0 - 2, y0 - 2, 2, PATCH + 4, ...outline);
  fillRect(x0 + PATCH, y0 - 2, 2, PATCH + 4, ...outline);

  const label = key.toString(16).toUpperCase().padStart(2, "0");
  drawText(label, x0, y0 + PATCH + 6, 2, entry.exact ? 190 : 220, entry.exact ? 210 : 150, entry.exact ? 190 : 120);
  table.push({ key, label, gid: centre & GID_MASK, name: entry.name, exact: entry.exact });
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, encodePng(WIDTH, HEIGHT, canvas));

console.log(`wrote ${path.relative(process.cwd(), OUT)}  ${WIDTH}x${HEIGHT}  @${SCALE}x`);
console.log("");
console.log("key  N S W E   gid  art      case");
for (const row of table) {
  const bits = [8, 4, 2, 1].map((bit) => (row.key & bit ? "L" : ".")).join(" ");
  console.log(
    ` ${row.label}  ${bits}   ${String(row.gid).padStart(3)}  ${row.exact ? "exact" : "APPROX"}   ${row.name}`,
  );
}
const approx = table.filter((row) => !row.exact).length;
console.log("");
console.log(`${approx} of 16 cases have no dedicated art (L = land neighbour).`);
