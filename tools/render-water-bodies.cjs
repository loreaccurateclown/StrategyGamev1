/**
 * Renders a generated board with each disconnected WATER BODY tinted a
 * distinct colour, so water fragmentation is visible at a glance.
 *
 * Why: naval units can only move on water they can reach. Every generated
 * board currently has 2-3 disconnected bodies, which would trap a ship in the
 * lake it spawned in. This tool exists to show that, not to fix it.
 * See plans/phase_1.md -> "Deferred: future movement requirements".
 *
 * Usage:
 *   node tools/render-water-bodies.cjs [--seed N] [--width N] [--height N] [--scale N]
 *
 * Defaults: seed 1234, 64x48, scale 2 (nearest-neighbour).
 * Output: tools/previews/water-bodies-seed<N>.png (gitignored).
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
// PNG decoding (Kenney sheet is indexed: colourType 3 + PLTE/tRNS).
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
// PNG encoding (RGBA8, filter 0).
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
const W = flag("width", 64);
const H = flag("height", 48);
const SCALE = flag("scale", 2);

// ---------------------------------------------------------------------------
// Earth
// ---------------------------------------------------------------------------

const WATER_BODY_COLORS = [
  [255, 59, 48], // red
  [255, 214, 10], // amber
  [48, 209, 88], // green
  [191, 90, 242], // violet
  [100, 210, 255], // sky
  [255, 141, 40], // orange
];

const restore = installSeededRandom(SEED);
let composed;
try {
  composed = compose(W, H);
} finally {
  restore();
}

const terrain = composed.terrain;
const visual = composed.visual;
const variations = composed.variations;
if (terrain.length !== W * H) throw new Error(`terrain length ${terrain.length} != ${W * H}`);

// 4-connected flood fill over water, recording the component id per cell.
const componentOf = new Int32Array(W * H).fill(-1);
const bodies = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (terrain[i] !== 3 || componentOf[i] !== -1) continue;
    const id = bodies.length;
    let size = 0;
    const stack = [i];
    componentOf[i] = id;
    while (stack.length) {
      const cur = stack.pop();
      size++;
      const cx = cur % W;
      const cy = (cur - cx) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (terrain[j] !== 3 || componentOf[j] !== -1) continue;
        componentOf[j] = id;
        stack.push(j);
      }
    }
    bodies.push({ id, size });
  }
}

// Largest first, so the palette reads big -> small.
bodies.sort((a, b) => b.size - a.size);
const rank = new Int32Array(bodies.length);
bodies.forEach((b, index) => {
  rank[b.id] = index;
});

// ---------------------------------------------------------------------------
// Composite: ground (all grass) -> variations -> terrain layer
// ---------------------------------------------------------------------------

const palette = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "assets", "generator", "palette.json"), "utf8"),
);
const tileset = palette.tileset;
const sheet = decodePng(
  fs.readFileSync(path.join(__dirname, "..", "assets", "import", "kenney_tiny-battle", "Tilemap", "tilemap.png")),
);

const TILE = tileset.tileSize;
const SPACING = tileset.spacing ?? 1;
const COLUMNS = tileset.columns;
const outW = W * TILE;
const outH = H * TILE;
const board = Buffer.alloc(outW * outH * 4);
for (let i = 0; i < board.length; i += 4) {
  board[i] = 0x1d;
  board[i + 1] = 0x1d;
  board[i + 2] = 0x1d;
  board[i + 3] = 0xff;
}

function blitGid(gid, cell) {
  if (!gid) return;
  const flipH = (gid & 0x80000000) !== 0;
  const flipV = (gid & 0x40000000) !== 0;
  const tileIndex = (gid & 0x1fffffff) - 1;
  const sx = (tileIndex % COLUMNS) * (TILE + SPACING);
  const sy = Math.floor(tileIndex / COLUMNS) * (TILE + SPACING);
  const dx = (cell % W) * TILE;
  const dy = Math.floor(cell / W) * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const fx = flipH ? TILE - 1 - x : x;
      const fy = flipV ? TILE - 1 - y : y;
      const s = ((sy + fy) * sheet.width + (sx + fx)) * 4;
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

for (let i = 0; i < W * H; i++) {
  blitGid(1, i); // ground: all grass
  blitGid(variations[i], i);
  blitGid(visual[i], i);
}

// ---------------------------------------------------------------------------
// Tint + outline each water body
// ---------------------------------------------------------------------------

const TINT = 0.62;
const EDGE = 3; // px, pre-upscale

function blend(d, r, g, b, amount) {
  board[d] = Math.round(board[d] * (1 - amount) + r * amount);
  board[d + 1] = Math.round(board[d + 1] * (1 - amount) + g * amount);
  board[d + 2] = Math.round(board[d + 2] * (1 - amount) + b * amount);
}

for (let i = 0; i < W * H; i++) {
  if (terrain[i] !== 3) continue;
  const color = WATER_BODY_COLORS[rank[componentOf[i]] % WATER_BODY_COLORS.length];
  const cx = i % W;
  const cy = (i - cx) / W;
  const dx = cx * TILE;
  const dy = cy * TILE;

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      blend(((dy + y) * outW + (dx + x)) * 4, color[0], color[1], color[2], TINT);
    }
  }

  // Bright inner border on any side facing a different body or dry land.
  const differs = (nx, ny) => {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return true;
    const j = ny * W + nx;
    return terrain[j] !== 3 || componentOf[j] !== componentOf[i];
  };
  const edges = [];
  if (differs(cx, cy - 1)) edges.push(["top"]);
  if (differs(cx, cy + 1)) edges.push(["bottom"]);
  if (differs(cx - 1, cy)) edges.push(["left"]);
  if (differs(cx + 1, cy)) edges.push(["right"]);
  for (const [side] of edges) {
    for (let t = 0; t < EDGE; t++) {
      for (let k = 0; k < TILE; k++) {
        let px;
        let py;
        if (side === "top") {
          px = dx + k;
          py = dy + t;
        } else if (side === "bottom") {
          px = dx + k;
          py = dy + TILE - 1 - t;
        } else if (side === "left") {
          px = dx + t;
          py = dy + k;
        } else {
          px = dx + TILE - 1 - t;
          py = dy + k;
        }
        const d = (py * outW + px) * 4;
        board[d] = 255;
        board[d + 1] = 255;
        board[d + 2] = 255;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Legend strip: one swatch per body, largest first, plus the header row text
// stand-in (solid squares only - no font rendering here).
// ---------------------------------------------------------------------------
const LEGEND_H = TILE;
const swatchW = 28;
const legendW = outW;
const legend = Buffer.alloc(legendW * LEGEND_H * 4);
for (let i = 0; i < legend.length; i += 4) {
  legend[i] = 0x10;
  legend[i + 1] = 0x10;
  legend[i + 2] = 0x10;
  legend[i + 3] = 0xff;
}
bodies.forEach((body, index) => {
  const color = WATER_BODY_COLORS[index % WATER_BODY_COLORS.length];
  const x0 = 4 + index * (swatchW + 6);
  for (let y = 8; y < LEGEND_H - 8; y++) {
    for (let x = x0; x < Math.min(x0 + swatchW, legendW); x++) {
      const d = (y * legendW + x) * 4;
      legend[d] = color[0];
      legend[d + 1] = color[1];
      legend[d + 2] = color[2];
    }
  }
});

const withLegendH = outH + LEGEND_H;
const composedBoard = Buffer.alloc(outW * withLegendH * 4);
board.copy(composedBoard, 0);
legend.copy(composedBoard, outW * outH * 4);

// ---------------------------------------------------------------------------
// Nearest-neighbour upscale
// ---------------------------------------------------------------------------
let finalBoard = composedBoard;
let finalW = outW;
let finalH = withLegendH;
if (SCALE > 1) {
  finalW = outW * SCALE;
  finalH = withLegendH * SCALE;
  finalBoard = Buffer.alloc(finalW * finalH * 4);
  for (let y = 0; y < finalH; y++) {
    const sy = Math.floor(y / SCALE) * outW * 4;
    const dy = y * finalW * 4;
    for (let x = 0; x < finalW; x++) {
      const s = sy + Math.floor(x / SCALE) * 4;
      finalBoard[dy + x * 4] = composedBoard[s];
      finalBoard[dy + x * 4 + 1] = composedBoard[s + 1];
      finalBoard[dy + x * 4 + 2] = composedBoard[s + 2];
      finalBoard[dy + x * 4 + 3] = composedBoard[s + 3];
    }
  }
}

const OUT_DIR = path.join(__dirname, "previews");
const outPath = path.join(OUT_DIR, `water-bodies-seed${SEED}.png`);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(outPath, encodePng(finalW, finalH, finalBoard));

console.log(`seed ${SEED} | board ${W}x${H} | water cells ${terrain.filter((t) => t === 3).length}`);
console.log(`water bodies: ${bodies.length}`);
bodies.forEach((body, index) => {
  const color = WATER_BODY_COLORS[index % WATER_BODY_COLORS.length];
  console.log(`  swatch ${index} rgb(${color.join(",")}) -> ${body.size} cells`);
});
console.log(`Wrote ${path.relative(path.join(__dirname, ".."), outPath)} (${finalW}x${finalH})`);

// ---------------------------------------------------------------------------
// Optional ASCII board, one character per tile. Lets the map be read in a
// terminal - and by agents that cannot view images.
//   A/B/C.. = water body N    = road    # building
//   T forest   ^ mountain     . grass
// ---------------------------------------------------------------------------
if (process.argv.includes("--ascii")) {
  const BODY_LETTERS = "ABCDEF";
  const glyph = (i) => {
    if (terrain[i] === 3) return BODY_LETTERS[rank[componentOf[i]] % BODY_LETTERS.length];
    switch (terrain[i]) {
      case 5:
        return "=";
      case 6:
        return "#";
      case 2:
        return "T";
      case 4:
        return "^";
      default:
        return ".";
    }
  };

  console.log("");
  console.log(`ASCII board (seed ${SEED})   A.. = water bodies, = road, # building, T forest, ^ mountain, . grass`);
  let ruler = "    ";
  for (let x = 0; x < W; x++) ruler += x % 10 === 0 ? String((x / 10) % 10) : " ";
  console.log(ruler + "   (tens)");
  for (let y = 0; y < H; y++) {
    let line = "";
    for (let x = 0; x < W; x++) line += glyph(y * W + x);
    console.log(String(y).padStart(2, " ") + "  " + line);
  }
}
