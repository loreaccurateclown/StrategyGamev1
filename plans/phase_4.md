# Phase 4: Map Pipeline & Tilemap Integration

**Goal:** A reproducible, scripted pipeline that turns the Kenney tiny-battle tileset into a playable board, plus the code that reads that board into the game's own terrain model. No hand-authoring in the Tiled editor.

**Status:** 4.1 and 4.2a are done. **4.1b (generator hardening, G1–G6) is the next body of work and is generator-owned.** 4.2b and 4.3 are not started and are blocked on 4.1b — the map contract has to be frozen before client code reads it.

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
npm run map:generate                              # seed 1234, 32×32
npm run map:generate -- --seed 999                # different layout
npm run map:generate -- --seed 1234 --width 48 --height 48
```

The script **fails loudly** if the generated map disagrees with `palette.json`: wrong board size, wrong tile size, `firstgid !== 1`, wrong columns/spacing/tilecount, any `0` in the ground layer, or a missing tileset image.

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
const FOREST_ROWS = [".TtT.", "TTtTT", "TTTtT", ".TtT."];
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
4. `fitCameraToMap` — integer zoom (`Math.max(1, Math.floor(fitRatio))`) so 16 px art stays crisp, bounds set from `map.widthInPixels`.

Verified output: `rendered 14 layers, skipped 13 collision layers (32x32 @ 16px = 512x512px)`.

Layer inventory for a default run:

| Layer | Purpose | Rendered |
|-------|---------|----------|
| `ground` | grass base, 1024/1024 cells, all gid 1 | ✅ |
| `ground-variations` | 100 cells of gids 1–3 | ✅ |
| `collisions-map-border` | 124 cells, board edge | ❌ (blocker) |
| `water{0..2}-visual` | 25 cells each | ✅ |
| `water{0..2}-collisions` | 25 cells each | ❌ (blocker) |
| `forest{0..5}-visual` | 16 cells each | ✅ |
| `forest{0..5}-collisions` | 16 cells each | ❌ (blocker) |
| `mountain{0..2}-visual` | 16 cells each | ✅ |
| `mountain{0..2}-collisions` | 16 cells each | ❌ (blocker) |

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

## 4.1b — Generator hardening roadmap (G1–G6) ⬜

**Status:** next body of work, generator-owned. G1/G2 must land before the client reads the map; G3/G4 freeze the contract that 4.2b is written against; G5/G6 are polish. This section supersedes the earlier "open tuning items" list.

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

### G1 — Retune density (target ≈ 37 %)

Starting point, to be iterated by measurement rather than treated as a spec:

| Element | Art | `f` | Qty | Cells | Reserved |
|---------|-----|-----|-----|-------|----------|
| forest | 6×5, ~26 filled | 0 | 7 | 182 | 210 |
| mountain | 6×4, ~20 filled | 0 | 4 | 80 | 96 |
| water | 7×6, ~38 filled | 1 | 3 | 114 | 216 |
| | | | | **376 (37 %)** | **522 (58 %)** |

The reservation total deliberately stays near the already-proven 58–60 %: above that the growth fallback returns. Denser clumps also improve the art (`f = 0` lets a grove be a grove instead of a scatter of separated clumps).

### G2 — Make `verifyMap` prove the map is playable

`verifyMap` currently checks board size, gids, zeros in the ground layer, and that the tileset image was copied. It does **not** check the two things that silently ruin a dense map:

1. **Connectivity** — flood-fill the passable interior (grass + forest + mountain, excluding the `collisions-map-border` ring, which is 32+32+30+30 = 124 cells) from one known free cell and assert a **single component**. This is what makes G1 safe, and it belongs in the generator, not the client.
2. **Occupancy band** — print per-terrain and total coverage, and assert a band (e.g. 30–48 %) so density cannot silently regress.
3. **Collision/visual agreement** — assert each element's `<key>-collisions` footprint matches its `<key>-visual` footprint. Currently unverified, and a mismatch would make walkability disagree with what the player sees.
4. Keep the existing board-size assertion as the hard gate against silent growth.

### G3 — Emit a `level_01.terrain.json` sidecar

The generator already knows each gid's terrain when it writes the layer, so it should write the resolved grid as well:

```json
{ "width": 32, "height": 32, "tileSize": 16, "seed": 1234,
  "paletteHash": "…", "terrain": [[1,1,2,…], …] }
```

- Values are `TerrainType`, **not** gids — so the client never needs `palette.json`, and an unknown gid becomes a generation-time failure instead of a browser failure.
- Generated from the same in-memory map object as the JSON, and `verifyMap` re-derives it from the visual layers and asserts equality, so the two files cannot drift.
- The border ring is deliberately **not** in the sidecar: pathfinding is bounds-limited anyway. If a 1-tile edge lock is wanted, the client can clamp to the interior — that is a client decision, not a data one.

This replaces 4.2b's reverse-mapping entirely.

### G4 — Collapse 27 layers to ~4

`MapLayersComposer` already supports `autoMergeLayersByKeys`, which merges by name substring and buckets overlapping members so draw order survives (`map-layers-composer.js:101`, `layer-data-factory.js:118`).

- `autoMergeLayersByKeys: ['visual', 'collisions']`
- 14 rendered layers → 3 (`ground`, `ground-variations`, `merge-visual`); 13 collision layers → 1 (`merge-collisions`, still skipped by the existing substring check).
- Each `TilemapLayer` is a full 32×32 render object; 14 of them for 219 tiles is real cost, and a 4-layer contract is far friendlier for the client.
- **Caveat:** merging `ground` with `ground-variations` does *not* collapse them — the variations overlap the ground everywhere, so the bucketing stacks them. Leave both alone.
- Layer names change, so this must land **with G3, before 4.2b is written**.

### G5 — Variant coverage

The ASCII legends reference two chars per element, so forest uses 2 of 5 variants, water 2 of 3, mountain 2 of 9. A third char per element costs nothing and removes the flat repeated-tile look.

### G6 — Shoreline autotiling (last)

Water is a solid pond of fill gids; 11 shore/edge gids (19–23, 37, 39, 40, 55–57) are unused, so ponds have hard rectangular edges. Needs a neighbour→edge-tile orientation map plus post-processing of the water layers in `generate-map.cjs`. Fiddly; only worth it once G1 makes the lakes bigger.

### Order and gate

```
G1 + G2  →  G3 + G4 (+G5)  →  freeze contract  →  4.2b TileMapManager  →  4.3 wiring
```

### Definition of done for 4.1b

- `npm run map:generate` prints occupancy per terrain and total inside the asserted band, plus a connectivity result (1 component).
- Same seed still produces a byte-identical `level_01.json` **and** `level_01.terrain.json`; a different seed produces different ones.
- Board is still exactly `32x32 @ 16px`, so the silent-growth guard still passes.
- `level_01.terrain.json` re-derived from the visual layers matches the emitted file exactly.
- `npx tsc --noEmit` clean, and the map still renders in `npm run dev`.

### Open questions for 4.1b

- **Coverage target** — ≈37 % (proposed) vs a more open ≈25 %. Only water affects connectivity, so this mostly controls how much cost terrain exists.
- **Board size** — 32×32 is a CLI flag and 48×48 works today; worth checking 16 px readability at that size before committing.

