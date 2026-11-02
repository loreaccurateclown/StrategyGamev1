/**
 * Map composer — Advance-Wars-1 style, replacing the @reldens scatter placer.
 *
 * Composition (deterministic, driven by the seeded Math.random):
 *   1. an irregular framing forest band with openings
 *   2. mountain accents clustered inside the band
 *   3. ONE localized water region — a vertical strait that splits the map into
 *      two landmasses, creating a chokepoint (the AW "land map with one water
 *      area" pattern; it can reach ~14% of the board)
 *   4. forest clumps and mountain clusters scattered through the interior
 *   4b. metropolitan city blocks (BUILDING terrain) in the open interior
 *   5. a horizontal road bridging the strait, and a vertical road (with one
 *      bend) on the left landmass
 *
 * Terrain codes mirror TerrainType: 1 Grass, 2 Forest, 3 Water, 4 Mountain,
 * 5 Road, 6 Building. Coast tiles and struts are WATER terrain, bridges ROAD.
 */

const palette = require("../../assets/generator/palette.json");

const GRASS = 1;
const FOREST = 2;
const WATER = 3;
const MOUNTAIN = 4;
const ROAD = 5;
const BUILDING = 6;

const FLIP_H = palette.flipFlags.horizontal;
const FLIP_V = palette.flipFlags.vertical;

const F = palette.terrain.forest;
const M = palette.terrain.mountain;
const W = palette.terrain.water;
const C = palette.coast;
const R = palette.roads;
const B = palette.terrain.building;

