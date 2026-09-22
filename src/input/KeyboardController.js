const DEFAULT_BINDINGS = {
  throttle: ["KeyW", "ArrowUp"],
  brake: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  drift: ["Space"],
  boost: ["ShiftLeft", "ShiftRight"],
  pause: ["Escape", "KeyP"],
};

/**
 * Keyboard input source. Produces the same abstract state shape any
 * other source (gamepad, phone controller) would produce, so it can be
 * swapped out later without touching Kart/Physics.
 */
export class KeyboardController {
  constructor(bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    this.keys = new Set();
    this._pauseLatch = false;

    this._onKeyDown = (e) => {
      this.keys.add(e.code);
      if (this._matches("pause", e.code) && !this._pauseLatch) {
        this._pauseLatch = true;
        this._pausePressedThisFrame = true;
      }
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      if (this._matches("pause", e.code)) this._pauseLatch = false;
    };
  }

  _matches(action, code) {
    return this.bindings[action]?.includes(code);
  }

  _any(action) {
    return this.bindings[action]?.some((code) => this.keys.has(code)) ?? false;
  }

  init() {
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
  }

  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
  }

  update(inputManager) {
    const left = this._any("left");
    const right = this._any("right");
    let steering = 0;
    if (left && !right) steering = -1;
    else if (right && !left) steering = 1;

    inputManager.apply({
      steering,
      throttle: this._any("throttle") ? 1 : 0,
      brake: this._any("brake") ? 1 : 0,
      drift: this._any("drift"),
      boost: this._any("boost"),
      pause: !!this._pausePressedThisFrame,
    });
    this._pausePressedThisFrame = false;
  }
}
