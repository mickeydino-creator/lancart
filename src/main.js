import "./style.css";
import { UI } from "./ui/UI.js";
import { Game } from "./core/Game.js";

const canvas = document.getElementById("game-canvas");
const ui = new UI();
const game = new Game(canvas, ui);

ui.bind({
  onPlay: () => ui.showTrackSelect(),
  onHowTo: () => ui.showHowTo(),
  onHowToBack: () => ui.showMenu(),
  onTracksBack: () => ui.showMenu(),
  onStartRace: () => game.startRace(),
  onPauseToggle: () => game.togglePause(),
  onResume: () => game.resumeRace(),
  onRestart: () => game.restartRace(),
  onQuit: () => game.quitToMenu(),
  onRaceAgain: () => game.restartRace(),
  onResultsMenu: () => game.quitToMenu(),
});

document.querySelectorAll(".track-card").forEach((card) => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".track-card").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
  });
});

ui.showMenu();

if (import.meta.env.DEV) {
  window.__game = game;
}
