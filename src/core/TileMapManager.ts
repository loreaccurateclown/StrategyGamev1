import { TerrainType, TERRAIN_DEFS } from '../types/game.types';

export interface TiledMapLike {
    width: number;
    height: number;
    tilewidth: number;
}

export interface TerrainMap {
    width: number;
    height: number;
    tileSize: number;
    grid: TerrainType[][];
}

function isPositiveInt(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) > 0;
}


export function terrainGridFromSidecar(map: TiledMapLike, sidecar: unknown): TerrainMap {
    if (!isPositiveInt(map.width) || !isPositiveInt(map.height) || !isPositiveInt(map.tilewidth)) {
        //console.error("invalid map dimensions");
        throw new Error(
            `terrainGridFromSidecar: invalid map dimensions` +
            `(width=${map.width}, height=${map.height}, tileSize=${map.tilewidth})`
        );
    }

    if (sidecar === undefined || typeof sidecar !== "object" || sidecar === null) { 
        throw new Error(
            'terrainGridFromSidecar: sidecar is undefined or not an object ' + `(sidecar=${sidecar})`
        ); //initially since the pseudocode said "read" i thought it was just checking values but the reminder was very useful for letting me know to pull the values into a record
    }

    const sidecarTyped = sidecar as { width: number; height: number; tileSize: number; terrain: unknown };

    if (!isPositiveInt(sidecarTyped.width) || !isPositiveInt(sidecarTyped.height) || !isPositiveInt(sidecarTyped.tileSize)) {
        //console.error("invalid map dimensions");
        throw new Error(
            `terrainGridFromSidecar: invalid map dimensions` +
            `(width=${sidecarTyped.width}, height=${sidecarTyped.height}, tileSize=${sidecarTyped.tileSize})`
        );
    }

    if (sidecarTyped.width !== map.width || sidecarTyped.height !== map.height) {
        throw new Error(
            `terrainGridFromSidecar: sidecar dimensions do not match map dimensions` +
            `(map.width=${map.width}, map.height=${map.height}, sidecar.width=${sidecarTyped.width}, sidecar.height=${sidecarTyped.height})`
        );
    }

    if (sidecarTyped.tileSize !== map.tilewidth) {
        throw new Error(
            `terrainGridFromSidecar: sidecar tileSize does not match map tilewidth` +
            `(map.tilewidth=${map.tilewidth}, sidecar.tileSize=${sidecarTyped.tileSize})`
        );
    }

    if (!Array.isArray(sidecarTyped.terrain)) {
        throw new Error("level_01.terrain.json: terrain is not an array");
    }

    if (sidecarTyped.terrain.length !== sidecarTyped.width * sidecarTyped.height) {
        throw new Error(
            `sidecar terrainmap is not mathematically consistent: width * height != length` +
            `(sidecar.terrain.length=${sidecarTyped.terrain.length}, sidecar.width=${sidecarTyped.width}, sidecar.height=${sidecarTyped.height})`
        );
    }

    const grid: TerrainType[][] = [];

    for (let i = 0; i < sidecarTyped.height; i++) {
        const row: TerrainType[] = [];
        for (let j = 0; j< sidecarTyped.width; j++) {
            const coordRowMajor = i * sidecarTyped.width + j;
            const coordTerrain = sidecarTyped.terrain[coordRowMajor];
            if (typeof coordTerrain !== "number" || !Object.prototype.hasOwnProperty.call(TERRAIN_DEFS, coordTerrain)) {
                throw new Error(
                    `level_01.terrain.json: terrain[${coordRowMajor}] = ${coordTerrain} at (${j}, ${i}) is not a TerrainType`
                );
            }

            row.push(coordTerrain as TerrainType);
        }
        grid.push(row);
    }

    return {width: sidecarTyped.width, height: sidecarTyped.height, tileSize: sidecarTyped.tileSize, grid};
    
}