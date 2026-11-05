# Phase 1: Core Loop Vertical Slice (Days 1–2)

> **Superseded on board size (2026-11-01).** The board is now **64×48 tiles** displayed at a fixed **48 px per tile** (integer 3× on the 16 px source art) on a window-filling, pannable canvas. The pathfinding contracts, types, and tests in this file are **unaffected** — they are grid-agnostic and still authoritative. Wherever this file says 32×32 / 512×512, read it as the original Phase 1 scope; the current target lives in [`plan.md`](./plan.md) and [`phase_4.md`](./phase_4.md).

> **Verified 2026-10-31 against Phaser 4.2.1:** `Scene.load.tilemapTiledJSON`, `Tilemap.getTileAt`, and `TilemapLayer.setCollision` are present in the pinned package's TypeScript declarations.

**Goal:** A single runnable `BattleScene` where you can **click a unit → see reachable tiles → click a tile → it moves**, on a **64×48 tile board built from 16×16 px source tiles** (1024×768 px world, shown at 48 px/tile) with terrain costs. No fog, no attack, no AI, no scene-per-phase. Only `BattleScene` is implemented (started directly via `main.ts`).

> **Note (2026-10-31):** the tile size is **16×16 px**, not 32×32 px. It is dictated by the only tileset in the repo. The *board* is still 32×32 tiles. The hardcoded map in step 1.3 has been superseded by the generated map from `phase_4.md`, so step 1.3 is now "load the generated map" rather than "invent a grid".

> **Canonical spec for Phase 1.** This file is self-contained — the Pathfinding interface and all contracts referenced below are defined in this document. Other phase files follow the same pattern.
>
> **Phase A — Environment & Dependencies.** Phaser 4.2.1 is pinned exact (`phaser@4.2.1 --save-exact`). The API gate calls the following methods on their declared owners:
> - `Scene.load.tilemapTiledJSON("key", "map.json")` — asset loader API (Phase 1/4).
> - `Tilemap.getTileAt(x, y)` → `Phaser.Tilemaps.Tile | null` — tile lookup.
> - `TilemapLayer.setCollision(indexes, collides?, recalculateFaces?, updateLayer?)` — sets Phaser tile collision flags. The custom pathfinder must separately enforce terrain passability and movement costs.
> - **Verification method:** `src/_gate_check.ts` calls all three APIs against the declared scene, tilemap, and tilemap-layer types; `tsc --noEmit` verifies those calls compile.
> - **Note:** `setCollidesWith` belongs to Arcade Physics and is not the tilemap API. `setCollision` is a method on `TilemapLayer`, not `Phaser.Tilemaps`.

---

## Actions to take

| Step | Task | Details |
|------|------|---------|
| 1.0 | ✅ **Completed — verify Phaser API and pin version** | Phaser 4.2.1 is pinned exactly in `package.json`. Verified `Scene.load.tilemapTiledJSON`, `Tilemap.getTileAt`, and `TilemapLayer.setCollision` against the installed types on 2026-10-31; the verification note is at the top of this file. |
| 1.1 | ✅ **Completed — verify Phaser setup + TypeScript** | Vite, TypeScript, and Phaser are configured. `src/main.ts` boots a minimal Phaser scene; `npm run build` and the browser startup were verified. Do not rerun project scaffolding. |
| 1.2 | ✅ **Completed — define core types** | `GridPos`, `TerrainType`, `UnitType`, `TerrainDef` (moveCost, passable, blocksLOS), `ReachableTile`, and `TERRAIN_DEFS` live in `src/types/game.types.ts`. `TerrainType` is `Grass = 1, Forest = 2, Water = 3, Mountain = 4, Road = 5, Building = 6`, and **every one of the six is emitted by the generator** — roads and neutral-city buildings arrived with the composer rewrite (see [`phase_4.md`](./phase_4.md) and [`progress.md`](./progress.md)). |
| 1.3 | ✅ **Completed — map source** | ~~Hardcoded 32×32 `number[][]`~~ Superseded: the board is generated (see [`phase_4.md`](./phase_4.md)) and rendered by `src/scenes/BattleScene.ts` at 16 px per tile. Tile ids in the JSON are **gids** (1-based), mapped to `TerrainType` through `assets/generator/palette.json`. Reading that JSON into `TerrainType[][]` is step 4.2b, not done yet. |
| 1.3b | **Use the terrain definitions for movement rules** | `TERRAIN_DEFS` is the source of truth. A known terrain is traversable only when `passable` is true; use its `moveCost` as the enter-cost. Impassable terrain and unknown tile indices resolve to `Infinity` at the pathfinding boundary. Never pass a negative movement cost to Dijkstra. |
| 1.4 | Implement **Dijkstra** pathfinding | `getReachableTiles` with per-tile move costs; store `cost` (**enter-cost convention: start tile = 0**) and `parent` per tile to reconstruct paths. Export `tileKey(pos)` and `reconstructPath(reachable, target): GridPos[]`. See the Pathfinding interface below |
| 1.4b | **Keep `Pathfinding.ts` Phaser-free** | Plain TypeScript only: `GridPos = { x, y }`, no imports beyond the type file (no `import Phaser from 'phaser'`). This is required so `Pathfinding.test.ts` can import it under vitest's default Node environment — Node has no canvas |
| 1.4c | **Write `Pathfinding.test.ts`** | Vitest and the `"test": "vitest run"` script are already configured. Create the file as specified in the Tests section below. No `vitest.config.ts` is needed — the Phaser-free `Pathfinding.ts` runs under Vitest's default Node environment, so do not add a jsdom config or reinstall Vitest |
| 1.5 | Wire the core loop | `this.cameras.main.getWorldPoint(pointer.x, pointer.y)` → tile coords → Dijkstra → tint reachable → second click animates unit along path over ~200 ms |

