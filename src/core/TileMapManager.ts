import { TerrainType } from '../types/game.types';

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

export function terrainGridFromSidecar(map: TiledMapLike, sidecar: unknown): TerrainMap {
    if (map.width <= 0 || map.height <= 0 || map.tilewidth <= 0) {
        console.error("invalid map dimensions");
        throw new Error(
            `terrainGridFromSidecar: invalid map dimensions` +
            `(width=${map.width}, height=${map.height}, tileSize=${map.tilewidth})`
        );
    };

    if (sidecar === undefined || typeof sidecar !== "object" || sidecar === null) { 
        throw new Error(
            'terrainGridFromSidecar: sidecar is undefined or not an object ' + `(sidecar=${sidecar})`
        ); //initially since the pseudocode said "read" i thought it was just checking values but the reminder was very useful for letting me know to pull the values into a record
    };

    const sidecarTyped = sidecar as { width: number; height: number; tileSize: number; terrain: unknown };

    if (sidecar.width <= 0 || sidecar.height <= 0 || sidecar.tileSize <= 0) {
        console.error("invalid map dimensions");
        throw new Error(
            `terrainGridFromSidecar: invalid map dimensions` +
            `(width=${map.width}, height=${map.height}, tileSize=${map.tilewidth})`
        );
    };

    


    if (sidecar.width !== map.width || sidecar.height !== map.height) {
        throw new Error(
            `terrainGridFromSidecar: sidecar dimensions do not match map dimensions` +
            `(map.width=${map.width}, map.height=${map.height}, sidecar.width=${sidecar.width}, sidecar.height=${sidecar.height})`
        );
    };

    if (sidecar.tileSize !== map.tilewidth) {
        throw new Error(
            `terrainGridFromSidecar: sidecar tileSize does not match map tilewidth` +
            `(map.tilewidth=${map.tilewidth}, sidecar.tileSize=${sidecar.tileSize})`
        );
    };

    terrain = sidecar.terrain; //perhaps terrain: Array = sidecar.terrain? I'm not sure if the type should be declared if we're checking it below in an unknown-safe manner

    if (!Array.isArray(terrain)) {
        throw new Error("level_01.terrain.json: terrain is not an array");
    };





    
    
}