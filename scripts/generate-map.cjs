#!/usr/bin/env node
/**
 * Generates a Tiled JSON map for the game with @reldens/tile-map-generator.
 *
 * Why .cjs: package.json sets "type": "module", so a plain .js file may not use
 * require(). The generator itself is CommonJS-only and Node-only (it writes files
 * through @reldens/server-utils), so it cannot be imported from browser code.
 *
 * Why Math.random is patched: the generator has no seed option. Installing a
 * seeded PRNG before constructing it is what makes `--seed` meaningful.
 *
 * Usage:
 *   node scripts/generate-map.cjs [--seed 1234] [--width 32] [--height 32]
 *   npm run map:generate -- --seed 1234
 */
const path = require("node:path");
const fs = require("node:fs");

const { installSeededRandom } = require("./lib/prng.cjs");
const { layerElements, palette } = require("./lib/map-elements.cjs");

// The generator is required lazily, after Math.random has been patched, so no
// module-level randomness can slip past the seeded implementation.
const { RandomMapGenerator } = require("@reldens/tile-map-generator");

const REPO_ROOT = path.join(__dirname, "..");
const DEFAULT_SEED = 1234;
const DEFAULT_MAP_WIDTH = 64;
const DEFAULT_MAP_HEIGHT = 48;
const MAP_NAME = "level_01";

/**
 * Layers whose name contains this marker carry collision data only. They are
 * skipped by the terrain-grid resolution and never rendered by the client.
 */
const COLLISION_LAYER_MARKER = "collisions";

/**
 * Acceptable obstacle-coverage band as a fraction of the board. The design
 * target is ~36% (forest ~17%, mountain ~9%, water ~10%); the band turns silent
 * regressions of that density into a generation failure.
 */
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

/** Generator options. Keys and defaults cross-checked against 0.64.0 source. */
const mapData = {
  rootFolder: REPO_ROOT,
  generatedFolder,
  mapName: MAP_NAME,

  // --- tileset: must mirror assets/tilemaps/kenney_tinybattle.tsx exactly ---
  // @reldens/tile-map-generator treats every value in a layer as a 1-based gid
  // (tilesets[0].firstgid is hard-coded to 1), so gid = tile index + 1.
  tileSize: palette.tileset.tileSize,
  columns: palette.tileset.columns,
  tileCount: palette.tileset.tileCount,
  margin: palette.tileset.margin,
  spacing: palette.tileset.spacing,
  imageWidth: palette.tileset.imageWidth,
  imageHeight: palette.tileset.imageHeight,
  // Relative to rootFolder; the generator copies it into generatedFolder under
  // tileSheetName, which is also the `image` field written into the map JSON.
  tileSheetPath: palette.tileset.source,
  tileSheetName: palette.tileset.image,

  // --- board ---
  mapSize: { mapWidth, mapHeight },

  // --- ground ---
  groundTile: palette.terrain.grass.primary,
  randomGroundTiles: palette.terrain.grass.variants,
  variableTilesPercentage: 10,

  // --- placement constraints ---
  layerElements,
  // Budget check for a 64x48 board (3072 cells). Each placement reserves
  // (width + 2*freeSpace) x (height + 2*freeSpace):
  //   forest   20 x (6+0)*(5+0) = 600
  //   water     8 x (7+2)*(6+2) = 576
  //   mountain 14 x (6+0)*(4+0) = 336
  // 1512/3072 = 49% reserved, well under the growth threshold. freeSpace 0 on
  // forest/mountain is deliberate: they are passable (cost 2/3), so contiguous
  // groves and ridges add tactical cost without disconnecting the map. Water is
  // the only impassable terrain and keeps freeSpace 1 so ponds cannot touch;
  // verifyMap flood-fills the passable cells to prove no pond wall partitions it.
  elementsQuantity: { forest: 20, water: 8, mountain: 14 },
  elementsFreeSpaceAround: { forest: 0, water: 1, mountain: 0 },
  minimumElementsFreeSpaceAround: 1,
  minimumDistanceFromBorders: 1,
  blockMapBorder: true,
  // Rearrange already-placed elements before falling back to growing the map.
  // The generator has no "skip this element" mode, so this is the only way to
  // keep the requested board size from being silently increased.
  placeRejectResolver: "moveElements",

  // No road tile exists in this tileset, so no path is carved: mainPathSize 0 and
  // pathTile unset. collisionLayersForPaths is still declared so that adding a
  // pathTile later behaves correctly.
  collisionLayersForPaths: ["collisions"],
};

