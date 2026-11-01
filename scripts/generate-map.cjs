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
const DEFAULT_MAP_WIDTH = 32;
const DEFAULT_MAP_HEIGHT = 32;
const MAP_NAME = "level_01";

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
  // Budget check for a 32x32 board (1024 cells). Each placement reserves
  // (width + 2*freeSpace) x (height + 2*freeSpace):
  //   forest   6 x (5+2)*(4+2) = 252
  //   water    3 x (5+4)*(5+4) = 243
  //   mountain 3 x (4+2)*(4+2) = 108
  // ~59% occupancy leaves room to place; the earlier 10/5/4 set needed ~95% and
  // made the generator grow the board to 32x44 instead.
  elementsQuantity: { forest: 6, water: 3, mountain: 3 },
  elementsFreeSpaceAround: { forest: 1, water: 2, mountain: 1 },
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

  if (problems.length > 0) {
    throw new Error("Generated map failed verification:\n  - " + problems.join("\n  - "));
  }

  console.log(
    `Verified: ${map.width}x${map.height} @ ${map.tilewidth}px, ` +
      `${map.layers.length} layers (${map.layers.map((layer) => layer.name).join(", ")})`
  );
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
