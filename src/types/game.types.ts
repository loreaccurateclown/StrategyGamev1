export interface GridPos {
    x:number;
    y:number;
}

export enum TerrainType {
    Grass = 1,
    Forest = 2,
    Water = 3,
    Mountain = 4,
    Road = 5,
    Building = 6
}

export interface TerrainDef {
    moveCost: number;
    passable: boolean;
    blocksLOS: boolean;
}

export const TERRAIN_DEFS: Record<TerrainType, TerrainDef> = {
    [TerrainType.Grass]: {moveCost: 1, passable: true, blocksLOS: false},
    [TerrainType.Forest]: {moveCost: 2, passable: true, blocksLOS: false},
    [TerrainType.Water]: {moveCost: Infinity, passable: false, blocksLOS: true},
    [TerrainType.Mountain]: {moveCost: 3, passable: true, blocksLOS: true},
    [TerrainType.Road]: {moveCost: 1, passable: true, blocksLOS: false},
    [TerrainType.Building]: {moveCost: Infinity, passable: false, blocksLOS: false}
};

export type UnitType = "infantry" | "l_veh" | "m_veh" | "h_veh" | "sh_veh" | "heli" | "prop_plane" | "jet_plane" | "l_ship" | "m_ship" | "h_ship" | "sh_ship" | "offmap";

export interface ReachableTile {
    pos: GridPos,
    cost: number,
    parent: GridPos | null
}