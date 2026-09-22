import * as THREE from "three";

// The kart.glb asset is authored nose-forward along its own +X axis at a
// large arbitrary unit scale. Our world convention (established by the
// camera/physics code) is nose = local -Z. KART_SCALE brings the model to
// a real-world kart length (~2.5m); KART_YAW rotates +X to -Z.
const KART_SCALE = 0.0272;
const KART_YAW = Math.PI / 2;
const WHEEL_RADIUS = 0.19; // approximate rolling radius, tuned by eye against the model

const WHEEL_BONE_NAMES = {
  fl: "Wheel_Front_Left_02",
  fr: "Wheel_Front_Right_03",
  rl: "Wheel_Rear_Left_04",
  rr: "Wheel_Rear_Right_05",
};

function findBone(root, name) {
  let found = null;
  root.traverse((o) => {
    if (!found && o.isBone && o.name === name) found = o;
  });
  return found;
}

/**
 * Kart handles ONLY the visual representation and its reaction to motion
 * state (tilt, lean, wheel spin/steer, boost flame, brake lights).
 * All physics/state math lives in Physics.js / the kart's state object.
 *
 * `model` is a pre-loaded, pre-cloned GLTF scene (see AssetLoader.js) -
 * loading/cloning happens once up front in Game.js so this class stays
 * fully synchronous and easy to instantiate per-kart (including future
 * additional player-controlled karts for LAN multiplayer).
 */
export class Kart {
  constructor({ model, isPlayer = false } = {}) {
    this.isPlayer = isPlayer;
    this.root = new THREE.Group();
    this.tiltGroup = new THREE.Group();
    this.root.add(this.tiltGroup);

    const modelWrapper = new THREE.Group();
    modelWrapper.rotation.y = KART_YAW;
    modelWrapper.scale.setScalar(KART_SCALE);
    modelWrapper.add(model);
    this.tiltGroup.add(modelWrapper);

    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    this.wheelBones = {
      fl: findBone(model, WHEEL_BONE_NAMES.fl),
      fr: findBone(model, WHEEL_BONE_NAMES.fr),
      rl: findBone(model, WHEEL_BONE_NAMES.rl),
      rr: findBone(model, WHEEL_BONE_NAMES.rr),
    };

    // Scaled half-length, used to place add-on effects (lights, flames)
    // relative to the actual model regardless of exact source proportions.
    const box = new THREE.Box3().setFromObject(modelWrapper);
    const halfLength = (box.max.z - box.min.z) / 2;
    const topY = box.max.y;

    // brake lights (small emissive add-ons - the source model has no
    // separate light geometry to target)
    const brakeMat = new THREE.MeshStandardMaterial({
      color: "#3a0d0d",
      emissive: "#ff2222",
      emissiveIntensity: 0,
    });
    this.brakeMat = brakeMat;
    const brakeGeo = new THREE.BoxGeometry(0.26, 0.1, 0.05);
    const bl = new THREE.Mesh(brakeGeo, brakeMat);
    bl.position.set(-0.42, topY * 0.55, halfLength + 0.05);
    const br = bl.clone();
    br.position.x = 0.42;
    this.tiltGroup.add(bl, br);

    // boost flame
    this.boostFlames = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: "#3fd1ff", transparent: true, opacity: 0 });
    for (const side of [-0.3, 0.3]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.8, 8), flameMat.clone());
      flame.rotation.x = -Math.PI / 2;
      flame.position.set(side, topY * 0.4, halfLength + 0.5);
      this.tiltGroup.add(flame);
      this.boostFlames.push(flame);
    }

    // drift sparks near the rear wheels
    this.driftSparkMat = new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0 });
    this.driftSparks = [];
    for (const side of [-0.55, 0.55]) {
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), this.driftSparkMat.clone());
      spark.position.set(side, 0.15, halfLength - 0.3);
      this.tiltGroup.add(spark);
      this.driftSparks.push(spark);
    }

    this._currentTilt = 0;
    this._currentLean = 0;
    this._bobPhase = Math.random() * Math.PI * 2;
  }

  addToScene(scene) {
    scene.add(this.root);
  }

  /** World-space positions of the rear wheel contact points (for skid trails). */
  getRearWheelPositions() {
    return [this.wheelBones.rl, this.wheelBones.rr].map((bone) => {
      const p = new THREE.Vector3();
      bone.getWorldPosition(p);
      p.y = 0.05;
      return p;
    });
  }

  /** Sync visuals with a physics state object each frame. */
  updateVisual(state, dt) {
    this.root.position.copy(state.position);
    // Movement integrates along dir = (sin(heading), 0, cos(heading)) (see
    // Physics.js). A plain Euler(0, heading, 0) rotation points the model's
    // local -Z ("nose", per KART_YAW above) at -dir instead of +dir, so the
    // kart visually drives backward; the extra PI corrects that without
    // touching the camera or physics, which already assume nose = dir.
    this.root.quaternion.setFromEuler(new THREE.Euler(0, state.heading + Math.PI, 0));

    // suspension pitch based on acceleration, roll based on turning
    const targetTilt = THREE.MathUtils.clamp(-state.forwardAccel * 0.02, -0.12, 0.12);
    const targetLean = THREE.MathUtils.clamp(
      -state.angularVelocity * 0.35 - (state.driftDirection || 0) * (state.isDrifting ? 0.28 : 0),
      -0.5,
      0.5
    );
    this._currentTilt = THREE.MathUtils.lerp(this._currentTilt, targetTilt, 1 - Math.pow(0.001, dt));
    this._currentLean = THREE.MathUtils.lerp(this._currentLean, targetLean, 1 - Math.pow(0.0005, dt));

    // subtle idle suspension bob, faster and slightly stronger with speed
    const speedRatio = Math.min(1, Math.abs(state.speed) / 32);
    this._bobPhase += dt * (3 + speedRatio * 6);
    const bob = Math.sin(this._bobPhase) * (0.012 + speedRatio * 0.01);

    this.tiltGroup.rotation.set(this._currentTilt, 0, this._currentLean);
    this.tiltGroup.position.y = bob;

    // wheel steering + spin, driven directly on the model's rig bones.
    // Steer is negated to match Physics.js's heading convention (see the
    // note there); spin is around each bone's local lateral (Z) axis.
    const steerAngle = -state.steerVisual * 0.5;
    const spin = (state.speed / WHEEL_RADIUS) * dt;
    const { fl, fr, rl, rr } = this.wheelBones;
    fl.rotation.z += spin;
    fr.rotation.z += spin;
    rl.rotation.z += spin;
    rr.rotation.z += spin;
    fl.rotation.y = steerAngle;
    fr.rotation.y = steerAngle;

    // brake light
    this.brakeMat.emissiveIntensity = state.braking ? 2.2 : 0.05;

    // boost flame
    const boostOpacity = state.isBoosting ? 0.85 : 0;
    for (const f of this.boostFlames) {
      f.material.opacity = THREE.MathUtils.lerp(f.material.opacity, boostOpacity, 0.3);
      f.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    }

    // drift sparks
    const sparkOpacity = state.isDrifting ? (state.driftBoostLevel > 0 ? 1 : 0.6) : 0;
    const sparkColor = state.driftBoostLevel >= 2 ? "#3fd1ff" : state.driftBoostLevel >= 1 ? "#ff8f3f" : "#ffd23f";
    for (const s of this.driftSparks) {
      s.material.opacity = sparkOpacity;
      s.material.color.set(sparkColor);
    }
  }
}
