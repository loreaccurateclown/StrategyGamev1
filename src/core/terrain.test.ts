import {describe, it, expect} from "vitest";
import {TERRAIN_DEFS, TerrainType} from "../types/game.types";
import type {GridPos} from "../types/game.types";
import {enterCost} from "./terrain";
import {getReachableTiles} from "./Pathfinding";

describe("enterCost", () => {
    it("uses moveCost for every passable terrain in TERRAIN_DEFS", () => {
        for (const key of Object.keys(TERRAIN_DEFS)) {
            const terrain = Number(key) as TerrainType;
            if (TERRAIN_DEFS[terrain].passable) {
                expect(enterCost(terrain)).toBe(TERRAIN_DEFS[terrain].moveCost);
            }
        }
    });

    it("returns Infinity for impassable terrain", () => {
        expect(enterCost(TerrainType.Water)).toBe(Infinity);
        expect(enterCost(TerrainType.Building)).toBe(Infinity);
    });

    it("returns Infinity for unknown tile indices", () => {
        expect(enterCost(0)).toBe(Infinity);
        expect(enterCost(-1)).toBe(Infinity);
        expect(enterCost(99)).toBe(Infinity);
        expect(enterCost(1.5)).toBe(Infinity);
    });
});

/**
 * The point of step 1.3b: the movement rules in TERRAIN_DEFS must actually govern
 * pathfinding. Half of that contract lives in `terrain.ts` (index -> cost) and the
 * other half in `Pathfinding.ts` (what it does with the cost), so these tests run
 * `enterCost` as the real `TerrainCostFn` instead of asserting against it directly.
 */
const neverOccupied = (_pos: GridPos): boolean => false;

describe("enterCost drives the pathfinder", () => {
    it("makes water a wall the search cannot cross", () => {
        //   G G W
        //   G G W
        //   G G W   water spans the full height, so there is no route around it
        const WALL: number[][] = [
            [TerrainType.Grass, TerrainType.Grass, TerrainType.Water],
            [TerrainType.Grass, TerrainType.Grass, TerrainType.Water],
            [TerrainType.Grass, TerrainType.Grass, TerrainType.Water],
        ];

        const reachable = getReachableTiles(WALL, {x: 0, y: 0}, 99, enterCost, neverOccupied);

        expect(reachable.size).toBe(6); // columns 0 and 1 only
        for (const behindWater of ["2,0", "2,1", "2,2"]) {
            expect(reachable.has(behindWater), `${behindWater} is behind water`).toBe(false);
        }

        // The far corner is reached the long way round: three grass steps.
        expect(reachable.get("1,2")?.cost).toBe(3);
    });

    it("charges the terrain's moveCost rather than a flat 1", () => {
        //   G F G
        const row: number[][] = [[TerrainType.Grass, TerrainType.Forest, TerrainType.Grass]];

        const reachable = getReachableTiles(row, {x: 0, y: 0}, 99, enterCost, neverOccupied);

        expect(reachable.get("1,0")?.cost).toBe(2); // entering forest costs 2
        expect(reachable.get("2,0")?.cost).toBe(3); // grass 1 + forest 2
    });

    it("spends movement points against those costs", () => {
        //   G F
        //   G G
        const grid: number[][] = [
            [TerrainType.Grass, TerrainType.Forest],
            [TerrainType.Grass, TerrainType.Grass],
        ];

        const reachable = getReachableTiles(grid, {x: 0, y: 0}, 1, enterCost, neverOccupied);

        expect(reachable.has("1,0"), "forest costs 2 but only 1 point is available").toBe(false);
        expect(reachable.has("0,1"), "adjacent grass costs 1").toBe(true);
    });

    it("blocks buildings and unknown indices, so a data slip stays impassable", () => {
        // 999 is not a TerrainType: it must behave like a wall, not like free ground.
        const row: number[][] = [
            [TerrainType.Grass, TerrainType.Building, 999, TerrainType.Grass],
        ];

        const reachable = getReachableTiles(row, {x: 0, y: 0}, 99, enterCost, neverOccupied);

        expect(reachable.has("1,0"), "building is impassable").toBe(false);
        expect(reachable.has("2,0"), "unknown index is impassable").toBe(false);
        expect(reachable.has("3,0"), "no route past a two-tile wall").toBe(false);
    });
});
