# Phase 4: Map Pipeline & Tilemap Integration

**Goal:** A reproducible, scripted pipeline that turns the Kenney tiny-battle tileset into a playable board, plus the code that reads that board into the game's own terrain model. No hand-authoring in the Tiled editor.

**Status:** 4.1, 4.1b (G1–G4), 4.2a and **4.2b are done**. The map contract is **frozen**: 4 layers (`ground`, `ground-variations`, `terrain`, `collisions`) plus `level_01.terrain.json`. `TileMapManager` reads the sidecar and is covered by 17 tests; **4.3 (wiring) is next**.

---

## Why not hand-author in Tiled

The repo already ships a 16 px tileset (`assets/tilemaps/kenney_tinybattle.tsx`), so re-tiling was never the problem — producing *boards* was. The original `@reldens/tile-map-generator` scatter placer did that procedurally but could not reach a composed AW look; it has since been **replaced by `scripts/lib/compose-map.cjs`**. A new map is still a command (`npm run map:generate`), not an afternoon of clicking. The sharp edges of the retired library are recorded below for history.

---

## Verified tileset facts

Taken from `assets/tilemaps/kenney_tinybattle.tsx` and `Tilesheet.txt` — these are the numbers the generator config must match exactly:

| Property | Value |
|----------|-------|
| Tile size | 16 × 16 px |
| Spacing | 1 px (both axes) |
| Margin | 0 |
| Columns | 18 |
| Rows | 11 |
| Tile count | 198 |
| Image | `assets/import/kenney_tiny-battle/Tilemap/tilemap.png` |
| Image size | 305 × 186 px |

Check: `18 × 16 + 17 × 1 = 305` and `11 × 16 + 10 × 1 = 186`.

> `assets/tilemaps/kenney_tinybattle_indiv.tsx` contains absolute paths pointing outside the project and is unusable. Ignore it.

---

## Gids are 1-based

`RandomMapGenerator.createTiledMapObject` hard-codes `tilesets[0].firstgid = 1`, and every value written into a layer's `data` array is used verbatim. Therefore:

```
gid = tile index in the sheet (0-based) + 1
```

Consequences:

- `groundTile` must be **≥ 1**. A value of `0` means "no ground layer", which renders as holes.
- A gid is **not** a `TerrainType`. `TerrainType.Grass = 1` happens to match gid 1, but that is a coincidence — the mapping is explicit in `assets/generator/palette.json` and must be applied at the import boundary.

---

## 4.1 — Generation pipeline ✅

### Files

```
scripts/
├── generate-map.cjs            # npm run map:generate
└── lib/
    ├── prng.cjs                # seeded Math.random replacement
    └── compose-map.cjs         # the AW-style composer (border band → clumps → cities → roads → gids)

assets/generator/
└── palette.json                # verified gid ↔ terrain table

public/assets/maps/             # generator output (committed)
├── level_01.json
├── level_01.terrain.json       # TerrainType sidecar (client never reverse-maps gids)
└── kenney_tinybattle.png       # copied here by the generator
```

### Command

```powershell
npm run map:generate                              # seed 1234, 64×48
npm run map:generate -- --seed 999                # different layout
npm run map:generate -- --seed 1234 --width 50 --height 50   # any size; 64×48 counts fail the band on 50×50
```

The script **fails loudly** if the generated map disagrees with `palette.json`: wrong board size, wrong tile size, `firstgid !== 1`, wrong columns/spacing/tilecount, any `0` in the ground layer, a missing tileset image, an unknown gid, overlapping elements, occupancy outside the 32–42 % band, a partitioned walkable area, or a visual/collision footprint mismatch.

### Seeding

The generator calls bare `Math.random()` and exposes no seed option, so `scripts/lib/prng.cjs` swaps `Math.random` for a mulberry32 instance *before* `RandomMapGenerator` is constructed. Verified: the same seed produces a byte-identical `level_01.json`, a different seed produces a different one.

### Object mode, not composite mode

`RandomMapGenerator` takes `layerElements` as `{ key: layers[] }` inline. Composite mode (`MultipleByLoaderGenerator` + `ElementsProvider`) instead needs `key` tile properties (`groundTile`, `pathTile`, `border-*`, `corner-*`) on the tileset so it can auto-split a composite map. **The Kenney sheet has no `tiles` metadata** (`tiles: []`), so composite mode would require inventing that metadata first. Object mode was chosen.

