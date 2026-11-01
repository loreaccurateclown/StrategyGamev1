/**
 * Map composer — replaces the @reldens/tile-map-generator scatter step.
 *
 * Produces an Advance-Wars-1-style battlefield deterministically from the seeded
 * Math.random: a framing forest border band with openings, mountain accents,
 * forest blobs grown inward from the band, interior lakes with a coastline, and
 * two roads (with bends, a junction and a bridge). The result is expressed as
 * Tiled-friendly layer data plus a resolved terrain grid for the sidecar.
 *
 * Terrain codes mirror TerrainType in src/types/game.types.ts:
 *   1 Grass, 2 Forest, 3 Water, 4 Mountain, 5 Road.
 *
 * The composer only ever uses the clean coast subset: corner 19 plus flips, the
 * four straight edges, and water fill 38 (see plans/tile_roles.md).
 */

const palette = require("../../assets/generator/palette.json");

const GRASS = 1;
const FOREST = 2;
const WATER = 3;
const MOUNTAIN = 4;
const ROAD = 5;

const FLIP_H = palette.flipFlags.horizontal;
const FLIP_V = palette.flipFlags.vertical;

const F = palette.terrain.forest;
const M = palette.terrain.mountain;
const W = palette.terrain.water;
const C = palette.coast;
const R = palette.roads;

