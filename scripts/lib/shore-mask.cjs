/**
 * Shoreline autotiling.
 *
 * A water cell is rendered according to which of its four orthogonal neighbours
 * are LAND. That is a 4-bit mask, so there are exactly 16 cases, and this module
 * is the whole table — one deliberate choice per case.
 *
 *   key = N<<3 | S<<2 | W<<1 | E
 *
 * Why a table instead of if-chains: the previous implementation handled nine of
 * the sixteen cases and silently fell through to the open-water tile for the
 * rest. A thin inlet is exactly one of the dropped cases, so it rendered as a
 * raw blue strip with no banks at all — which read as a glitch floating in the
 * grass.
 *
 * Art inventory (measured by `tools/tile-shore-scan.cjs`, not guessed):
 *
 *   fill 38                  open water
 *   edges 20 / 37 / 39       bank on N / W / E
 *   edges south              NOT 56 - see edgeGid() below
 *   corner 19                bank on N+W; mirrored for the other three corners
 *   innerCorners 91/92/93/94 bank wedge in exactly one corner (concave case)
 *   channelVertical 58       banks on W AND E — water running vertically between
 *                            two walls. The sheet has no rotated twin, and Tiled's
 *                            flip flags mirror rather than rotate, so there is no
 *                            N+S equivalent.
 *
 * `exact: false` marks the cases the sheet cannot draw. They are approximations,
 * kept explicit so they can be measured instead of silently misrendered.
 */
const palette = require("../../assets/generator/palette.json");

const FLIP_H = palette.flipFlags.horizontal;
const FLIP_V = palette.flipFlags.vertical;

/**
 * Resolve a palette edge entry, which may be a bare gid or `{ gid, flip }`.
 *
 * The sheet's only south-facing bank, 56, belongs to a different art family: it
 * carries no beach band at all and its water runs 12 px deep, while the north bank
 * (20) has a three-row peach beach and only 9 px of water. Dropped into a two-tile
 * tall inlet - the one shape that pairs a north bank directly against a south bank -
 * the two edges do not agree: the top edge gets the beach and the bottom edge gets a
 * hard water-to-grass cut. That is exactly the asymmetry that shows up at an inlet
 * mouth (measured: 20 has 28 beach pixels, 56 has zero; no tile in the sheet has a
 * beach above a south edge).
 *
 * So the south bank is declared as the vertical mirror of the north bank. Flip flags
 * mirror rather than rotate, which is precisely what is wanted here.
 */
function edgeGid(entry) {
  if (typeof entry === "number") return entry;
  return entry.gid | (entry.flip === "h" ? FLIP_H : 0) | (entry.flip === "v" ? FLIP_V : 0);
}

/** Ordered so the table reads as a truth table: N,S major then W,E. */
const SHORE_CASES = {
  0: { name: "open water", exact: true, gid: () => palette.terrain.water.fill },

  8: { name: "bank N", exact: true, gid: () => edgeGid(palette.coast.edges.north) },
  2: { name: "bank W", exact: true, gid: () => edgeGid(palette.coast.edges.west) },
  1: { name: "bank E", exact: true, gid: () => edgeGid(palette.coast.edges.east) },
  4: { name: "bank S", exact: true, gid: () => edgeGid(palette.coast.edges.south) },

  10: { name: "corner N+W", exact: true, gid: () => palette.coast.corner },
  9: { name: "corner N+E", exact: true, gid: () => palette.coast.corner | FLIP_H },
  6: { name: "corner S+W", exact: true, gid: () => palette.coast.corner | FLIP_V },
  5: { name: "corner S+E", exact: true, gid: () => palette.coast.corner | FLIP_H | FLIP_V },

  3: {
    name: "channel W+E",
    exact: true,
    gid: () => palette.coast.channelVertical,
  },
  12: {
    name: "channel N+S",
    exact: false,
    gid: () => edgeGid(palette.coast.edges.north),
    note: "no N+S bank art exists; shows one bank, the far side stays open",
  },

  14: {
    name: "end of an eastward run (N+S+W)",
    exact: true,
    gid: () => edgeGid(palette.coast.edges.west),
  },
  13: {
    name: "end of a westward run (N+S+E)",
    exact: true,
    gid: () => edgeGid(palette.coast.edges.east),
  },
  7: {
    name: "end of a northward run (S+W+E)",
    exact: true,
    gid: () => edgeGid(palette.coast.edges.south),
  },
  11: {
    name: "end of a southward run (N+W+E)",
    exact: true,
    gid: () => edgeGid(palette.coast.edges.north),
  },

  15: {
    name: "isolated cell (land N+S+W+E)",
    exact: false,
    gid: () => palette.coast.corner,
    note: "no pond ring art; an L of bank is the closest available",
  },
};

function maskKey(land) {
  return (land.n ? 8 : 0) | (land.s ? 4 : 0) | (land.w ? 2 : 0) | (land.e ? 1 : 0);
}

/**
 * Diagonal follow-up pass.
 *
 * The four-neighbour table above is complete on its own, but it cannot see a land
 * corner touching the water corner-to-corner. Such a cell has NO orthogonal land,
 * so it resolves to open water and the bank just stops - the water looks like it
 * bleeds into the grass at the diagonal. Measured on generated maps: 1,756 cells
 * over 40 maps (44 per map), so this is not a rare edge case.
 *
 * The sheet does have the art: 91/92/93/94 put a bank wedge in exactly one corner
 * (NW/NE/SE/SW). They are only applicable when the orthogonal mask is empty -
 * once any orthogonal neighbour is land, the ordinary edge/corner tile already
 * draws a bank and would fight with a diagonal wedge.
 *
 * Cases with two diagonal land corners are left on the plain fill: the paired
 * tiles (40/73/75/76) are keyed on the *edge middle* being water, which does not
 * line up with every opposite-corner pair, and they measure ~2.5 cells per map.
 */
const INNER_CORNER_BY_DIAGONAL = {
  8: "nw", // NW land only
  4: "ne",
  1: "se",
  2: "sw",
};

function diagonalKey(diagonals) {
  if (!diagonals) return 0;
  return (diagonals.nw ? 8 : 0) | (diagonals.ne ? 4 : 0) | (diagonals.sw ? 2 : 0) | (diagonals.se ? 1 : 0);
}

/**
 * @param {{n:boolean,s:boolean,w:boolean,e:boolean}} land which orthogonal neighbours are land
 * @param {{nw:boolean,ne:boolean,sw:boolean,se:boolean}} [diagonals] which diagonals are land
 * @returns {number} tileset gid (flip flags included where needed)
 */
function shoreGid(land, diagonals) {
  const key = maskKey(land);
  const entry = SHORE_CASES[key];
  if (!entry) throw new Error(`shore line mask has no case for ${key}`);
  // Diagonals only speak when no orthogonal neighbour is land: that is the one
  // case the edge/corner tiles cannot express.
  if (key === 0) {
    const dKey = diagonalKey(diagonals);
    const corner = INNER_CORNER_BY_DIAGONAL[dKey];
    if (corner) return palette.coast.innerCorners[corner];
  }
  return entry.gid();
}

module.exports = { shoreGid, maskKey, diagonalKey, SHORE_CASES, INNER_CORNER_BY_DIAGONAL };
