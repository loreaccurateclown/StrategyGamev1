#!/usr/bin/env node
/**
 * Generates a Tiled JSON map plus a resolved terrain sidecar.
 *
 * The composition is done by scripts/lib/compose-map.cjs (an Advance-Wars-1
 * style battlefield). This file owns the CLI, the deterministic seeding, the
 * Tiled JSON envelope, the tileset-image copy, the terrain sidecar, and the
 * verification that fails loudly on a map which "looks generated" but is wrong.
 *
 * Usage:
 *   node scripts/generate-map.cjs [--seed 1234] [--width 64] [--height 48]
 *   npm run map:generate -- --seed 1234
 */
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

const { installSeededRandom } = require("./lib/prng.cjs");
const { compose } = require("./lib/compose-map.cjs");
const palette = require("../assets/generator/palette.json");

const REPO_ROOT = path.join(__dirname, "..");
const DEFAULT_SEED = 1234;
const DEFAULT_MAP_WIDTH = 64;
const DEFAULT_MAP_HEIGHT = 48;
const MAP_NAME = "level_01";

const OCCUPANCY_BAND = [0.32, 0.42];

/** Parses `--key value` / `--key=value` pairs. */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const withoutDashes = token.slice(2);
    const equalsIndex = withoutDashes.indexOf("=");
    if (equalsIndex !== -1) {
      args[withoutDashes.slice(0, equalsIndex)] = withoutDashes.slice(equalsIndex + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[withoutDashes] = next;
      i++;
    } else {
      args[withoutDashes] = "true";
    }
  }
  return args;
}

function toPositiveInt(value, fallback, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${label} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const seed = toPositiveInt(args.seed, DEFAULT_SEED, "seed");
const mapWidth = toPositiveInt(args.width, DEFAULT_MAP_WIDTH, "width");
const mapHeight = toPositiveInt(args.height, DEFAULT_MAP_HEIGHT, "height");

const generatedFolder = path.join(REPO_ROOT, "public", "assets", "maps");

function tileLayer(name, data) {
  return {
    name,
    type: "tilelayer",
    x: 0,
    y: 0,
    width: mapWidth,
    height: mapHeight,
    visible: true,
    opacity: 1,
    data: Array.from(data),
  };
}

function buildMap(visual, variations, collisions) {
  const ground = new Array(mapWidth * mapHeight).fill(1);
  return {
    type: "map",
    version: "1.10",
    tiledversion: "1.12.2",
    orientation: "orthogonal",
    renderorder: "right-down",
    width: mapWidth,
    height: mapHeight,
    tilewidth: palette.tileset.tileSize,
    tileheight: palette.tileset.tileSize,
    infinite: false,
    nextlayerid: 5,
    nextobjectid: 1,
    tilesets: [
      {
        firstgid: 1,
        name: palette.tileset.name,
        image: palette.tileset.image,
        imagewidth: palette.tileset.imageWidth,
        imageheight: palette.tileset.imageHeight,
        tilewidth: palette.tileset.tileSize,
        tileheight: palette.tileset.tileSize,
        spacing: palette.tileset.spacing,
        margin: palette.tileset.margin,
        columns: palette.tileset.columns,
        tilecount: palette.tileset.tileCount,
      },
    ],
    layers: [
      tileLayer("ground", ground),
      tileLayer("ground-variations", variations),
      tileLayer("terrain", visual),
      tileLayer("collisions", collisions.map((c) => (c ? 1 : 0))),
    ],
  };
}

function main() {
  fs.mkdirSync(generatedFolder, { recursive: true });

  const restoreRandom = installSeededRandom(seed);
  try {
    console.log(
      `Generating ${mapWidth}x${mapHeight} map "${MAP_NAME}" at ${palette.tileset.tileSize}px (seed ${seed})`
    );

    const composed = compose(mapWidth, mapHeight);
    const map = buildMap(composed.visual, composed.variations, composed.collisions);

    verifyMap(map, composed);

    const mapPath = path.join(generatedFolder, `${MAP_NAME}.json`);
    fs.writeFileSync(mapPath, JSON.stringify(map));

    // Tileset image next to the map, so the JSON's relative `image` resolves.
    const imagePath = path.join(generatedFolder, palette.tileset.image);
    fs.copyFileSync(path.join(REPO_ROOT, palette.tileset.source), imagePath);

    // Resolved terrain sidecar (phase 4 G3) — the client never reverse-maps gids.
    const paletteHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(palette))
      .digest("hex")
      .slice(0, 16);
    const sidecarPath = path.join(generatedFolder, `${MAP_NAME}.terrain.json`);
    fs.writeFileSync(
      sidecarPath,
      JSON.stringify({
        width: mapWidth,
        height: mapHeight,
        tileSize: palette.tileset.tileSize,
        seed,
        paletteHash,
        terrain: Array.from(composed.terrain),
      })
    );

    console.log(`Wrote ${path.relative(REPO_ROOT, mapPath)}`);
    console.log(`Wrote ${path.relative(REPO_ROOT, sidecarPath)}`);
    console.log(`Tileset image ${path.relative(REPO_ROOT, imagePath)}`);
  } finally {
    restoreRandom();
  }
}

