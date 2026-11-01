/**
 * Decodes the Kenney tilesheet PNG and prints a per-tile colour profile.
 *
 * Why: reading terrain off a bitmap by eye is error-prone at 16px. This prints
 * the dominant hue bucket for every tile so gid -> terrain mapping is verified
 * against real pixel data instead of guessed.
 *
 * Usage: node tools/inspect-tiles.cjs [from] [to]
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

/** Minimal PNG reader: 8-bit truecolour (2), truecolour+alpha (6), or indexed (3). */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("Not a PNG file");
  }

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
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      paletteAlpha = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 3 && colorType !== 6)) {
    throw new Error(`Unsupported PNG (bitDepth=${bitDepth} colorType=${colorType})`);
  }

  const isIndexed = colorType === 3;
  if (isIndexed && !palette) {
    throw new Error("Indexed PNG is missing its PLTE chunk");
  }

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

      switch (filter) {
        case 0:
          break;
        case 1:
          line[x] = (line[x] + a) & 0xff;
          break;
        case 2:
          line[x] = (line[x] + b) & 0xff;
          break;
        case 3:
          line[x] = (line[x] + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          line[x] = (line[x] + predictor) & 0xff;
          break;
        }
        default:
          throw new Error(`Unknown PNG filter ${filter} on row ${y}`);
      }
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
        continue;
      }

      out[dst] = line[src];
      out[dst + 1] = line[src + 1];
      out[dst + 2] = line[src + 2];
      out[dst + 3] = channels === 4 ? line[src + 3] : 255;
    }

    previous = line;
  }

  return { width, height, pixels: out };
}

function classify(r, g, b, a) {
  if (a < 16) return "transparent";
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;

  if (sat < 0.14) return max > 190 ? "white" : "gray";
  if (b >= r && b >= g && (b - Math.max(r, g)) > 12) return "blue";
  if (g >= r && g >= b) return g > 120 ? "green" : "darkgreen";
  if (r > g && g > b) return "tan";
  if (r > g && g >= b) return "red";
  return "other";
}

function profileTile(img, index) {
  const col = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const originX = col * (TILE + SPACING);
  const originY = row * (TILE + SPACING);
  const counts = new Map();

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = ((originY + y) * img.width + (originX + x)) * 4;
      const bucket = classify(img.pixels[i], img.pixels[i + 1], img.pixels[i + 2], img.pixels[i + 3]);
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
    }
  }

  const total = TILE * TILE;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [dominant, dominantCount] = sorted[0];
  const distinct = sorted.filter(([, n]) => n >= 8).length;

  return {
    index,
    gid: index + 1,
    dominant,
    share: Math.round((dominantCount / total) * 100),
    detail: sorted
      .filter(([, n]) => n >= 8)
      .map(([bucket, n]) => `${bucket}:${Math.round((n / total) * 100)}%`)
      .join(" "),
    buckets: sorted,
    distinct,
  };
}

const from = Number(process.argv[2] ?? 0);
const to = Number(process.argv[3] ?? 197);

const img = decodePng(fs.readFileSync(PNG_PATH));
console.log(`Sheet ${img.width}x${img.height}px`);

const groups = new Map();

for (let index = from; index <= to; index++) {
  const p = profileTile(img, index);
  if (!groups.has(p.dominant)) {
    groups.set(p.dominant, []);
  }
  groups.get(p.dominant).push(p);
}

for (const [bucket, tiles] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n=== ${bucket} (${tiles.length}) ===`);
  console.log(tiles.map((t) => `idx ${t.index} gid ${t.gid}`).join(", "));
}

console.log("\n--- per-tile detail ---");
for (let index = from; index <= to; index++) {
  const p = profileTile(img, index);
  console.log(
    `idx ${String(p.index).padStart(3)} gid ${String(p.gid).padStart(3)}  ` +
      `${p.dominant.padEnd(11)} ${String(p.share).padStart(2)}%  ${p.detail}`
  );
}
