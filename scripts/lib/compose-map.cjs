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

  // --- 3b. main roads, laid BEFORE anything connectivity-sensitive ---------
  // The strait splits the map in two, so the crossing must exist before cities
  // are placed (a city placed on an uncrossable map reports as "stranding" and
  // gets reverted). The horizontal road is therefore laid now and bridges the
  // strait properly, instead of carving a land causeway and hoping a road
  // follows later. Road cells are walkable, so connectivity is honest either way.
  const deckCells = new Uint8Array(n); // 1 horizontal deck, 2 vertical deck
  const strutCells = new Uint8Array(n); // 1 = underside struts (149) in water

  function setRoad(x, y, orientation) {
    if (!inBounds(x, y)) return;
    const i = idx(x, y);
    if (terrain[i] === WATER) deckCells[i] = orientation === "h" ? 1 : 2;
    terrain[i] = ROAD;
  }

  // Horizontal road: straight, full width, bridging the strait.
  const roadY = irand(10, height - 10);
  for (let x = 0; x < width; x++) setRoad(x, roadY, "h");

  // Vertical road on the left landmass, with one horizontal step (two bends).
  const roadX = irand(5, Math.max(6, straitMinX - 6));
  const stepDir = Math.random() < 0.5 ? -1 : 1;
  const roadX2 = clamp(roadX + stepDir * irand(2, 4), 5, Math.max(6, straitMinX - 6));
  const stepY = irand(10, height - 10);
  for (let y = 0; y <= stepY; y++) setRoad(roadX, y, "v");
  for (let x = Math.min(roadX, roadX2); x <= Math.max(roadX, roadX2); x++) setRoad(x, stepY, "h");
  for (let y = stepY + 1; y < height; y++) setRoad(roadX2, y, "v");

  // A cell that is guaranteed to be on the main road skeleton. District roads use
  // it to decide whether they have actually joined the network.
  const mainRoadSeed = idx(0, roadY);

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

  // --- 4b. metropolitan areas: scattered city districts --------------------
  // Cities are properties (income/capture arrive later). They are scattered in
  // a compact cluster with at least one empty tile between buildings, so a
  // district reads as a loose town rather than a solid block. Only gid 9 (the
  // neutral generic city) is emitted for now.

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
    for (let attempt = 0; attempt < 100; attempt++) {
      const cx = irand(5, width - 6);
      const cy = irand(5, height - 6);
      if (terrain[idx(cx, cy)] !== GRASS) continue;

      // Candidate cells within Chebyshev radius 3 of the centre, shuffled so the
      // district fills in a natural-looking scattered order.
      const cand = [];
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 4 || ny < 4 || nx >= width - 4 || ny >= height - 4) continue;
          if (terrain[idx(nx, ny)] !== GRASS) continue;
          cand.push(idx(nx, ny));
        }
      }
      for (let k = cand.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [cand[k], cand[j]] = [cand[j], cand[k]];
      }

      const placed = [];
      for (const cell of cand) {
        if (placed.length >= maxCells) break;
        const x = cell % width;
        const y = Math.floor(cell / width);
        // Spread rule: at least one empty tile between buildings (not 8-adjacent
        // to anything already placed).
        let tooClose = false;
        for (const p of placed) {
          const px = p % width;
          const py = Math.floor(p / width);
          if (Math.max(Math.abs(x - px), Math.abs(y - py)) <= 1) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        terrain[cell] = BUILDING;
        placed.push(cell);
      }
      if (placed.length === 0) continue;

      // Buildings are impassable: revert if this district stranded any grass.
      if (strandedAnywhere()) {
        for (const cell of placed) terrain[cell] = GRASS;
        continue;
      }
      cityClusters.push(placed);
      return placed.length;
    }
    return 0;
  }

  const cityClusters = [];
  // Maximise the number of cities: many overlapping districts, each scattering a
  // good number of buildings. Buildings only need a grass cell, so the practical
  // ceiling is free interior grass plus the occupancy band (the connectivity
  // guard still reverts any district that would wall off a pocket).
  for (let i = 0, count = irand(8, 12); i < count; i++) placeCityBlock(irand(8, 14));

  if (process.env.COMPOSE_DEBUG) {
    console.log(
      `[compose] after cities: stranded=${strandedAnywhere()} buildings=${
        Array.from(terrain).filter((t) => t === BUILDING).length
      }`
    );
  }

  // --- 5. link each city district into the road network -------------------
  // The main road skeleton was laid back in step 3b (so the strait was already
  // crossable when cities were placed); this step adds the district roads.
  // AWBW reference maps show roads as a NETWORK: a district gets a road that
  // joins the nearest existing road (making a T-junction), and only a few roads
  // run out to the map edge. So a city spur is routed to the closest road cell
  // with an L-shaped stepped path - never sent hunting for an edge, which would
  // slice the map into parallel strips.
  function isRoadCell(x, y) {
    return inBounds(x, y) && terrain[idx(x, y)] === ROAD;
  }

  /** All road cells 4-connected to `start`, as a Set of cell indices. */
  function roadComponent(start) {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length > 0) {
      const c = stack.pop();
      const x = c % width;
      const y = Math.floor(c / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!isRoadCell(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (seen.has(ni)) continue;
        seen.add(ni);
        stack.push(ni);
      }
    }
    return seen;
  }

  /** Routes an L-shaped (stepped) road from (sx,sy) to the nearest road cell. */
  function connectPoint(sx, sy, exclude, maxDistance) {
    const candidates = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (!isRoadCell(x, y)) continue;
        if (exclude && exclude.has(idx(x, y))) continue;
        const d = Math.abs(x - sx) + Math.abs(y - sy);
        if (maxDistance !== undefined && d > maxDistance) continue;
        candidates.push([x, y, d]);
      }
    }
    candidates.sort((a, b) => a[2] - b[2]);
    // Try a generous number of targets: the nearest road cells are often the
    // district's own ring (excluded) or lie behind the town, so a short candidate
    // list leaves the ring orphaned.
    for (const [tx, ty] of candidates.slice(0, 40)) {
      const shapes = [];
      // L: horizontal, then vertical.
      {
        const cells = [];
        for (let x = Math.min(sx, tx); x <= Math.max(sx, tx); x++) cells.push([x, sy, "h"]);
        for (let y = Math.min(sy, ty); y <= Math.max(sy, ty); y++) cells.push([tx, y, "v"]);
        shapes.push(cells);
      }
      // L: vertical, then horizontal.
      {
        const cells = [];
        for (let y = Math.min(sy, ty); y <= Math.max(sy, ty); y++) cells.push([sx, y, "v"]);
        for (let x = Math.min(sx, tx); x <= Math.max(sx, tx); x++) cells.push([x, ty, "h"]);
        shapes.push(cells);
      }
      // Z via a mid column, to dodge whatever blocks the direct L.
      {
        const mx = Math.round((sx + tx) / 2);
        const cells = [];
        for (let x = Math.min(sx, mx); x <= Math.max(sx, mx); x++) cells.push([x, sy, "h"]);
        for (let y = Math.min(sy, ty); y <= Math.max(sy, ty); y++) cells.push([mx, y, "v"]);
        for (let x = Math.min(mx, tx); x <= Math.max(mx, tx); x++) cells.push([x, ty, "h"]);
        shapes.push(cells);
      }
      // Z via a mid row.
      {
        const my = Math.round((sy + ty) / 2);
        const cells = [];
        for (let y = Math.min(sy, my); y <= Math.max(sy, my); y++) cells.push([sx, y, "v"]);
        for (let x = Math.min(sx, tx); x <= Math.max(sx, tx); x++) cells.push([x, my, "h"]);
        for (let y = Math.min(my, ty); y <= Math.max(my, ty); y++) cells.push([tx, y, "v"]);
        shapes.push(cells);
      }
      for (const cells of shapes) {
        // Never tunnel through a building: it is impassable, so a road drawn over
        // it would be a fake line through a solid object.
        let hitsBuilding = false;
        for (const [x, y] of cells) {
          if (inBounds(x, y) && terrain[idx(x, y)] === BUILDING) {
            hitsBuilding = true;
            break;
          }
        }
        if (hitsBuilding) continue;
        for (const [x, y, orientation] of cells) setRoad(x, y, orientation);
        return true;
      }
    }
    return false;
  }

  /**
   * Runs a road THROUGH a district (so buildings front onto it) and joins that
   * road to the network. The corridor is the building-free row or column across
   * the district with the most city frontage; using the corridor rather than a
   * single spur is what makes a district read as a town on a road.
   */
  function routeDistrict(cluster) {
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    for (const cell of cluster) {
      const x = cell % width;
      const y = Math.floor(cell / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // The main road is the row or column through the district with the most
    // building frontage (the "longest road through the cluster"), not a box
    // around it - a ring is an inefficient detour and its four-way corners read
    // as unnatural roundabouts when only one side has buildings.
    let main = null;
    const consider = (kind, line, from, to, frontage, d) => {
      if (frontage > 0 && (!main || frontage > main.frontage || (frontage === main.frontage && d < main.d))) {
        main = { kind, line, from, to, frontage, d };
      }
    };

    // Candidate main-road rows.
    for (let y = minY - 1; y <= maxY + 1; y++) {
      if (y < 1 || y >= height - 1) continue;
      let usable = true;
      let frontage = 0;
      for (let x = minX - 1; x <= maxX + 1; x++) {
        if (!inBounds(x, y)) continue;
        const t = terrain[idx(x, y)];
        if (t === BUILDING || t === WATER) {
          usable = false;
          break;
        }
        if (inBounds(x, y - 1) && terrain[idx(x, y - 1)] === BUILDING) frontage++;
        if (inBounds(x, y + 1) && terrain[idx(x, y + 1)] === BUILDING) frontage++;
      }
      if (usable) consider("h", y, minX - 1, maxX + 1, frontage, Math.abs(y - (minY + maxY) / 2));
    }
    // Candidate main-road columns.
    for (let x = minX - 1; x <= maxX + 1; x++) {
      if (x < 1 || x >= width - 1) continue;
      let usable = true;
      let frontage = 0;
      for (let y = minY - 1; y <= maxY + 1; y++) {
        if (!inBounds(x, y)) continue;
        const t = terrain[idx(x, y)];
        if (t === BUILDING || t === WATER) {
          usable = false;
          break;
        }
        if (inBounds(x - 1, y) && terrain[idx(x - 1, y)] === BUILDING) frontage++;
        if (inBounds(x + 1, y) && terrain[idx(x + 1, y)] === BUILDING) frontage++;
      }
      if (usable) consider("v", x, minY - 1, maxY + 1, frontage, Math.abs(x - (minX + maxX) / 2));
    }
    if (!main) return false;

    // Lay the main road and remember it (owned) so the network connection skips
    // the district's own road instead of "connecting" to itself.
    const owned = new Set();
    const ends = [];
    if (main.kind === "h") {
      for (let x = main.from; x <= main.to; x++) {
        setRoad(x, main.line, "h");
        owned.add(idx(x, main.line));
      }
      ends.push([main.from, main.line], [main.to, main.line]);
    } else {
      for (let y = main.from; y <= main.to; y++) {
        setRoad(main.line, y, "v");
        owned.add(idx(main.line, y));
      }
      ends.push([main.line, main.from], [main.line, main.to]);
    }

    // Connect the through-road to the network from both ends, so the district
    // sits on a road that continues rather than dead-ending. If it already
    // intersects the main skeleton (e.g. it crosses the horizontal road), skip.
    const startCell = main.kind === "h" ? idx(main.from, main.line) : idx(main.line, main.from);
    if (!roadComponent(startCell).has(mainRoadSeed)) {
      for (const [ex, ey] of ends) connectPoint(ex, ey, owned, 18);
    }

    // Branch short spurs to cities off the main road. Skip a city that already
    // fronts a road, or whose neighbour (within 2 tiles) already does - one road
    // serves the whole pocket instead of a stub per building.
    const frontsRoad = (bx, by) =>
      isRoadCell(bx + 1, by) || isRoadCell(bx - 1, by) || isRoadCell(bx, by + 1) || isRoadCell(bx, by - 1);

    for (const cell of cluster) {
      const bx = cell % width;
      const by = Math.floor(cell / width);
      if (frontsRoad(bx, by)) continue;

      let neighbourServed = false;
      for (const other of cluster) {
        if (other === cell) continue;
        const ox = other % width;
        const oy = Math.floor(other / width);
        if (Math.max(Math.abs(bx - ox), Math.abs(by - oy)) <= 2 && frontsRoad(ox, oy)) {
          neighbourServed = true;
          break;
        }
      }
      if (neighbourServed) continue;

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = bx + dx;
        const ny = by + dy;
        if (!inBounds(nx, ny)) continue;
        const t = terrain[idx(nx, ny)];
        if (t === GRASS || t === FOREST) {
          connectPoint(nx, ny, undefined, 8);
          break;
        }
      }
    }
    return true;
  }

  for (const cluster of cityClusters) routeDistrict(cluster);

  // --- 5c. extend dead-end road tips -------------------------------------
  // A district main road stops at the district box, which reads as a severed
  // stub. Extend each dead-end tip forward:
  //   - vertical roads run on to the map frame (north-south arteries), and
  //   - any tip extends a short way to serve an unserved city or to join a road.
  // A tip never extends into a cell that would touch >=2 other roads: that is
  // what produced the "roundabout" four-way corners.
  const frontsRoad = (bx, by) =>
    isRoadCell(bx + 1, by) || isRoadCell(bx - 1, by) || isRoadCell(bx, by + 1) || isRoadCell(bx, by - 1);

  function roadNeighbourCount(x, y) {
    let c = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (isRoadCell(x + dx, y + dy)) c++;
    }
    return c;
  }

  for (let pass = 0; pass < 24; pass++) {
    let extended = false;

    // Snapshot current tips (dead ends) so extending one does not re-scan itself.
    const tips = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (isRoadCell(x, y) && roadNeighbourCount(x, y) === 1) tips.push([x, y]);
      }
    }
    if (tips.length === 0) break;

    for (const [x, y] of tips) {
      if (!isRoadCell(x, y) || roadNeighbourCount(x, y) !== 1) continue;
      // Direction the tip points away from its one neighbour.
      let dx = 0;
      let dy = 0;
      if (isRoadCell(x, y - 1)) dy = 1;
      else if (isRoadCell(x, y + 1)) dy = -1;
      else if (isRoadCell(x - 1, y)) dx = 1;
      else if (isRoadCell(x + 1, y)) dx = -1;
      if (dx === 0 && dy === 0) continue;

      const vertical = dy !== 0;
      const cap = vertical ? 48 : 8;

      // First worthwhile cell ahead: a road to join, or an unserved city to reach
      // (on-axis or one flank). Buildings ON the axis block (a road can't cut a
      // city in half); buildings one flank off the axis are what we serve.
      let goal = -1;
      for (let step = 1; step <= cap; step++) {
        const fx = x + dx * step;
        const fy = y + dy * step;
        if (!inBounds(fx, fy)) break;
        const t = terrain[idx(fx, fy)];
        if (t === WATER || t === BUILDING) break;
        if (t === ROAD) {
          goal = step;
          break;
        }
        for (const [ox, oy] of [[0, 0], [dy, dx], [-dy, -dx]]) {
          const cx = fx + ox;
          const cy = fy + oy;
          if (inBounds(cx, cy) && terrain[idx(cx, cy)] === BUILDING && !frontsRoad(cx, cy)) {
            goal = step;
            break;
          }
        }
        if (goal !== -1) break;
      }
      // Vertical roads with no nearer target run on to the map frame, but a long
      // barren run just trails into the edge and reads as junk. Only allow the
      // frame run if the edge is close or the corridor passes buildings.
      if (goal === -1 && vertical) {
        const distToFrame = dy > 0 ? height - 1 - y : y;
        let hasBuilding = false;
        for (let step = 1; step <= distToFrame; step++) {
          const fx = x + dx * step;
          const fy = y + dy * step;
          if (!inBounds(fx, fy)) break;
          const t = terrain[idx(fx, fy)];
          if (t === WATER || t === BUILDING || t === ROAD) break;
          for (const ox of [1, -1]) {
            if (inBounds(fx + ox, fy) && terrain[idx(fx + ox, fy)] === BUILDING) {
              hasBuilding = true;
              break;
            }
          }
          if (hasBuilding) break;
        }
        if (distToFrame <= 8 || hasBuilding) goal = cap;
      }
      if (goal === -1) continue;

      for (let step = 1; step <= goal; step++) {
        const nx = x + dx * step;
        const ny = y + dy * step;
        if (!inBounds(nx, ny)) break;
        const t = terrain[idx(nx, ny)];
        if (t === ROAD) break;
        if (t === WATER || t === BUILDING) break;
        if (roadNeighbourCount(nx, ny) >= 3) break; // would make a 4-way roundabout
        setRoad(nx, ny, dx !== 0 ? "h" : "v");
        extended = true;
      }
    }

    if (!extended) break;
  }

  // Struts: the water cell directly SOUTH of each horizontal deck gets the
  // underside (149), so the bridge reads as a deck over a supported span. This
  // runs after ALL roads so bridges created by city spurs get struts too.
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
    if (cnt === 0) return R.single;
    if (cnt === 1) {
      // A dead-end gets a proper cul-de-sac cap rather than a straight-through
      // road tile that looks severed mid-block.
      if (N) return R.deadEndTop;
      if (S) return R.deadEndBottom;
      if (E) return R.deadEndLeft; // closed on the left, open on the right
      return R.deadEndRight; // closed on the right, open on the left
    }
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
        // Neutral generic city (gid 9) only for now; variants and faction colours
        // are applied by map scripting on capture.
        visual[i] = B.city;
        collisions[i] = 1;
        break;
      }
    }
  }

  return { width, height, terrain, visual, variations, collisions };
}

module.exports = { compose };