/** Random integer in [a, b] inclusive. */
function irand(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

/** Random element of an array. */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function compose(width, height) {
  const n = width * height;
  const terrain = new Int8Array(n).fill(GRASS);
  const band = new Uint8Array(n); // 1 = part of the framing forest band

  const idx = (x, y) => y * width + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  const at = (x, y) => (inBounds(x, y) ? terrain[idx(x, y)] : -1);

  // --- 1. framing band -----------------------------------------------------
  const thick = (v) => irand(2, 4);
  const bandTop = thick();
  const bandBottom = thick();
  const bandLeft = thick();
  const bandRight = thick();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inBand =
        y < bandTop || y >= height - bandBottom || x < bandLeft || x >= width - bandRight;
      if (inBand) {
        terrain[idx(x, y)] = FOREST;
        band[idx(x, y)] = 1;
      }
    }
  }

  // --- 2. openings in the band (entry lanes) -------------------------------
  function carveOpening() {
    const side = irand(0, 3); // 0 top, 1 bottom, 2 left, 3 right
    const len = irand(2, 4);
    let sx, sy, dx, dy;
    if (side === 0) {
      sy = 0;
      sx = irand(2, width - len - 2);
      dx = 1;
      dy = 0;
    } else if (side === 1) {
      sy = height - 1;
      sx = irand(2, width - len - 2);
      dx = 1;
      dy = 0;
    } else if (side === 2) {
      sx = 0;
      sy = irand(2, height - len - 2);
      dx = 0;
      dy = 1;
    } else {
      sx = width - 1;
      sy = irand(2, height - len - 2);
      dx = 0;
      dy = 1;
    }
    // Clear a corridor from the edge inward (length `len` along the edge,
    // depth `depth` toward the interior) so the opening is actually usable.
    const depth = irand(2, 4);
    for (let d = 0; d < depth; d++) {
      for (let l = 0; l < len; l++) {
        const x = sx + dx * l + (side === 0 ? 0 : side === 1 ? 0 : side === 2 ? d : -d);
        const y = sy + dy * l + (side === 0 ? d : side === 1 ? -d : side === 2 ? 0 : 0);
        if (inBounds(x, y)) {
          terrain[idx(x, y)] = GRASS;
          band[idx(x, y)] = 0;
        }
      }
    }
  }
  for (let i = 0, count = irand(2, 4); i < count; i++) carveOpening();

  // --- 3. mountain accents, inside the band only ---------------------------
  const bandCells = [];
  for (let i = 0; i < n; i++) if (band[i] && terrain[i] === FOREST) bandCells.push(i);
  const mountainTarget = Math.floor(bandCells.length * 0.08);
  for (let placed = 0; placed < mountainTarget && bandCells.length; ) {
    const i = pick(bandCells);
    if (terrain[i] === FOREST) {
      terrain[i] = MOUNTAIN;
      placed++;
    }
  }

  // --- 4. road geometry decided up front, so lakes can be sited to cross ----
  const roadY = irand(10, height - 10);
  const roadX = irand(10, width - 10);
  const stepX = irand(Math.floor(width * 0.35), Math.floor(width * 0.65));
  const stepDir = Math.random() < 0.5 ? -1 : 1;
  const stepLen = irand(2, 4);
  const roadY2 = Math.max(4, Math.min(height - 4, roadY + stepDir * stepLen));

  // --- 5. lakes (one sited to straddle the horizontal road) ----------------
  function tryLake(w, h, x, y, force) {
    if (x < 2 || y < 2 || x + w > width - 2 || y + h > height - 2) return false;
    if (!force) {
      let open = 0;
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) if (terrain[idx(xx, yy)] === GRASS) open++;
      }
      if (open < w * h * 0.75) return false;
    }
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) terrain[idx(xx, yy)] = WATER;
    }
    return true;
  }

  // Lake 1: forced across the horizontal road's first run, so the road will
  // bridge it (guarantees at least one bridge, which is the AW road look).
  {
    const lw = irand(10, 14);
    const lh = irand(6, 8);
    const cx = irand(8, Math.max(9, stepX - 7));
    tryLake(lw, lh, cx - Math.floor(lw / 2), roadY - Math.floor(lh / 2), true);
  }
  // Lake 2: somewhere else open.
  for (let attempt = 0; attempt < 30; attempt++) {
    const lw = irand(6, 9);
    const lh = irand(5, 7);
    if (tryLake(lw, lh, irand(6, width - lw - 6), irand(6, height - lh - 6), false)) break;
  }

  // --- 6. forest blobs grown inward from the band --------------------------
  function grassNeighbors(i) {
    const x = i % width;
    const y = Math.floor(i / width);
    const out = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(nx, ny) && terrain[idx(nx, ny)] === GRASS) out.push(idx(nx, ny));
    }
    return out;
  }

  function growBlob(target) {
    // Seed: a band forest cell with an open grass neighbour.
    let seed = -1;
    for (let attempt = 0; attempt < 60; attempt++) {
      const i = bandCells[Math.floor(Math.random() * bandCells.length)];
      if (terrain[i] === FOREST && grassNeighbors(i).length > 0) {
        seed = i;
        break;
      }
    }
    if (seed === -1) return;
    const blob = [seed];
    let guard = 0;
    while (blob.length < target && guard++ < target * 4) {
      const c = blob[Math.floor(Math.random() * blob.length)];
      const ns = grassNeighbors(c);
      if (ns.length === 0) continue;
      const next = pick(ns);
      terrain[next] = FOREST;
      blob.push(next);
    }
  }

  for (let i = 0, count = irand(10, 14); i < count; i++) growBlob(irand(12, 30));

  // --- 7. roads ------------------------------------------------------------
  // bridgeCells: 0 none, 1 horizontal bridge, 2 vertical bridge
  const bridgeCells = new Uint8Array(n);

  function setRoad(x, y, orientation) {
    if (!inBounds(x, y)) return;
    const i = idx(x, y);
    if (terrain[i] === WATER) {
      bridgeCells[i] = orientation === "h" ? 1 : 2;
    }
    terrain[i] = ROAD;
  }

  // Horizontal road with a single vertical step (creates two bends).
  for (let x = 0; x <= stepX; x++) setRoad(x, roadY, "h");
  const lo = Math.min(roadY, roadY2);
  const hi = Math.max(roadY, roadY2);
  for (let y = lo + 1; y < hi; y++) setRoad(stepX, y, "v");
  for (let x = stepX + 1; x < width; x++) setRoad(x, roadY2, "h");
  // Vertical road.
  for (let y = 0; y < height; y++) setRoad(roadX, y, "v");

  // --- 8. terrain -> layer gids --------------------------------------------
  const visual = new Uint32Array(n); // the `terrain` layer (non-grass tiles)
  const variations = new Uint32Array(n); // grass variants 2/3
  const collisions = new Uint8Array(n); // 1 = blocked (water)

  function forestGid(i) {
    const x = i % width;
    const y = Math.floor(i / width);
    const all = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(
      ([dx, dy]) => at(x + dx, y + dy) === FOREST
    );
    return all ? F.interior : F.edge;
  }

  function waterGid(i) {
    const x = i % width;
    const y = Math.floor(i / width);
    const N = at(x, y - 1) === WATER;
    const S = at(x, y + 1) === WATER;
    const W2 = at(x - 1, y) === WATER;
    const E = at(x + 1, y) === WATER;
    if (N && S && W2 && E) return W.fill;
    const landN = !N;
    const landS = !S;
    const landW = !W2;
    const landE = !E;
    if (landN && !landS && !landW && !landE) return C.edges.north;
    if (landS && !landN && !landW && !landE) return C.edges.south;
    if (landW && !landN && !landS && !landE) return C.edges.west;
    if (landE && !landN && !landS && !landW) return C.edges.east;
    if (landN && landW && !landS && !landE) return C.corner;
    if (landN && landE && !landS && !landW) return C.corner | FLIP_H;
    if (landS && landW && !landN && !landE) return C.corner | FLIP_V;
    if (landS && landE && !landN && !landW) return C.corner | FLIP_H | FLIP_V;
    return W.fill; // concave or 1-wide water — fill as a safe fallback
  }

  function roadGid(i) {
    if (bridgeCells[i] === 1) return R.bridges.horizontal;
    if (bridgeCells[i] === 2) return R.bridges.vertical;
    const x = i % width;
    const y = Math.floor(i / width);
    const N = at(x, y - 1) === ROAD;
    const S = at(x, y + 1) === ROAD;
    const W2 = at(x - 1, y) === ROAD;
    const E = at(x + 1, y) === ROAD;
    const cnt = N + S + W2 + E;
    if (cnt <= 1) return N || S ? R.vertical : R.horizontal;
    if (cnt === 2) {
      if (N && S) return R.vertical;
      if (E && W2) return R.horizontal;
      if (N && E) return R.bends.northEast;
      if (N && W2) return R.bends.northWest;
      if (S && E) return R.bends.southEast;
      if (S && W2) return R.bends.southWest;
    }
    if (cnt === 3) {
      if (!S) return R.junctions.north;
      if (!N) return R.junctions.south;
      if (!W2) return R.junctions.east;
      if (!E) return R.junctions.west;
    }
    return R.junctions.cross;
  }

  for (let i = 0; i < n; i++) {
    switch (terrain[i]) {
      case GRASS:
        if (Math.random() < 0.1) variations[i] = Math.random() < 0.5 ? 2 : 3;
        break;
      case FOREST:
        visual[i] = forestGid(i);
        break;
      case MOUNTAIN:
        visual[i] = M.gids[0];
        break;
      case WATER:
        visual[i] = waterGid(i);
        collisions[i] = 1;
        break;
      case ROAD:
        visual[i] = roadGid(i);
        break;
    }
  }

  return { width, height, terrain, visual, variations, collisions };
}

module.exports = { compose };
