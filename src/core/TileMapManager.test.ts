import {describe, it, expect} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {TerrainType} from "../types/game.types";
import {terrainGridFromSidecar} from "./TileMapManager";
import type {TiledMapLike} from "./TileMapManager";

/** A 2x2 map header, matching the fixture sidecars below. */
const MAP_2X2: TiledMapLike = {width: 2, height: 2, tilewidth: 16};

/** Builds a sidecar object; `terrain` is left as `unknown` so bad values can be passed. */
function sidecar(overrides: Record<string, unknown> = {}): unknown {
    return {width: 2, height: 2, tileSize: 16, terrain: [1, 1, 3, 3], ...overrides};
}

describe("terrainGridFromSidecar — happy path", () => {
    /**
     * The orientation test. The sidecar stores flat row-major terrain, so
     * grid[y][x] must be terrain[y * width + x]. A transposed implementation
     * passes every other test in this file and fails only this one.
     */
    it("builds grid[y][x] from flat row-major terrain", () => {
        const result = terrainGridFromSidecar(MAP_2X2, sidecar());

        expect(result.grid).toEqual([
            [TerrainType.Grass, TerrainType.Grass], // y=0: indices 0,1
            [TerrainType.Water, TerrainType.Water], // y=1: indices 2,3
        ]);
    });

    it("distinguishes rows when the terrain is not symmetric", () => {
        // A transposed build would produce the same grid for a symmetric fixture,
        // so this one is deliberately asymmetric in both axes.
        const result = terrainGridFromSidecar(
            {width: 3, height: 2, tilewidth: 16},
            {width: 3, height: 2, tileSize: 16, terrain: [1, 2, 3, 4, 5, 6]},
        );

        expect(result.grid).toEqual([
            [TerrainType.Grass, TerrainType.Forest, TerrainType.Water],
            [TerrainType.Mountain, TerrainType.Road, TerrainType.Building],
        ]);
    });

    it("copies the dimensions through to the result", () => {
        const result = terrainGridFromSidecar(MAP_2X2, sidecar());

        expect(result.width).toBe(2);
        expect(result.height).toBe(2);
        expect(result.tileSize).toBe(16);
        expect(result.grid).toHaveLength(2);
        expect(result.grid[0]).toHaveLength(2);
    });

    it("accepts water, which is a known terrain that is deliberately impassable", () => {
        // Guards against validating with enterCost(...) !== Infinity, which would
        // reject every lake and make the whole map fail to load.
        const result = terrainGridFromSidecar(
            MAP_2X2,
            sidecar({terrain: [3, 3, 3, 3]}),
        );

        expect(result.grid).toEqual([
            [TerrainType.Water, TerrainType.Water],
            [TerrainType.Water, TerrainType.Water],
        ]);
    });
});