### Tile palette (verified against pixels, not by eye)

`node tools/tile-rgb.cjs 0 197` prints an exact RGB histogram and opacity per tile. A tile was only accepted as ground if it is **100% opaque**, otherwise the layer below shows through.

| Terrain | Primary gid | Variants | Evidence |
|---------|-------------|----------|----------|
| Grass | 1 | 1, 2, 3 | gid 1 is 100% `rgb(132,198,105)` |
| Water | 38 | 38, 93, 94 | 93% `rgb(117,227,255)` |
| Mountain | 111 | 111, 129, 131, 145–148, 165, 167 | 67% slate `rgb(82,96,124)` + 33% highlights, fully opaque |
| Forest | 28 | 27, 28, 29, 30, 31 | 94% opaque, 41% trunk + 43% canopy |

**There IS a road tile** — an earlier revision of this file claimed otherwise and was wrong. The full grammar is implemented: horizontal 111, vertical 145, single 109, dead-ends 110/112/127/163, bends 128/130/164/166, tees 129/146/148/165, cross 147, bridge deck 131/167, strut 149. `TerrainType.Road` (cost 1) is emitted on ~10 % of every board.

> The gid table above is **historical** and predates the palette correction (it assigns mountain to 111 and forest to 28, which are road and unit/UI gids respectively). [`assets/generator/palette.json`](../assets/generator/palette.json) and [`tile_roles.md`](./tile_roles.md) are authoritative.

### Element authoring

Elements are written as ASCII art so shapes are reviewable in a diff:

```js
const FOREST_ROWS = [".TtfT.", "TTttTT", "TftTtT", "TTtffT", ".TtTT."];
```

Every element produces **two** layers: `<key>-visual` and `<key>-collisions`. The collision layer is mandatory — the generator matches collision layers by *name substring*, so without it the path router carves straight through a pond.

### Generator sharp edges (all hit during implementation)

| Symptom | Cause | Fix |
|---------|-------|-----|
| Board came out **32×44** instead of 32×32 | Elements didn't fit; the generator silently grows the map. Initial quantities (10 forest / 5 water / 4 mountain) reserved ~95% of the board | Reduce to 6 / 3 / 3 (~21% actual occupancy) **and** set `placeRejectResolver: 'moveElements'` so it rearranges instead of growing |
| `require()` throws under ESM | `package.json` has `"type": "module"` | Generator scripts are `.cjs` |
| `addTilesetImage` returns `null` | The tileset's `name` in the JSON is the **map name** (`level_01`), not the image filename | Read `map.tilesets[0].name` back out of the parsed map |
| Ground renders as holes | `groundTile: 0` (falsy) means "no ground layer" | Never let `groundTile` reach 0; the script asserts 0 zeros in the ground layer |

---

## 4.2a — Rendering the generated map ✅

`src/scenes/BattleScene.ts`:

1. `preload` — `load.tilemapTiledJSON('level-01', 'assets/maps/level_01.json')` and `load.image('kenney-tinybattle', 'assets/maps/kenney_tinybattle.png')`.
2. `create` — `make.tilemap`, then `addTilesetImage(map.tilesets[0].name, 'kenney-tinybattle')`.
3. Render one `createLayer` per layer whose name does **not** contain `collisions`.
4. `fitCameraToMap` — integer zoom (`Math.max(1, Math.floor(fitRatio))`) so 16 px art stays crisp, bounds set from `map.widthInPixels`. **Superseded by the 48 px/tile + panning decision** — this step renders only the board center until the display rework lands.

Historical verified output (32×32 era): `rendered 14 layers, skipped 13 collision layers (32x32 @ 16px = 512x512px)`. Current default run is 64×48 with **4 layers** (3 rendered / 1 collision).

Layer inventory for a default run:

