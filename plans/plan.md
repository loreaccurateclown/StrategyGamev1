# Plan: Advance Wars-Style 2D Turn-Based Strategy Game in Phaser 4 + TypeScript

## TL;DR
Build an Advance Wars-inspired turn-based strategy game using **Phaser 4 (TypeScript)** on a **64×48 tile board built from 16×16 px source tiles** (a 1024×768 px world), **displayed at a fixed 48 px per tile** (3× the source art) on a window-filling canvas with camera panning. Use a **single `BattleScene` with an internal FSM** for phase management, custom **Dijkstra pathfinding** with per-tile movement costs, and a **three-state fog-of-war** model. Maps are produced procedurally by `@reldens/tile-map-generator` from the Kenney tiny-battle tileset — see [`phase_4.md`](./phase_4.md) and [`progress.md`](./progress.md).

---

## Core Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Source tiles: 16×16 px, displayed at 48 px (3×)** | 16 px is the only tileset the project has (`kenney_tinybattle.tsx`: 16 px, 1 px spacing, 18 columns, 198 tiles). It is **never rescaled in the source** — the 3× happens at render time by integer camera zoom, which keeps pixel art crisp. Fixed 48 px/tile (not fit-to-window) is what makes the game look right on a 1440p display regardless of OS scaling |
| **Board: 64×48 tiles** | At 48 px/tile the 1440p viewport shows ~53×30 tiles (100 % scaling) down to ~35×20 (150 % scaling). A 32×32 board would letterbox badly at every one of those, so the battlefield is deliberately larger than any viewport and the camera pans within it |
| **Phaser 4 + TypeScript** | Type safety; scene system maps cleanly to top-level game states |
| **Square grid, 4-directional movement for MVP** | Simplest correct model. Diagonals, "don't cut corners" LOS, and 8-way adjacency are deferred to Phase 5+ |
| **Dijkstra over BFS for pathfinding** | BFS assumes uniform edge weight; terrain costs break that assumption |
| **Single `BattleScene` with internal FSM** | Scene transitions reset camera/input/UI and force state shuttle through a singleton. FSM in one scene is cleaner |
| **Three-state fog of war** | `unexplored` / `explored` / `visible` — conflating these leads to refactors |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Phaser 4 Scene System                    │
├─────────────────────────────────────────────────────────────┤
│  Top-level scenes (Phaser .scene.start transitions only):    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  BootScene   │→ │ SetupScene   │→ │  BattleScene     │  │
│  └──────────────┘  └──────────────┘  │  (FSM inside)    │  │
│                                      └──────────────────┘  │
│                                      ┌──────────────────┐  │
│                                      │  GameOverScene   │  │
│                                      └──────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  BattleScene internal FSM states:                            │
│  setup → move → attack → end_turn → enemy_turn → move …      │
├─────────────────────────────────────────────────────────────┤
│  GameEngine (shared across scenes)                          │
│  ├─ UnitManager      ├─ TileMapManager    ├─ Pathfinding   │
│  ├─ FogOfWar         ├─ LineOfSight       ├─ TurnState     │
│  └─ InputHandler     └─ UIManager         └─ AudioManager  │
├─────────────────────────────────────────────────────────────┤
│  Generated Map Layers (Phase 4)                              │
│  ├─ ground                  (grass base, no zeros)          │
│  ├─ ground-variations       (grass variants)                │
│  ├─ *-visual                (forest / water / mountain)      │
│  ├─ *-collisions            (blocker masks)                  │
│  └─ collisions-map-border   (board edge)                     │
└─────────────────────────────────────────────────────────────┘
```

**Phase 1 renders only `BattleScene`** (started directly via `main.ts`). `BootScene`, `SetupScene`, and `GameOverScene` are added in later phases.

---

## Step-by-Step Implementation Plan

Each phase has a canonical spec in its own file. This document gives the goal, the shape, and the decisions; the per-phase file gives the step-by-step actions, DoD, interfaces, and tests.

### [Phase 1: Core Loop Vertical Slice (Days 1–2)](./phase_1.md)

**Goal:** A single runnable `BattleScene` where you can **click a unit → see reachable tiles → click a tile → it moves**, on a 64×48 tile board of 16×16 px source tiles, with terrain costs. No sprites beyond the tileset, no fog, no attack, no AI.

**Status:** the board, the generated map, and its rendering are done. Movement, pathfinding wiring, and the FSM are not. See [`progress.md`](./progress.md).

**Full step-by-step spec, DoD, Pathfinding interface, and tests:** see [`phase_1.md`](./phase_1.md).

**Scope reminder:** Phase 1 implements the `setup → move` FSM states only. `attack`, `end_turn`, and `enemy_turn` arrive in Phase 2–3. The full FSM in the architecture diagram above is the *final* shape, not the Phase 1 shape.

---

### Phase 2: Turn-Based State Machine & Attack System (Days 3–5)

**Goal:** A complete turn cycle where players can move and attack.

| Step | Task | Details |
|------|------|---------|
| 2.1 | Implement `TurnState` FSM in `BattleScene` | Tracks `currentPlayer`, `phase`, remaining MP per unit — **no scene transitions**, just state changes within one scene |
| 2.2 | Build move → attack flow | After moving, switch to attack sub-state; highlight valid attack targets within range using LOS |
| 2.3 | Implement `LineOfSight` | Raycast from unit center through tiles; blocked by mountains/water and other units |
| 2.4 | Implement `AttackResolution` | Damage based on terrain modifiers; apply to target, update HP |
| 2.5 | Build End Turn transition | Reset MP, switch control to enemy AI |

**Fog-of-war note:** Tiles start `unexplored`; entering a unit's LOS marks them `visible`; leaving LOS demotes to `explored` (terrain remembered, units hidden).

**Full spec:** see `phase_2.md`.

---

### Phase 3: Enemy AI & Polish (Days 6–9)

| Step | Task | Details |
|------|------|---------|
| 3.1 | `EnemyAI` class | Find nearest valid target → pathfind → attack if in range; fallback to random movement |
| 3.2 | Fog-of-war rendering | Graphics overlay or tile layer respecting `unexplored` / `explored` / `visible` |
| 3.3 | UI overlays | Health bars, MP display, unit type icons, turn indicator |
| 3.4 | Audio | Phaser `SoundManager` for move/attack/end-turn |
| 3.5 | Visual polish | Direction indicators, attack tweens, floating damage numbers |

**Full spec:** see `phase_3.md`.

---

### Phase 4: Map Pipeline & Tilemap Integration

Originally "Tiled Integration & Tooling". The map is **not** hand-authored in the Tiled editor; it is generated by a script from the Kenney tileset. Status: steps 4.1 and 4.2a are done. **4.1b (generator hardening, G1–G6) is next and is generator-owned**; 4.2b and 4.3 are blocked on it, because the map contract has to be frozen before the client reads it.

| Step | Task | Details | Status |
|------|------|---------|--------|
| 4.1 | Map generation pipeline | `npm run map:generate` → `public/assets/maps/level_01.json` via `@reldens/tile-map-generator@0.64.0`, seeded for reproducibility. Terrain: grass/forest/water/mountain. Tile size 16 px | ✅ done |
| 4.1b | Generator hardening | Raise density from 21 % by improving placement efficiency (`freeSpace` 0 for forest/mountain, larger clumps, water kept modest), add connectivity + occupancy assertions to `verifyMap`, emit a `level_01.terrain.json` sidecar, and collapse 87 layers to ~4 | 🔶 G1/G2/G5 done (35.9 % coverage, connectivity-proven); G3/G4 pending contract decision |
| 4.2a | Render the generated map | `BattleScene` loads the JSON + tileset texture with `load.tilemapTiledJSON` / `load.image`, builds one `createLayer` per non-collision layer, fits the camera to the board | ✅ done, **needs revision** for the 48 px/tile + panning decision (fixed zoom 3 on a window-filling canvas, replacing `fitCameraToMap`) |
| 4.2b | `TileMapManager` from the map | Consume the **terrain sidecar from 4.1b**, not the visual layers — no gid reverse-mapping in the client. Validate at the import boundary | ⬜ blocked on 4.1b |
| 4.3 | Wire layers to systems | Terrain → costs; collision layer → walkable; fog layer → visibility tracking | ⬜ blocked on 4.1b |

**Full spec:** see [`phase_4.md`](./phase_4.md). **Current state:** see [`progress.md`](./progress.md).

---

### Phase 5: Gameplay Depth & Campaign Mode (Days 13–20+)

- Supply lines / supply radius
- Terrain variety (rivers, hills, ruins) with modifiers
- Unit upgrades
- Multiple unit types (air, artillery, recon)
- Campaign mode with scripted objectives
- *(Optional)* 8-directional movement with corner-cut rules

**Full spec:** see `phase_5.md`.

---

## Key Algorithms & Data Structures

| Algorithm | Use Case | Complexity |
|-----------|----------|------------|
| **Dijkstra** | Reachable tiles within MP budget | O(V + E log V) with a priority queue; O(V²) with array queue — fine for ~3k nodes (64×48) |
| **A\*** | Single shortest path (optional) | O(E log V) |
| **Raycasting (LOS)** | Line of sight from unit to target | O(width × height) per raycast; stops at first blocker |

- `TileMapManager`: 2D `number[][]` for O(1) lookup, kept separate from Phaser internals
- `Pathfinding`: returns `Map<string, ReachableTile>` keyed by `tileKey(pos)` (see `phase_1.md`)
- `TurnState`: `{ currentPlayer, phase, perUnitState }`

---

## Key API Usage Notes (Phaser 4)

- **Input (camera-aware):**
  ```ts
  const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
  const tx = Math.floor(worldPoint.x / TILE_SIZE);
  const ty = Math.floor(worldPoint.y / TILE_SIZE);
  ```
- **Camera:** fixed integer zoom of 3 (48 px per 16 px source tile) on a window-filling canvas, with `this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels)` → 1024×768 world for a 64×48 board. The board is larger than the viewport by design, so the camera **pans**; do not go back to fit-to-window integer zoom, which letterboxed the board and forced it to stay tiny.
- **Graphics:** `this.add.graphics().fillStyle(0x00ff00).fillRect(x, y, TILE_SIZE, TILE_SIZE)`
- **Scene management:** only top-level scenes use `this.scene.start()`; phases stay inside `BattleScene`
- **Tileset name ≠ image name:** the generator writes the tileset's `name` as the *map* name (`level_01`), while `image` holds the PNG filename. Always read the name back out of the parsed map:
  ```ts
  const tilesetName = map.tilesets[0].name;      // 'level_01'
  map.addTilesetImage(tilesetName, 'kenney-tinybattle'); // (name, textureKey)
  ```

---

## Verification Steps

1. **Map generation:** `npm run map:generate` exits 0 and prints `Verified: 64x48 @ 16px, 87 layers | occupancy: forest 16.9%, mountain 9.1%, water 9.9%, grass 64.1% | connectivity: 1 component(s), 2548/2548 walkable cells`; running it twice with the same `--seed` produces byte-identical JSON
2. **Build:** `npm run dev` renders the 1024×768 world board with grass, forest, water, and mountain tiles at 48 px per tile on a window-filling canvas, pannable — no magenta textures, no holes in the ground layer
3. **Pathfinding:** click unit → reachable tiles highlighted (water unreachable, forest costs 2, mountain costs 3)
4. **Movement:** click reachable tile → unit animates along path over ~200 ms
5. **Turn flow:** setup → move → attack → end_turn cycles without crashing
6. **Fog of war:** units outside LOS are not visible or selectable; explored terrain remains remembered after leaving LOS
7. **Tests:** `npm test` passes all Pathfinding tests (see `phase_1.md`)

---

## Decisions & Assumptions

| Decision | Rationale |
|----------|-----------|
| Generated map, not hand-authored Tiled | Removes the manual authoring step; the Kenney sheet is already 16 px so no re-tiling is needed. Phase 4 documents the pipeline |
| Object-mode generation (inline element layers) | Composite mode needs `key` tile properties on the tileset, which the Kenney sheet does not have |
| Dijkstra over BFS | BFS ignores terrain costs |
| Single-scene FSM | Avoids scene-transition resets and state-shuttle code |
| 4-directional for MVP | 8-way + corner rules is a Phase 5+ concern |
| 16 px source tiles, 64×48 board (1024×768 px world), displayed at 48 px/tile | Tile size is dictated by the tileset (16 px, unchanged). The **board size is a design choice** driven by the 48 px/tile display decision, not a consequence of the tileset — the only coupling is `world px = board tiles × 16` |

---

## Further Considerations

1. **Map scaling** — `GRID_SIZE` is already a CLI flag (`--width` / `--height`), so the *generator* handles 64×64 / 100×100 today. The **renderer does not**: `BattleScene.fitCameraToMap` clamps zoom to `max(1, floor(fitRatio))`, so it can never shrink below 1:1 and any board taller than the 800×600 canvas is cropped, not scaled. With 16 px tiles the ceiling is 37×37 (592 px); 38×38 (608 px) already overflows. Going bigger needs a canvas, `Phaser.Scale`, or camera panning decision first
2. **Network multiplayer** — serialize state and sync turns over WebSockets
3. **Mobile input** — tap-to-select, drag-to-move mapping in `InputHandler`

---

## Critical Flags (Don't Skip)

- ✅ **Verify Phaser 4 API before building.** Confirm `load.tilemapTiledJSON`, `tilemap.getTileAt`, `setCollision` exist in the pinned version. Decision is binding.
- ✅ **Gate checks must compile the actual method calls**, not just `import Phaser from 'phaser'`. A passing `tsc` on a file that only renders a rectangle doesn't prove `setCollision` exists — it proves the import resolves. The verification file must call all three APIs (`load.tilemapTiledJSON`, `getTileAt`, `setCollision`) against declared types so tsc failing = API missing, and tsc catching an unrelated error (e.g. unused var) confirms real type checking is happening rather than just resolving the import.
- ✅ **Dijkstra, not BFS.** Terrain costs break BFS.
- ✅ **Single scene with FSM.** No `MovePhaseScene`, `AttackPhaseScene`, etc.
- ✅ **Generated map, not a hand-authored one.** The pipeline is `npm run map:generate`; see `phase_4.md`. Do not hand-edit `public/assets/maps/level_01.json` — it is overwritten on every run.
- ✅ **World coordinates for input.** Use `cameras.main.getWorldPoint`, not `pointer.x / TILE_SIZE`-by-hand arithmetic on screen coords.

---

## File Structure (Final)

```
src/
├── core/
│   ├── TileMapManager.ts       # Generated map → TerrainType[][] (phase 4.2b, not written)
│   ├── UnitManager.ts
│   ├── Pathfinding.ts          # Dijkstra + tileKey + reconstructPath
│   ├── Pathfinding.test.ts     # Vitest — see phase_1.md
│   ├── LineOfSight.ts
│   ├── FogOfWar.ts             # Three states: unexplored / explored / visible
│   ├── TurnState.ts
│   └── InputHandler.ts
├── scenes/
│   ├── BootScene.ts            # Phase 2+
│   ├── SetupScene.ts           # Phase 2+
│   ├── BattleScene.ts          # Phase 1 — single scene, internal FSM
│   └── GameOverScene.ts        # Phase 2+
├── entities/
│   ├── Unit.ts
│   ├── Infantry.ts
│   ├── Tank.ts
│   └── AirUnit.ts
├── ui/
│   ├── HealthBar.ts
│   ├── MovementPointsDisplay.ts
│   └── UnitIcon.ts
├── audio/
│   └── SoundManager.ts
├── types/
│   └── game.types.ts
└── main.ts