async function main() {
  fs.mkdirSync(generatedFolder, { recursive: true });

  const restoreRandom = installSeededRandom(seed);

  try {
    console.log(
      `Generating ${mapWidth}x${mapHeight} map "${MAP_NAME}" at ${palette.tileset.tileSize}px ` +
        `(seed ${seed}, object mode)`
    );

    const generator = new RandomMapGenerator(mapData);
    const map = await generator.generate();

    if (!map) {
      throw new Error(
        "Generator returned no map — check the options above against OptionsValidator.requiredKeys"
      );
    }

    verifyMap(map);

    console.log(`Wrote ${path.relative(REPO_ROOT, generator.mapFileFullPath)}`);
    console.log(`Tileset image ${path.relative(REPO_ROOT, path.join(generatedFolder, palette.tileset.image))}`);
  } finally {
    restoreRandom();
  }
}

/**
 * Fails loudly on the failure modes that produce a map which "looks generated"
 * but renders as a magenta board: wrong board size, missing ground, or a tileset
 * header that disagrees with the .tsx file.
 */
function verifyMap(map) {
  const problems = [];

  if (map.width !== mapWidth || map.height !== mapHeight) {
    problems.push(`board is ${map.width}x${map.height}, expected ${mapWidth}x${mapHeight}`);
  }

  if (map.tilewidth !== palette.tileset.tileSize || map.tileheight !== palette.tileset.tileSize) {
    problems.push(
      `tile size is ${map.tilewidth}x${map.tileheight}, expected ${palette.tileset.tileSize}`
    );
  }

  const tileset = map.tilesets[0];
  if (!tileset) {
    problems.push("map has no tileset");
  } else {
    if (tileset.firstgid !== 1) problems.push(`firstgid is ${tileset.firstgid}, expected 1`);
    if (tileset.columns !== palette.tileset.columns) {
      problems.push(`tileset columns is ${tileset.columns}, expected ${palette.tileset.columns}`);
    }
    if (tileset.spacing !== palette.tileset.spacing) {
      problems.push(`tileset spacing is ${tileset.spacing}, expected ${palette.tileset.spacing}`);
    }
    if (tileset.tilecount !== palette.tileset.tileCount) {
      problems.push(`tileset tilecount is ${tileset.tilecount}, expected ${palette.tileset.tileCount}`);
    }
  }

  // A zero anywhere in the ground layer means the layer is absent (groundTile was
  // falsy) or was treated as a 0-based index — both render as holes in Phaser.
  const groundLayer =
    map.layers.find((layer) => layer.name === "ground") ??
    map.layers.find((layer) => layer.type === "tilelayer");
  if (!groundLayer) {
    problems.push("map has no ground layer");
  } else {
    const zeros = groundLayer.data.filter((value) => value === 0).length;
    if (zeros > 0) {
      problems.push(`${zeros} zero cells in ground layer "${groundLayer.name}"`);
    }
  }

  const imagePath = path.join(generatedFolder, palette.tileset.image);
  if (!fs.existsSync(imagePath)) {
    problems.push(`tileset image was not copied to ${path.relative(REPO_ROOT, imagePath)}`);
  }

  // --- gid -> terrain map, resolved from the palette at generation time ---
  const gidToTerrain = new Map();
  for (const [terrain, def] of Object.entries(palette.terrain)) {
    for (const gid of new Set([def.primary, ...def.variants])) {
      if (gidToTerrain.has(gid) && gidToTerrain.get(gid) !== terrain) {
        problems.push(`palette.json maps gid ${gid} to more than one terrain`);
      }
      gidToTerrain.set(gid, terrain);
    }
  }

  // --- terrain grid from the visual layers ---
  // Ground layers (all grass, already verified zero-free) are the implicit
  // base; every element cell must map through the palette and no two elements
  // may overlap.
  const total = map.width * map.height;
  const cellTerrain = new Array(total).fill(null);
  for (const layer of map.layers) {
    if (layer.name.includes(COLLISION_LAYER_MARKER)) continue;
    if (layer.name === "ground" || layer.name === "ground-variations") continue;
    for (let i = 0; i < layer.data.length; i++) {
      const gid = layer.data[i];
      if (gid === 0) continue;
      const terrain = gidToTerrain.get(gid);
      if (!terrain) {
        problems.push(`unknown gid ${gid} in layer "${layer.name}" at cell ${i}`);
        continue;
      }
      if (cellTerrain[i] !== null && cellTerrain[i] !== terrain) {
        problems.push(`element overlap at cell ${i} (${cellTerrain[i]} vs ${terrain})`);
      }
      cellTerrain[i] = terrain;
    }
  }

  const counts = { grass: 0, forest: 0, water: 0, mountain: 0 };
  for (const terrain of cellTerrain) counts[terrain ?? "grass"]++;

  const pct = (n) => ((100 * n) / total).toFixed(1) + "%";
  const occupied = total - counts.grass;
  if (occupied / total < OCCUPANCY_BAND[0] || occupied / total > OCCUPANCY_BAND[1]) {
    problems.push(
      `obstacle coverage ${pct(occupied)} outside band ` +
        `${pct(Math.round(OCCUPANCY_BAND[0] * total))}..${pct(Math.round(OCCUPANCY_BAND[1] * total))}`
    );
  }
  for (const terrain of ["forest", "water", "mountain"]) {
    if (counts[terrain] === 0) problems.push(`no ${terrain} tiles on the board`);
  }

  // --- connectivity: the passable interior must be one component ---
  // Only the border ring and water block movement in-game (forest/mountain are
  // passable), so those are the only blockers here.
  const blocked = new Uint8Array(total);
  const border = map.layers.find((layer) => layer.name === "collisions-map-border");
  if (border) {
    for (let i = 0; i < total; i++) if (border.data[i] !== 0) blocked[i] = 1;
  }
  for (let i = 0; i < total; i++) if (cellTerrain[i] === "water") blocked[i] = 1;

  let walkable = 0;
  let components = 0;
  let largest = 0;
  const seen = new Uint8Array(total);
  for (let i = 0; i < total; i++) if (!blocked[i]) walkable++;
  for (let start = 0; start < total; start++) {
    if (blocked[start] || seen[start]) continue;
    components++;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const cell = stack.pop();
      size++;
      const x = cell % map.width;
      const y = (cell - x) / map.width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const ni = ny * map.width + nx;
        if (!blocked[ni] && !seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    if (size > largest) largest = size;
  }
  if (components !== 1) {
    problems.push(
      `walkable area is split into ${components} components (largest ${largest}/${walkable} cells)`
    );
  }

  // --- every element's collision layer must cover exactly its visual footprint ---
  for (const layer of map.layers) {
    if (!layer.name.endsWith("-visual")) continue;
    const collision = map.layers.find(
      (l) => l.name === layer.name.replace(/-visual$/, "-collisions")
    );
    if (!collision) {
      problems.push(`no collision layer for "${layer.name}"`);
      continue;
    }
    for (let i = 0; i < total; i++) {
      if ((layer.data[i] !== 0) !== (collision.data[i] !== 0)) {
        problems.push(`footprint mismatch in "${layer.name}" at cell ${i}`);
        break;
      }
    }
  }

  if (problems.length > 0) {
    throw new Error("Generated map failed verification:\n  - " + problems.join("\n  - "));
  }

  console.log(
    `Verified: ${map.width}x${map.height} @ ${map.tilewidth}px, ${map.layers.length} layers | ` +
      `occupancy: forest ${pct(counts.forest)}, mountain ${pct(counts.mountain)}, ` +
      `water ${pct(counts.water)}, grass ${pct(counts.grass)} | ` +
      `connectivity: ${components} component(s), ${largest}/${walkable} walkable cells`
  );
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
