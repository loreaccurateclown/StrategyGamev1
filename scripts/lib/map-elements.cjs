/**
 * Element definitions for the map generator (object-mode `layerElements`).
 *
 * Elements are authored as ASCII art so the shapes are reviewable in a diff.
 * Each element contributes two layers:
 *   - <key>-visual      the tiles the player sees
 *   - <key>-collisions  the same footprint as a blocker mask
 *
 * The collision layer is not optional bookkeeping: @reldens/tile-map-generator
 * matches collision layers by name substring (see `collisionLayersForPaths`), so
 * every element needs a layer whose name contains "collisions" or the path
 * router will happily carve through it.
 *
 * Layers are built against the verified gids in assets/generator/palette.json.
 */
const path = require("node:path");
const fs = require("node:fs");
const { buildLayer, buildCollisionLayer } = require("./tile-grid.cjs");

const palettePath = path.join(__dirname, "..", "..", "assets", "generator", "palette.json");
const palette = JSON.parse(fs.readFileSync(palettePath, "utf8"));

const FOREST = palette.terrain.forest.variants;
const WATER = palette.terrain.water.variants;
const MOUNTAIN = palette.terrain.mountain.variants;

/**
 * Forest: a 5x4 clump of tree tiles. The outer corners stay empty so clumps read
 * as rounded rather than as rectangular blocks.
 */
const FOREST_ROWS = [
  ".TtT.",
  "TTtTT",
  "TTTtT",
  ".TtT.",
];

/**
 * Water: a 5x5 pond. Variants are sprinkled in so the surface is not flat blue.
 */
const WATER_ROWS = [
  "wwWww",
  "wWwww",
  "wwwww",
  "wwwWw",
  "wWwww",
];

/**
 * Mountain: a 4x4 massif built from the densest stone tiles.
 */
const MOUNTAIN_ROWS = [
  "mmMm",
  "mmmm",
  "mMmm",
  "mmMm",
];

/** Wraps rows in a layer pair: visual first (the generator sizes from it), then collisions. */
function elementLayers(key, rows, legend, collisionGid) {
  return [
    buildLayer(`${key}-visual`, legend, rows),
    buildCollisionLayer(`${key}-collisions`, rows, collisionGid),
  ];
}

const layerElements = {
  forest: elementLayers(
    "forest",
    FOREST_ROWS,
    { ".": 0, T: FOREST[0], t: FOREST[1] },
    FOREST[0]
  ),
  water: elementLayers(
    "water",
    WATER_ROWS,
    { w: WATER[0], W: WATER[1] },
    WATER[0]
  ),
  mountain: elementLayers(
    "mountain",
    MOUNTAIN_ROWS,
    { m: MOUNTAIN[0], M: MOUNTAIN[1] },
    MOUNTAIN[0]
  ),
};

module.exports = { layerElements, palette };
