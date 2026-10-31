# Phase 1: Core Loop Vertical Slice (Days 1–2)

**Goal:** A single runnable `BattleScene` where you can **click a unit → see reachable tiles → click a tile → it moves**, on a 32×32 grid with terrain costs. No Tiled, no sprites, no fog, no attack, no AI, no scene-per-phase. Only `BattleScene` is implemented (starting directly via `main.ts`).

> **Canonical spec for Phase 1.** This file is self-contained — the Pathfinding interface and all contracts referenced below are defined in this document. Other phase files follow the same pattern.
>
> **Phase A — Environment & Dependencies.** Gate passed on **second attempt** — first grep hit `setCollidesWith` (Arcade Physics, wrong class); corrected to `setCollision` on `TilemapLayer`, then verified via grep + compile. Phaser 4.2.1 pinned exact (`phaser@4.2.1 --save-exact`).
> - `LoaderPlugin.tilemapTiledJSON("key", "map.json")` — asset loader API (Phase 1/4).
> - `Tilemap.getTileAt(x, y)` → `Phaser.Tilemaps.Tile | null` — tile lookup.
> - **`TilemapLayer.setCollision(indexes, collides?, recalculateFaces?, updateLayer?)`** — the gate. Marks tile indices as blocking for movement/pathfinding so water is impassable and forest costs 2. Confirmed at line ~142756 of `phaser.d.ts`.
> - **Verification method (substantive, not decorative):** wrote a file that calls all three APIs against declared `Phaser.Tilemaps.Tilemap` / `Phaser.Tilemaps.TilemapLayer` types and ran `tsc --noEmit`. It compiled cleanly — proving the methods exist on those classes. As a control, tsc correctly flagged the unused `_tile` variable (which held the `getTileAt` return value), confirming real type checking was running rather than just resolving the import.
> - **Note:** `setCollidesWith` (Arcade Physics, different class) was initially considered by mistake; the correct tile-collision API is `setCollision` on `TilemapLayer`.

---

## Actions to take

| Step | Task | Details |
|------|------|---------|
| 1.0 | **Verify Phaser API and pin version** | `npm view phaser versions \| tail`, read the 4.x release notes for tilemap/input changes; confirm `load.tilemapTiledJSON`, `tilemap.getTileAt`, and `setCollision` exist in 4.x. **Pin `phaser` to one exact version in `package.json` (no `^`, no `~`). Then add a one-line note at the top of **`phase_1.md`** naming that version and today's date as the verification date.** Do not proceed until this is decided. |
| 1.1 | Verify Phaser setup + TypeScript | `npm create vite@latest -- --template vanilla-ts`, install pinned Phaser, confirm `import Phaser from 'phaser'` works |
| 1.2 | Define core types first | `GridPos`, `TerrainType`, `UnitType`, `TerrainDef` (moveCost, passable, blocksLOS), `ReachableTile` — all in `src/types/game.types.ts`. Define before writing game logic |
| 1.3 | Scaffold with hardcoded map | A 32×32 `number[][]` rendered as colored `Phaser.GameObjects.Rectangle`s or one `Graphics` object. Terrain indices: **1 = grass (green)**, **2 = forest (dark green, cost 2)**, **3 = water (blue, impassable)** — this is what the Definition of Done checks |
| 1.3b | **Clarify terrain-cost rule** | Any tile index other than `1` or `2` is treated as impassable (`cost = Infinity`). This covers index `0` and any future indices: only grass (1) and forest (2) are walkable, everything else blocks movement. See the cost function in the Pathfinding interface below. |
| 1.4 | Implement **Dijkstra** pathfinding | `getReachableTiles` with per-tile move costs; store `cost` (**enter-cost convention: start tile = 0**) and `parent` per tile to reconstruct paths. Export `tileKey(pos)` and `reconstructPath(reachable, target): GridPos[]`. See the Pathfinding interface below |
| 1.4b | **Keep `Pathfinding.ts` Phaser-free** | Plain TypeScript only: `GridPos = { x, y }`, no imports beyond the type file (no `import Phaser from 'phaser'`). This is required so `Pathfinding.test.ts` can import it under vitest's default Node environment — Node has no canvas |
| 1.4c | **Add Vitest and write `Pathfinding.test.ts`** | `npm i -D vitest`; add `"test": "vitest run"` to `package.json` scripts; create the file exactly as specified in the Tests section below. No `vitest.config.ts` is needed — the Vite template plus the Phaser-free `Pathfinding.ts` runs under vitest's default Node environment, so do not add a jsdom config |
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

