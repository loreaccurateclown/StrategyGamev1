/**
 * Compiles several PNGs into one labelled-by-position contact sheet.
 *
 * Panels are framed by a border colour derived from the filename, so the
 * comparison is readable without drawing text: panels whose name contains
 * "wrong" get a red frame, everything else gets a green frame.
 *
 * Usage: node tools/make-montage.cjs <out.png> <cols> <in1.png> <in2.png> ...
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const GAP = 4;
const BORDER = 2;

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
  const isIndexed = colorType === 3;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  if (!isIndexed && bitDepth !== 8) throw new Error(`Unsupported bit depth ${bitDepth}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  const bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const out = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = previous[x];
      const c = x >= bpp ? previous[x - bpp] : 0;
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
      const dst = (y * width + x) * 4;
      if (isIndexed) {
        let index;
        if (bitDepth === 8) index = line[x];
        else {
          const bit = x * bitDepth;
          index = (line[bit >> 3] >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1);
        }
        const entry = index * 3;
        out[dst] = palette[entry];
        out[dst + 1] = palette[entry + 1];
        out[dst + 2] = palette[entry + 2];
        out[dst + 3] = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] : 255;
      } else {
        const src = x * channels;
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

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error("usage: node tools/make-montage.cjs <out.png> <cols> <in1.png> ...");
  process.exit(1);
}
const outPath = args[0];
const cols = Math.max(1, Number(args[1]) || 1);
const inputs = args.slice(2).map((file) => ({ file, name: path.basename(file), img: decodePng(fs.readFileSync(file)) }));

const cellW = Math.max(...inputs.map((i) => i.img.width)) + BORDER * 2;
const cellH = Math.max(...inputs.map((i) => i.img.height)) + BORDER * 2;
const rows = Math.ceil(inputs.length / cols);
const width = cols * cellW + (cols - 1) * GAP;
const height = rows * cellH + (rows - 1) * GAP;

const out = Buffer.alloc(width * height * 4);
for (let i = 0; i < out.length; i += 4) {
  out[i] = 0xff;
  out[i + 1] = 0xff;
  out[i + 2] = 0xff;
  out[i + 3] = 0xff;
}

inputs.forEach((entry, index) => {
  const col = index % cols;
  const row = Math.floor(index / cols);
  const originX = col * (cellW + GAP);
  const originY = row * (cellH + GAP);
  const wrong = /wrong/i.test(entry.name);
  const frame = wrong ? [0xd0, 0x20, 0x20] : [0x20, 0xa0, 0x40];
  // frame
  for (let y = 0; y < cellH; y++) {
    for (let x = 0; x < cellW; x++) {
      const d = ((originY + y) * width + (originX + x)) * 4;
      out[d] = frame[0];
      out[d + 1] = frame[1];
      out[d + 2] = frame[2];
    }
  }
  // panel
  for (let y = 0; y < entry.img.height; y++) {
    for (let x = 0; x < entry.img.width; x++) {
      const s = (y * entry.img.width + x) * 4;
      const d = ((originY + BORDER + y) * width + (originX + BORDER + x)) * 4;
      const a = entry.img.pixels[s + 3];
      if (a === 0) continue;
      out[d] = entry.img.pixels[s];
      out[d + 1] = entry.img.pixels[s + 1];
      out[d + 2] = entry.img.pixels[s + 2];
      out[d + 3] = 255;
    }
  }
});

fs.writeFileSync(outPath, encodePng(width, height, out));
console.log(`wrote ${outPath} (${width}x${height}, ${inputs.length} panels, ${cols} cols)`);
inputs.forEach((entry, index) => {
  const col = (index % cols) + 1;
  const row = Math.floor(index / cols) + 1;
  console.log(`  r${row}c${col}: ${entry.name}${/wrong/i.test(entry.name) ? "  [red frame]" : "  [green frame]"}`);
});