| Layer | Purpose | Rendered |
|-------|---------|----------|
| `ground` | grass base, 3072/3072 cells, all gid 1 | ✅ |
| `ground-variations` | ~10 % of cells, gids 1–3 | ✅ |
| `collisions-map-border` | 220 cells, board edge | ❌ (blocker) |
| `water{0..7}-visual` | 38 cells each | ✅ |
| `water{0..7}-collisions` | 38 cells each | ❌ (blocker) |
| `forest{0..19}-visual` | 26 cells each | ✅ |
| `forest{0..19}-collisions` | 26 cells each | ❌ (blocker) |
| `mountain{0..13}-visual` | 20 cells each | ✅ |
| `mountain{0..13}-collisions` | 20 cells each | ❌ (blocker) |

---

## 4.2b — `TileMapManager` from the sidecar ✅ (prepped 2026-11-05, done 2026-11-06)

**Decided 2026-11-05: the client reads `level_01.terrain.json`.** The gid reverse-mapping that this
section used to specify — "start from `ground`, then stamp each `*-visual` layer, map each gid through
`assets/generator/palette.json`" — is **obsolete. Do not implement it.** It was superseded on
2026-11-01 (step G3) and confirmed again when the runtime source was chosen: the generator knows every
gid's terrain at write time, so an unknown gid should be a *generation* error, not a browser error.
Gids never reach the game logic.

```ts
// src/core/TileMapManager.ts — plain TypeScript, NO Phaser import
export interface TiledMapLike {
    width: number;
    height: number;
    tilewidth: number;
}

export interface TerrainMap {
    width: number;
    height: number;
    tileSize: number;
    grid: TerrainType[][]; // grid[y][x] — matches Pathfinding's indexing
}

export function terrainGridFromSidecar(map: TiledMapLike, sidecar: unknown): TerrainMap
```

Rules:

- **Indexing is `grid[y][x]`**, because `Pathfinding.ts` indexes `grid[next.y][next.x]`. The sidecar
  stores flat row-major `terrain`, so `grid[y][x]` is `terrain[y * width + x]`. Inverting this is the
  single most likely bug in the file.
- **Hard errors, never silent defaults.** Throw on: missing/NaN `width`/`height` in either input,
  `terrain.length !== width * height`, a value that is not a known `TerrainType`, or a dimension
  mismatch between map and sidecar. After this check the pathfinder can trust every value it
  receives, which is what step 1.3b's boundary assumes.
- **`tileSize` is cross-checked** against the map's `tilewidth`. The sidecar also carries `seed` and
  `paletteHash`; the hash is the cheap way to prove the pair came from the same generation run.
- **Collision is out of scope.** The sidecar carries terrain only, so walkability comes from
  `TERRAIN_DEFS[...].passable` via `enterCost`. Wiring the `collisions` layer is 4.3.
- **Phaser-free**, so it runs under Vitest's Node environment alongside `Pathfinding.test.ts`.

Tests (`src/core/TileMapManager.test.ts`) — **17 tests, all passing**:

- a small hand-written fixture for the happy path, proving `grid[y][x]` orientation explicitly;
- an **asymmetric** 3×2 fixture, because a transposed build passes the symmetric 2×2 one;
- water accepted as valid terrain — guards against validating with `enterCost(...) !== Infinity`,
  which would reject every lake;
- one test per hard error: non-object sidecar, bad map dims (`0`, `NaN`, `1.5`), bad sidecar dims,
  dimension mismatch, `tileSize` mismatch, non-array `terrain`, short array, long array, unknown
  value (`99`, asserting the message names index `3` and coordinate `(1, 1)`), non-numeric values;
- the **real generated map** — `public/assets/maps/level_01.{json,terrain.json}` loaded with `fs`,
  asserting 64×48, `terrain.length === 3072`, every cell in `1..6`, and a per-cell row-major
  regression check.

Two bugs the tests caught during implementation, both worth remembering:

1. **`terrain[i]` instead of `terrain[y * width + x]`** — `i` is the row index, so every cell in a
   row repeated that row's first value. It corrupted **2596 of 3072** cells while still producing a
   plausible-looking grid. The 2×2 fixture fails loudly on it.
2. **`hasOwnProperty` coerces its key to a string**, so `"3"` matched the `3` key and a string
   terrain value was accepted. The guard needs `typeof coordTerrain !== "number"` first.

Non-goals for this step: touching `BattleScene`, the display rework (4.2a), and any gid or layer
compositing logic.

### Why the file is ~70 lines when the contract above is 16