---

## Pathfinding interface

All functions below operate on plain TypeScript — no Phaser import (see step 1.4b).

### Types

```ts
// src/types/game.types.ts
export interface GridPos { x: number; y: number }

export interface ReachableTile {
  pos: GridPos;
  cost: number;   // enter-cost: cost to move *onto* this tile (start tile = 0)
  parent: GridPos | null;
}
```

`UnitType` is a union of unit-name string literals describing a unit's **kind**, not the full unit object. Current value in `src/types/game.types.ts`:

```ts
type UnitType =
  | "infantry" | "l_veh" | "m_veh" | "h_veh" | "sh_veh"
  | "heli" | "prop_plane" | "jet_plane"
  | "l_ship" | "m_ship" | "h_ship" | "sh_ship"
  | "offmap";
```

> **Must be exported** (`export type UnitType = …`). With `noUnusedLocals` on, an alias that is neither used in its own file nor exported is a compile error (`TS6196`), and nothing else can import it.

`TERRAIN_DEFS` is the single source of truth for `TerrainType` movement costs and passability. Current values (mirroring `src/types/game.types.ts`):

| Terrain | `moveCost` | `passable` | `blocksLOS` |
|---------|-----------|------------|-------------|
| Grass | 1 | ✅ | ❌ |
| Forest | 2 | ✅ | ❌ |
| Water | `Infinity` | ❌ | ✅ |
| Mountain | 3 | ✅ | ✅ |
| Road | 1 | ✅ | ❌ |
| Building | `Infinity` | ❌ | ❌ |

### `tileKey(pos): string`

Hashes a position into a map key. Contract: `` `"${x},${y}"` `` — no spaces, comma-separated.

### `getReachableTiles(grid, start, maxMovementPoints, getTerrainCost, isOccupied) → Map<string, ReachableTile>`

Runs Dijkstra from `start` and returns every tile reachable within `maxMovementPoints`, keyed by `tileKey`.

