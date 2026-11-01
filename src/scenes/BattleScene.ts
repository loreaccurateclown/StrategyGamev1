import Phaser from "phaser";

/**
 * Loads the map produced by `npm run map:generate` and renders it.
 *
 * The map JSON and its tileset image both live in `public/assets/maps/`, so Vite
 * serves them at `/assets/maps/...` and the JSON's `image` field resolves next to
 * the JSON itself.
 */
const MAP_KEY = "level-01";
const MAP_URL = "assets/maps/level_01.json";
const TILESET_TEXTURE_KEY = "kenney-tinybattle";
const TILESET_URL = "assets/maps/kenney_tinybattle.png";

/**
 * The generator emits one layer per element instance plus blocker masks. Layers
 * whose name contains this marker exist only to carry collision data and must
 * not be drawn.
 */
const COLLISION_LAYER_MARKER = "collisions";

export class BattleScene extends Phaser.Scene {
  constructor() {
    super("battle");
  }

  preload(): void {
    this.load.tilemapTiledJSON(MAP_KEY, MAP_URL);
    this.load.image(TILESET_TEXTURE_KEY, TILESET_URL);
  }

  create(): void {
    const map = this.make.tilemap({ key: MAP_KEY });

    // The generator writes the tileset's `name` as the map name (not the image
    // filename), so the name has to be read back out of the parsed map rather
    // than hard-coded — passing the wrong name returns null and renders nothing.
    const tilesetName = map.tilesets[0]?.name;

    if (!tilesetName) {
      throw new Error(`Map "${MAP_KEY}" has no tileset. Re-run: npm run map:generate`);
    }

    // Dimensions, margin, spacing and firstgid all come from the parsed Tiled
    // JSON, so only the texture key is needed here.
    const tileset = map.addTilesetImage(tilesetName, TILESET_TEXTURE_KEY);

    if (!tileset) {
      throw new Error(
        `Could not bind texture "${TILESET_TEXTURE_KEY}" to tileset "${tilesetName}". ` +
          "Check that public/assets/maps/kenney_tinybattle.png exists."
      );
    }

    let rendered = 0;
    let skipped = 0;

    for (const layerData of map.layers) {
      if (layerData.name.includes(COLLISION_LAYER_MARKER)) {
        skipped++;
        continue;
      }

      // `createLayer` is typed as TilemapLayer | TilemapGPULayer; gpu === false
      // guarantees the plain TilemapLayer branch.
      const layer = map.createLayer(
        layerData.name,
        tileset,
        0,
        0,
        false
      ) as Phaser.Tilemaps.TilemapLayer | null;

      if (layer) {
        rendered++;
      }
    }

    console.log(
      `[BattleScene] rendered ${rendered} layers, skipped ${skipped} collision layers ` +
        `(${map.width}x${map.height} @ ${map.tileWidth}px = ${map.widthInPixels}x${map.heightInPixels}px)`
    );

    this.fitCameraToMap(map);
  }

  /** Fits the whole board in view at the largest integer zoom that still fits. */
  private fitCameraToMap(map: Phaser.Tilemaps.Tilemap): void {
    const camera = this.cameras.main;
    const fitRatio = Math.min(
      this.scale.width / map.widthInPixels,
      this.scale.height / map.heightInPixels
    );

    // Integer zoom keeps the 16px pixel art crisp; never drop below 1:1.
    camera.setZoom(Math.max(1, Math.floor(fitRatio)));
    camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    camera.centerOn(map.widthInPixels / 2, map.heightInPixels / 2);
  }
}
