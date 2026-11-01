/**
 * Turns readable ASCII art into Tiled tile-layer objects.
 *
 * Authoring element shapes as gid arrays is unreadable, so elements are written
 * as string rows plus a legend. This converts one to the layer shape the
 * generator expects:
 *
 *   {
 *     name: 'collisions' | 'forest-visual' | ...,
 *     type: 'tilelayer',
 *     width, height,          // required by MapGridBuilder (element.width/height)
 *     data,                   // row-major, length = width * height
 *     visible, opacity, x, y  // required by MapLayersComposer
 *   }
 */

/**
 * @param {string} name Layer name. The generator matches collision layers by
 *   substring, so any layer whose name contains "collisions" is treated as a
 *   blocker when it plans paths.
 * @param {Record<string, number>} legend Maps one character to one gid.
 * @param {string[]} rows ASCII rows, all the same length.
 * @param {{visible?: boolean}} [options]
 * @returns {import('../../types/generator').TileLayer}
 */
function buildLayer(name, legend, rows, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Layer "${name}" needs at least one row`);
  }

  const width = rows[0].length;
  for (const [index, row] of rows.entries()) {
    if (row.length !== width) {
      throw new Error(
        `Layer "${name}" row ${index} is ${row.length} wide, expected ${width}`
      );
    }
  }

  const data = [];
  for (const [rowIndex, row] of rows.entries()) {
    for (const [colIndex, char] of [...row].entries()) {
      if (!(char in legend)) {
        throw new Error(
          `Layer "${name}" has unknown char "${char}" at row ${rowIndex}, col ${colIndex}. ` +
            `Known chars: ${Object.keys(legend).join(" ")}`
        );
      }
      data.push(legend[char]);
    }
  }

  return {
    name,
    type: "tilelayer",
    width,
    height: rows.length,
    data,
    visible: options.visible ?? true,
    opacity: 1,
    x: 0,
    y: 0,
  };
}

/**
 * Builds a collision mask from the same ASCII art as the visual layer:
 * "." stays empty (gid 0) and every other character becomes `gid`. The mask
 * only needs to know "is this cell blocked", so the visual gid is irrelevant.
 */
function buildCollisionLayer(name, rows, gid) {
  const chars = [...new Set(rows.join(""))];
  const legend = Object.fromEntries(chars.map((char) => [char, char === "." ? 0 : gid]));
  return buildLayer(name, legend, rows);
}

module.exports = { buildLayer, buildCollisionLayer };
