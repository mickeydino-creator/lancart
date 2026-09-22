function el(id) {
  return document.getElementById(id);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

/**
 * Thin DOM controller for every screen (menu, track select, countdown,
 * HUD, pause, results). Game.js wires callbacks in and pushes state out;
 * this module has no game logic of its own.
 */
export class UI {
  constructor() {
    this.screens = {
      menu: el("screen-menu"),
      howto: el("screen-howto"),
      tracks: el("screen-tracks"),
      countdown: el("screen-countdown"),
      pause: el("screen-pause"),
      results: el("screen-results"),
    };
    this.hud = el("hud");
    this._messageTimeout = null;
  }

  _hideAllScreens() {
    for (const s of Object.values(this.screens)) s.classList.add("hidden");
  }

  showMenu() {
    this._hideAllScreens();
    this.hud.classList.add("hidden");
    this.screens.menu.classList.remove("hidden");
  }

  showHowTo() {
    this._hideAllScreens();
    this.screens.howto.classList.remove("hidden");
  }

  showTrackSelect() {
    this._hideAllScreens();
    this.screens.tracks.classList.remove("hidden");
  }

  setStartRaceLoading(loading) {
    const btn = el("btn-start-race");
    btn.disabled = loading;
    btn.textContent = loading ? "Loading…" : "Start Race";
  }

  showCountdown() {
    this._hideAllScreens();
    this.hud.classList.remove("hidden");
    this.screens.countdown.classList.remove("hidden");
  }

  setCountdownValue(value) {
    const node = el("countdown-number");
    node.textContent = value === "GO" ? "GO!" : String(value);
    node.style.animation = "none";
    // force reflow to restart the pop animation
    void node.offsetWidth;
    node.style.animation = "";
  }

  hideCountdown() {
    this.screens.countdown.classList.add("hidden");
  }

  showRacingHUD() {
    this._hideAllScreens();
    this.hud.classList.remove("hidden");
  }

  showPause() {
    this.screens.pause.classList.remove("hidden");
  }

  hidePause() {
    this.screens.pause.classList.add("hidden");
  }

  showResults(result, totalLaps) {
    this._hideAllScreens();
    this.hud.classList.add("hidden");
    el("result-position").textContent = ORDINALS[result.position - 1] ?? `${result.position}th`;
    el("result-time").textContent = formatTime(result.totalTime);
    el("result-best-lap").textContent = formatTime(result.bestLap);
    el("result-medal").textContent = result.position === 1 ? "🥇" : result.position === 2 ? "🥈" : result.position === 3 ? "🥉" : "🏁";
    this.screens.results.classList.remove("hidden");
  }

  updateHUD({ lap, totalLaps, position, elapsed, speedKmh, drifting, boostLevel, boostFuel, boosting }) {
    el("hud-lap-text").textContent = `LAP ${lap}/${totalLaps}`;
    el("hud-position-text").textContent = ORDINALS[position - 1] ?? `${position}th`;
    el("hud-timer-text").textContent = formatTime(elapsed);
    el("hud-speed").textContent = Math.round(speedKmh);

    const speedRatio = Math.min(1, speedKmh / 115);
    const circumference = 2 * Math.PI * 42;
    const ring = el("speed-ring-fill");
    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = `${circumference * (1 - speedRatio)}`;

    const driftIndicator = el("drift-indicator");
    driftIndicator.classList.toggle("active", drifting);
    driftIndicator.classList.toggle("boost-ready", boostLevel > 0);
    driftIndicator.querySelector("span").textContent =
      boostLevel >= 2 ? "SUPER BOOST!" : boostLevel >= 1 ? "BOOST READY" : "DRIFT";

    el("boost-bar-fill").style.width = `${Math.round(boostFuel * 100)}%`;
    el("boost-bar-wrap").classList.toggle("active", !!boosting);
  }

  flashMessage(text, duration = 1400) {
    const node = el("hud-message");
    node.textContent = text;
    node.classList.add("show");
    clearTimeout(this._messageTimeout);
    this._messageTimeout = setTimeout(() => node.classList.remove("show"), duration);
  }

  bind(handlers) {
    el("btn-play").addEventListener("click", handlers.onPlay);
    el("btn-howto").addEventListener("click", handlers.onHowTo);
    el("btn-howto-back").addEventListener("click", handlers.onHowToBack);
    el("btn-tracks-back").addEventListener("click", handlers.onTracksBack);
    el("btn-start-race").addEventListener("click", handlers.onStartRace);
    el("btn-pause").addEventListener("click", handlers.onPauseToggle);
    el("btn-resume").addEventListener("click", handlers.onResume);
    el("btn-restart").addEventListener("click", handlers.onRestart);
    el("btn-quit").addEventListener("click", handlers.onQuit);
    el("btn-race-again").addEventListener("click", handlers.onRaceAgain);
    el("btn-results-menu").addEventListener("click", handlers.onResultsMenu);
  }
}

export { formatTime };
