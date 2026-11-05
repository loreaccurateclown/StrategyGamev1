import { describe, it, expect } from "vitest";
import { TERRAIN_DEFS, TerrainType } from "../types/game.types";
import type { GridPos } from "../types/game.types";
import { getReachableTiles, reconstructPath, tileKey } from './Pathfinding';

const terrainCost = (tileIndex: number): number => {
    const terrain = TERRAIN_DEFS[tileIndex as TerrainType];
    return terrain?.passable ? terrain.moveCost : Infinity;
};

const neverOccupied = (_pos: GridPos): boolean => false;

// 3×3 fixture used across tests:
//   (0,0) grass  (1,0) grass  (2,0) forest
//   (0,1) grass  (1,1) water  (2,1) grass
//   (0,2) grass  (1,2) grass  (2,2) grass

const GRID: number[][] = [
    [TerrainType.Grass, TerrainType.Grass, TerrainType.Forest],
    [TerrainType.Grass, TerrainType.Water, TerrainType.Grass],
    [TerrainType.Grass, TerrainType.Grass, TerrainType.Grass],
];

const START: GridPos = {x:0, y:0};

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
        expect(reachable.has(tileKey({x:1,y:1}))).toBe(false);
    });

    it("returns terrain cost, but not step count (fails for BFS)", () => {
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
            trapGrid, {x: 0, y: 0}, Infinity, terrainCost, neverOccupied
        );
        const target = reachable.get(tileKey({x:4,y:0}));
        expect(target).toBeDefined();
        expect(target!.cost).toBe(6);
        // A BFS/uniform-weight implementation would report 4 (step count),
        // which is the exact bug this test exists to catch.
    });
    it("respects the movement-point budget", () => {
        const reachable = getReachableTiles(
            GRID, START, 1, terrainCost, neverOccupied
        );
        // 1 MP: grass neighbors at cost 1 are in, cost 2 tiles are out.
        expect(reachable.has(tileKey({x:1,y:0}))).toBe(true);
        expect(reachable.has(tileKey({x:0,y:1}))).toBe(true);
        expect(reachable.has(tileKey({x:0,y:2}))).toBe(false); //cost 2
        expect(reachable.has(tileKey({x:2,y:2}))).toBe(false);//cost 4
    });
    it("does not traverse occupied tiles", () => {
        //Block the only two grass neighbors of the start tile; 
        // nothing should be reachable except start
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
        const path = reconstructPath(reachable, {x: 2, y: 2});

        expect(path[0]).toEqual(START);
        expect(path[path.length - 1]).toEqual({x: 2, y: 2});

        for (let i = 0; i < path.length - 1; i++) {
            const a = path[i], b = path[i + 1];
            expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1); // 4-directional
            }

            // Enter-cost convention: sum all tiles except start.
            const total = path.slice(1)
                .reduce((s, p) => s + terrainCost(GRID[p.y][p.x]), 0);
            expect(total).toBe(reachable.get(tileKey({x: 2, y: 2}))!.cost);
        
        });

    it("returns [] when the target is unreachable", () => {
        const reachable = getReachableTiles(
            GRID, START, Infinity, terrainCost, neverOccupied
        );
        expect(reconstructPath(reachable, {x: 1, y: 1})).toEqual([]);
   });
});
