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

// Any button click gets a light UI tick; the very first one also unlocks
// audio (WebAudio requires a user gesture before it can play anything).
document.addEventListener(
  "click",
  (e) => {
    if (e.target.closest(".btn, .hud-icon-btn, .track-card")) {
      game.audio.init();
      game.audio.resume();
      game.audio.playUIClick();
    }
  },
  { capture: true }
);

ui.showMenu();

if (import.meta.env.DEV) {
  window.__game = game;
}