/** Random integer in [a, b] inclusive. */
function irand(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function compose(width, height) {
  const n = width * height;
  const terrain = new Int8Array(n).fill(GRASS);
  const band = new Uint8Array(n);

  const idx = (x, y) => y * width + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;

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

  // --- 1. irregular framing band ------------------------------------------
  // Per-side depth arrays with occasional ±1 jitter so the inner edge is not a
  // straight line (AW frames are a clearing cut out of wilderness, not a hedge).
  // Thin, irregular base border: mostly 1 tile deep with gaps (~18 %) so it is
  // not one contiguous line, plus occasional 2-tile bulges. Edge clumps below
  // add the natural clumpy masses near the edges.
  function borderDepth(len) {
    const a = new Int8Array(len);
    for (let t = 0; t < len; t++) {
      const r = Math.random();
      a[t] = r < 0.18 ? 0 : r < 0.26 ? 2 : 1;
    }
    return a;
  }
  const bandTop = borderDepth(width);
  const bandBottom = borderDepth(width);
  const bandLeft = borderDepth(height);
  const bandRight = borderDepth(height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inBand =
        y < bandTop[x] || y >= height - bandBottom[x] || x < bandLeft[y] || x >= width - bandRight[y];
      if (inBand) {
        terrain[idx(x, y)] = FOREST;
        band[idx(x, y)] = 1;
      }
    }
  }

  // openings: clear a short corridor through the band to the interior
  for (let o = 0, count = irand(2, 3); o < count; o++) {
    const side = irand(0, 3);
    const len = irand(2, 4);
    const depth = irand(2, 4);
    let sx = side === 2 ? 0 : side === 3 ? width - 1 : irand(2, width - len - 2);
    let sy = side === 0 ? 0 : side === 1 ? height - 1 : irand(2, height - len - 2);
    for (let d = 0; d < depth; d++) {
      for (let l = 0; l < len; l++) {
        const x = sx + (side === 0 || side === 1 ? l : side === 2 ? d : -d);
        const y = sy + (side === 2 || side === 3 ? l : side === 0 ? d : -d);
        if (inBounds(x, y)) {
          terrain[idx(x, y)] = GRASS;
          band[idx(x, y)] = 0;
        }
      }
    }
  }

  // --- 2. mountain accents, clustered, inside the band --------------------
  const bandCells = [];
  for (let i = 0; i < n; i++) if (band[i] && terrain[i] === FOREST) bandCells.push(i);
  const mountainTarget = Math.floor(bandCells.length * 0.05);
  for (let placed = 0; placed < mountainTarget && bandCells.length; ) {
    const i = pick(bandCells);
    if (terrain[i] === FOREST) {
      terrain[i] = MOUNTAIN;
      placed++;
    }
  }

  // --- 3. the strait (single localized water region) ----------------------
  // A vertical water band, jittered per row, spanning the full height so it
  // splits the map into two landmasses. Roads will bridge it.
  const straitCx = irand(Math.floor(width * 0.38), Math.floor(width * 0.62));
  const straitBase = irand(5, 8);
  const rowC = new Float32Array(height);
  const rowW = new Float32Array(height);
  let c = straitCx;
  let w = straitBase / 2;
  for (let y = 0; y < height; y++) {
    if (y > 2 && y < height - 3) {
      if (Math.random() < 0.14) c += Math.random() < 0.5 ? -1 : 1;
      if (Math.random() < 0.1) w += Math.random() < 0.5 ? -0.5 : 0.5;
      c = clamp(c, straitCx - 3, straitCx + 3);
      w = clamp(w, straitBase / 2 - 1, straitBase / 2 + 1.5);
    }
    rowC[y] = c;
    rowW[y] = w;
  }
  let straitMinX = width;
  let straitMaxX = 0;
  for (let y = 0; y < height; y++) {
    const lo = Math.floor(rowC[y] - rowW[y]);
    const hi = Math.ceil(rowC[y] + rowW[y]);
    if (lo < straitMinX) straitMinX = lo;
    if (hi > straitMaxX) straitMaxX = hi;
    for (let x = lo; x <= hi; x++) {
      if (inBounds(x, y)) terrain[idx(x, y)] = WATER;
    }
  }

  // --- 3b. reserve the crossing BEFORE anything connectivity-sensitive -----
  // The strait splits the map in two, so it must be crossable before cities are
  // placed: a city placed on an uncrossable map reports as "stranding" and gets
  // reverted. The crossing is a 2-wide land causeway (which the horizontal road
  // later runs over), not a bridge tile — a bridge is walkable anyway, and using
  // land here keeps the connectivity picture honest at every stage.
  const roadY = irand(10, height - 10);
  const crossingHalfHeight = 1;
  for (let y = roadY - crossingHalfHeight; y <= roadY + crossingHalfHeight; y++) {
    if (y < 0 || y >= height) continue;
    for (let x = straitMinX; x <= straitMaxX; x++) {
      if (inBounds(x, y)) terrain[idx(x, y)] = GRASS;
    }
  }

  // --- 4. interior forest clumps + mountain clusters ----------------------
  function growClump(size, type) {
    let seed = -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const i = idx(irand(4, width - 5), irand(4, height - 5));
      if (terrain[i] === GRASS) {
        seed = i;
        break;
      }
    }
    if (seed === -1) return;
    terrain[seed] = type;
    const blob = [seed];
    let guard = 0;
    while (blob.length < size && guard++ < size * 5) {
      const c = blob[Math.floor(Math.random() * blob.length)];
      const ns = grassNeighbors(c);
      if (ns.length === 0) continue;
      const next = pick(ns);
      terrain[next] = type;
      blob.push(next);
    }
  }

  function growEdgeClump(size) {
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
    while (blob.length < size && guard++ < size * 5) {
      const c = blob[Math.floor(Math.random() * blob.length)];
      const ns = grassNeighbors(c);
      if (ns.length === 0) continue;
      const next = pick(ns);
      terrain[next] = FOREST;
      blob.push(next);
    }
  }

  for (let i = 0, count = irand(12, 18); i < count; i++) growEdgeClump(irand(3, 10));
  for (let i = 0, count = irand(8, 12); i < count; i++) growClump(irand(3, 8), FOREST);
  for (let i = 0, count = irand(3, 6); i < count; i++) growClump(irand(2, 4), MOUNTAIN);

  // --- 4b. metropolitan areas: compact city blocks -------------------------
  // Cities are properties (income/capture arrive later), so they are placed as
  // tight blocks in the open interior rather than rambled by growClump: a 2x2
  // block plus a few attached neighbours reads as a town, not a smear. Each
  // block is surrounded by grass on all sides so terrain can later be aligned
  // to it (woods/roads running up to the town edge).
  function blockIsOpen(x, y, w, h) {
    // require a 1-tile grass margin so towns never fuse with forest or water
    for (let yy = y - 1; yy < y + h + 1; yy++) {
      for (let xx = x - 1; xx < x + w + 1; xx++) {
        if (xx < 3 || yy < 3 || xx >= width - 3 || yy >= height - 3) return false;
        if (terrain[idx(xx, yy)] !== GRASS) return false;
      }
    }
    return true;
  }

  // Buildings are impassable, so a town could seal off a 1-tile pocket of grass.
  // Place the block, then prove the walkable area is still a single region; if
  // it stranded anything, revert and try elsewhere.
  function isImpassable(t) {
    return t === WATER || t === BUILDING;
  }  function strandedAnywhere() {
    let start = -1;
    let walkable = 0;
    for (let i = 0; i < n; i++) {
      if (!isImpassable(terrain[i])) {
        walkable++;
        if (start === -1) start = i;
      }
    }
    if (start === -1) return true;
    const seen = new Uint8Array(n);
    const stack = [start];
    seen[start] = 1;
    let reached = 0;
    while (stack.length > 0) {
      const cell = stack.pop();
      reached++;
      const x = cell % width;
      const y = Math.floor(cell / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (!isImpassable(terrain[ni]) && !seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    return reached !== walkable;
  }

  function placeCityBlock(maxCells) {
    // Bias toward a 3x3 footprint: a 2x2 town reads as a stub, while up to 8
    // cells of 3x3 reads as a district (the user's "metropolitan area").
    const w = Math.random() < 0.7 ? 3 : 2;
    const h = Math.random() < 0.7 ? 3 : 2;
    for (let attempt = 0; attempt < 80; attempt++) {
      const x = irand(4, width - w - 4);
      const y = irand(4, height - h - 4);
      if (!blockIsOpen(x, y, w, h)) continue;
      // Fill in a shuffled order and stop at maxCells, so a 3x3 block with a
      // cell budget of 6-8 produces an L-shaped town rather than a stamp.
      const cells = [];
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) cells.push(idx(xx, yy));
      }
      for (let k = cells.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [cells[k], cells[j]] = [cells[j], cells[k]];
      }
      const placedCells = [];
      for (const cell of cells) {
        if (placedCells.length >= maxCells) break;
        terrain[cell] = BUILDING;
        placedCells.push(cell);
      }
      if (strandedAnywhere()) {
        for (const cell of placedCells) terrain[cell] = GRASS;
        continue;
      }
      return placedCells.length;
    }
    return 0;
  }

  for (let i = 0, count = irand(1, 3); i < count; i++) placeCityBlock(irand(5, 8));

  if (process.env.COMPOSE_DEBUG) {
    console.log(
      `[compose] after cities: stranded=${strandedAnywhere()} buildings=${
        Array.from(terrain).filter((t) => t === BUILDING).length
      }`
    );
  }

  // --- 5. roads -----------------------------------------------------------
  const deckCells = new Uint8Array(n); // 1 horizontal deck, 2 vertical deck
  const strutCells = new Uint8Array(n); // 1 = underside struts (149) in water

  function setRoad(x, y, orientation) {
    if (!inBounds(x, y)) return;
    const i = idx(x, y);
    if (terrain[i] === WATER) deckCells[i] = orientation === "h" ? 1 : 2;
    terrain[i] = ROAD;
  }

  // Horizontal road: straight, full width, bridging the strait. roadY was chosen
  // back in step 3b so the causeway and this road share the same row.
  for (let x = 0; x < width; x++) setRoad(x, roadY, "h");

  // Vertical road on the left landmass, with one horizontal step (two bends).
  const roadX = irand(5, Math.max(6, straitMinX - 6));
  const stepDir = Math.random() < 0.5 ? -1 : 1;
  const roadX2 = clamp(roadX + stepDir * irand(2, 4), 5, Math.max(6, straitMinX - 6));
  const stepY = irand(10, height - 10);
  for (let y = 0; y <= stepY; y++) setRoad(roadX, y, "v");
  for (let x = Math.min(roadX, roadX2); x <= Math.max(roadX, roadX2); x++) setRoad(x, stepY, "h");
  for (let y = stepY + 1; y < height; y++) setRoad(roadX2, y, "v");

  // Struts: the water cell directly SOUTH of each horizontal deck gets the
  // underside (149), so the bridge reads as a deck over a supported span.
  for (let i = 0; i < n; i++) {
    if (deckCells[i] !== 1) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    if (inBounds(x, y + 1) && terrain[idx(x, y + 1)] === WATER) strutCells[idx(x, y + 1)] = 1;
  }

  // --- 5b. normalise coverage up to the design target ---------------------
  // Band/strait/clump sizes vary per seed, so grow interior forest until the
  // non-grass fraction reaches the target. This keeps every seed inside the
  // occupancy band without touching the band, strait or roads.
  let nonGrass = 0;
  for (let i = 0; i < n; i++) if (terrain[i] !== GRASS) nonGrass++;
  const coverageTarget = Math.floor(n * 0.35);
  let guard = 0;
  while (nonGrass < coverageTarget && guard++ < 2000) {
    growClump(irand(4, 10), FOREST);
    nonGrass = 0;
    for (let i = 0; i < n; i++) if (terrain[i] !== GRASS) nonGrass++;
  }

  // --- 6. terrain -> layer gids --------------------------------------------
  const visual = new Uint32Array(n);
  const variations = new Uint32Array(n);
  const collisions = new Uint8Array(n);

  function forestGid(i) {
    const x = i % width;
    const y = Math.floor(i / width);
    const all = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return inBounds(nx, ny) && terrain[idx(nx, ny)] === FOREST;
    });
    return all ? F.interior : F.edge;
  }

  function isWater(x, y) {
    // Out-of-bounds counts as water (open-sea entrance at the map edge), and a
    // bridge deck sits ON water so it also counts — otherwise the water cell
    // north of a deck is mistaken for a coastline and draws a grass bank in the
    // middle of the lake.
    if (!inBounds(x, y)) return true;
    const i = idx(x, y);
    return terrain[i] === WATER || deckCells[i] !== 0;
  }

  function isLand(x, y) {
    // Buildings are built on land, so they must not be mistaken for water by the
    // coast autotile (a city adjacent to the strait still gets a proper bank).
    return !isWater(x, y);
  }

  function waterGid(i) {
    if (strutCells[i]) return R.bridges.strutHorizontal;
    const x = i % width;
    const y = Math.floor(i / width);
    const N = isWater(x, y - 1);
    const S = isWater(x, y + 1);
    const W2 = isWater(x - 1, y);
    const E = isWater(x + 1, y);
    if (N && S && W2 && E) return W.fill;
    const landN = isLand(x, y - 1);
    const landS = isLand(x, y + 1);
    const landW = isLand(x - 1, y);
    const landE = isLand(x + 1, y);
    if (landN && !landS && !landW && !landE) return C.edges.north;
    if (landS && !landN && !landW && !landE) return C.edges.south;
    if (landW && !landN && !landS && !landE) return C.edges.west;
    if (landE && !landN && !landS && !landW) return C.edges.east;
    if (landN && landW && !landS && !landE) return C.corner;
    if (landN && landE && !landS && !landW) return C.corner | FLIP_H;
    if (landS && landW && !landN && !landE) return C.corner | FLIP_V;
    if (landS && landE && !landN && !landW) return C.corner | FLIP_H | FLIP_V;
    return W.fill;
  }

  function roadGid(i) {
    if (deckCells[i] === 1) return R.bridges.horizontal;
    if (deckCells[i] === 2) return R.bridges.vertical;
    const x = i % width;
    const y = Math.floor(i / width);
    const N = inBounds(x, y - 1) && terrain[idx(x, y - 1)] === ROAD;
    const S = inBounds(x, y + 1) && terrain[idx(x, y + 1)] === ROAD;
    const W2 = inBounds(x - 1, y) && terrain[idx(x - 1, y)] === ROAD;
    const E = inBounds(x + 1, y) && terrain[idx(x + 1, y)] === ROAD;
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
      case BUILDING: {
        // 27 is the generic city (income); 28/29 are used only for variety so
        // the town does not read as one stamp repeated.
        const r = Math.random();
        visual[i] = r < 0.7 ? B.city : pick(B.cityVariants);
        collisions[i] = 1;
        break;
      }
    }
  }

  return { width, height, terrain, visual, variations, collisions };
}

module.exports = { compose };
