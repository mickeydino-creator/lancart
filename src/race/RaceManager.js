import { CheckpointManager } from "./CheckpointManager.js";

const COUNTDOWN_SECONDS = 3;

/**
 * Orchestrates the race state machine: countdown, lap/position tracking,
 * timing, pause, finish detection, and restart. UI subscribes via the
 * on* callback hooks; Game.js drives it every frame with kart states.
 */
export class RaceManager {
  constructor(track, kartCount, { totalLaps = 3, playerIndex = 0 } = {}) {
    this.track = track;
    this.kartCount = kartCount;
    this.totalLaps = totalLaps;
    this.playerIndex = playerIndex;
    this.checkpoints = new CheckpointManager(track, kartCount);

    this.onCountdownTick = null; // (displayValue) => void, displayValue: 3,2,1,"GO"
    this.onGo = null;
    this.onLapComplete = null; // (kartIndex, lapNumber) => void
    this.onFinish = null; // (result) => void
    this.onPositionsChanged = null; // (orderedKartIndices) => void

    this.reset();
  }

  reset() {
    this.state = "countdown";
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this._lastCountdownDigit = COUNTDOWN_SECONDS + 1;
    this.elapsed = 0;
    this.checkpoints.reset();
    this.lapTimes = Array.from({ length: this.kartCount }, () => []);
    this._lapStartTime = new Array(this.kartCount).fill(0);
    this.positions = Array.from({ length: this.kartCount }, (_, i) => i);
    this.finished = false;
    this.playerResult = null;
    this._announcedGo = false;
  }

  pause() {
    if (this.state === "racing") this.state = "paused";
  }

  resume() {
    if (this.state === "paused") this.state = "racing";
  }

  isRunning() {
    return this.state === "racing";
  }

  /** kartStates: array of physics state objects, index-aligned with kartCount. */
  update(dt, kartStates) {
    if (this.state === "countdown") {
      this.countdownRemaining -= dt;
      const digit = Math.ceil(this.countdownRemaining);
      if (digit !== this._lastCountdownDigit) {
        this._lastCountdownDigit = digit;
        if (digit > 0 && this.onCountdownTick) this.onCountdownTick(digit);
      }
      if (this.countdownRemaining <= 0) {
        this.state = "racing";
        if (this.onCountdownTick) this.onCountdownTick("GO");
        if (this.onGo) this.onGo();
      }
      return;
    }

    if (this.state !== "racing") return;

    this.elapsed += dt;

    for (let i = 0; i < this.kartCount; i++) {
      const lapCompleted = this.checkpoints.update(i, kartStates[i]);
      if (lapCompleted) {
        const lapNumber = this.checkpoints.getLap(i);
        const lapTime = this.elapsed - this._lapStartTime[i];
        this._lapStartTime[i] = this.elapsed;
        this.lapTimes[i].push(lapTime);
        if (this.onLapComplete) this.onLapComplete(i, lapNumber, lapTime);

        if (i === this.playerIndex && lapNumber >= this.totalLaps && !this.finished) {
          this.finished = true;
          this.state = "finished";
          const bestLap = Math.min(...this.lapTimes[i]);
          this.playerResult = {
            position: this._playerRank ?? 1,
            totalTime: this.elapsed,
            bestLap,
            laps: this.lapTimes[i].slice(),
          };
          if (this.onFinish) this.onFinish(this.playerResult);
        }
      }
    }

    const newOrder = [...Array(this.kartCount).keys()].sort(
      (a, b) => this.checkpoints.getDistance(b) - this.checkpoints.getDistance(a)
    );
    this._playerRank = newOrder.indexOf(this.playerIndex) + 1;
    if (this.playerResult) this.playerResult.position = this._playerRank;

    if (newOrder.join(",") !== this.positions.join(",")) {
      this.positions = newOrder;
      if (this.onPositionsChanged) this.onPositionsChanged(newOrder);
    }
  }

  getPlayerPosition() {
    return this._playerRank ?? 1;
  }

  getPlayerLap() {
    return Math.min(this.checkpoints.getLap(this.playerIndex) + 1, this.totalLaps);
  }
}
