# Lancart Racing

An original arcade 3D kart racing prototype built with Three.js. Single-player,
one track ("Sunset Circuit"), 3-lap races against 5 AI opponents.

## Running locally

```bash
npm install
npm run dev
```

Then open the printed local URL in a browser.

To build a production bundle:

```bash
npm run build
npm run preview
```

## Controls

- `W` / `↑` — Accelerate
- `S` / `↓` — Brake / Reverse
- `A` / `←` — Steer left
- `D` / `→` — Steer right
- `Space` — Drift (hold while steering, release to fire a boost)
- `Shift` — Boost
- `Esc` / `P` — Pause

## Architecture

Game logic is split into small, focused modules so keyboard input can later
be swapped for LAN/phone-controller input without touching physics or
rendering code:

- `src/input/` — `InputManager` (abstract control state: steering, throttle,
  brake, drift, boost) + `KeyboardController` as its only current source.
- `src/physics/Physics.js` — acceleration, braking, drifting, boosting,
  friction, and track/kart collision, operating on plain kart state objects.
- `src/entities/Kart.js` — the kart's 3D model and visual reactions (wheel
  spin/steer, body tilt/lean, boost flame, brake lights).
- `src/entities/AIController.js` — simple lookahead-based opponent driving.
- `src/world/Track.js` — procedurally builds the track mesh, barriers,
  checkpoints, decorations, and start lights from a spline.
- `src/camera/ChaseCamera.js` — smooth third-person follow camera.
- `src/race/` — `CheckpointManager` (lap/shortcut validation, race
  position) and `RaceManager` (countdown, timing, finish, pause).
- `src/ui/UI.js` — DOM screens (menu, track select, HUD, pause, results).
- `src/audio/AudioManager.js` — WebAudio-synthesized sound effects (no
  external audio assets).
- `src/core/Game.js` — wires everything together and runs the game loop.
