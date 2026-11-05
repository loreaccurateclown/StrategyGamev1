/**
 * Map composer — Advance-Wars-1 style, replacing the @reldens scatter placer.
 *
 * Composition (deterministic, driven by the seeded Math.random):
 *   1. an irregular framing forest band with openings
 *   2. mountain accents clustered inside the band
 *   3. ONE localized water region spanning the full height, splitting the map
 *      into two landmasses (the AW "land map with one water area" pattern).
 *      Two looks, chosen per seed or forced with --water:
 *        strait — a straight constant-width canal: clean engineered chokepoint
 *        river  — a meandering channel of varying width, optionally with a
 *                 pool and short tapering tributaries (the default, 2:1)
 *   4. forest clumps and mountain clusters scattered through the interior
 *   4b. metropolitan city blocks (BUILDING terrain) in the open interior
 *   5. a horizontal road bridging the strait, and a vertical road (with one
 *      bend) on the left landmass
 *
 * Terrain codes mirror TerrainType: 1 Grass, 2 Forest, 3 Water, 4 Mountain,
 * 5 Road, 6 Building. Coast tiles and struts are WATER terrain, bridges ROAD.
 */

const palette = require("../../assets/generator/palette.json");
const { shoreGid } = require("./shore-mask.cjs");

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

