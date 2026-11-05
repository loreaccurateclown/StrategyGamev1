/**
 * Decompose a reference map image back into tileset gids.
 *
 * Given a screenshot/render that was made from the Kenney tiny-battle sheet, find
 * the tile grid and report which gid (plus flip flags) each cell is. Cells that
 * match no tile are reported explicitly rather than mis-assigned - that is how we
 * learn which parts of a reference are NOT drawable with this tileset.
 *
 * Usage:
 *   node tools/decompose-reference.cjs --in <png> [--scale 2] [--out <png>]
 *
 * Without --scale it searches scaling factors 1..4 and every sub-tile grid offset,
 * then keeps the alignment that resolves the most cells exactly.
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const TILE = 16;
const SPACING = 1;
const COLUMNS = 18;
const TILE_COUNT = 198;
const SHEET = path.join(__dirname, "..", "assets", "import", "kenney_tiny-battle", "Tilemap", "tilemap.png");
const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}
const INPUT = arg("in");
const FIXED_SCALE = arg("scale") ? Number(arg("scale")) : null;
const OUT = arg("out", path.join(__dirname, "previews", "reference-gids.png"));
if (!INPUT) throw new Error("--in <png> is required");

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

const reference = decodePng(fs.readFileSync(INPUT));
const sheet = decodePng(fs.readFileSync(SHEET));

const refPx = (x, y) => {
  const i = (y * reference.width + x) * 4;
  return `${reference.pixels[i]},${reference.pixels[i + 1]},${reference.pixels[i + 2]},${reference.pixels[i + 3]}`;
};
const sheetPx = (x, y) => {
  const i = (y * sheet.width + x) * 4;
  return `${sheet.pixels[i]},${sheet.pixels[i + 1]},${sheet.pixels[i + 2]},${sheet.pixels[i + 3]}`;
};

// --- tileset: hash every gid in all four flip states -----------------------
const origin = (gid) => {
  const index = gid - 1;
  return [(index % COLUMNS) * (TILE + SPACING), Math.floor(index / COLUMNS) * (TILE + SPACING)];
};

const variants = new Map(); // hash -> [{ gid, flags, bg }]
const byFirstPixel = new Map(); // first-pixel colour -> Set(hash)

// Tiles are sprite art: many have transparent pixels, and a composited screenshot
// shows whatever was underneath at those pixels rather than transparency. Matching
// raw RGBA therefore rejects every sprite tile outright - which is why the first
// pass "found" only the solid grass tile. Composite each tile over the two
// plausible backgrounds (the map base is grass, the channel is water) and match
// against those.
const BACKGROUNDS = [
  [132, 198, 105, "grass"],
  [117, 227, 255, "water"],
];

const sheetRGBA = (x, y) => {
  const i = (y * sheet.width + x) * 4;
  return [sheet.pixels[i], sheet.pixels[i + 1], sheet.pixels[i + 2], sheet.pixels[i + 3]];
};

for (let gid = 1; gid <= TILE_COUNT; gid++) {
  const [ox, oy] = origin(gid);
  for (const flags of [0, FLIP_H, FLIP_V, FLIP_H | FLIP_V]) {
    for (const [br, bg2, bb, bgName] of BACKGROUNDS) {
      let hash = "";
      let first = null;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const sx = ox + (flags & FLIP_H ? TILE - 1 - x : x);
          const sy = oy + (flags & FLIP_V ? TILE - 1 - y : y);
          const [r, g, b, a] = sheetRGBA(sx, sy);
          const px =
            a === 255
              ? `${r},${g},${b},255`
              : `${Math.round((r * a + br * (255 - a)) / 255)},${Math.round(
                  (g * a + bg2 * (255 - a)) / 255,
                )},${Math.round((b * a + bb * (255 - a)) / 255)},255`;
          if (first === null) first = px;
          hash += px + "|";
        }
      }
      if (!variants.has(hash)) variants.set(hash, []);
      variants.get(hash).push({ gid, flags, bg: bgName });
      if (!byFirstPixel.has(first)) byFirstPixel.set(first, new Set());
      byFirstPixel.get(first).add(hash);
    }
  }
}

/** Reads one cell at the given grid alignment, downsampling by `scale`. */
function readCell(ox, oy, cx, cy, pitch, step) {
  let hash = "";
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const px = ox + cx * pitch + x * step;
      const py = oy + cy * pitch + y * step;
      if (px < 0 || py < 0 || px >= reference.width || py >= reference.height) return null;
      hash += refPx(px, py) + "|";
    }
  }
  return hash;
}

/**
 * Exact-match score for one alignment. A cheap first-pixel prefilter keeps this
 * fast enough to sweep many pitches - without it the search is dominated by flat
 * grass, which matches the solid grass tile at almost any offset.
 */
function score(ox, oy, pitch, step) {
  const cols = Math.floor((reference.width - ox) / pitch);
  const rows = Math.floor((reference.height - oy) / pitch);
  let matched = 0;
  let seen = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = ox + cx * pitch;
      const y0 = oy + cy * pitch;
      if (x0 + TILE * step > reference.width || y0 + TILE * step > reference.height) continue;
      seen++;
      const bucket = byFirstPixel.get(refPx(x0, y0));
      if (!bucket) continue;
      const hash = readCell(ox, oy, cx, cy, pitch, step);
      if (hash !== null && bucket.has(hash)) matched++;
    }
  }
  return { ox, oy, pitch, step, cols, rows, matched, seen };
}

