# Plan: Advance Wars-Style 2D Turn-Based Strategy Game in Phaser 4 + TypeScript

## TL;DR
Build an Advance Wars-inspired turn-based strategy game using **Phaser 4 (TypeScript)** on a **32×32 tile grid**. Use a **single `BattleScene` with an internal FSM** for phase management, custom **Dijkstra pathfinding** with per-tile movement costs, and a **three-state fog-of-war** model. Start with a minimal playable vertical slice — click unit → highlight reachable tiles → click tile → unit moves — before adding combat, AI, or Tiled-based map authoring.

---

## Core Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Tile size: 32×32 px** | Standard for strategy games — room for detailed sprites and per-tile UI overlays |
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
│  Tiled Map Layers (Phase 4+)                                │
│  ├─ Terrain       (tile indices)                            │
│  ├─ Collision     (walkable vs. blocked)                    │
│  ├─ FogOfWar      (unexplored / explored / visible)         │
│  └─ Objects       (unit placement markers, objectives)      │
└─────────────────────────────────────────────────────────────┘
```

**Phase 1 only implements `BattleScene`** (starting directly via `main.ts`). `BootScene`, `SetupScene`, and `GameOverScene` are added in later phases.

---

## Step-by-Step Implementation Plan

Each phase has a canonical spec in its own file. This document gives the goal, the shape, and the decisions; the per-phase file gives the step-by-step actions, DoD, interfaces, and tests.

### [Phase 1: Core Loop Vertical Slice (Days 1–2)](./phase_1.md)

**Goal:** A single runnable `BattleScene` where you can **click a unit → see reachable tiles → click a tile → it moves**, on a 32×32 grid with terrain costs. No Tiled, no sprites, no fog, no attack, no AI, no scene-per-phase. Only `BattleScene` is implemented (starting directly via `main.ts`).

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

### Phase 4: Tiled Integration & Tooling (Days 10–12)

| Step | Task | Details |
|------|------|---------|
| 4.1 | Create Tiled map project | 32×32 grid; tilesets for grass/water/mountain/forest; layers for terrain/collision/fog/objects |
| 4.2 | Swap `TileMapManager` to Phaser Tilemap API | Load `.json` via `this.load.tilemapTiledJSON()`; parse to `number[][]` |
| 4.3 | Wire Tiled layers to systems | Terrain → costs; Collision → walkable; FogOfWar → visibility tracking |

**Full spec:** see `phase_4.md`.

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
| **Dijkstra** | Reachable tiles within MP budget | O(V + E log V) with a priority queue; O(V²) with array queue — fine for 1024 nodes |
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
- **Camera bounds:** `this.cameras.main.setBounds(0, 0, GRID_SIZE * TILE_SIZE, GRID_SIZE * TILE_SIZE)` → 1024×1024 world. Set zoom to fit **or** allow drag-pan, not both.
- **Graphics:** `this.add.graphics().fillStyle(0x00ff00).fillRect(x, y, TILE_SIZE, TILE_SIZE)`
- **Scene management:** only top-level scenes use `this.scene.start()`; phases stay inside `BattleScene`

---

## Verification Steps

1. **Build:** `npm run dev` shows a 32×32 board with colored tiles and one unit rect
2. **Pathfinding:** click unit → reachable tiles highlighted (water unreachable, forest costs 2)
3. **Movement:** click reachable tile → unit animates along path over ~200 ms
4. **Turn flow:** setup → move → attack → end_turn cycles without crashing
5. **Fog of war:** units outside LOS are not visible or selectable; explored terrain remains remembered after leaving LOS
6. **Tests:** `npm test` passes all Pathfinding tests (see `phase_1.md`)

---

## Decisions & Assumptions

| Decision | Rationale |
|----------|-----------|
| Hardcoded map first, Tiled in Phase 4 | Tooling work before fun is a trap |
| Dijkstra over BFS | BFS ignores terrain costs |
| Single-scene FSM | Avoids scene-transition resets and state-shuttle code |
| 4-directional for MVP | 8-way + corner rules is a Phase 5+ concern |
| 32 px × 32 tiles = 1024 px world | Standard strategy size; world bounds = `GRID_SIZE * TILE_SIZE` |

---

## Further Considerations

1. **Map scaling** — make `GRID_SIZE` configurable so 64×64 / 100×100 work without refactor
2. **Network multiplayer** — serialize state and sync turns over WebSockets
3. **Mobile input** — tap-to-select, drag-to-move mapping in `InputHandler`

---

## Critical Flags (Don't Skip)

- ✅ **Verify Phaser 4 API before building.** Confirm `load.tilemapTiledJSON`, `tilemap.getTileAt`, `setCollision` exist in the pinned version. Decision is binding.
- ✅ **Gate checks must compile the actual method calls**, not just `import Phaser from 'phaser'`. A passing `tsc` on a file that only renders a rectangle doesn't prove `setCollision` exists — it proves the import resolves. The verification file must call all three APIs (`load.tilemapTiledJSON`, `getTileAt`, `setCollision`) against declared types so tsc failing = API missing, and tsc catching an unrelated error (e.g. unused var) confirms real type checking is happening rather than just resolving the import.
- ✅ **Dijkstra, not BFS.** Terrain costs break BFS.
- ✅ **Single scene with FSM.** No `MovePhaseScene`, `AttackPhaseScene`, etc.
- ✅ **Hardcode the map first.** Tiled is a Phase 4 concern.
- ✅ **World coordinates for input.** Use `cameras.main.getWorldPoint`, not `pointer.x / 32`.

---

## File Structure (Final)

```
src/
├── core/
│   ├── TileMapManager.ts       # Hardcoded grid (Phase 1) → Phaser Tilemap API (Phase 4)
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
│   └── level_01.json           # Phase 4+
└── audio/
```

---

## Summary of Fixes from Prior Revisions

| Issue | Prior | This version |
|-------|-------|--------------|
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