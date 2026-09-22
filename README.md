# Lancart Racing

An arcade 3D kart racing prototype built with Three.js. Single-player,
one track ("Sunset Circuit"), 3-lap time trial.

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
- `src/entities/Kart.js` — wraps the loaded kart model, animating its rig
  bones (wheel spin/steer) and visual reactions (body tilt/lean, boost
  flame, brake lights).
- `src/assets/AssetLoader.js` — GLTF loading/caching/cloning for the kart
  and tree models.
- `src/world/Track.js` — procedurally builds the track mesh, barriers,
  checkpoints, decorations, and start lights from a spline.
- `src/camera/ChaseCamera.js` — smooth third-person follow camera.
- `src/race/` — `CheckpointManager` (lap/shortcut validation, race
  position) and `RaceManager` (countdown, timing, finish, pause).
- `src/ui/UI.js` — DOM screens (menu, track select, HUD, pause, results).
- `src/audio/AudioManager.js` — WebAudio-synthesized sound effects (no
  external audio assets).
- `src/core/Game.js` — wires everything together and runs the game loop.

## 3D asset credits

The kart and tree models in `public/models/` are community assets from
Sketchfab, licensed CC BY 4.0:

- ["Goat Simulator 3 Go Cart"](https://sketchfab.com/3d-models/goat-simulator-3-go-cart-3e098157a0e844c0898147019eaced2e) by noiq998
- ["Stylized Pine Tree Tree"](https://sketchfab.com/3d-models/stylized-pine-tree-tree-deadcadc915545a7b4701dbe6eb419e8) by Batuhan13
- ["Coconut Tree"](https://sketchfab.com/3d-models/coconut-tree-d141941578044b0f861ca83b36d4c411) by sujirour
- ["Terrain"](https://sketchfab.com/3d-models/terrain-2c30e112d63e417ab67676ff696f18c0) by makeitcleanapp

`kart.glb` has been re-exported with resized/WebP-compressed textures for
faster loading (2.8MB vs the original 10.9MB); geometry is unmodified.