- **grid** — the 32×32 terrain grid (`number[][]`).- **start** — `GridPos` of the unit's current tile.
- **maxMovementPoints** — total movement points available this turn (e.g. 6). `Infinity` means no limit (used by tests).
- **getTerrainCost(tileIndex: number) → number** — given a numeric tile index from the grid, look up its definition in `TERRAIN_DEFS`. Return its `moveCost` only when the definition is passable and the cost is finite and nonnegative; otherwise return `Infinity`. Unknown indices also return `Infinity`. The pathfinder passes `grid[pos.y][pos.x]`, not `pos` itself. This keeps terrain values centralized and ensures invalid costs are never used by Dijkstra.
- **isOccupied(pos) → boolean** — true if another unit currently occupies the tile. The pathfinder must **not** call `isOccupied(start)` — the moving unit occupies its own tile and must not block itself. All other tiles are checked. When friendly pass-through is added it means *"blocks movement"* (enemies only), while *"may I stop here"* becomes a caller-side filter — see [Deferred: future movement requirements](#deferred-future-movement-requirements-not-implemented).

The returned map **includes the start tile** with `cost: 0` and `parent: null`. All other entries have `cost > 0`. Callers may rely on `reachable.get(tileKey(start))` being defined.

### `reconstructPath(reachable, target): GridPos[]`

Returns the ordered list of tiles from `start` to `target` by walking `parent` pointers backward and reversing. The returned array's first element is `start`. If `target` is not in `reachable`, returns `[]`. The caller is responsible for checking reachability before calling.

### Enter-cost convention

The cost stored on each tile is the cost to **enter** it (not leave it). A path's total cost sums every tile *except* the start, so moving onto a forest costs 2 per step while grass costs 1.

---

## Deferred: future movement requirements (not implemented)

Recorded 2026-11-04 from the owner's design notes. **Nothing here is built in Phase 1.** It is written down because the three contracts above were checked against it, and all three turn out to absorb these requirements **without a signature change** — provided the semantics below are respected. Breaking one of those semantics is what would force a rewrite.

They land when per-unit state is defined: **Phase 2.1** (`TurnState`: `currentPlayer`, `phase`, remaining MP per unit) and **Phase 2.2** (the move → attack flow, which is where destination legality first matters). `phase_2.md` does not exist yet, so this section is the only written record.

### 1. Units pass through friendly units, but cannot stop on them

Enemies still block. Friendlies must not, or the board becomes a sliding-puzzle traffic jam and the AI becomes much harder to write.

`isOccupied` currently conflates two different questions — *may I enter this tile* and *may I end my turn here*. They must split, but **not in the pathfinder**:

| question | where it lives |
|----------|----------------|
| may I **move through**? | `isOccupied`, passed by the caller → true for **enemies only** once teams exist |
| may I **stop** here? | a caller-side filter over the returned map, not a pathfinder rule |

```ts
const reachable = getReachableTiles(grid, start, mp, costFn, enemyBlocksMovement);
const destinations = [...reachable.values()].filter(t => !anyUnitAt(t.pos));
```

Consequences to keep in mind:

- `reconstructPath` may legitimately return a path whose **intermediate** tiles are friendly-occupied.
- A unit hemmed in by friendlies is still selectable and can end its turn in place — the result still contains the start tile.
- **Do not** write a test asserting that a friendly on a tile removes that tile from `reachable`. That assertion is correct for enemies and wrong for friendlies. Today's `"does not traverse occupied tiles"` test stays valid because its predicate stands in for enemy units.
- `isOccupied` keeps its name and its type. Only the predicate the caller supplies changes.

### 2. Limited same-tile stacking

Some support units (the motivating example: a long-range air-defense unit that does one job well but otherwise occupies a tile for nothing) may share a tile with another unit. Graphically this does not change: the unit sprite stays the same.

The consequence is structural: **"one unit per tile" is not an invariant.** So:

- `isOccupied(pos) → boolean` is eventually insufficient; the real query is `occupantsAt(pos) → Unit[]`.
- Unit storage should be `Map<tileKey, Unit[]>` (or a unit list plus a spatial index), not `Map<tileKey, Unit>`.
- Nothing exists yet, so the cost today is **zero** — the only requirement is not to document one-per-tile as permanent.
- Stacks still count as blockable for enemies, and still count as "occupied" for the destination filter in item 1.

### 3. Naval units move over water (and amphibious units over both)

`TERRAIN_DEFS[t].moveCost` is **one scalar per terrain**, so it cannot express "water costs 1 for a ship and ∞ for a tank". That is fine, because `getTerrainCost` is a *callback*: the caller closes over the moving unit's movement class.

```ts
getReachableTiles(grid, start, mp, (t) => costFor(unitClass, t), enemyBlocksMovement);
```

- The pathfinder never learns that unit types exist. **Do not** add a `unitType` parameter to it later — that would couple pathfinding to the unit taxonomy for no gain.
- The data that eventually arrives is a **movement-class × terrain** matrix (plus per-type overrides), *not* a change to `TERRAIN_DEFS`. `TERRAIN_DEFS` stays the ground-unit baseline and the map generator keeps validating against it.
- An amphibious APC is just another class with cost 1 on both land and water.
- Water is still `Infinity` for ground units, so `verifyMap`'s land-connectivity assertion is unaffected.

**Blocker, and it is a map-generator problem rather than a pathfinding one.** Water on every generated board is *fragmented*, so a ship would be confined to the lake it spawned in. Measured on the default board and 11 more seeds (2026-11-04):

| seed | water cells | bodies | sizes |
|------|------------|--------|-------|
| 1234 | 329 | 2 | 210, 119 |
| 7 | 381 | 2 | 209, 172 |
| 99 | 503 | 2 | 286, 217 |
| 2026 | 493 | 2 | 363, 130 |
| 55 | 316 | **3** | 133, 94, 89 |

**12/12 boards have 2–3 disconnected water bodies** (largest single body 86–363 cells). Land connectivity is already asserted by `verifyMap`; **water connectivity is not**. Before naval units ship, the composer needs either one connected sea or an explicit rule: assert water components in `verifyMap`, and require naval spawns/deployments to use the largest body.

### Verdict

| requirement | change to `getReachableTiles`? | change needed today? |
|-------------|------------------------------|----------------------|
| Friendly pass-through | none — caller supplies enemy-only `isOccupied` + filters destinations | no; only keep the *movement* semantics in the doc comment |
| Same-tile stacking | none — becomes `occupantsAt` at the call site | no; just never document one-per-tile as permanent |
| Naval / amphibious | none — caller closes over movement class | no; generator needs a water-connectivity rule, tracked separately |

---

## Tests (`src/core/Pathfinding.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { TERRAIN_DEFS, TerrainType } from "../types/game.types";
import type { GridPos } from "../types/game.types";
import { getReachableTiles, reconstructPath, tileKey } from "./Pathfinding";

const terrainCost = (tileIndex: number): number => {
  const terrain = TERRAIN_DEFS[tileIndex as TerrainType];
  return terrain?.passable ? terrain.moveCost : Infinity;
};

const neverOccupied = (_pos: GridPos): boolean => false;

// 3×3 fixture used across tests:
//   (0,0) grass  (1,0) grass  (2,0) forest
//   (0,1) grass  (1,1) water  (2,1) grass
//   (0,2) grass  (1,2) grass  (2,2) grass
//
const GRID: number[][] = [
  [TerrainType.Grass, TerrainType.Grass, TerrainType.Forest],
  [TerrainType.Grass, TerrainType.Water, TerrainType.Grass],
  [TerrainType.Grass, TerrainType.Grass, TerrainType.Grass],
];

const START: GridPos = { x: 0, y: 0 };

describe("getReachableTiles", () => {
  it("includes the start tile with cost 0 and null parent", () => {
    const reachable = getReachableTiles(
      GRID, START, Infinity, terrainCost, neverOccupied
    );
    const start = reachable.get(tileKey(START));
    expect(start).toBeDefined();
    expect(start!.cost).toBe(0);
    expect(start!.parent).toBeNull();
  });

  it("excludes water tiles", () => {
    const reachable = getReachableTiles(
      GRID, START, Infinity, terrainCost, neverOccupied
    );
    expect(reachable.has(tileKey({ x: 1, y: 1 }))).toBe(false);
  });

  it("returns terrain cost, not step count (fails for BFS)", () => {
    // Trap fixture: the direct route to (4,0) is fewer steps but more expensive.
    //   top row:  (0,0)→(1,0)→(2,0)→(3,0)→(4,0)   4 steps, cost 2+2+2+1 = 7
    //   detour:   (0,0)→(0,1)→(1,1)→(2,1)→(3,1)→(4,1)→(4,0)   6 steps, cost 6
    // A correct Dijkstra returns 6. Pure BFS (and a uniform-weight
    // Dijkstra, which is BFS in disguise) returns 4 — the step count.
    const trapGrid: number[][] = [
      [TerrainType.Grass, TerrainType.Forest, TerrainType.Forest, TerrainType.Forest, TerrainType.Grass],
      [TerrainType.Grass, TerrainType.Grass, TerrainType.Grass, TerrainType.Grass, TerrainType.Grass],
    ];
    const reachable = getReachableTiles(
      trapGrid, { x: 0, y: 0 }, Infinity, terrainCost, neverOccupied
    );
    const target = reachable.get(tileKey({ x: 4, y: 0 }));
    expect(target).toBeDefined();
    expect(target!.cost).toBe(6);
    // A BFS/uniform-weight implementation would report 4 (step count),
    // which is the exact bug this test exists to catch.
  });

  it("respects the movement-point budget", () => {
    const reachable = getReachableTiles(
      GRID, START, 1, terrainCost, neverOccupied
    );
    // 1 MP: grass neighbors at cost 1 are in, cost-2 tiles are out.
    expect(reachable.has(tileKey({ x: 1, y: 0 }))).toBe(true);
    expect(reachable.has(tileKey({ x: 0, y: 1 }))).toBe(true);
    expect(reachable.has(tileKey({ x: 0, y: 2 }))).toBe(false); // cost 2
    expect(reachable.has(tileKey({ x: 2, y: 2 }))).toBe(false); // cost 4
  });

    it("does not traverse occupied tiles", () => {
    // Block the only two grass neighbors of the start tile; nothing
    // should be reachable except the start itself.
    const blocked = (p: GridPos): boolean =>
      (p.x === 1 && p.y === 0) || (p.x === 0 && p.y === 1);
    const reachable = getReachableTiles(
      GRID, START, Infinity, terrainCost, blocked
    );
    expect(reachable.size).toBe(1);
    expect(reachable.has(tileKey(START))).toBe(true);
  });
});

describe("reconstructPath", () => {
  it("returns a 4-directional path from start to target", () => {
    const reachable = getReachableTiles(
      GRID, START, Infinity, terrainCost, neverOccupied
    );
    const path = reconstructPath(reachable, { x: 2, y: 2 });

    expect(path[0]).toEqual(START);
    expect(path[path.length - 1]).toEqual({ x: 2, y: 2 });

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
    }

    // Enter-cost convention: sum all tiles except start.
    const total = path.slice(1)
      .reduce((s, p) => s + terrainCost(GRID[p.y][p.x]), 0);
    expect(total).toBe(reachable.get(tileKey({ x: 2, y: 2 }))!.cost);
  });

  it("returns [] for a target not in the reachable set", () => {
    const reachable = getReachableTiles(
      GRID, START, Infinity, terrainCost, neverOccupied
    );
    // (1,1) is water — never in the reachable map.
    expect(reconstructPath(reachable, { x: 1, y: 1 })).toEqual([]);
  });
});
```

---

## Definition of Done
- `npm run dev` shows a **64×48 tile board at 48 px/tile (1024×768 px world, 3072×2304 px on screen)** with all six terrain types (grass / forest / water / mountain / road / building), on a window-filling canvas the camera can pan
- One unit marker on grass. Click → reachable tiles highlighted (water and building unreachable; forest costs 2, mountain costs 3, road 1)
- Click a reachable tile → unit animates along path over ~200 ms
- `npm test` passes all Pathfinding tests

**Done so far:** first bullet (board renders, all 6 terrains present, verified). Remaining: unit marker, reachable highlighting, movement, and the `Pathfinding.ts` / test file, which do not exist yet.

---

## Key files created in Phase 1
- `src/types/game.types.ts` — core interfaces (`GridPos`, `ReachableTile`, etc.) and `TERRAIN_DEFS`
- `src/core/Pathfinding.ts` — **not written yet.** Dijkstra with terrain costs, `tileKey(pos)`, `reconstructPath(reachable, target): GridPos[]`
- `src/core/TileMapManager.ts` — **not written yet.** Will read the generated map into `TerrainType[][]` (step 4.2b)
- `src/scenes/BattleScene.ts` — ✅ exists: loads the generated map, renders every non-collision layer, fits the camera. The FSM, input handling, and unit logic are still to come
- `src/_gate_check.ts` — ✅ compile-time API gate for both the loading API and the render API

---

## Notes on scope & dependencies
- **FSM states:** Phase 1 implements `setup → move` only. `attack`, `end_turn`, and `enemy_turn` arrive in Phase 2–3. The full FSM in `plan.md`'s architecture diagram is the *final* shape, not the Phase 1 shape.
- **1.0 is a hard gate** — passed for Phaser 4.2.1 on 2026-10-31; do not change the pinned version or rely on unverified APIs without repeating the gate.
- **1.2 must precede 1.3 through 1.5 (including all sub-steps)** — types are defined first so the Dijkstra code and rendering compile against stable contracts rather than being rewritten mid-phase.
- **1.4 (Dijkstra) feeds 1.5 (core loop)** — pathfinding is implemented before it's wired into input handling, with `Pathfinding.test.ts` driving the implementation in parallel via step 1.4c.
- **Source tiles are 16 px; the board is 64×48 tiles** (1024×768 world px), displayed at 48 px/tile. Do not reintroduce 32 px *source* arithmetic — `TILE_SIZE` comes from `map.tileWidth` (16), display scale comes from the camera zoom (3), and world size from `map.widthInPixels`. Never hardcode the display tile size into pathfinding or input math.

---

## Current state (2026-10-31)

See [`progress.md`](./progress.md) for the handoff summary. In short: Phaser setup, types, the seeded map generator, and map rendering are done and verified; pathfinding, units, and the FSM are not started.