function compose(width, height, options = {}) {
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

  // --- 3. the water region -------------------------------------------------
  // Both looks share one invariant: the water spans the full height, so the
  // board is split into two landmasses and the horizontal road below is a real
  // chokepoint. Which look a seed gets is drawn here (or forced by --water).
  //
  //   strait - a straight, constant-width canal. Deliberately artificial: it
  //            reads as an engineered cut and is the cleanest chokepoint.
  //   river  - a meandering channel whose width breathes along its course,
  //            optionally widening into a pool and throwing off short
  //            tributaries that taper and die inside the land.
  //
  // The centreline is clamped so the water never touches column 0 or width-1:
  // both banks always exist, so the split stays a split.
  const WATER_STYLES = ["strait", "river", "river"];
  const requested = options.waterStyle;
  if (requested !== undefined && requested !== "auto" && !WATER_STYLES.includes(requested)) {
    throw new Error(
      `unknown waterStyle "${requested}" (expected auto, ${WATER_STYLES.filter((s, i, a) => a.indexOf(s) === i).join(", ")})`,
    );
  }
  const waterStyle =
    requested === undefined || requested === "auto" ? pick(WATER_STYLES) : requested;

  const rowC = new Float32Array(height);
  const rowHalf = new Float32Array(height);
  // A smooth sum of sines reads as a curve; a clamped per-row random walk reads
  // as a ragged edge. t runs 0..1 from the top of the board to the bottom.
  const wave = (t, amp, freq, phase) => amp * Math.sin(2 * Math.PI * freq * t + phase);

  if (waterStyle === "strait") {
    // Constant centre, constant width. The absence of variance is the point:
    // this is the look that makes a canal read as a deliberate crossing.
    const cx = irand(Math.floor(width * 0.4), Math.floor(width * 0.6));
    const waterWidth = 2 * irand(2, 3) + 1; // 5 or 7, odd so it stays centred
    for (let y = 0; y < height; y++) {
      rowC[y] = cx;
      rowHalf[y] = (waterWidth - 1) / 2;
    }
  } else {
    const cx0 = irand(Math.floor(width * 0.44), Math.floor(width * 0.56));
    // Two octaves of drift: a broad bend plus a smaller kink, so the banks
    // curve instead of stepping one tile at a time.
    const bendAmp = 4 + Math.random() * 6;
    const bendFreq = pick([1, 1, 2]);
    const bendPhase = Math.random() * Math.PI * 2;
    const kinkAmp = 0.8 + Math.random() * 2.2;
    const kinkFreq = 3 + irand(0, 2);
    const kinkPhase = Math.random() * Math.PI * 2;
    // Half-width breathes along the course, and ~60% of rivers also open into
    // a pool somewhere, which is what sells it as a body of water.
    const halfBase = 2.2 + Math.random() * 1.8;
    const halfSwing = 0.25 + Math.random() * 0.25;
    const widthFreq = 2 + irand(0, 2);
    const widthPhase = Math.random() * Math.PI * 2;
    const hasPool = Math.random() < 0.6;
    const poolY = (0.2 + Math.random() * 0.6) * height;
    const poolAmp = 2 + Math.random() * 3;
    const poolSigma = 2 + Math.random() * 2.5;

    for (let y = 0; y < height; y++) {
      const t = y / height;
      const drift =
        wave(t, bendAmp, bendFreq, bendPhase) + wave(t, kinkAmp, kinkFreq, kinkPhase);
      let half = halfBase * (1 + halfSwing * wave(t, 1, widthFreq, widthPhase));
      if (hasPool) {
        const d = y - poolY;
        half += poolAmp * Math.exp(-(d * d) / (2 * poolSigma * poolSigma));
      }
      half = clamp(half, 1.5, 6);
      rowC[y] = clamp(cx0 + drift, 3 + half, width - 4 - half);
      rowHalf[y] = half;
    }
  }

  for (let y = 0; y < height; y++) {
    const lo = Math.round(rowC[y] - rowHalf[y]);
    const hi = Math.round(rowC[y] + rowHalf[y]);
    for (let x = lo; x <= hi; x++) {
      if (inBounds(x, y)) terrain[idx(x, y)] = WATER;
    }
  }

  // Tributaries: short spurs off the channel that narrow from three tiles to two
  // and die inside the land. They add fine structure without creating a second
  // barrier — a spur that reached the map edge would seal a pocket behind it.
  // Two tiles is the minimum: see the funnel note below.
  if (waterStyle === "river") {
    for (let t = 0, count = irand(1, 2); t < count; t++) {
      const y0 = irand(5, height - 6);
      const dir = Math.random() < 0.5 ? -1 : 1;
      const length = irand(4, 8);
      // Start at the bank the terrain actually has on this row. A pool makes the
      // carved channel wider than the analytic curve predicts, and a spur that
      // begins inside the channel reads as a notch rather than an inlet.
      let mouth = -1;
      for (let x = 0; x < width; x++) {
        if (terrain[idx(x, y0)] !== WATER) continue;
        mouth = x;
        if (dir < 0) break;
      }
      if (mouth < 0) continue;
      // A funnel: three tiles tall at the mouth, then two for the rest of the run.
      // It deliberately never narrows to a single tile. A 1-tall shaft has land
      // directly above AND below, and the sheet has no bank art for that pair —
      // flip flags mirror, they cannot rotate the vertical channel tile — so such
      // a cell has no shore and renders as a bare blue strip in the grass. At two
      // tiles tall every cell lands on a corner or an edge tile instead.
      for (let step = 1; step <= length; step++) {
        const x = mouth + dir * step;
        if (x < 3 || x > width - 4) break;
        const from = step === 1 ? -1 : 0;
        const to = 1;
        for (let k = from; k <= to; k++) {
          const yy = y0 + k;
          if (inBounds(x, yy)) terrain[idx(x, yy)] = WATER;
        }
      }
    }
  }


  // A spur near a sharp bend can curl back and pinch a pocket of land off against
  // the channel. This runs before any road exists, so there are exactly two
  // landmasses and each one touches a map edge: anything not reachable from the
  // left or right edge is such a pocket, and it becomes water. Without this a
  // seed can leave a 2-cell island that verifyMap rejects.
  {
    const reached = new Uint8Array(n);
    const stack = [];
    for (let y = 0; y < height; y++) {
      for (const x of [0, width - 1]) {
        const i = idx(x, y);
        if (terrain[i] !== WATER && !reached[i]) {
          reached[i] = 1;
          stack.push(i);
        }
      }
    }
    while (stack.length > 0) {
      const cell = stack.pop();
      const x = cell % width;
      const y = (cell - x) / width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (!reached[ni] && terrain[ni] !== WATER) {
          reached[ni] = 1;
          stack.push(ni);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (terrain[i] !== WATER && !reached[i]) terrain[i] = WATER;
    }
  }

  // One-tile-tall water fins. Where the meander's width peaks, the outermost
  // carved cell has land directly above AND below - a 1-tall sliver. The sheet
  // has no bank art for that pair (flip flags mirror, they cannot rotate the
  // vertical channel tile), so such a cell can only be approximated, and it reads
  // as water bleeding into the grass. Grow the fin by one row instead: every cell
  // then lands on an edge or a corner tile. Growing water is safe for player
  // movement - it can never disconnect the water region - and verifyMap still
  // guards land connectivity. Measured 1.15 fin cells per map before this.
  // Each pass can expose a new fin one row up, so this iterates to convergence.
  // Every pass strictly converts land to water, so it terminates.
  for (let pass = 0; pass < 64; pass++) {
    const fins = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 0; x < width; x++) {
        if (terrain[idx(x, y)] !== WATER) continue;
        if (terrain[idx(x, y - 1)] === WATER) continue; // already two tiles tall
        if (terrain[idx(x, y + 1)] === WATER) continue;
        if (x > 0 && terrain[idx(x - 1, y)] !== WATER) continue; // needs open water either side
        if (x < width - 1 && terrain[idx(x + 1, y)] !== WATER) continue;
        fins.push([x, y]);
      }
    }
    if (fins.length === 0) break;
    if (process.env.SHORE_DEBUG) console.error("  pass " + pass + ": " + fins.length + " fin cell(s)");
    for (const [x, y] of fins) terrain[idx(x, y - 1)] = WATER;
  }

  // Extents of the finished water region, used to keep the vertical road on the
  // left landmass. Measured after the tributaries so a spur can't be missed.
  let waterMinX = width;
  let waterMaxX = -1;
  for (let i = 0; i < n; i++) {
    if (terrain[i] !== WATER) continue;
    const x = i % width;
    if (x < waterMinX) waterMinX = x;
    if (x > waterMaxX) waterMaxX = x;
  }

  // --- 3b. main roads, laid BEFORE anything connectivity-sensitive ---------
  // The water splits the map in two, so the crossing must exist before cities
  // are placed (a city placed on an uncrossable map reports as "stranding" and
  // gets reverted). The horizontal road is therefore laid now and bridges the
  // channel properly, instead of carving a land causeway and hoping a road
  // follows later. Road cells are walkable, so connectivity is honest either way.
  const deckCells = new Uint8Array(n); // 1 horizontal deck, 2 vertical deck
  const strutCells = new Uint8Array(n); // 1 = underside struts (149) in water

  function setRoad(x, y, orientation, allowBridge = false) {
    if (!inBounds(x, y)) return;
    const i = idx(x, y);
    if (terrain[i] === WATER) {
      // Only the main crossing may build over the channel. A district road is
      // refused: a second bridge would turn one chokepoint into two and split
      // the water into three bodies.
      if (!allowBridge) return;
      deckCells[i] = orientation === "h" ? 1 : 2;
    }
    terrain[i] = ROAD;
  }

  // Horizontal road: straight, full width, bridging the channel. This is the
  // only road allowed to build over water.
  const roadY = irand(10, height - 10);
  for (let x = 0; x < width; x++) setRoad(x, roadY, "h", true);

  // Vertical road on the left landmass, with one horizontal step (two bends).
  // `waterMinX` is the leftmost water column, so this stays clear of the channel.
  const roadX = irand(5, Math.max(6, waterMinX - 6));
  const stepDir = Math.random() < 0.5 ? -1 : 1;
  const roadX2 = clamp(roadX + stepDir * irand(2, 4), 5, Math.max(6, waterMinX - 6));
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

  /** True if placing a road at (x,y) would complete a 2x2 all-road square. */
  function formsBlock(x, y) {
    for (const [x0, y0] of [[x, y], [x - 1, y], [x, y - 1], [x - 1, y - 1]]) {
      let roads = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const cx = x0 + dx;
          const cy = y0 + dy;
          if (cx === x && cy === y) continue;
          if (isRoadCell(cx, cy)) roads++;
        }
      }
      if (roads === 3) return true;
    }
    return false;
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
        // Never tunnel through a building (a road drawn over it would be a fake
        // line through a solid object), and never complete a 2x2 road block (that
        // is the "roundabout" the map already has enough of).
        let bad = false;
        for (const [x, y] of cells) {
          // Never tunnel through a building (a road drawn over it would be a fake
          // line through a solid object), never route across water (that would
          // build a bridge nobody asked for), and never complete a 2x2 road block
          // (that is the "roundabout" the map already has enough of).
          if (
            inBounds(x, y) &&
            (terrain[idx(x, y)] === BUILDING ||
              terrain[idx(x, y)] === WATER ||
              formsBlock(x, y))
          ) {
            bad = true;
            break;
          }
        }
        if (bad) continue;
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
    // fronts a road, or one 8-adjacent to another already-fronted city - but keep
    // this tight, because the user wants dense side-road connectivity.
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
        if (Math.max(Math.abs(bx - ox), Math.abs(by - oy)) <= 1 && frontsRoad(ox, oy)) {
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

  // --- 5b2. prune road fragments that never joined the network -------------
  // A district on the far side of the channel can no longer tunnel across it, so
  // its through-road sometimes ends up isolated. An orphan fragment reads as a
  // broken road, so clear every component that does not contain the main road
  // back to grass. This runs BEFORE the extension and side-road passes below, so
  // they still get a chance to reconnect the district over land.
  {
    const inNetwork = new Uint8Array(n);
    if (terrain[mainRoadSeed] === ROAD) {
      const stack = [mainRoadSeed];
      inNetwork[mainRoadSeed] = 1;
      while (stack.length > 0) {
        const cell = stack.pop();
        const x = cell % width;
        const y = (cell - x) / width;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          const ni = idx(nx, ny);
          if (!inNetwork[ni] && terrain[ni] === ROAD) {
            inNetwork[ni] = 1;
            stack.push(ni);
          }
        }
      }
      for (let i = 0; i < n; i++) {
        if (terrain[i] === ROAD && !inNetwork[i]) terrain[i] = GRASS;
      }
    }
  }

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

      const cap = 12;

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
      // Roads never trail to the map frame: a vertical running into the top or
      // bottom edge reads as junk. Extensions only serve a city or join a road.
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

  // --- 5d. side roads to any city still without road access ---------------
  // Dense district placement leaves some buildings without a neighbouring road
  // (those at cluster edges, or skipped by the neighbour rule). Give each such
  // building a short side road to the nearest road, so the network reaches every
  // city. connectPoint's formsBlock guard keeps this from piling up roundabouts.
  {
    const frontsRoad = (bx, by) =>
      isRoadCell(bx + 1, by) || isRoadCell(bx - 1, by) || isRoadCell(bx, by + 1) || isRoadCell(bx, by - 1);
    for (let pass = 0; pass < 3; pass++) {
      let allServed = true;
      for (let y = 2; y < height - 2; y++) {
        for (let x = 2; x < width - 2; x++) {
          if (terrain[idx(x, y)] !== BUILDING) continue;
          if (frontsRoad(x, y)) continue;
          allServed = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (!inBounds(nx, ny)) continue;
            const t = terrain[idx(nx, ny)];
            if (t === GRASS || t === FOREST) {
              connectPoint(nx, ny, undefined, 12);
              break;
            }
          }
        }
      }
      if (allServed) break;
    }
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

  // Dense roads + max cities can push coverage past the band's top edge; thin
  // interior forest back to grass to stay inside it. The border band is left
  // alone (interior cells only), and roads/buildings/water are never touched.
  const coverageCeiling = Math.floor(n * 0.42);
  if (nonGrass > coverageCeiling) {
    const interior = [];
    for (let i = 0; i < n; i++) {
      if (terrain[i] !== FOREST) continue;
      const x = i % width;
      const y = Math.floor(i / width);
      if (x >= 3 && y >= 3 && x < width - 3 && y < height - 3) interior.push(i);
    }
    // Shuffle so thinning is spread out rather than erasing one region.
    for (let k = interior.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [interior[k], interior[j]] = [interior[j], interior[k]];
    }
    let j = 0;
    while (nonGrass > coverageCeiling && j < interior.length) {
      terrain[interior[j++]] = GRASS;
      nonGrass--;
    }
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
    // The 16-case shoreline table lives in shore-mask.cjs so the composer and the
    // mask preview tool cannot drift apart.
    const x = i % width;
    const y = Math.floor(i / width);
    return shoreGid(
      {
        n: isLand(x, y - 1),
        s: isLand(x, y + 1),
        w: isLand(x - 1, y),
        e: isLand(x + 1, y),
      },
      // Diagonals resolve the concave (inner corner) cases, which the orthogonal
      // mask cannot express: water with land touching only corner-to-corner.
      {
        nw: isLand(x - 1, y - 1),
        ne: isLand(x + 1, y - 1),
        sw: isLand(x - 1, y + 1),
        se: isLand(x + 1, y + 1),
      },
    );
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

  return { width, height, terrain, visual, variations, collisions, waterStyle, waterMinX, waterMaxX };
}

module.exports = { compose };
