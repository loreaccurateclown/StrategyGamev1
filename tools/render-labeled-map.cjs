/**
 * Renders a generated board as plain tiles (no terrain colouring) with text
 * labels drawn on top: coordinate rulers, water-body captions, and a bridge
 * caption. Composites in memory from a seed, so the committed map JSON is
 * never touched and no existing preview is overwritten.
 *
 * Usage:
 *   node tools/render-labeled-map.cjs [--seed N] [--width N] [--height N] [--scale N]
 *   node tools/render-labeled-map.cjs --debug-font      # ASCII-dump sample text
 *
 * Defaults: seed 1234, 64x48, scale 2 (nearest-neighbour).
 * Output: tools/previews/map-labeled-seed<N>.png (gitignored).
 *
 * Decoding/encoding helpers are duplicated per-tool, matching the other
 * render-*.cjs scripts.
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const { installSeededRandom } = require("../scripts/lib/prng.cjs");
const { compose } = require("../scripts/lib/compose-map.cjs");

// ---------------------------------------------------------------------------
// Bitmap font: 5x7 uppercase, filled with '#' and blank with '.'
// ---------------------------------------------------------------------------

const FONT_SRC = `
A
.###.
#...#
#...#
#####
#...#
#...#
#...#
B
####.
#...#
#...#
####.
#...#
#...#
####.
C
.####
#....
#....
#....
#....
#....
.####
D
####.
#...#
#...#
#...#
#...#
#...#
####.
E
#####
#....
#....
####.
#....
#....
#####
F
#####
#....
#....
####.
#....
#....
#....
G
.####
#....
#....
#..##
#...#
#...#
.####
H
#...#
#...#
#...#
#####
#...#
#...#
#...#
I
#####
..#..
..#..
..#..
..#..
..#..
#####
J
....#
....#
....#
....#
#...#
#...#
.###.
K
#...#
#..#.
#.#..
##...
#.#..
#..#.
#...#
L
#....
#....
#....
#....
#....
#....
#####
M
#...#
##.##
#.#.#
#...#
#...#
#...#
#...#
N
#...#
##..#
#.#.#
#..##
#...#
#...#
#...#
O
.###.
#...#
#...#
#...#
#...#
#...#
.###.
P
####.
#...#
#...#
####.
#....
#....
#....
Q
.###.
#...#
#...#
#...#
#.#.#
#..#.
.##.#
R
####.
#...#
#...#
####.
#.#..
#..#.
#...#
S
.####
#....
#....
.###.
....#
....#
####.
T
#####
..#..
..#..
..#..
..#..
..#..
..#..
U
#...#
#...#
#...#
#...#
#...#
#...#
.###.
V
#...#
#...#
#...#
#...#
#...#
.#.#.
..#..
W
#...#
#...#
#...#
#.#.#
#.#.#
##.##
#...#
X
#...#
#...#
.#.#.
..#..
.#.#.
#...#
#...#
Y
#...#
#...#
.#.#.
..#..
..#..
..#..
..#..
Z
#####
....#
...#.
..#..
.#...
#....
#####
0
.###.
#...#
#..##
#.#.#
##..#
#...#
.###.
1
..#..
.##..
..#..
..#..
..#..
..#..
#####
2
.###.
#...#
....#
...#.
..#..
.#...
#####
3
####.
....#
....#
.###.
....#
....#
####.
4
...#.
..##.
.#.#.
#..#.
#####
...#.
...#.
5
#####
#....
####.
....#
....#
#...#
.###.
6
.###.
#....
#....
####.
#...#
#...#
.###.
7
#####
....#
...#.
..#..
.#...
.#...
.#...
8
.###.
#...#
#...#
.###.
#...#
#...#
.###.
9
.###.
#...#
#...#
.####
....#
....#
.###.
-
.....
.....
.....
#####
.....
.....
.....
:
.....
..#..
..#..
.....
..#..
..#..
.....
`;

const FONT = (() => {
  const lines = FONT_SRC.split("\n").slice(1);
  const map = new Map();
  let i = 0;
  while (i < lines.length) {
    if (lines[i] === "") {
      i++;
      continue;
    }
    // A glyph block is: the character, then exactly 7 rows of exactly 5 cells.
    const char = lines[i];
    if (char.length !== 1) throw new Error(`bad glyph header "${char}" at line ${i}`);
    const rows = lines.slice(i + 1, i + 8);
    if (rows.length !== 7) throw new Error(`glyph "${char}" has ${rows.length} rows`);
    for (const row of rows) {
      if (!/^[#.]{5}$/.test(row)) throw new Error(`glyph "${char}" bad row "${row}"`);
    }
    map.set(char, rows);
    i += 8;
  }
  // Space is added in code rather than in FONT_SRC: a glyph header of " " is
  // indistinguishable from a blank separator line once the source is split.
  map.set(" ", Array.from({ length: 7 }, () => "....."));
  return map;
})();

const GLYPH_H = 7;
const GLYPH_W = 5;
const TRACKING = 1;

function textWidth(text) {
  return text.length * (GLYPH_W + TRACKING) - TRACKING;
}

// ---------------------------------------------------------------------------
// PNG helpers (Kenney sheet is indexed: colourType 3 + PLTE/tRNS)
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

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function flag(name, fallback) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}`));
  if (!hit) return fallback;
  const value = Number(hit.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const SEED = flag("seed", 1234);
const BOARD_W = flag("width", 64);
const BOARD_H = flag("height", 48);
const SCALE = flag("scale", 2);

// ---------------------------------------------------------------------------
// Font self-test: dump sample strings as ASCII so glyph parsing is verifiable
// without opening the PNG.
// ---------------------------------------------------------------------------

function dumpText(text) {
  const rows = [];
  for (let r = 0; r < GLYPH_H; r++) {
    let line = "";
    for (const ch of text) {
      const glyph = FONT.get(ch);
      if (!glyph) throw new Error(`no glyph for "${ch}"`);
      line += glyph[r] + (TRACKING ? "." : "");
    }
    rows.push(line);
  }
  return rows;
}

if (process.argv.includes("--debug-font")) {
  console.log(`glyphs loaded: ${FONT.size}`);
  for (const sample of ["WATER 210", "BRIDGE", "SEED 1234", "0123456789"]) {
    console.log("");
    for (const row of dumpText(sample)) console.log(row);
    console.log(`  -> "${sample}" width ${textWidth(sample)}px`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Compose the board in memory
// ---------------------------------------------------------------------------

const restore = installSeededRandom(SEED);
let composed;
try {
  composed = compose(BOARD_W, BOARD_H);
} finally {
  restore();
}

const terrain = composed.terrain;
const visual = composed.visual;
const variations = composed.variations;
if (terrain.length !== BOARD_W * BOARD_H) {
  throw new Error(`terrain length ${terrain.length} != ${BOARD_W * BOARD_H}`);
}

// Water bodies (for captions only - no colouring).
const componentOf = new Int32Array(BOARD_W * BOARD_H).fill(-1);
const bodies = [];
for (let y = 0; y < BOARD_H; y++) {
  for (let x = 0; x < BOARD_W; x++) {
    const i = y * BOARD_W + x;
    if (terrain[i] !== 3 || componentOf[i] !== -1) continue;
    const id = bodies.length;
    let size = 0;
    let sumX = 0;
    let sumY = 0;
    const stack = [i];
    componentOf[i] = id;
    while (stack.length) {
      const cur = stack.pop();
      size++;
      const cx = cur % BOARD_W;
      const cy = (cur - cx) / BOARD_W;
      sumX += cx;
      sumY += cy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= BOARD_W || ny >= BOARD_H) continue;
        const j = ny * BOARD_W + nx;
        if (terrain[j] !== 3 || componentOf[j] !== -1) continue;
        componentOf[j] = id;
        stack.push(j);
      }
    }
    bodies.push({ id, size, cx: sumX / size, cy: sumY / size });
  }
}
bodies.sort((a, b) => b.size - a.size);

// Bridge deck cells: road with water on either side of its axis.
const bridgeCells = [];
for (let y = 0; y < BOARD_H; y++) {
  for (let x = 0; x < BOARD_W; x++) {
    const i = y * BOARD_W + x;
    if (terrain[i] !== 5) continue;
    const above = y > 0 && terrain[i - BOARD_W] === 3;
    const below = y < BOARD_H - 1 && terrain[i + BOARD_W] === 3;
    const left = x > 0 && terrain[i - 1] === 3;
    const right = x < BOARD_W - 1 && terrain[i + 1] === 3;
    if (above || below || left || right) bridgeCells.push(i);
  }
}

// ---------------------------------------------------------------------------
// Tileset
// ---------------------------------------------------------------------------

const palette = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "assets", "generator", "palette.json"), "utf8"),
);
const tileset = palette.tileset;
const sheet = decodePng(
  fs.readFileSync(
    path.join(__dirname, "..", "assets", "import", "kenney_tiny-battle", "Tilemap", "tilemap.png"),
  ),
);

const TILE = tileset.tileSize;
const SPACING = tileset.spacing ?? 1;
const COLUMNS = tileset.columns;

// Margins leave room for the rulers and the footer.
const PAD_L = 20;
const PAD_T = 11;
const PAD_R = 3;
const PAD_B = 13;

const boardPxW = BOARD_W * TILE;
const boardPxH = BOARD_H * TILE;
const imgW = PAD_L + boardPxW + PAD_R;
const imgH = PAD_T + boardPxH + PAD_B;

const pixels = Buffer.alloc(imgW * imgH * 4);
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i] = 0x14;
  pixels[i + 1] = 0x14;
  pixels[i + 2] = 0x18;
  pixels[i + 3] = 0xff;
}

function setPixel(x, y, r, g, b, a = 1) {
  if (x < 0 || y < 0 || x >= imgW || y >= imgH) return;
  const d = (y * imgW + x) * 4;
  pixels[d] = Math.round(pixels[d] * (1 - a) + r * a);
  pixels[d + 1] = Math.round(pixels[d + 1] * (1 - a) + g * a);
  pixels[d + 2] = Math.round(pixels[d + 2] * (1 - a) + b * a);
}

function fillRect(x0, y0, w, h, r, g, b, a = 1) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setPixel(x, y, r, g, b, a);
  }
}

function drawText(text, x0, y0, r = 255, g = 255, b = 255, a = 1) {
  let cursor = x0;
  for (const ch of text) {
    const glyph = FONT.get(ch);
    if (!glyph) {
      cursor += GLYPH_W + TRACKING;
      continue;
    }
    for (let row = 0; row < GLYPH_H; row++) {
      for (let col = 0; col < GLYPH_W; col++) {
        if (glyph[row][col] !== "#") continue;
        setPixel(cursor + col, y0 + row, r, g, b, a);
      }
    }
    cursor += GLYPH_W + TRACKING;
  }
}

// Caption: dark plate behind the text so it reads over any tile.
function drawCaption(text, xCentre, yCentre, r = 255, g = 255, b = 255) {
  const w = textWidth(text);
  const x = Math.round(xCentre - w / 2);
  const y = Math.round(yCentre - GLYPH_H / 2);
  fillRect(x - 2, y - 2, w + 4, GLYPH_H + 4, 0, 0, 0, 0.72);
  drawText(text, x, y, r, g, b, 1);
  return { x, y, w };
}

// ---------------------------------------------------------------------------
// Draw the tiles
// ---------------------------------------------------------------------------

function blitGid(gid, cell) {
  if (!gid) return;
  const flipH = (gid & 0x80000000) !== 0;
  const flipV = (gid & 0x40000000) !== 0;
  const tileIndex = (gid & 0x1fffffff) - 1;
  const sx = (tileIndex % COLUMNS) * (TILE + SPACING);
  const sy = Math.floor(tileIndex / COLUMNS) * (TILE + SPACING);
  const dx = PAD_L + (cell % BOARD_W) * TILE;
  const dy = PAD_T + Math.floor(cell / BOARD_W) * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const fx = flipH ? TILE - 1 - x : x;
      const fy = flipV ? TILE - 1 - y : y;
      const s = ((sy + fy) * sheet.width + (sx + fx)) * 4;
      const alpha = sheet.pixels[s + 3];
      if (alpha === 0) continue;
      const d = ((dy + y) * imgW + (dx + x)) * 4;
      if (alpha === 255) {
        pixels[d] = sheet.pixels[s];
        pixels[d + 1] = sheet.pixels[s + 1];
        pixels[d + 2] = sheet.pixels[s + 2];
      } else {
        const inv = 255 - alpha;
        pixels[d] = (sheet.pixels[s] * alpha + pixels[d] * inv) / 255;
        pixels[d + 1] = (sheet.pixels[s + 1] * alpha + pixels[d + 1] * inv) / 255;
        pixels[d + 2] = (sheet.pixels[s + 2] * alpha + pixels[d + 2] * inv) / 255;
      }
    }
  }
}

for (let i = 0; i < BOARD_W * BOARD_H; i++) {
  blitGid(1, i); // ground: all grass
  blitGid(variations[i], i);
  blitGid(visual[i], i);
}

// Thin board border, so the playfield edge is unambiguous.
fillRect(PAD_L - 1, PAD_T - 1, boardPxW + 2, 1, 0x55, 0x55, 0x60);
fillRect(PAD_L - 1, PAD_T + boardPxH, boardPxW + 2, 1, 0x55, 0x55, 0x60);
fillRect(PAD_L - 1, PAD_T - 1, 1, boardPxH + 2, 0x55, 0x55, 0x60);
fillRect(PAD_L + boardPxW, PAD_T - 1, 1, boardPxH + 2, 0x55, 0x55, 0x60);

// ---------------------------------------------------------------------------
// Rulers: every 8 tiles, labelled with the tile index
// ---------------------------------------------------------------------------

const STEP = 8;
for (let x = 0; x < BOARD_W; x += STEP) {
  const label = String(x);
  const px = PAD_L + x * TILE + 1;
  drawText(label, px, 2, 0x9a, 0x9a, 0xa8);
  // tick mark
  fillRect(PAD_L + x * TILE, PAD_T - 3, 1, 3, 0x55, 0x55, 0x60);
}
for (let y = 0; y < BOARD_H; y += STEP) {
  const label = String(y);
  const py = PAD_T + y * TILE + 1;
  drawText(label, 2, py, 0x9a, 0x9a, 0xa8);
  fillRect(PAD_L - 3, PAD_T + y * TILE, 3, 1, 0x55, 0x55, 0x60);
}

// ---------------------------------------------------------------------------
// Feature captions
// ---------------------------------------------------------------------------

const captions = [];

// Naming rule, so "NORTH" always means the same body on any board:
//   band   = which vertical third the body's centroid falls in (NORTH/MID/SOUTH)
//   suffix = "-1", "-2", ... only when two bodies share a band, ordered by size
// Every caption also prints the cell count, and is drawn at the body's own
// centroid, so a label physically sits on the water it describes.
const bandOf = (body) => {
  const third = BOARD_H / 3;
  if (body.cy < third) return "NORTH";
  if (body.cy > third * 2) return "SOUTH";
  return "MID";
};

const bandCount = new Map();
for (const body of bodies) {
  const band = bandOf(body);
  bandCount.set(band, (bandCount.get(band) ?? 0) + 1);
}

const bandSeen = new Map();
const nameById = new Map();
for (const body of bodies) {
  const band = bandOf(body);
  if (bandCount.get(band) === 1) {
    nameById.set(body.id, band);
    continue;
  }
  const n = (bandSeen.get(band) ?? 0) + 1;
  bandSeen.set(band, n);
  nameById.set(body.id, band + "-" + n);
}

const nameOf = (body) => nameById.get(body.id);

bodies.forEach((body) => {
  const text = "WATER " + nameOf(body) + " " + body.size;
  const px = PAD_L + body.cx * TILE + TILE / 2;
  const py = PAD_T + body.cy * TILE + TILE / 2;
  captions.push({ text, ...drawCaption(text, px, py, 0x8f, 0xe6, 0xff) });
});

if (bridgeCells.length > 0) {
  let sx = 0;
  let sy = 0;
  for (const i of bridgeCells) {
    const cx = i % BOARD_W;
    sx += cx;
    sy += (i - cx) / BOARD_W;
  }
  const px = PAD_L + (sx / bridgeCells.length) * TILE + TILE / 2;
  const py = PAD_T + (sy / bridgeCells.length) * TILE - TILE / 2;
  const text = "BRIDGE " + bridgeCells.length;
  captions.push({ text, ...drawCaption(text, px, py, 0xff, 0xd6, 0x4a) });
}

// Footer.
const footer = "SEED " + SEED + "  " + BOARD_W + "X" + BOARD_H + "  WATER " +
  bodies.reduce((sum, b) => sum + b.size, 0);
drawText(footer, PAD_L, PAD_T + boardPxH + 3, 0x9a, 0x9a, 0xa8);

// ---------------------------------------------------------------------------
// Nearest-neighbour upscale + write
// ---------------------------------------------------------------------------

let finalPixels = pixels;
let finalW = imgW;
let finalH = imgH;
if (SCALE > 1) {
  finalW = imgW * SCALE;
  finalH = imgH * SCALE;
  finalPixels = Buffer.alloc(finalW * finalH * 4);
  for (let y = 0; y < finalH; y++) {
    const sy = Math.floor(y / SCALE) * imgW * 4;
    const dy = y * finalW * 4;
    for (let x = 0; x < finalW; x++) {
      const s = sy + Math.floor(x / SCALE) * 4;
      finalPixels[dy + x * 4] = pixels[s];
      finalPixels[dy + x * 4 + 1] = pixels[s + 1];
      finalPixels[dy + x * 4 + 2] = pixels[s + 2];
      finalPixels[dy + x * 4 + 3] = pixels[s + 3];
    }
  }
}

const OUT_DIR = path.join(__dirname, "previews");
const outPath = path.join(OUT_DIR, `map-labeled-seed${SEED}.png`);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(outPath, encodePng(finalW, finalH, finalPixels));

console.log(`seed ${SEED} | board ${BOARD_W}x${BOARD_H} | water ${bodies.length} bodies, ${bodies.reduce((s, b) => s + b.size, 0)} cells | bridge deck ${bridgeCells.length}`);
bodies.forEach((body) => {
  console.log(`  body ${nameOf(body)} ${body.size} cells at tile (${body.cx.toFixed(1)}, ${body.cy.toFixed(1)})`);
});
for (const c of captions) {
  const inside = c.x >= 0 && c.y >= 0 && c.x + c.w < imgW && c.y + GLYPH_H < imgH;
  console.log(`  caption "${c.text}" at ${c.x},${c.y} ${inside ? "ok" : "OUT OF BOUNDS"}`);
}
console.log(`Wrote ${path.relative(path.join(__dirname, ".."), outPath)} (${finalW}x${finalH})`);