The block above is only the *shape* — two interfaces and a signature. The file also has to treat the
sidecar as **untrusted input**, because in the browser it arrives from a `fetch`, not from a typed
import. That validation is the bulk of it:

| part | ~lines |
|---|---|
| interfaces + doc comments | 15 |
| guards (the checks below) | 25 |
| building the nested grid | 10 |
| error message formatting | 10 |

Bare, without comments, it fits in ~40. If it lands at 70 that is mostly documentation, which on a
boundary module is the point — this is the one place that gets to assume the data is good, so it has
to explain what "good" means.

### Validation order — cheapest check first

1. `map.width`, `map.height`, `map.tilewidth` are finite positive integers.
2. `sidecar` is a non-null object.
3. `sidecar.width` and `sidecar.height` are finite positive integers.
4. **`sidecar.width === map.width && sidecar.height === map.height`** — otherwise the two files came
   from different runs and every index would be silently off.
5. **`sidecar.tileSize === map.tilewidth`** — otherwise the sidecar describes a different tileset.
6. `Array.isArray(sidecar.terrain)`.
7. `sidecar.terrain.length === width * height`.
8. every value has an own property in `TERRAIN_DEFS` — checked during the grid build, so it costs no
   extra pass.

Steps 4 and 5 are the ones that catch a stale pair. They are the reason the sidecar carries `seed`
and `paletteHash` too, though dimensions catch the common case on their own.

Note what "known terrain" means here: `Object.prototype.hasOwnProperty.call(TERRAIN_DEFS, value)`,
**not** `enterCost(value) !== Infinity`. Water is a known terrain that is deliberately impassable, so
a cost check would reject valid water cells and every lake would fail to load.

### Error messages carry the position

A bare `throw new Error("unknown terrain")` on a 3,072-cell array is useless. Every failure names the
index, the coordinate, and the offending value:

```
level_01.terrain.json: terrain[1543] = 99 at (7, 24) is not a TerrainType
```

### Load path — one function, two callers

The function takes **plain objects**, so nothing about testing differs from production:

```ts
// browser (BattleScene.preload / create) — Phaser loading stays out of this module
this.load.json("terrain", "assets/maps/level_01.terrain.json");
const terrainMap = terrainGridFromSidecar(map, this.cache.json.get("terrain"));

// vitest — plain fs, no Phaser, no DOM
const terrainMap = terrainGridFromSidecar(
    JSON.parse(fs.readFileSync("public/assets/maps/level_01.json", "utf8")),
    JSON.parse(fs.readFileSync("public/assets/maps/level_01.terrain.json", "utf8")),
);
```

**Worked example** — a 2×2 sidecar with `terrain: [1, 1, 3, 3]` must produce

```ts
[[1, 1],    // y=0: indices 0,1  -> grass, grass
 [3, 3]]    // y=1: indices 2,3  -> water, water
```

If a test passes with that transposed, the orientation is wrong.

### What step 1.5 consumes

```ts
const { grid, width, height } = terrainGridFromSidecar(map, sidecar);
const reachable = getReachableTiles(grid, unitPos, unitMove, enterCost, isOccupied);
```

`TerrainType[][]` is assignable to the `number[][]` that `getReachableTiles` declares, so no cast is
needed and no conversion step exists between the two modules.

---

## 4.3 — Wire layers to systems ⬜

- Visual gids → `TerrainType` → `TERRAIN_DEFS` move costs
- `*-collisions` / `collisions-map-border` → occupancy / walkability
- Future fog layer → `unexplored` / `explored` / `visible`

---

## Palette tooling (dev-only, not shipped)

| Tool | Purpose |
|------|---------|
| `tools/palette-inspector.html?page=N` | All 198 tiles at 4× with index + gid labels, paged 60 at a time |
| `tools/tile-picker.html?gids=1,2,38` | Just the gids you name, at 6× — for spot-checking a palette edit |
| `tools/inspect-tiles.cjs [from] [to]` | Dominant hue bucket per tile |
| `tools/tile-rgb.cjs [from] [to]` | Exact RGB histogram + opacity per tile — **the authority** |

Both HTML tools read `../assets/import/kenney_tiny-battle/Tilemap/tilemap.png` and are opened directly via `file://`; they are not part of the Vite build.

---

## 4.1b — Generator hardening roadmap (G1–G6)