public/assets/                  # Served at /assets/... by Vite
├── tilesets/                   # Phase 4+
├── units/                      # Phase 4+
├── maps/
│   └── level_01.json           # generated — do not hand-edit
└── audio/
```

The generator side (Node-only, never bundled):

```
scripts/
├── generate-map.cjs            # npm run map:generate
└── lib/
    ├── prng.cjs                # seeded Math.random replacement
    ├── tile-grid.cjs           # ASCII art → Tiled layer objects
    └── map-elements.cjs        # forest / water / mountain element layers

assets/generator/
└── palette.json                # verified gid ↔ terrain table
```

---

## Summary of Fixes from Prior Revisions

| Issue | Prior | This version |
|-------|-------|--------------|
| Tile size | 32×32 px (no tileset of that size existed) | 16×16 px, matching `kenney_tinybattle.tsx` |
| World size | 1024×1024 px | 1024×768 px (64×48 tiles × 16 px) |
| Map source | Hand-authored Tiled project | Generated by `@reldens/tile-map-generator`, seeded |
| Phase 4 reference | `phase_4.md` did not exist | Written |
| Architecture diagram | Mixed scene-per-phase with single-scene FSM | Only top-level scenes; FSM inside `BattleScene` |
| Phase 1 scope | Diagram implied all scenes exist on day 1 | Phase 1 uses `BattleScene` only; other scenes are Phase 2+ |
| Input API | Mixed `pointer.x / 32` and `camera.getWorldPoint()` | Unified to `cameras.main.getWorldPoint(pointer.x, pointer.y)` |
| Pathfinding interface | Undefined signature | Defined once, in `phase_1.md` (single source of truth) |
| `ReachableTile` type | Referenced but undefined | Defined in `phase_1.md` → `game.types.ts` |
| Cost convention | Unspecified (tests assumed two different conventions) | Explicit in `phase_1.md`: enter-cost; start = 0 |
| Pathfinding tests | Undefined; two competing versions | Single 7-test suite in `phase_1.md` (includes BFS discriminator, MP budget, occupancy, reconstructPath success + failure) |
| Fog-of-war states | Binary "hidden / visible" in Phase 2 text | Three-state throughout: `unexplored` / `explored` / `visible` |
| Asset folders | Both `assets/` and `public/assets/` listed | Single `public/assets/` tree |
| Diagonal rationale | Mentioned √2 cost in 4-directional MVP | Deferred to Phase 5+ |
| Phase 1 content | Inlined in `plan.md` (duplicated tests + interface) | Extracted to `phase_1.md`; `plan.md` holds only goal + pointer |
| Duplicate `## Pathfinding Interface` / `## Unit Testing` | Bottom of `plan.md` after inlining | Removed — live only in `phase_1.md` |
| Heading hierarchy | `# Phase 1` at H1, Phases 2–5 at H3 | All five phases at H3 under "Step-by-Step Implementation Plan" |
| Phase 1 discoverability | Plain heading, spec referenced only in body | Heading is a link to `phase_1.md`; body reference retained as fallback |
| Stray metadata | "Response complete", token counts, duplicate summary | Removed |