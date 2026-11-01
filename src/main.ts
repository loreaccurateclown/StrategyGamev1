import Phaser from "phaser";
import { BattleScene } from "./scenes/BattleScene";

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: "app",
  backgroundColor: "#1d1d1d",
  // 16px tiles: without this the browser smooths the art into mush.
  pixelArt: true,
  roundPixels: true,
  scene: BattleScene,
});
