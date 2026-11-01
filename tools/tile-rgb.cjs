/**
 * Prints exact RGB histograms and opacity for every tile in the Kenney sheet.
 *
 * Ground tiles are the ones that are 100% opaque and dominated by a single
 * colour, so the two columns that matter are "opaque %" and the top RGB values.
 * Object tiles (trees, rocks, walls) always carry transparent pixels.
 *
 * Usage: node tools/tile-rgb.cjs [from] [to]
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const TILE = 16;
const SPACING = 1;
const COLUMNS = 18;

const PNG_PATH = path.join(
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

const img = decodePng(fs.readFileSync(PNG_PATH));
const from = Number(process.argv[2] ?? 0);
const to = Number(process.argv[3] ?? 197);

console.log("idx gid  opaque  transparent  top colours (rgb:percent)");

for (let index = from; index <= to; index++) {
  const col = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const ox = col * (TILE + SPACING);
  const oy = row * (TILE + SPACING);
  const counts = new Map();
  let opaque = 0;

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = ((oy + y) * img.width + (ox + x)) * 4;
      if (img.pixels[i + 3] > 200) opaque++;
      const key = `${img.pixels[i]},${img.pixels[i + 1]},${img.pixels[i + 2]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const total = TILE * TILE;
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([rgb, n]) => `${rgb}:${Math.round((n / total) * 100)}`)
    .join("  ");

  console.log(
    `${String(index).padStart(3)} ${String(index + 1).padStart(3)}  ` +
      `${String(Math.round((opaque / total) * 100)).padStart(3)}%  ` +
      `${String(Math.round(((total - opaque) / total) * 100)).padStart(3)}%  ${top}`
  );
}
