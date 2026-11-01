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
 * Forest: a 6x5 grove, 26 of 30 cells filled. The outer corners stay empty so
 * groves read as rounded rather than as rectangular blocks. Three of the five
 * palette variants are used (T, t, f).
 */
const FOREST_ROWS = [
  ".TtfT.",
  "TTttTT",
  "TftTtT",
  "TTtffT",
  ".TtTT.",
];

/**
 * Water: a 7x6 pond, 38 of 42 cells filled (corners rounded). Variants are
 * sprinkled in so the surface is not flat blue.
 */
const WATER_ROWS = [
  ".wwWww.",
  "wWswWww",
  "wwWwWww",
  "wwwWwww",
  "wWwwwws",
  ".wWwww.",
];

/**
 * Mountain: a 6x4 massif, 20 of 24 cells filled, built from the densest stone
 * tiles with three variants (m, M, n).
 */
const MOUNTAIN_ROWS = [
  ".mmMm.",
  "mMMnmM",
  "mmnMmm",
  ".mMmm.",
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
    { ".": 0, T: FOREST[0], t: FOREST[1], f: FOREST[2] },
    FOREST[0]
  ),
  water: elementLayers(
    "water",
    WATER_ROWS,
    { ".": 0, w: WATER[0], W: WATER[1], s: WATER[2] },
    WATER[0]
  ),
  mountain: elementLayers(
    "mountain",
    MOUNTAIN_ROWS,
    { ".": 0, m: MOUNTAIN[0], M: MOUNTAIN[1], n: MOUNTAIN[2] },
    MOUNTAIN[0]
  ),
};

module.exports = { layerElements, palette };
