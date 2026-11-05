/**
 * Shoreline inventory: for every tile in the sheet, measure how much of it is
 * liquid vs land, and which EDGES the land occupies.
 *
 * The water autotile mask needs to know, for each tile, "which side is the bank
 * on". Guessing that from gid numbers is how the earlier palette ended up with
 * only five coast tiles when the sheet has more. This measures it.
 *
 * Usage: node tools/tile-shore-scan.cjs [--all]
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const TILE = 16;
const SPACING = 1;
const COLUMNS = 18;
const SHEET = path.join(
  __dirname,
  "..",
  "assets",
  "import",
  "kenney_tiny-battle",
  "Tilemap",
  "tilemap.png",
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
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
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
      } else if (filter !== 0) throw new Error(`bad filter ${filter}`);
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

const sheet = decodePng(fs.readFileSync(SHEET));
const px = (x, y) => {
  const i = (y * sheet.width + x) * 4;
  return [sheet.pixels[i], sheet.pixels[i + 1], sheet.pixels[i + 2], sheet.pixels[i + 3]];
};

// Families keyed by hue rather than exact RGB, so shading variants group together.
function family(r, g, b, a) {
  if (a < 32) return "none";
  if (b > 150 && b > r + 40 && g > 120) return "liquid"; // cyan / water blues
  if (g > 120 && g > b + 30 && r > 70 && r < 200) return "land"; // grass greens
  if (r > 180 && g > 150 && b < 120) return "warm"; // sand / gold
  return "other";
}

const tileOrigin = (gid) => {
  const index = gid - 1;
  const col = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  return [col * (TILE + SPACING), row * (TILE + SPACING)];
};

const showAll = process.argv.includes("--all");
const rows = [];

for (let gid = 1; gid <= 198; gid++) {
  const [ox, oy] = tileOrigin(gid);
  let liquid = 0;
  let land = 0;
  let total = 0;
  const edge = { top: 0, bottom: 0, left: 0, right: 0 };
  const edgeTotal = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const [r, g, b, a] = px(ox + x, oy + y);
      const f = family(r, g, b, a);
      total++;
      if (f === "liquid") liquid++;
      else if (f === "land") land++;
      const isLand = f === "land";
      if (y === 0) {
        edgeTotal.top++;
        if (isLand) edge.top++;
      }
      if (y === TILE - 1) {
        edgeTotal.bottom++;
        if (isLand) edge.bottom++;
      }
      if (x === 0) {
        edgeTotal.left++;
        if (isLand) edge.left++;
      }
      if (x === TILE - 1) {
        edgeTotal.right++;
        if (isLand) edge.right++;
      }
    }
  }
  const liquidPct = (100 * liquid) / total;
  const landPct = (100 * land) / total;
  if (liquid < 8) continue;
  const sides = [];
  if (edge.top / edgeTotal.top > 0.5) sides.push("N");
  if (edge.bottom / edgeTotal.bottom > 0.5) sides.push("S");
  if (edge.left / edgeTotal.left > 0.5) sides.push("W");
  if (edge.right / edgeTotal.right > 0.5) sides.push("E");
  rows.push({
    gid,
    liquidPct,
    landPct,
    sides: sides.join("") || "-",
    edges: `N${edge.top} S${edge.bottom} W${edge.left} E${edge.right}`,
  });
}

console.log("gid  liquid  land   bank-on-edges   (of 16 px per edge)");
for (const r of rows) {
  if (!showAll && r.landPct < 1 && r.liquidPct < 99) continue;
  console.log(
    `${String(r.gid).padStart(3)}  ${r.liquidPct.toFixed(0).padStart(6)}%  ${r.landPct
      .toFixed(0)
      .padStart(4)}%   ${r.sides.padEnd(5)}  ${r.edges}`,
  );
}
console.log("");
console.log("palette.json currently maps: fill 38, corner 19, edges N20 S56 W37 E39, strut 149");
