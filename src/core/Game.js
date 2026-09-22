import * as THREE from "three";
import { Track } from "../world/Track.js";
import { Kart } from "../entities/Kart.js";
import { SkidTrail } from "../entities/SkidTrail.js";
import { ChaseCamera } from "../camera/ChaseCamera.js";
import { RaceManager } from "../race/RaceManager.js";
import { InputManager } from "../input/InputManager.js";
import { KeyboardController } from "../input/KeyboardController.js";
import { AudioManager } from "../audio/AudioManager.js";
import { loadModel, cloneScene, preloadAssets } from "../assets/AssetLoader.js";
import { PHYSICS, createKartState, stepKartPhysics, resolveKartCollisions } from "../physics/Physics.js";

const TOTAL_LAPS = 3;

function buildSkyTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#2a3a6b");
  grad.addColorStop(0.35, "#7a6fb0");
  grad.addColorStop(0.62, "#ff9d6c");
  grad.addColorStop(0.8, "#ffd28a");
  grad.addColorStop(1, "#ffe9b8");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Single-player race game. Kart/state/input arrays are still indexed
 * collections (not hardcoded to one kart) so a future LAN version can add
 * more player-controlled karts without restructuring this loop - only the
 * AI opponent source has been removed.
 */
export class Game {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.audio = new AudioManager();
    this.initialized = false;
    this.initPromise = null;
    this.paused = false;
    this.clock = new THREE.Clock();
    this._prevCollisionImpulse = [];
    this._driftTickTimer = 0;
    this._prevBoosting = [];

