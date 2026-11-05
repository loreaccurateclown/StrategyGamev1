/**
 * Decompose a *rescaled* reference image into tileset gids.
 *
 * The exact matcher (decompose-reference.cjs) only works on a 1:1 render. This one
 * handles the case where the reference was interpolated up: it measures or takes a
 * scale factor, box-downsamples back towards native resolution, quantises to the
 * tileset palette (which undoes the interpolation blends), and then does the
 * ordinary 16 px lattice search.
 *
 * The scale factor can be estimated from a high-contrast sprite feature - see
 * --feature. Units work well because a soldier's skin blob is a compact, high
 * contrast shape that survives interpolation recognisably.
 *
 * Usage:
 *   node tools/decompose-scaled.cjs --in <png> [--scale 1.41] [--out <png>]
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
const OUT = arg("out", path.join(__dirname, "previews", "reference-scaled.png"));
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

// --- tileset palette -------------------------------------------------------
const paletteColours = [];
{
  const seen = new Set();
  for (let i = 0; i < sheet.width * sheet.height; i++) {
    const p = i * 4;
    if (sheet.pixels[p + 3] < 128) continue;
    const key = (sheet.pixels[p] << 16) | (sheet.pixels[p + 1] << 8) | sheet.pixels[p + 2];
    if (seen.has(key)) continue;
    seen.add(key);
    paletteColours.push([sheet.pixels[p], sheet.pixels[p + 1], sheet.pixels[p + 2]]);
  }
}
console.log(`tileset palette: ${paletteColours.length} opaque colours`);

// --- scale estimate from a high-contrast feature ---------------------------
// A unit's skin blob is compact and high contrast, so its area scales as f^2 even
// after interpolation. Sheet blobs are the ground truth for "one unit of art".
const SKIN = [247, 194, 130];
const TOL = 48;
function skinBlobAreas(im) {
  const near = (x, y) => {
    const i = (y * im.width + x) * 4;
    const dr = im.pixels[i] - SKIN[0];
    const dg = im.pixels[i + 1] - SKIN[1];
    const db = im.pixels[i + 2] - SKIN[2];
    return dr * dr + dg * dg + db * db <= TOL * TOL;
  };
  const seen = new Uint8Array(im.width * im.height);
  const areas = [];
  for (let y = 0; y < im.height; y++) {
    for (let x = 0; x < im.width; x++) {
      const i = y * im.width + x;
      if (seen[i] || !near(x, y)) continue;
      const stack = [i];
      seen[i] = 1;
      let n = 0;
      while (stack.length) {
        const c = stack.pop();
        const cx = c % im.width;
        const cy = (c - cx) / im.width;
        n++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= im.width || ny >= im.height) continue;
          const ni = ny * im.width + nx;
          if (!seen[ni] && near(nx, ny)) {
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }
      if (n >= 2) areas.push(n);
    }
  }
  return areas.sort((a, b) => a - b);
}
const median = (list) => list[Math.floor(list.length / 2)] ?? 0;
const sheetAreas = skinBlobAreas(sheet);
const refAreas = skinBlobAreas(reference);
const estimatedScale = Math.sqrt(median(refAreas) / Math.max(1, median(sheetAreas)));
console.log(
  `unit-sprite ruler: sheet median skin blob ${median(sheetAreas)} px, reference ${median(refAreas)} px ` +
    `-> scale ${estimatedScale.toFixed(3)}`,
);

const SCALE = arg("scale") ? Number(arg("scale")) : estimatedScale;

// --- box-downsample by 1/SCALE, then quantise to the tileset palette -------
const DW = Math.floor(reference.width / SCALE);
const DH = Math.floor(reference.height / SCALE);
const down = Buffer.alloc(DW * DH * 4);
for (let y = 0; y < DH; y++) {
  for (let x = 0; x < DW; x++) {
    const x0 = Math.floor(x * SCALE);
    const x1 = Math.max(x0 + 1, Math.floor((x + 1) * SCALE));
    const y0 = Math.floor(y * SCALE);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * SCALE));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let yy = y0; yy < y1 && yy < reference.height; yy++) {
      for (let xx = x0; xx < x1 && xx < reference.width; xx++) {
        const i = (yy * reference.width + xx) * 4;
        r += reference.pixels[i];
        g += reference.pixels[i + 1];
        b += reference.pixels[i + 2];
        n++;
      }
    }
    const dst = (y * DW + x) * 4;
    down[dst] = r / n;
    down[dst + 1] = g / n;
    down[dst + 2] = b / n;
    down[dst + 3] = 255;
  }
}

/** Snap every pixel to the nearest tileset colour, killing interpolation blends. */
const quantised = Buffer.alloc(DW * DH * 4);
for (let i = 0; i < DW * DH; i++) {
  const r = down[i * 4];
  const g = down[i * 4 + 1];
  const b = down[i * 4 + 2];
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < paletteColours.length; c++) {
    const dr = r - paletteColours[c][0];
    const dg = g - paletteColours[c][1];
    const db = b - paletteColours[c][2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  quantised[i * 4] = paletteColours[best][0];
  quantised[i * 4 + 1] = paletteColours[best][1];
  quantised[i * 4 + 2] = paletteColours[best][2];
  quantised[i * 4 + 3] = 255;
}
console.log(`downsampled ${reference.width}x${reference.height} -> ${DW}x${DH} and quantised to the palette`);

// --- tile lookup (numeric hash, verified on hit) --------------------------
const origin = (gid) => {
  const index = gid - 1;
  return [(index % COLUMNS) * (TILE + SPACING), Math.floor(index / COLUMNS) * (TILE + SPACING)];
};
const hash256 = (fn) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < 256; i++) {
    h ^= fn(i) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};
