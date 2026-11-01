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
    // Road is defined ahead of the tile palette: the Kenney tiny-battle sheet has
    // no road tile yet, so the map generator never emits it. Keeping the enum
    // member means a future road tileset only needs a palette entry, not a type change.
    [TerrainType.Road]: {moveCost: 1, passable: true, blocksLOS: false},
};

export type UnitType = {
    type: "infantry";
};

export interface ReachableTile {
    pos: GridPos,
    cost: number,
    parent: GridPos | null
}