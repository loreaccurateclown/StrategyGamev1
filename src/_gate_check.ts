import Phaser from "phaser";

/**
 * Phase 1 gate: proves the tilemap *loading* surface exists in the pinned build.
 * If `tsc` fails here, the pinned Phaser version changed its API and every
 * downstream phase assumption is void.
 */
export function verifyPhaserTilemapApi(
  scene: Phaser.Scene,
  map: Phaser.Tilemaps.Tilemap,
  layer: Phaser.Tilemaps.TilemapLayer
): Phaser.Tilemaps.Tile | null {
  scene.load.tilemapTiledJSON("phase1-api-gate", "maps/gate.json");
  layer.setCollision([3], true, false, false);
  return map.getTileAt(0, 0);
}

/**
 * Map-render gate: proves the tilemap *building* surface exists in the pinned
 * build, which the function above does not cover. Without this, a passing `tsc`
 * only proves a map can be loaded, not that it can become layers on screen.
 *
 * `createLayer` is declared as `TilemapLayer | TilemapGPULayer`; passing
 * `gpu === false` selects the plain TilemapLayer, so the narrow is sound.
 */
export function verifyPhaserTilemapRenderApi(
  scene: Phaser.Scene
): Phaser.Tilemaps.TilemapLayer | null {
  const map = scene.make.tilemap({ key: "phase1-api-gate" });
  const tilesetName = map.tilesets[0]?.name;

  if (!tilesetName) {
    return null;
  }

  const tileset = map.addTilesetImage(tilesetName, "phase1-tileset-texture");

  if (!tileset) {
    return null;
  }

  return map.createLayer("ground", tileset, 0, 0, false) as Phaser.Tilemaps.TilemapLayer | null;
}
