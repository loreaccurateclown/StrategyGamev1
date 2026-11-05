/**
 * Bulk preview: generate N maps from freshly drawn seeds and render each one.
 *
 * Seeds come from `crypto.randomInt` rather than `Math.random`, so the draw does not
 * depend on any PRNG state this process happens to be in, and every seed is checked
 * against the ones already drawn so a draw can never collide with itself. Seeds are
 * printed, so any interesting map in the folder can be regenerated exactly.
 *
 * Usage:
 *   node tools/bulk-preview.cjs [--count 12] [--dir bulk_preview] [--seed 1234 ...]
 *
 * Output: tools/previews/<dir>/map-preview_seed<N>.png
 *
 * The generator and the renderer run as child processes with `stdio: "inherit"`.
 * Piped stdio is blocked in this sandbox (named pipes unavailable), so inheriting is
 * both the simplest and the only reliable option here.
 */
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const OUT_BASE = path.join(__dirname, "previews");

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const COUNT = Math.max(1, Number(arg("count", "12")));
const DIR = arg("dir", "bulk_preview");
const explicit = process.argv.reduce((acc, value, index) => {
  if (value === "--seed" && process.argv[index + 1]) acc.push(Number(process.argv[index + 1]));
  return acc;
}, []);

// 2**31 keeps the seeds inside a signed 32-bit integer, which is what the generator's
// mulberry32 seeder accepts without any reduction surprises.
const SEED_MAX = 2 ** 31;
const seeds = [];
for (const seed of explicit) {
  if (Number.isFinite(seed) && seed > 0 && !seeds.includes(seed)) seeds.push(seed);
}
while (seeds.length < COUNT) {
  const seed = crypto.randomInt(1, SEED_MAX);
  if (!seeds.includes(seed)) seeds.push(seed);
}

const outDir = path.join(OUT_BASE, DIR);
fs.mkdirSync(outDir, { recursive: true });
console.log(`bulk preview: ${seeds.length} seeds -> ${path.relative(ROOT, outDir)}`);
console.log(`seeds: ${seeds.join(" ")}`);

const run = (script, args) => {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`${script} ${args.join(" ")} exited ${result.status}`);
};

const written = [];
for (const seed of seeds) {
  run(path.join("scripts", "generate-map.cjs"), ["--seed", String(seed)]);
  const name = `map-preview_seed${seed}.png`;
  run(path.join("tools", "render-map-preview.cjs"), [`--out=${DIR}/${name}`]);
  written.push(name);
}
// Leave the checked-in map on its canonical seed rather than whichever seed was drawn
// last, so running this tool does not quietly change the committed map.
run(path.join("scripts", "generate-map.cjs"), ["--seed", "1234"]);

console.log("");
console.log(`wrote ${written.length} previews to ${path.relative(ROOT, outDir)}:`);
for (const name of written) console.log(`  ${name}`);
console.log("level_01.json restored to seed 1234");