/**
 * Fails loudly on the failure modes that produce a map which "looks generated"
 * but is wrong: wrong board size, a wrong tileset header, holes in the ground,
 * a gid that does not resolve to terrain, visual/terrain-model drift, UI gids
 * used as terrain, occupancy outside the band, a partitioned walkable area, or
 * a collision layer that disagrees with the water cells.
 */
function verifyMap(map, composed) {
  const problems = [];
  const total = mapWidth * mapHeight;

  if (map.width !== mapWidth || map.height !== mapHeight) {
    problems.push(`board is ${map.width}x${map.height}, expected ${mapWidth}x${mapHeight}`);
  }
  if (map.tilewidth !== palette.tileset.tileSize || map.tileheight !== palette.tileset.tileSize) {
    problems.push(`tile size is ${map.tilewidth}x${map.tileheight}, expected ${palette.tileset.tileSize}`);
  }

  const tileset = map.tilesets[0];
  if (!tileset) {
    problems.push("map has no tileset");
  } else {
    if (tileset.firstgid !== 1) problems.push(`firstgid is ${tileset.firstgid}, expected 1`);
    if (tileset.columns !== palette.tileset.columns) problems.push(`columns ${tileset.columns}, expected ${palette.tileset.columns}`);
    if (tileset.spacing !== palette.tileset.spacing) problems.push(`spacing ${tileset.spacing}, expected ${palette.tileset.spacing}`);
    if (tileset.tilecount !== palette.tileset.tileCount) problems.push(`tilecount ${tileset.tilecount}, expected ${palette.tileset.tileCount}`);
  }

  const ground = map.layers.find((l) => l.name === "ground");
  if (!ground) problems.push("no ground layer");
  else if (ground.data.some((v) => v === 0)) problems.push("ground layer has holes (zero cells)");

  const terrainLayer = map.layers.find((l) => l.name === "terrain");
  const collisionsLayer = map.layers.find((l) => l.name === "collisions");
  if (!terrainLayer) problems.push("no terrain layer");
  if (!collisionsLayer) problems.push("no collisions layer");

  // gid -> terrain type map (flip bits are masked before lookup)
  const gidToTerrain = new Map();
  for (const [name, def] of Object.entries(palette.terrain)) {
    for (const gid of def.gids) {
      if (gidToTerrain.has(gid)) problems.push(`palette maps gid ${gid} to more than one terrain`);
      gidToTerrain.set(gid, { name, type: def.type });
    }
  }
  const never = new Set(palette.neverUseAsTerrain);

  // visual layer vs terrain model (drift check) + unknown/forbidden gids
  if (terrainLayer && collisionsLayer) {
    for (let i = 0; i < total; i++) {
      const gid = terrainLayer.data[i];
      const model = composed.terrain[i];
      if (gid === 0) {
        // A non-grass cell must have a visual tile.
        if (model !== 1) problems.push(`terrain model ${model} at cell ${i} has no visual tile`);
        continue;
      }
      const base = gid & palette.gidMask;
      if (never.has(base)) problems.push(`forbidden gid ${base} used at cell ${i}`);
      const resolved = gidToTerrain.get(base);
      if (!resolved) problems.push(`unknown gid ${gid} (base ${base}) at cell ${i}`);
      else if (resolved.type !== model) {
        problems.push(`cell ${i}: visual ${resolved.name} but terrain model is type ${model}`);
      }
      // collision layer must mark exactly the impassable cells: water (3) and
      // buildings (6). Buildings are impassable per TERRAIN_DEFS.
      const blocked = collisionsLayer.data[i] !== 0;
      const shouldBlock = model === 3 || model === 6;
      if (blocked !== shouldBlock) {
        problems.push(`collision mismatch at cell ${i} (blocked=${blocked}, model=${model})`);
      }
    }
  }

  // occupancy
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const t of composed.terrain) counts[t] = (counts[t] || 0) + 1;
  const pct = (k) => ((100 * (counts[k] || 0)) / total).toFixed(1) + "%";
  const nonGrass = total - counts[1];
  if (nonGrass / total < OCCUPANCY_BAND[0] || nonGrass / total > OCCUPANCY_BAND[1]) {
    const p = ((100 * nonGrass) / total).toFixed(1) + "%";
    problems.push(`obstacle coverage ${p} outside band ${OCCUPANCY_BAND.map((b) => (b * 100).toFixed(0) + "%").join("..")}`);
  }
  for (const [name, type] of [["forest", 2], ["water", 3], ["mountain", 4], ["road", 5], ["building", 6]]) {
    if (!counts[type]) problems.push(`no ${name} tiles on the board`);
  }

  // connectivity: water (3) and buildings (6) are impassable
  const impassable = (t) => t === 3 || t === 6;
  let walkable = 0;
  let components = 0;
  let largest = 0;
  const seen = new Uint8Array(total);
  for (let i = 0; i < total; i++) if (!impassable(composed.terrain[i])) walkable++;
  for (let start = 0; start < total; start++) {
    if (impassable(composed.terrain[start]) || seen[start]) continue;
    components++;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const cell = stack.pop();
      size++;
      const x = cell % mapWidth;
      const y = (cell - x) / mapWidth;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) continue;
        const ni = ny * mapWidth + nx;
        if (!impassable(composed.terrain[ni]) && !seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    if (size > largest) largest = size;
  }
  if (components !== 1) {
    problems.push(`walkable area is split into ${components} components (largest ${largest}/${walkable})`);
  }

  // road connectivity: the road graph must be one piece. A district cut off from
  // the network is still walkable across grass, so the check above cannot catch
  // it - an orphan road fragment reads as a broken road on the map.
  const isRoad = (t) => t === 5;
  let roadCells = 0;
  let roadComponents = 0;
  let largestRoad = 0;
  const roadSeen = new Uint8Array(total);
  for (let i = 0; i < total; i++) if (isRoad(composed.terrain[i])) roadCells++;
  for (let start = 0; start < total; start++) {
    if (!isRoad(composed.terrain[start]) || roadSeen[start]) continue;
    roadComponents++;
    let size = 0;
    const stack = [start];
    roadSeen[start] = 1;
    while (stack.length > 0) {
      const cell = stack.pop();
      size++;
      const x = cell % mapWidth;
      const y = (cell - x) / mapWidth;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) continue;
        const ni = ny * mapWidth + nx;
        if (isRoad(composed.terrain[ni]) && !roadSeen[ni]) {
          roadSeen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    if (size > largestRoad) largestRoad = size;
  }
  if (roadCells > 0 && roadComponents !== 1) {
    const orphans = roadComponents - 1;
    problems.push(
      `road network is split into ${roadComponents} components (${orphans} orphan fragment(s), largest ${largestRoad}/${roadCells})`
    );
  }

  const imagePath = path.join(generatedFolder, palette.tileset.image);
  if (!fs.existsSync(imagePath)) {
    problems.push(`tileset image was not copied to ${path.relative(REPO_ROOT, imagePath)}`);
  }

  if (problems.length > 0) {
    throw new Error("Generated map failed verification:\n  - " + problems.join("\n  - "));
  }

  console.log(
    `Verified: ${map.width}x${map.height} @ ${map.tilewidth}px, ${map.layers.length} layers | ` +
      `occupancy: forest ${pct(2)}, mountain ${pct(4)}, water ${pct(3)}, road ${pct(5)}, ` +
      `building ${pct(6)}, grass ${pct(1)} | ` +
      `connectivity: ${components} component(s), ${largest}/${walkable} walkable cells | ` +
      `roads: ${roadComponents} component(s), ${largestRoad}/${roadCells} road cells`
  );
}

try {
  main();
} catch (error) {
  console.error(error.message ?? error);
  process.exitCode = 1;
}