**Status:** G1, G2, and G5 are done (2026-11-01). G3/G4 are next and await the contract decision; G6 shorelines are deferred by the user. This section supersedes the earlier "open tuning items" list.

### Why density is capped at 21 % — the actual mechanism

Read out of the package source, not inferred from experiments:

- `ElementsPlacer.findValidatedPosition` reserves `(w + 2·f) × (h + 2·f)` for every placement, where `f = elementsFreeSpaceAround` for that element type and `requiredForBothSidesDuplicator = 2` is **hard-coded** (`random-map-generator.js:68`).
- Current `f` is `{forest: 1, water: 2, mountain: 1}`, so efficiency is poor:

  | Element | Filled | `f` | Reserved | Efficiency |
  |---------|--------|-----|----------|------------|
  | forest 5×4 | 16 | 1 | 7×6 = 42 | 38 % |
  | water 5×5 | 25 | 2 | 9×9 = 81 | 31 % |
  | mountain 4×4 | 16 | 1 | 6×6 = 36 | 44 % |

- Total reserved is 603/1024 = **59 %**, which is why the count cannot simply be raised: `PlacementFeasibility.canFitAllFootprints` rejects any candidate that would strand a *future* element, and `placeRejectResolver: 'moveElements'` then rearranges — and eventually the map silently grows (the recorded 32×44 failure).

**Conclusion: the lever is efficiency per placement, not `elementsQuantity`.** Efficiency improves two ways — shrink `f`, and enlarge the element so the fixed free-space ring is a smaller fraction of its box.

### The asymmetry that drives the design: only water can partition the board

`TERRAIN_DEFS` has forest and mountain as `passable: true` (cost 2 and 3) and water as `passable: false`. Therefore:

- **Dense, contiguous forest/mountain** adds tactical movement cost and *never* disconnects the map. Adjacency is desirable — it reads as a grove or a massif.
- **Water is the only terrain that can strand a region.** It is the one thing density tuning can break, which is why G1 and G2 are coupled and must land together.

### G1 — Retune density for the larger board ✅ (done 2026-11-01)

The board grows from 32×32 (1024 cells) to **64×48 (3072 cells)** as part of the 48 px/tile display decision — see [`plan.md`](./plan.md) decisions table. Verified safe: `npm run map:generate -- --width 64 --height 48` holds the requested size exactly with **no silent growth**, so the size change alone is not the risk. At the current element counts occupancy collapses to **7.1 %** (219/3072), which is why the counts have to scale roughly 5×, not just the reserved space.

Starting point, to be iterated by measurement rather than treated as a spec:

| Element | Art | `f` | Qty | Cells | Reserved |
|---------|-----|-----|-----|-------|----------|
| forest | 6×5, ~26 filled | 0 | 20 | 520 | 600 |
| mountain | 6×4, ~20 filled | 0 | 14 | 280 | 336 |
| water | 7×6, ~38 filled | 1 | 8 | 304 | 576 |
| | | | | **1104 (36 %)** | **1512 (49 %)** |

The reservation total stays near half the board rather than the 58–60 % that was already proven on 1024 cells: a 3072-cell board has more room to breathe, and staying well under the limit keeps `placeRejectResolver` from having to rearrange or grow. Denser clumps also improve the art (`f = 0` lets a grove be a grove instead of a scatter of separated clumps).

**Historical (32×32 era, retired library):** `Verified: 64x48 @ 16px, 87 layers | occupancy: forest 16.9 %, mountain 9.1 %, water 9.9 %, grass 64.1 % | connectivity: 1 component(s), 2548/2548 walkable cells`. The composer now emits `4 layers` with a different terrain mix (grass ~65 %, forest ~10 %, water ~11 %, road ~10 %, building ~3 %).

### G2 — Make `verifyMap` prove the map is playable ✅ (done 2026-11-01)

`verifyMap` checked board size, gids, zeros in the ground layer, and that the tileset image was copied. It did **not** check the things that silently ruin a dense map — now it does:

1. **Connectivity** — flood-fills the passable interior (grass + forest + mountain; only the `collisions-map-border` ring — 220 cells on 64×48 — and water block) and asserts a **single component**. Implemented in `verifyMap`; prints `connectivity: N component(s), X/Y walkable cells`.
2. **Occupancy band** — prints per-terrain and total coverage and asserts the 32–42 % band (target 36 %), so density cannot silently regress.
3. **Collision/visual agreement** — asserts each element's `<key>-collisions` footprint matches its `<key>-visual` footprint, so walkability can never disagree with what the player sees.
4. **Unknown gids and overlaps** — every element-cell gid must resolve through the palette (hard error otherwise) and no two elements may overlap; both checked at generation time instead of in the browser.
5. The existing board-size assertion remains the hard gate against silent growth.

### G3 — Emit a `level_01.terrain.json` sidecar

The generator already knows each gid's terrain when it writes the layer, so it should write the resolved grid as well:

```json
{ "width": 64, "height": 48, "tileSize": 16, "seed": 1234,
  "paletteHash": "…", "terrain": [[1,1,2,…], …] }
```

- Values are `TerrainType`, **not** gids — so the client never needs `palette.json`, and an unknown gid becomes a generation-time failure instead of a browser failure.
- Generated from the same in-memory map object as the JSON, and `verifyMap` re-derives it from the visual layers and asserts equality, so the two files cannot drift.
- The border ring is deliberately **not** in the sidecar: pathfinding is bounds-limited anyway. If a 1-tile edge lock is wanted, the client can clamp to the interior — that is a client decision, not a data one.

This replaces 4.2b's reverse-mapping entirely.

### G4 — Collapse 87 layers to 4 ✅ (done — composer emits 4 directly)

`MapLayersComposer` already supports `autoMergeLayersByKeys`, which merges by name substring and buckets overlapping members so draw order survives (`map-layers-composer.js:101`, `layer-data-factory.js:118`).