describe("terrainGridFromSidecar — hard errors", () => {
    it("rejects a non-object sidecar", () => {
        expect(() => terrainGridFromSidecar(MAP_2X2, undefined)).toThrow(/not an object/);
        expect(() => terrainGridFromSidecar(MAP_2X2, null)).toThrow(/not an object/);
        expect(() => terrainGridFromSidecar(MAP_2X2, "level_01")).toThrow(/not an object/);
    });

    it("rejects invalid map dimensions", () => {
        expect(() => terrainGridFromSidecar({width: 0, height: 2, tilewidth: 16}, sidecar()))
            .toThrow(/invalid map dimensions/);
        expect(() => terrainGridFromSidecar({width: NaN, height: 2, tilewidth: 16}, sidecar()))
            .toThrow(/invalid map dimensions/);
        expect(() => terrainGridFromSidecar({width: 2, height: 2, tilewidth: 1.5}, sidecar()))
            .toThrow(/invalid map dimensions/);
    });

    it("rejects invalid sidecar dimensions", () => {
        expect(() => terrainGridFromSidecar(MAP_2X2, sidecar({width: 0})))
            .toThrow(/invalid map dimensions/);
        expect(() => terrainGridFromSidecar(MAP_2X2, sidecar({height: NaN})))
            .toThrow(/invalid map dimensions/);
        expect(() => terrainGridFromSidecar(MAP_2X2, sidecar({tileSize: undefined})))
            .toThrow(/invalid map dimensions/);
    });

    it("rejects a sidecar whose dimensions do not match the map", () => {
        expect(() => terrainGridFromSidecar(MAP_2X2, sidecar({width: 3, height: 2})))
            .toThrow(/do not match map dimensions/);
    });

    it("rejects a sidecar whose tileSize does not match the map tilewidth", () => {
        expect(() => terrainGridFromSidecar(MAP_2X2, sidecar({tileSize: 32})))
            .toThrow(/tileSize does not match map tilewidth/);
    });

    it("rejects a non-array terrain field", () => {
        expect(() => terrainGridFromSidecar(MAP_2X2, sidecar({terrain: "1,1,3,3"})))
            .toThrow(/terrain is not an array/);
    });

    it("rejects a terrain array shorter than width * height", () => {
        expect(() => terrainGridFromSidecar(MAP_2X2, sidecar({terrain: [1, 1, 3]})))
            .toThrow(/not mathematically consistent/);
    });

    it("rejects a terrain array longer than width * height", () => {
        expect(() => terrainGridFromSidecar(MAP_2X2, sidecar({terrain: [1, 1, 3, 3, 1]})))
            .toThrow(/not mathematically consistent/);
    });

    it("rejects an unknown terrain value and names its index and coordinate", () => {
        // 99 sits at flat index 3, which is (x=1, y=1) on a 2-wide grid.
        expect(() => terrainGridFromSidecar(MAP_2X2, sidecar({terrain: [1, 1, 3, 99]})))
            .toThrow(/terrain\[3\] = 99 at \(1, 1\) is not a TerrainType/);
    });

    it("rejects non-numeric terrain values", () => {
        expect(() => terrainGridFromSidecar(MAP_2X2, sidecar({terrain: [1, 1, 3, null]})))
            .toThrow(/is not a TerrainType/);
        expect(() => terrainGridFromSidecar(MAP_2X2, sidecar({terrain: [1, 1, 3, "3"]})))
            .toThrow(/is not a TerrainType/);
    });
});

describe("terrainGridFromSidecar — the real generated map", () => {
    const readJson = (name: string): unknown =>
        JSON.parse(
            readFileSync(
                fileURLToPath(new URL(`../../public/assets/maps/${name}`, import.meta.url)),
                "utf8",
            ),
        );

    const map = readJson("level_01.json") as TiledMapLike;
    const raw = readJson("level_01.terrain.json") as {terrain: number[]};

    it("loads the committed map and sidecar", () => {
        const result = terrainGridFromSidecar(map, raw);

        expect(result.width).toBe(64);
        expect(result.height).toBe(48);
        expect(result.tileSize).toBe(16);
        expect(result.grid).toHaveLength(48);
        expect(result.grid.every((row) => row.length === 64)).toBe(true);
    });

    it("has one terrain value per cell, all of them known", () => {
        const result = terrainGridFromSidecar(map, raw);

        expect(raw.terrain).toHaveLength(64 * 48);
        for (const row of result.grid) {
            for (const cell of row) {
                expect(Object.values(TerrainType)).toContain(cell);
            }
        }
    });

    it("preserves row-major order for every cell", () => {
        // Regression test: reading terrain[i] instead of terrain[y * width + x]
        // repeats the first value of each row and corrupts 2596 of 3072 cells.
        const result = terrainGridFromSidecar(map, raw);

        for (let y = 0; y < result.height; y++) {
            for (let x = 0; x < result.width; x++) {
                expect(result.grid[y][x], `cell (${x}, ${y})`).toBe(raw.terrain[y * result.width + x]);
            }
        }
    });
});
