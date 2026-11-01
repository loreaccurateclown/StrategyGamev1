# Phase 4: Map Pipeline & Tilemap Integration

**Goal:** A reproducible, scripted pipeline that turns the Kenney tiny-battle tileset into a playable board, plus the code that reads that board into the game's own terrain model. No hand-authoring in the Tiled editor.

**Status:** 4.1, 4.1b-G1/G2, and 4.2a are done. **G3/G4 (sidecar + layer merge) are next and await the contract decision**; 4.2b and 4.3 are not started and stay blocked on that decision — the map contract has to be frozen before client code reads it.

---

## Why not hand-author in Tiled

The repo already ships a 16 px tileset (`assets/tilemaps/kenney_tinybattle.tsx`), so re-tiling was never the problem — producing *boards* was. `@reldens/tile-map-generator` does that procedurally, which means a new map is a command, not an afternoon of clicking. The trade-off is that the generator is opinionated and has several sharp edges (see below), so this file records them.

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
    ├── tile-grid.cjs           # ASCII art → Tiled layer objects
    └── map-elements.cjs        # forest / water / mountain element layers

assets/generator/
└── palette.json                # verified gid ↔ terrain table

public/assets/maps/             # generator output (committed)
├── level_01.json
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

**There is no road tile.** The only gold pixels (`rgb(253,190,83)`) are 13% of gid 3 — a decoration on grass. `TerrainType.Road` therefore exists in the type system (cost 1) but the generator never emits it, and no path is carved (`mainPathSize` unset).

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

Historical verified output (32×32 era): `rendered 14 layers, skipped 13 collision layers (32x32 @ 16px = 512x512px)`. Current default run is 64×48 with 87 layers (44 rendered / 43 collision).

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

## 4.2b — `TileMapManager` from the map ⬜

Not started. Target contract:

```ts
// src/core/TileMapManager.ts
export function terrainGridFromMap(map: TiledMapLike): TerrainType[][]
```

Rules:

- Start from `ground` (all grass), then stamp each `*-visual` layer on top in layer order.
- Map each gid → `TerrainType` through `assets/generator/palette.json`. **Do not** assume gid === `TerrainType`.
- Validate at the import boundary: an unknown gid is a hard error, not a silent skip — after that check, the pathfinder can trust every value it receives. Tracked in `.vscode/todos.json`.
- Keep the result Phaser-free so `Pathfinding.ts` can consume it under Vitest's Node environment.
- Collision comes from `*-collisions` + `collisions-map-border`, not from visual layers.

**Decided 2026-11-01 (was "alternative worth considering"):** the generator will emit a sidecar `level_01.terrain.json` containing the already-resolved `TerrainType[][]`, so the client never reverse-maps gids. Rationale: the generator knows every gid's terrain at write time, so an unknown gid is a *generation* error rather than a browser error, and `TileMapManager` collapses to a fetch + validate with no palette knowledge. See step **G3** in the roadmap below. This makes the whole reverse-mapping approach described above obsolete — do not implement it.

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

**Shipped as proposed, verified on seeds 1234, 999, 42, 7:** `Verified: 64x48 @ 16px, 87 layers | occupancy: forest 16.9 %, mountain 9.1 %, water 9.9 %, grass 64.1 % | connectivity: 1 component(s), 2548/2548 walkable cells`. No silent growth on any seed, byte-identical output per seed. The 50×50 probe with these counts correctly fails the band (44.2 %), which is expected — 50×50 would need counts scaled ≈0.81×, and it still letterboxes at 1440p@100 % (viewport is 53 tiles wide > 50).

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

### G4 — Collapse 87 layers to ~4

`MapLayersComposer` already supports `autoMergeLayersByKeys`, which merges by name substring and buckets overlapping members so draw order survives (`map-layers-composer.js:101`, `layer-data-factory.js:118`).

- `autoMergeLayersByKeys: ['visual', 'collisions']`
- 44 rendered layers → 3 (`ground`, `ground-variations`, `merge-visual`); 43 collision layers → 1 (`merge-collisions`, still skipped by the existing substring check).
- Each `TilemapLayer` is a full 64×48 render object; 44 of them for 1104 tiles is real memory and fill-rate cost (the JSON is already 551 KB), and a 4-layer contract is far friendlier for the client.
- **Caveat:** merging `ground` with `ground-variations` does *not* collapse them — the variations overlap the ground everywhere, so the bucketing stacks them. Leave both alone.
- Layer names change, so this must land **with G3, before 4.2b is written**.

### G5 — Variant coverage ✅ (done with G1)

The ASCII legends previously referenced two chars per element (forest 2/5 variants, water 2/3, mountain 2/9). The G1 art uses **three variants per element** (forest `T t f`, water `w W s`, mountain `m M n`), so the terrain no longer reads as flat repeats.

### G6 — Shoreline autotiling (last)

Water is a solid pond of fill gids; 11 shore/edge gids (19–23, 37, 39, 40, 55–57) are unused, so ponds have hard rectangular edges. Needs a neighbour→edge-tile orientation map plus post-processing of the water layers in `generate-map.cjs`. Fiddly; only worth it once G1 makes the lakes bigger.

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