### `tileKey(pos): string`

Hashes a position into a map key. Contract: `` `"${x},${y}"` `` — no spaces, comma-separated.

### `getReachableTiles(grid, start, maxMovementPoints, getTerrainCost, isOccupied) → Map<string, ReachableTile>`

Runs Dijkstra from `start` and returns every tile reachable within `maxMovementPoints`, keyed by `tileKey`.

- **grid** — the 32×32 terrain grid (`number[][]`).
- **start** — `GridPos` of the unit's current tile.
- **maxMovementPoints** — total movement points available this turn (e.g. 6). `Infinity` means no limit (used by tests).
- **getTerrainCost(tileIndex: number) → number** — given a tile index from the grid (e.g., `1` for grass, `2` for forest), returns the enter-cost for that tile type: `1 → 1`, `2 → 2`, everything else → `Infinity`. The pathfinder passes `grid[pos.y][pos.x]`, not `pos` itself.
- **isOccupied(pos) → boolean** — true if another unit currently occupies the tile. The pathfinder must **not** call `isOccupied(start)` — the moving unit occupies its own tile and must not block itself. All other tiles are checked.

The returned map **includes the start tile** with `cost: 0` and `parent: null`. All other entries have `cost > 0`. Callers may rely on `reachable.get(tileKey(start))` being defined.

### `reconstructPath(reachable, target): GridPos[]`

Returns the ordered list of tiles from `start` to `target` by walking `parent` pointers backward and reversing. The returned array's first element is `start`. If `target` is not in `reachable`, returns `[]`. The caller is responsible for checking reachability before calling.

### Enter-cost convention

The cost stored on each tile is the cost to **enter** it (not leave it). A path's total cost sums every tile *except* the start, so moving onto a forest costs 2 per step while grass costs 1.

---

## Tests (`src/core/Pathfinding.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import type { GridPos } from "../types/game.types";
import { getReachableTiles, reconstructPath, tileKey } from "./Pathfinding";

const terrainCost = (tile: number): number =>
  tile === 1 ? 1 : tile === 2 ? 2 : Infinity;

const neverOccupied = (_pos: GridPos): boolean => false;

// 3×3 fixture used across tests:
//   (0,0) grass  (1,0) grass  (2,0) forest
//   (0,1) grass  (1,1) water  (2,1) grass
//   (0,2) grass  (1,2) grass  (2,2) grass
//
const GRID: number[][] = [
  [1, 1, 2],
  [1, 3, 1],
  [1, 1, 1],
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
      [1, 2, 2, 2, 1],
      [1, 1, 1, 1, 1],
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
- `npm run dev` shows a 32×32 board with 3 terrain types (grass / forest / water)
- One unit rect on grass. Click → reachable tiles highlighted (water unreachable, forest costs 2)
- Click a reachable tile → unit animates along path over ~200 ms
- `npm test` passes all Pathfinding tests

---

## Key files created in Phase 1
- `src/types/game.types.ts` — core interfaces (`GridPos`, `ReachableTile`, etc.)
- `src/core/Pathfinding.ts` — Dijkstra implementation with terrain costs, returns reachable set + parent pointers for path reconstruction; defines `tileKey(pos)` and exports `reconstructPath(reachable, target): GridPos[]`
- `src/core/TileMapManager.ts` — wraps a hardcoded 32×32 grid (no Tiled yet), exposes `getTileAt(x,y)`, `setTileAt(x,y,index)`, `isWalkable(x,y)`
- `src/scenes/BattleScene.ts` — single scene with the internal FSM (Phase 1: `setup → move`; `attack → end_turn → enemy_turn` added in Phase 2–3), input handling, and camera setup

---

## Notes on scope & dependencies
- **FSM states:** Phase 1 implements `setup → move` only. `attack`, `end_turn`, and `enemy_turn` arrive in Phase 2–3. The full FSM in `plan.md`'s architecture diagram is the *final* shape, not the Phase 1 shape.
- **1.0 is a hard gate** — do not proceed until Phaser's version/API is confirmed.
- **1.2 must precede 1.3 through 1.5 (including all sub-steps)** — types are defined first so the Dijkstra code and rendering compile against stable contracts rather than being rewritten mid-phase.
- **1.4 (Dijkstra) feeds 1.5 (core loop)** — pathfinding is implemented before it's wired into input handling, with `Pathfinding.test.ts` driving the implementation in parallel via step 1.4c.
