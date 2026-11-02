/**
 * Structural QA report for a generated map.
 *
 * Reads the map JSON plus its terrain sidecar and reports the things that are
 * easy to get subtly wrong: road topology (is the road network one piece?),
 * city road frontage, walkable connectivity, bridge assembly and terrain mix.
 *
 * Usage: node tools/map-stats.cjs [mapBasename]
 * Default mapBasename: level_01  (public/assets/maps/<basename>.json)
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const basename = process.argv[2] ?? "level_01";
const mapPath = path.join(ROOT, "public", "assets", "maps", `${basename}.json`);
const sidecarPath = path.join(ROOT, "public", "assets", "maps", `${basename}.terrain.json`);

const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));

const W = sidecar.width;
const H = sidecar.height;
const T = sidecar.terrain;

const GRASS = 1;
const FOREST = 2;
const WATER = 3;
const MOUNTAIN = 4;
const ROAD = 5;
const BUILDING = 6;

const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : T[y * W + x]);
const idx = (x, y) => y * W + x;

/** Groups cells matching `test` into 4-connected components. */
function components(test) {
  const seen = new Uint8Array(W * H);
  const groups = [];
  for (let i = 0; i < W * H; i++) {
    if (!test(T[i]) || seen[i]) continue;
    const cells = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length > 0) {
      const c = stack.pop();
      cells.push(c);
      const x = c % W;
      const y = Math.floor(c / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = idx(nx, ny);
        if (test(T[ni]) && !seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    groups.push(cells);
  }
  groups.sort((a, b) => b.length - a.length);
  return groups;
}

function bbox(cells) {
  let minX = W;
  let maxX = 0;
  let minY = H;
  let maxY = 0;
  for (const c of cells) {
    const x = c % W;
    const y = Math.floor(c / W);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return `x${minX}-${maxX} y${minY}-${maxY}`;
}

const total = W * H;
const counts = new Map();
for (const t of T) counts.set(t, (counts.get(t) ?? 0) + 1);
const pct = (n) => ((100 * n) / total).toFixed(2) + "%";

console.log(`map: ${basename}  ${W}x${H} = ${total} cells  (${map.layers.length} layers)`);
console.log(
  `terrain: grass ${pct(counts.get(GRASS) ?? 0)} | forest ${pct(counts.get(FOREST) ?? 0)} | ` +
    `water ${pct(counts.get(WATER) ?? 0)} | mountain ${pct(counts.get(MOUNTAIN) ?? 0)} | ` +
    `road ${pct(counts.get(ROAD) ?? 0)} | building ${pct(counts.get(BUILDING) ?? 0)}`
);

// --- roads ---------------------------------------------------------------
const roads = components((t) => t === ROAD);
const roadCells = roads.reduce((s, c) => s + c.length, 0);
console.log(`\nroads: ${roadCells} cells in ${roads.length} component(s)`);
roads.forEach((c, i) => {
  console.log(`  ${i === 0 ? "main  " : "orphan"} ${String(c.length).padStart(4)} cells  ${bbox(c)}`);
});

// --- cities --------------------------------------------------------------
const cityCells = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) if (T[idx(x, y)] === BUILDING) cityCells.push([x, y]);
}
let frontage = 0;
for (const [x, y] of cityCells) {
  if (at(x + 1, y) === ROAD || at(x - 1, y) === ROAD || at(x, y + 1) === ROAD || at(x, y - 1) === ROAD) {
    frontage++;
  }
}
console.log(`\ncities: ${cityCells.length} cell(s), ${frontage} with road frontage`);
if (cityCells.length > 0) console.log(`  extent ${bbox(cityCells.map(([x, y]) => idx(x, y)))}`);

// --- walkable connectivity ----------------------------------------------
const impassable = (t) => t === WATER || t === BUILDING;
const walkable = T.reduce((s, t) => s + (impassable(t) ? 0 : 1), 0);
const walkGroups = components((t) => !impassable(t));
console.log(`\nwalkable: ${walkable} cells in ${walkGroups.length} component(s)`);
walkGroups.slice(1).forEach((c) => console.log(`  STRANDED ${c.length} cells  ${bbox(c)}`));

// --- bridges -------------------------------------------------------------
const terrainLayer = map.layers.find((l) => l.name === "terrain");
const gidCounts = new Map();
for (const g of terrainLayer.data) {
  if (!g) continue;
  const base = g & 0x1fffffff;
  gidCounts.set(base, (gidCounts.get(base) ?? 0) + 1);
}
const deck = gidCounts.get(131) ?? 0;
const struts = gidCounts.get(149) ?? 0;
console.log(`\nbridge: deck(131) ${deck}, struts(149) ${struts}, vertical(167) ${gidCounts.get(167) ?? 0}`);

// --- verdict -------------------------------------------------------------
const problems = [];
if (roads.length > 1) problems.push(`${roads.length - 1} orphan road fragment(s)`);
if (frontage !== cityCells.length) problems.push(`${cityCells.length - frontage} city cell(s) off the road network`);
if (walkGroups.length !== 1) problems.push(`${walkGroups.length} walkable component(s)`);
if (deck !== struts) problems.push(`bridge deck/strut count mismatch (${deck} vs ${struts})`);
console.log(`\nverdict: ${problems.length === 0 ? "OK" : problems.join("; ")}`);
