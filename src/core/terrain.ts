import {TERRAIN_DEFS, TerrainType} from "../types/game.types";

export function enterCost(tileIndex: number): number {
    const terrain = TERRAIN_DEFS[tileIndex as TerrainType];
    if (terrain === undefined || !terrain.passable) return Infinity;

    const cost = terrain.moveCost;
    return Number.isFinite(cost)&& cost >= 0 ? cost : Infinity;
}