- `autoMergeLayersByKeys: ['visual', 'collisions']`
- 44 rendered layers → 3 (`ground`, `ground-variations`, `merge-visual`); 43 collision layers → 1 (`merge-collisions`, still skipped by the existing substring check).
- Each `TilemapLayer` is a full 64×48 render object; dozens of them for ~1100 tiles is real memory and fill-rate cost (the old JSON was 551 KB; the composer's 4-layer JSON is **26 KB**), and a 4-layer contract is far friendlier for the client.
- **Caveat:** merging `ground` with `ground-variations` does *not* collapse them — the variations overlap the ground everywhere, so the bucketing stacks them. Leave both alone.
- Layer names change, so this must land **with G3, before 4.2b is written**.

### G5 — Variant coverage ✅ (done with G1)

The ASCII legends previously referenced two chars per element (forest 2/5 variants, water 2/3, mountain 2/9). The G1 art uses **three variants per element** (forest `T t f`, water `w W s`, mountain `m M n`), so the terrain no longer reads as flat repeats.

### G6 — Shoreline autotiling ✅ (done 2026-11-05)

Done. Water is no longer a solid pond of fill gids: `scripts/lib/shore-mask.cjs` holds an explicit 16-case
table keyed on `N<<3 | S<<2 | W<<1 | E`, where a set bit means that neighbour is **land**, and the composer
asks it for every water cell instead of falling back to the fill gid.

Art inventory was measured with `tools/tile-shore-scan.cjs`, not guessed. Two findings changed the design:

- **`58` was missing from the palette.** It is water with banks on **W and E** — the narrow vertical
  channel. Without it a 1-tile-wide vertical inlet rendered as bare blue.
- **There is no beach-bearing south bank.** `20` (north bank) is land 0–3 / sand 4–6 / water 7–15; the only
  south-facing bank, `56`, is a different art family with **zero** beach pixels and 12 px of water. Pairing
  them in a two-tall inlet gave a beach on the top edge and a hard cut on the bottom. The south bank is
  therefore declared as `{ "gid": 20, "flip": "v" }` — flip flags mirror, which is exactly right.

A diagonal pass then handles the concave (inner) corner, which a 4-neighbour mask cannot express: water with
land touching only corner-to-corner. `91/92/93/94` put a bank wedge in exactly one corner and fire ~44
times per map. They are consulted **only** when the orthogonal mask is empty, so they can never fight with
an edge tile. `tools/render-shore-mask.cjs` renders the whole table in context as a truth table.

`verifyMap` still passes 24/24 seeds in both water styles.

### G7 — City distribution: trunk roads + graded thinning ⬜ (designed 2026-11-05)

**The complaint.** City generation is *correct* but reads as machine-made — the same feeling the old water
had. The measured reason: **86.1 of 90.8 buildings per map are road-adjacent (95 %)**. Because essentially
every building sits on a road, the road network reaches everywhere, so building density is uniform across
the board. There is no "developed core / wild hinterland" gradient, which is exactly what the AW reference
grammar in `aw_style.md` wants.

**Measured baseline (12 seeds from `tools/bulk-preview.cjs`)**

| Metric | Value |
|---|---|
| buildings per map | 90.8 (range 72–112) |
| road-adjacent | 86.1 (95 %) |
| orphan (no road neighbour) | 4.8, but **bimodal**: 10 maps have 0–2, two maps have 29 and 24 |
| road cells per map | 312 (range 204–386) |
| 4-connected building clusters | 83.8 — nearly all size 1, **useless as "clusters"** |
| spatial districts (radius-3 linkage) | 6 per map, median size 11, largest 49 |

Two consequences for the design. First, the bimodal orphans are not a feature: the two maps with 24–29
orphans are also the two with the **fewest road cells** (235, 204), so orphans appear only when the road
planner ran short — it is incidental, not authored. Second, "a city cluster of size *k*" cannot mean
adjacency, because adjacent buildings barely exist. **The unit is a district: buildings grouped at
Chebyshev distance ≤ 3**, giving k ≈ 6–49, which is the range a graded probability curve needs.

**Goal 1 — fewer road connections to cities.** Stop treating "every building gets a road" as an invariant.
Plan districts first, then route a *trunk* network through a subset of them, leaving the rest as satellite
districts. Target: ~60–70 % of buildings road-adjacent instead of 95 %. This does **not** relax
`verifyMap`'s road-connectivity assertion: the road network must stay one component, it simply stops
visiting every district. Orphan *districts* are wanted; orphan *road fragments* are still a failure.

**Goal 2 — graded thinning inside a district.** Dense at the core, dissolving at the fringe, so a district
has a readable centre rather than a uniform blob. Proposed rule, replacing the "n %, n−1 %, …" sketch with
an explicit curve:

```
p_keep(site) = clamp(p_core - SLOPE * d, P_MIN, 1.0)
  d      = Chebyshev distance from the site to the nearest road cell
           (districts with no road at all: distance to the district core)
  p_core = 1.0
  SLOPE  = 0.12   ~12 percentage points lost per tile of distance
  P_MIN  = 0.25   fringe never drops to zero, or districts get hard edges
```

Plus three guards a pure probability curve cannot give:

- **Never dissolve a district.** Keep at least one site in every district of size ≥ 4, chosen as the site
  closest to the district centroid, so thinning cannot delete a district entirely.
- **Cap orphans deliberately.** At most 1 fully roadless district per map, size ≤ 8. This replaces the
  accidental 0-or-29 distribution with a chosen 0-or-1.
- **Deterministic.** All draws go through the seeded `prng.cjs`, never `Math.random`, so a seed still
  reproduces its map byte-identically.

**✅ DECIDED 2026-11-05 — density concentrates toward the road, orphans are pruned hardest.**

The original request read in two directions at once: *"allow more orphan cities off the road network"* versus
*"the percentage grows smaller the closer it gets to cities that see actual gameplay utility"*. Taken
literally, the second sentence thins the utility cities **most** and spares the roadless ones, which is the
opposite of a gradient toward infrastructure and makes roads matter less where units actually use them.

Resolved by the user: **orphaned cities should have the higher chance of disappearing.** So the curve above
is correct as written — `p_keep` falls with distance from the road, the district core (the road end) is the
dense part, and the fringe dissolves.

**The trap, recorded so it is not re-inverted.** The quantity being scaled is the chance a city **exists**.
Decreasing it removes the *tail* (the orphans); it does not add them. It is easy to read "decreasing %"
as "fewer buildings overall" and then reason about the wrong end. The two statements are only compatible
once "fewer road connections to cities" is understood as **roads visit fewer districts**, not as **more
buildings sit off-road**:

- fewer road *connections* → the road network stays one component but visits a subset of districts (goal 1
  is satisfied, and `verifyMap`'s road-connectivity assertion is untouched);
- everything off-road → thinned by distance, so what survives is a handful of isolated hamlets rather than
  the accidental 0-or-29 distribution measured today.

Net effect: built-up districts sit *on* the spine, satellites are rare and deliberate, and total building
count drops from ~91/map (expect roughly 60–75 once thinning lands — to be measured, not assumed).

### G7 — back pocket: smaller districts vs ambient buildings

Recorded 2026-11-05, deliberately **not** part of G7 as designed. Kept because it is the likely next move if the
gradient still reads too even.

The lever for "make the map look busier away from roads" is **not** the thinning curve — it is district
*granularity*: **more districts, each smaller, with roads visiting a subset.** Two variations were floated:

- **(i) fewer cities, same radius** — a district keeps its footprint but fills sparsely;
- **(ii) smaller radius and fewer cities** — the district shrinks, so the silhouette is compact rather than a
  wide sparse field.

**The tradeoff is against a design intent that is not written down anywhere.** The user's earlier mental model
for the game was *ambient buildings scattered around special-purpose buildings* — ordinary settlements exist
because they sit near something with a purpose (factory, dockyard, airport, HQ). `grep` across `plans/` finds no
mention of "ambient" or "special-purpose", so this is carried only in the user's head and **must be specified
before G7 is implemented**, because it decides what a district even is:

| | Unit of generation | Why a building exists | Needs first |
|---|---|---|---|
| **A — districts** | an abstract density blob on a probability curve | road proximity / gradient | nothing; can ship now |
| **B — ambient around purpose** | a cluster around a special-purpose building | proximity to purpose | the special-purpose list, their placement rule, and the gid → role decision |

They compose rather than compete: **B supplies the candidate sites, the curve decides which survive.** But B is
blocked on things that do not exist yet — only neutral city gid 9 is generated, and "factory placement" is still
an open question in `progress.md` (leaning spawn logic rather than the composer). Airport 16, dockyard 13,
factory 12 and antenna 14 are identified in the palette but unplaced.

**Action before implementing G7:** get the user's "mental map of the game" for purpose-buildings written down.
Everything above is a guess at it, and guessing would bake the wrong model into the composer.

### Order and gate

```
G1 + G2  →  G3 + G4 (+G5)  →  freeze contract  →  4.2b TileMapManager  →  4.3 wiring
```

### Definition of done for 4.1b

- ✅ `npm run map:generate` prints occupancy per terrain inside the asserted band, plus a connectivity result (1 component).
- ✅ Same seed produces a byte-identical `level_01.json` (verified: seeds 1234, 999, 42, 7); a different seed produces a different one.
- ✅ Board is exactly `64x48 @ 16px` (1024×768 px world) — the silent-growth guard passes on every tested seed.
- ⬜ `level_01.terrain.json` sidecar — pending the G3 contract decision.
- ⬜ Map renders correctly at 48 px/tile with panning — renderer-side display work, pending.

### Open questions for 4.1b

- **Coverage target** — **resolved 2026-11-01: 36 %**, matching the user's choice to keep the denser feel over the AW-authentic ~20–25 % band found in the map-composition research. Only water affects connectivity, and the flood-fill check proves it safe.

### Display and board size — decided 2026-11-01

The earlier "the renderer caps the board at 37×37" problem is resolved by changing the display strategy rather than the board:

- **Fixed 48 px per tile** (integer camera zoom 3 on the 16 px source art — the source is never rescaled), so tiles look right at any OS scaling.
- **Canvas fills the window** (`Phaser.Scale.RESIZE`), replacing the hardcoded 800×600 in `main.ts`.
- **Camera pans** within `camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels)`; the whole board no longer has to fit on screen, so `fitCameraToMap`'s `max(1, floor(fitRatio))` is replaced by a fixed zoom of 3.
- **Board is 64×48 tiles** = 1024×768 world px → 3072×2304 screen px at 3×. At 48 px/tile the 1440p viewport shows ~53×30 tiles at 100 % scaling, ~42×24 at 125 %, ~35×20 at 150 % — so the board is always larger than the viewport and never letterboxes.

Consequences for this phase: element counts scale with the board (see G1), the connectivity check in G2 matters more (larger board, more water), and G4's layer merging matters more (each `TilemapLayer` is now 64×48 instead of 32×32).