const variants = new Map(); // hash -> [{ gid, flags }]
for (let gid = 1; gid <= TILE_COUNT; gid++) {
  const [ox, oy] = origin(gid);
  for (const flags of [0, FLIP_H, FLIP_V, FLIP_H | FLIP_V]) {
    const h = hash256((i) => {
      const x = i & 15;
      const y = i >> 4;
      const sx = ox + (flags & FLIP_H ? TILE - 1 - x : x);
      const sy = oy + (flags & FLIP_V ? TILE - 1 - y : y);
      const p = (sy * sheet.width + sx) * 4;
      return (
        ((sheet.pixels[p] << 24) | (sheet.pixels[p + 1] << 16) | (sheet.pixels[p + 2] << 8) | sheet.pixels[p + 3]) >>> 0
      );
    });
    if (!variants.has(h)) variants.set(h, []);
    variants.get(h).push({ gid, flags });
  }
}

const cellHash = (ox, oy, cx, cy) =>
  hash256((i) => {
    const x = i & 15;
    const y = i >> 4;
    const px = ox + cx * TILE + x;
    const py = oy + cy * TILE + y;
    if (px < 0 || py < 0 || px >= DW || py >= DH) return 0xffffffff;
    const p = (py * DW + px) * 4;
    return (
      ((quantised[p] << 24) | (quantised[p + 1] << 16) | (quantised[p + 2] << 8) | quantised[p + 3]) >>> 0
    );
  });

function score(ox, oy) {
  const cols = Math.floor((DW - ox) / TILE);
  const rows = Math.floor((DH - oy) / TILE);
  let matched = 0;
  let seen = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (ox + cx * TILE + TILE > DW || oy + cy * TILE + TILE > DH) continue;
      seen++;
      if (variants.has(cellHash(ox, oy, cx, cy))) matched++;
    }
  }
  return { ox, oy, cols, rows, matched, seen };
}

let best = null;
for (let oy = 0; oy < TILE; oy++) {
  for (let ox = 0; ox < TILE; ox++) {
    const s = score(ox, oy);
    if (s.seen === 0) continue;
    s.ratio = s.matched / s.seen;
    if (!best || s.matched > best.matched) best = s;
  }
}
console.log(
  `best lattice at scale ${SCALE.toFixed(3)}: offset (${best.ox},${best.oy}), ${best.cols}x${best.rows} cells, ` +
    `${best.matched}/${best.seen} exact (${(100 * best.ratio).toFixed(1)}%)`,
);

// --- decomposition ---------------------------------------------------------
const { ox, oy, cols, rows } = best;
const grid = [];
const unresolved = [];
const counts = new Map();
for (let cy = 0; cy < rows; cy++) {
  const row = [];
  for (let cx = 0; cx < cols; cx++) {
    const hit = variants.get(cellHash(ox, oy, cx, cy));
    if (!hit) {
      row.push(null);
      unresolved.push([cx, cy]);
      continue;
    }
    const chosen = hit.slice().sort((a, b) => (a.flags !== 0) - (b.flags !== 0) || a.gid - b.gid)[0];
    row.push(chosen);
    counts.set(chosen.gid, (counts.get(chosen.gid) || 0) + 1);
  }
  grid.push(row);
}

console.log("");
console.log("top gids:");
for (const [gid, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(gid).padStart(3)}  x${String(n).padStart(4)}`);
}
console.log(`distinct gids: ${counts.size}`);
console.log(`unresolved: ${unresolved.length}/${cols * rows}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const jsonPath = OUT.replace(/\.png$/, ".json");
fs.writeFileSync(
  jsonPath,
  JSON.stringify(
    {
      source: path.basename(INPUT),
      scale: SCALE,
      offset: [ox, oy],
      cols,
      rows,
      gids: grid.map((row) => row.map((cell) => (cell ? cell.gid : 0))),
    },
    null,
    0,
  ),
);
console.log(`wrote ${path.relative(process.cwd(), jsonPath)}`);

// --- reconstruction --------------------------------------------------------
const S = 2;
const W = cols * TILE * S;
const H = rows * TILE * S;
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
      for (let y = 0; y < TILE * S; y++)
        for (let x = 0; x < TILE * S; x++) put(cx * TILE * S + x, cy * TILE * S + y, 200, 40, 200);
      continue;
    }
    const [sox, soy] = origin(cell.gid);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const sx = sox + (cell.flags & FLIP_H ? TILE - 1 - x : x);
        const sy = soy + (cell.flags & FLIP_V ? TILE - 1 - y : y);
        const p = (sy * sheet.width + sx) * 4;
        if (sheet.pixels[p + 3] < 32) continue;
        for (let yy = 0; yy < S; yy++)
          for (let xx = 0; xx < S; xx++)
            put(
              cx * TILE * S + x * S + xx,
              cy * TILE * S + y * S + yy,
              sheet.pixels[p],
              sheet.pixels[p + 1],
              sheet.pixels[p + 2],
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
