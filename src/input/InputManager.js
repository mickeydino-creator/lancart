/**
 * InputManager owns the abstract control state that drives a kart.
 * It has no idea whether the values come from a keyboard, a gamepad,
 * or (in a future phase) a phone over LAN. Sources just call `apply()`
 * with a partial state patch.
 */
export class InputManager {
  constructor() {
    this.state = {
      steering: 0, // -1 (left) .. 1 (right)
      throttle: 0, // 0 .. 1
      brake: 0, // 0 .. 1
      drift: false,
      boost: false,
      pause: false,
    };
    this._pauseHandlers = [];
    this._sources = [];
  }

  /** Register an input source. A source must expose update(inputManager). */
  addSource(source) {
    this._sources.push(source);
    if (typeof source.init === "function") source.init(this);
    return this;
  }

  onPausePressed(handler) {
    this._pauseHandlers.push(handler);
  }

  /** Called by a source to patch the current control state. */
  apply(patch) {
    Object.assign(this.state, patch);
  }

  /** Called once per frame before physics reads input. */
  update(dt) {
    for (const source of this._sources) {
      if (typeof source.update === "function") source.update(this, dt);
    }
    if (this.state.pause) {
      this.state.pause = false;
      for (const h of this._pauseHandlers) h();
    }
  }

  get() {
    return this.state;
  }
}