// --- alignment search ------------------------------------------------------
// pitch = the distance between cell origins; step = the upscale factor of the
// art inside each cell. The sample sheet ships with a 1 px gap between tiles, and
// resized screenshots land on fractional scales, so both are searched.
let best = null;
const PITCHES = FIXED_SCALE ? [TILE * FIXED_SCALE] : [16, 17, 18, 19, 20, 32, 34, 36];
for (const pitch of PITCHES) {
  for (const step of [1, 2]) {
    if (TILE * step > pitch) continue;
    for (let oy = 0; oy < pitch; oy++) {
      for (let ox = 0; ox < pitch; ox++) {
        const s = score(ox, oy, pitch, step);
        if (s.seen === 0) continue;
        s.ratio = s.matched / s.seen;
        if (!best || s.matched > best.matched || (s.matched === best.matched && s.ratio > best.ratio)) best = s;
      }
    }
  }
}

console.log(`image: ${INPUT}  ${reference.width}x${reference.height}`);
console.log(
  `best grid: pitch ${best.pitch}px, ${best.step}x art, offset (${best.ox},${best.oy}), ` +
    `${best.cols}x${best.rows} cells, ${best.matched}/${best.seen} exact (${(100 * best.ratio).toFixed(1)}%)`,
);

// --- decomposition ---------------------------------------------------------
const { ox, oy, pitch, step, cols, rows } = best;
const grid = [];
const unresolved = [];
const counts = new Map();
for (let cy = 0; cy < rows; cy++) {
  const row = [];
  for (let cx = 0; cx < cols; cx++) {
    const hash = readCell(ox, oy, cx, cy, pitch, step);
    const hit = hash === null ? null : variants.get(hash);
    if (!hit) {
      row.push(null);
      unresolved.push([cx, cy]);
      continue;
    }
    // Prefer the unflagged variant, then the lowest gid, so output is stable.
    const chosen = hit.slice().sort((a, b) => (a.flags !== 0) - (b.flags !== 0) || a.gid - b.gid)[0];
    row.push(chosen);
    counts.set(chosen.gid, (counts.get(chosen.gid) || 0) + 1);
  }
  grid.push(row);
}

console.log("");
console.log("top gids used:");
for (const [gid, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 24)) {
  console.log(`  ${String(gid).padStart(3)}  x${String(n).padStart(4)}`);
}
console.log("");
console.log(`distinct gids: ${counts.size}`);
console.log(`unresolved cells: ${unresolved.length} / ${cols * rows}`);
if (unresolved.length) {
  // Group into bounding boxes so the report names regions, not 400 coordinates.
  const boxes = [];
  for (const [cx, cy] of unresolved) {
    const box = boxes.find((b) => cx >= b.x0 - 2 && cx <= b.x1 + 2 && cy >= b.y0 - 2 && cy <= b.y1 + 2);
    if (box) {
      box.x0 = Math.min(box.x0, cx);
      box.x1 = Math.max(box.x1, cx);
      box.y0 = Math.min(box.y0, cy);
      box.y1 = Math.max(box.y1, cy);
      box.n++;
    } else boxes.push({ x0: cx, x1: cx, y0: cy, y1: cy, n: 1 });
  }
  console.log("unresolved regions (cell coords, inclusive):");
  for (const b of boxes) {
    console.log(`  x ${b.x0}..${b.x1}  y ${b.y0}..${b.y1}   ${b.n} cell(s)`);
  }
}

// --- outputs ---------------------------------------------------------------
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const jsonPath = OUT.replace(/\.png$/, ".json");
fs.writeFileSync(
  jsonPath,
  JSON.stringify(
    {
      source: path.basename(INPUT),
      pitch,
      step,
      offset: [ox, oy],
      cols,
      rows,
      gids: grid.map((row) => row.map((cell) => (cell ? cell.gid : 0))),
    },
    null,
    0,
  ),
);
console.log("");
console.log(`wrote ${path.relative(process.cwd(), jsonPath)}`);

// Reconstruction: redraw the decomposition from the sheet, marking unresolved
// cells magenta. If this looks like the input, the decomposition is complete.
const SCALE_OUT = 2;
const W = cols * TILE * SCALE_OUT;
const H = rows * TILE * SCALE_OUT;
const canvas = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  canvas[i * 4] = 24;
  canvas[i * 4 + 1] = 24;
  canvas[i * 4 + 2] = 32;
  canvas[i * 4 + 3] = 255;
}
const put = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  canvas[i] = r;
  canvas[i + 1] = g;
  canvas[i + 2] = b;
  canvas[i + 3] = 255;
};
for (let cy = 0; cy < rows; cy++) {
  for (let cx = 0; cx < cols; cx++) {
    const cell = grid[cy][cx];
    if (!cell) {
      for (let y = 0; y < TILE * SCALE_OUT; y++)
        for (let x = 0; x < TILE * SCALE_OUT; x++)
          put(cx * TILE * SCALE_OUT + x, cy * TILE * SCALE_OUT + y, 200, 40, 200);
      continue;
    }
    const [sox, soy] = origin(cell.gid);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const sx = sox + (cell.flags & FLIP_H ? TILE - 1 - x : x);
        const sy = soy + (cell.flags & FLIP_V ? TILE - 1 - y : y);
        const i = (sy * sheet.width + sx) * 4;
        if (sheet.pixels[i + 3] < 32) continue;
        for (let yy = 0; yy < SCALE_OUT; yy++)
          for (let xx = 0; xx < SCALE_OUT; xx++)
            put(
              cx * TILE * SCALE_OUT + x * SCALE_OUT + xx,
              cy * TILE * SCALE_OUT + y * SCALE_OUT + yy,
              sheet.pixels[i],
              sheet.pixels[i + 1],
              sheet.pixels[i + 2],
            );
      }
    }
  }
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
function chunk(type, data) {
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
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
fs.writeFileSync(OUT, encodePng(W, H, canvas));
console.log(`wrote ${path.relative(process.cwd(), OUT)}  (${W}x${H}, magenta = unresolved)`);