    this._onResize = this._onResize.bind(this);
    this._loop = this._loop.bind(this);
  }

  /** Kick off asset downloads early (e.g. as soon as the track-select
   * screen is shown) so the wait at "Start Race" is minimal. Safe to call
   * more than once - loadModel caches by URL. */
  preload() {
    preloadAssets();
  }

  async init() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    await this.initPromise;
    this.initialized = true;
  }

  async _init() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES tone mapping gives the warm sunset lighting natural contrast and
    // highlight roll-off without any post-processing passes.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xf0b98a, 130, 360);

    const skyGeo = new THREE.SphereGeometry(450, 20, 20);
    const skyMat = new THREE.MeshBasicMaterial({ map: buildSkyTexture(), side: THREE.BackSide, fog: false });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.chaseCamera = new ChaseCamera(this.camera);

    // Soft sky/ground fill so shadow sides never go fully black.
    const hemi = new THREE.HemisphereLight(0xfff0d6, 0x3d6b34, 0.85);
    this.scene.add(hemi);

    // Warm low-angle "sunset" key light.
    const sun = new THREE.DirectionalLight(0xffcf96, 2.1);
    sun.position.set(-90, 70, 55);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 320;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // Cool, dim fill light from the opposite side so shadowed faces still
    // read some form/color instead of crushing to black.
    const fill = new THREE.DirectionalLight(0x7ea6ff, 0.35);
    fill.position.set(70, 40, -60);
    this.scene.add(fill);

    const [kartGltf, pineGltf, coconutGltf] = await Promise.all([
      loadModel("/models/kart.glb"),
      loadModel("/models/pine_tree.glb"),
      loadModel("/models/coconut_tree.glb"),
    ]);

    this.track = new Track(this.scene, { pineGltf, coconutGltf });
    this.skidTrail = new SkidTrail(this.scene);
    this._skidSpawnTimer = [];

    this.kartCount = 1;
    this.playerIndex = 0;
    this.karts = [];
    this.states = [];

    for (let i = 0; i < this.kartCount; i++) {
      const kart = new Kart({ model: cloneScene(kartGltf), isPlayer: i === this.playerIndex });
      kart.addToScene(this.scene);
      this.karts.push(kart);

      const grid = this.track.getGridPosition(i);
      const state = createKartState(grid.position, grid.heading);
      this.states.push(state);
      this._prevCollisionImpulse.push(0);
      this._prevBoosting.push(false);
      this._skidSpawnTimer.push(0);
    }

    this.inputManager = new InputManager();
    this.keyboard = new KeyboardController();
    this.inputManager.addSource(this.keyboard);
    this.inputManager.onPausePressed(() => this.togglePause());

    this.raceManager = new RaceManager(this.track, this.kartCount, {
      totalLaps: TOTAL_LAPS,
      playerIndex: this.playerIndex,
    });
    this._wireRaceEvents();

    window.addEventListener("resize", this._onResize);
    this._onResize();

    this.clock.start();
    requestAnimationFrame(this._loop);
  }

  _wireRaceEvents() {
    const rm = this.raceManager;
    rm.onCountdownTick = (value) => {
      this.ui.setCountdownValue(value);
      this.audio.playCountdownBeep(value === "GO");
      this._setStartLights(value);
    };
    rm.onGo = () => {
      this.ui.hideCountdown();
      this.audio.startEngine();
    };
    rm.onLapComplete = (kartIndex, lapNumber) => {
      if (kartIndex === this.playerIndex && lapNumber < TOTAL_LAPS) {
        this.ui.flashMessage(`LAP ${lapNumber + 1} / ${TOTAL_LAPS}`);
        this.audio.playLapComplete();
      }
    };
    rm.onFinish = (result) => {
      this.audio.stopEngine();
      this.audio.playFinish();
      setTimeout(() => this.ui.showResults(result, TOTAL_LAPS), 1200);
    };
  }

  _setStartLights(value) {
    const lights = this.track.startLights;
    if (!lights) return;
    const litCount = value === "GO" ? 3 : value === 3 ? 1 : value === 2 ? 2 : value === 1 ? 3 : 0;
    const color = value === "GO" ? "#2be05a" : "#ff2323";
    for (let i = 0; i < lights.length; i++) {
      const on = i < litCount;
      lights[i].material.emissive.set(on ? color : "#2a0d0d");
      lights[i].material.color.set(on ? color : "#2a0d0d");
      lights[i].material.emissiveIntensity = on ? 1.6 : 0.2;
    }
    if (value === "GO") {
      setTimeout(() => {
        for (const l of lights) {
          l.material.emissive.set("#1a1a1a");
          l.material.color.set("#1a1a1a");
        }
      }, 900);
    }
  }

  async startRace() {
    this.audio.init();
    this.audio.resume();
    await this.init();
    this._resetPositions();
    this.raceManager.reset();
    this._setStartLights(3);
    this.ui.showCountdown();
    this.paused = false;
  }

  restartRace() {
    this._resetPositions();
    this.raceManager.reset();
    this.audio.stopEngine();
    this._setStartLights(3);
    this.ui.hidePause();
    this.ui.showCountdown();
    this.paused = false;
  }

  _resetPositions() {
    for (let i = 0; i < this.kartCount; i++) {
      const grid = this.track.getGridPosition(i);
      const fresh = createKartState(grid.position, grid.heading);
      Object.assign(this.states[i], fresh);
    }
    this.chaseCamera._initialized = false;
  }

  togglePause() {
    if (this.raceManager.state === "racing") {
      this.raceManager.pause();
      this.paused = true;
      this.audio.stopEngine();
      this.ui.showPause();
    } else if (this.raceManager.state === "paused") {
      this.resumeRace();
    }
  }

  resumeRace() {
    this.raceManager.resume();
    this.paused = false;
    this.audio.startEngine();
    this.ui.hidePause();
  }

  quitToMenu() {
    this.raceManager.state = "menu";
    this.audio.stopEngine();
    this.ui.hidePause();
    this.ui.showMenu();
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    const rmState = this.raceManager.state;
    if (rmState === "racing" || rmState === "countdown" || rmState === "paused") {
      this.inputManager.update(dt);
    }

    if (rmState === "racing") {
      this._stepPhysics(dt);
    }

    this.raceManager.update(dt, this.states);

    if (this.raceManager.state === "racing" || this.raceManager.state === "countdown") {
      this._updateHUD();
    }

    for (let i = 0; i < this.kartCount; i++) {
      this.karts[i].updateVisual(this.states[i], dt);
      this._updateSkidMarks(i, dt);
    }
    this.skidTrail.update(dt);

    this.chaseCamera.update(this.states[this.playerIndex], dt);
    this.renderer.render(this.scene, this.camera);
  }

  _stepPhysics(dt) {
    for (let i = 0; i < this.kartCount; i++) {
      const state = this.states[i];
      const input = this.inputManager.get();
      stepKartPhysics(state, input, dt, this.track);
    }
    resolveKartCollisions(this.states);

    const playerState = this.states[this.playerIndex];
    if (playerState.collisionImpulse > this._prevCollisionImpulse[this.playerIndex] + 0.15) {
      this.chaseCamera.shake(playerState.collisionImpulse * 0.7, 0.22);
      this.audio.playCollision();
    }
    if (playerState.isBoosting && !this._prevBoosting[this.playerIndex]) {
      this.chaseCamera.shake(0.22, 0.2);
      this.audio.playBoost();
    }
    this._prevCollisionImpulse[this.playerIndex] = playerState.collisionImpulse;
    this._prevBoosting[this.playerIndex] = playerState.isBoosting;

    this._driftTickTimer -= dt;
    if (playerState.isDrifting && this._driftTickTimer <= 0) {
      this.audio.playDriftTick();
      this._driftTickTimer = 0.14;
    }

    if (playerState.braking && Math.abs(playerState.speed) > 6) {
      this.audio.playBrakeScreech(Math.abs(playerState.speed) / PHYSICS.maxSpeed);
    }

    const speedRatio = Math.min(1, Math.abs(playerState.speed) / PHYSICS.maxSpeed);
    const playerInput = this.inputManager.get();
    this.audio.updateEngine(speedRatio, playerState.isBoosting, playerInput.throttle, playerState.offRoad);
    this.audio.tick(dt);
  }

  _updateSkidMarks(kartIndex, dt) {
    const state = this.states[kartIndex];
    this._skidSpawnTimer[kartIndex] -= dt;
    if (!state.isDrifting || Math.abs(state.speed) < 4) return;
    if (this._skidSpawnTimer[kartIndex] > 0) return;
    this._skidSpawnTimer[kartIndex] = 0.045;
    for (const pos of this.karts[kartIndex].getRearWheelPositions()) {
      this.skidTrail.spawn(pos, state.heading);
    }
  }

  _updateHUD() {
    const state = this.states[this.playerIndex];
    this.ui.updateHUD({
      lap: this.raceManager.getPlayerLap(),
      totalLaps: TOTAL_LAPS,
      position: this.raceManager.getPlayerPosition(),
      elapsed: this.raceManager.elapsed,
      speedKmh: Math.abs(state.speed) * 3.6,
      drifting: state.isDrifting,
      boostLevel: state.driftBoostLevel,
      boostFuel: state.manualBoostFuel,
      boosting: state.isBoosting,
    });
  }
}
