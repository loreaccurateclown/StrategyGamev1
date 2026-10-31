// =============================================================================
// ADVANCE WARS-STYLE STRATEGY GAME - TYPE DEFINITIONS
// =============================================================================

/**
 * Unit types available in the game.
 * Each type has distinct stats and capabilities.
 */
export type UnitType = 'infantry' | 'tank' | 'air';

/**
 * Terrain types that affect movement and combat.
 */
export type TerrainType = 'grass' | 'water' | 'mountain' | 'forest' | 'ruins';

/**
 * Fog of war states for each tile.
 */
export type FogState = 'explored' | 'hidden';

/**
 * Unit base stats by type.
 */
export interface UnitStats {
  movementPoints: number;
  attackRange: number;
  attackPower: number;
  defense: number;
  terrainModifiers: Record<TerrainType, { movementCost?: number; accuracyModifier?: number }>;
}

/**
 * Base unit data structure.
 */
export interface UnitData {
  id: string;
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  movementPointsRemaining: number;
  attackRange: number;
  terrainModifiers: Record<TerrainType, { movementCost?: number; accuracyModifier?: number }>;
}

/**
 * Tile data from Tiled map.
 */
export interface TileData {
  x: number;
  y: number;
  index: number;
  collides: boolean;
  terrainType: TerrainType;
  fogState: FogState;
}

/**
 * Game turn state.
 */
export interface TurnState {
  currentPlayer: 'player' | 'enemy';
  phase: 'setup' | 'move' | 'attack' | 'end_turn';
  unitsMovedThisTurn: Set<string>;
  unitsAttackedThisTurn: Set<string>;
}

/**
 * Pathfinding result from BFS.
 */
export interface PathfindingResult {
  path: Array<{ x: number; y: number }>;
  cost: number;
  valid: boolean;
}

/**
 * Line of sight calculation result.
 */
export interface LineOfSightResult {
  visibleTiles: Set<string>; // "x,y" format
  blockedBy: Array<{ x: number; y: number }>;
}

/**
 * Attack resolution result.
 */
export interface AttackResolution {
  damageDealt: number;
  accuracyRoll: number;
  hit: boolean;
  criticalHit: boolean;
}
