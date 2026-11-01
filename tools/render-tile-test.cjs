/**
 * Scratch harness for answering "how does this tile actually tile?".
 *
 * Renders small hand-authored layouts from the Kenney sheet at N× so autotile
 * choices (coast corners in particular) can be eyeballed before they go into
 * the map generator. Supports per-cell flips, because Tiled/Phaser gids carry
 * flip flags and mirroring one clean corner tile is the obvious way to get the
 * other three if the sheet's own corners carry neighbour artifacts.
 *
 * Usage: node tools/render-tile-test.cjs
 * Writes tools/tiles/coast-test-a.png and coast-test-b.png
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const TILE = 16;
const SPACING = 1;
const COLUMNS = 18;
const SCALE = 6;

/**
 * `--ignore-spacing` reproduces the classic sheet-stride bug: slicing with the
 * tile size (16) instead of tile + spacing (17) makes every column drift one
 * pixel further left than the last, so the map imports but shears toward the
 * bottom-right. Kept as a rendering mode because it is the most common
 * "tilemap imported but misaligned" failure and is worth being able to see.
 */
const IGNORE_SPACING = process.argv.includes("--ignore-spacing");
const STRIDE = IGNORE_SPACING ? TILE : TILE + SPACING;
const SUFFIX = IGNORE_SPACING ? "-wrong-stride" : "";

const SHEET = path.join(
  __dirname,
  "..",
  "assets",
  "import",
  "kenney_tiny-battle",
  "Tilemap",
  "tilemap.png"
);

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

const sheet = decodePng(fs.readFileSync(SHEET));

/** cells: [{gid, flipH?, flipV?}] or null */
function render(cells, cols, rows, outPath) {
  const w = cols * TILE;
  const h = rows * TILE;
  const img = Buffer.alloc(w * h * 4);
  for (let i = 0; i < img.length; i += 4) {
    img[i] = 0x1d;
    img[i + 1] = 0x1d;
    img[i + 2] = 0x1d;
    img[i + 3] = 0xff;
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = cells[row * cols + col];
      if (!cell) continue;
      const index = cell.gid - 1;
      const sx = (index % COLUMNS) * STRIDE;
      const sy = Math.floor(index / COLUMNS) * STRIDE;
      const dx = col * TILE;
      const dy = row * TILE;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const fx = cell.flipH ? TILE - 1 - x : x;
          const fy = cell.flipV ? TILE - 1 - y : y;
          const s = ((sy + fy) * sheet.width + (sx + fx)) * 4;
          const a = sheet.pixels[s + 3];
          if (a === 0) continue;
          const d = ((dy + y) * w + (dx + x)) * 4;
          img[d] = sheet.pixels[s];
          img[d + 1] = sheet.pixels[s + 1];
          img[d + 2] = sheet.pixels[s + 2];
          img[d + 3] = 255;
        }
      }
    }
  }
  // nearest-neighbour upscale
  const uw = w * SCALE;
  const uh = h * SCALE;
  const up = Buffer.alloc(uw * uh * 4);
  for (let y = 0; y < uh; y++) {
    const srcRow = Math.floor(y / SCALE) * w * 4;
    for (let x = 0; x < uw; x++) {
      const s = srcRow + Math.floor(x / SCALE) * 4;
      const d = (y * uw + x) * 4;
      up[d] = img[s];
      up[d + 1] = img[s + 1];
      up[d + 2] = img[s + 2];
      up[d + 3] = img[s + 3];
    }
  }
  fs.writeFileSync(outPath, encodePng(uw, uh, up));
  console.log(`wrote ${outPath} (${cols}x${rows} tiles -> ${uw}x${uh}px)`);
}

const GRASS = { gid: 1 };
const WATER = { gid: 38 };

/**
 * Build a rectangular lake inside grass.
 * cornerGids = { tl, tr, bl, br } and edgeGids = { n, w, e, s }.
 * Every cell starts as grass; the lake rect sets its own tiles.
 */
function buildLake(cols, rows, rect, cornerGids, edgeGids) {
  const cells = new Array(cols * rows).fill(null).map(() => ({ ...GRASS }));
  const { x, y, w, h } = rect;
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) {
      const isTop = r === y;
      const isBottom = r === y + h - 1;
      const isLeft = c === x;
      const isRight = c === x + w - 1;
      let cell;
      if (isTop && isLeft) cell = cornerGids.tl;
      else if (isTop && isRight) cell = cornerGids.tr;
      else if (isBottom && isLeft) cell = cornerGids.bl;
      else if (isBottom && isRight) cell = cornerGids.br;
      else if (isTop) cell = edgeGids.n;
      else if (isBottom) cell = edgeGids.s;
      else if (isLeft) cell = edgeGids.w;
      else if (isRight) cell = edgeGids.e;
      else cell = WATER;
      cells[r * cols + c] = { ...cell };
    }
  }
  return cells;
}

// A: the sheet's own corners (19 TL, 21 TR, 22 BL, 23 BR) — to see the specks
render(
  buildLake(
    12,
    9,
    { x: 2, y: 2, w: 8, h: 5 },
    { tl: { gid: 19 }, tr: { gid: 21 }, bl: { gid: 22 }, br: { gid: 23 } },
    { n: { gid: 20 }, s: { gid: 56 }, w: { gid: 37 }, e: { gid: 39 } }
  ),
  12,
  9,
  path.join(__dirname, "tiles", `coast-test-a${SUFFIX}.png`)
);

// B: one clean corner (19) mirrored into all four corners
render(
  buildLake(
    12,
    9,
    { x: 2, y: 2, w: 8, h: 5 },
    {
      tl: { gid: 19 },
      tr: { gid: 19, flipH: true },
      bl: { gid: 19, flipV: true },
      br: { gid: 19, flipH: true, flipV: true },
    },
    { n: { gid: 20 }, s: { gid: 56 }, w: { gid: 37 }, e: { gid: 39 } }
  ),
  12,
  9,
  path.join(__dirname, "tiles", `coast-test-b${SUFFIX}.png`)
);
