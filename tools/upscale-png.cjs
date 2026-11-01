/**
 * Nearest-neighbour upscale (or downscale-free copy) for any 8-bit PNG, so
 * 16 px tile art can be inspected at a readable size.
 *
 * Handles colour types 2 (RGB), 3 (indexed, with tRNS) and 6 (RGBA) at 8-bit
 * depth — which covers the Kenney sheet, ripped game maps, and screenshots.
 *
 * Usage:
 *   node tools/upscale-png.cjs <input.png> [output.png] [scale=4]
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

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

const input = process.argv[2];
const output = process.argv[3] ?? input.replace(/\.png$/i, `-x${process.argv[4] ?? 4}.png`);
const scale = Math.max(1, Math.floor(Number(process.argv[4] ?? 4) || 4));

const img = decodePng(fs.readFileSync(input));
const w = img.width * scale;
const h = img.height * scale;
const pixels = Buffer.alloc(w * h * 4);
for (let y = 0; y < h; y++) {
  const srcRow = Math.floor(y / scale) * img.width * 4;
  for (let x = 0; x < w; x++) {
    const s = srcRow + Math.floor(x / scale) * 4;
    const d = (y * w + x) * 4;
    pixels[d] = img.pixels[s];
    pixels[d + 1] = img.pixels[s + 1];
    pixels[d + 2] = img.pixels[s + 2];
    pixels[d + 3] = img.pixels[s + 3];
  }
}
fs.writeFileSync(output, encodePng(w, h, pixels));
console.log(`${path.basename(input)} ${img.width}x${img.height} -> ${w}x${h} (x${scale}) -> ${output}`);
