import * as THREE from "three";

const WHEEL_RADIUS = 0.42;

function buildWheel() {
  const group = new THREE.Group();
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.32, 14),
    new THREE.MeshStandardMaterial({ color: "#1b1b1f", roughness: 0.9 })
  );
  tire.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.34, 8),
    new THREE.MeshStandardMaterial({ color: "#c9c9c9", metalness: 0.6, roughness: 0.3 })
  );
  hub.rotation.z = Math.PI / 2;
  group.add(tire, hub);
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

function buildBody(bodyColor, accentColor) {
  const group = new THREE.Group();

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.4, 2.6),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.45, metalness: 0.15 })
  );
  chassis.position.y = 0.5;
  group.add(chassis);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.75, 1.1, 4),
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4 })
  );
  nose.rotation.x = Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.scale.set(1, 0.55, 1);
  nose.position.set(0, 0.55, -1.55);
  group.add(nose);

  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 12, 10, 0, Math.PI * 2, 0, Math.PI / 1.7),
    new THREE.MeshStandardMaterial({ color: "#1c2026", roughness: 0.3 })
  );
  cockpit.position.set(0, 0.78, 0.15);
  cockpit.scale.set(1, 0.75, 1.3);
  group.add(cockpit);

  const driver = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.4, 4, 8),
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.6 })
  );
  driver.position.set(0, 1.05, 0.25);
  group.add(driver);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 12, 10),
    new THREE.MeshStandardMaterial({ color: "#e8e8e8", roughness: 0.35 })
  );
  helmet.position.set(0, 1.42, 0.25);
  group.add(helmet);

  const spoiler = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.08, 0.35),
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4 })
  );
  spoiler.position.set(0, 0.95, 1.35);
  const spoilerPostGeo = new THREE.BoxGeometry(0.08, 0.35, 0.08);
  const spoilerMat = new THREE.MeshStandardMaterial({ color: "#222" });
  const postL = new THREE.Mesh(spoilerPostGeo, spoilerMat);
  postL.position.set(-0.65, 0.75, 1.35);
  const postR = postL.clone();
  postR.position.x = 0.65;
  group.add(spoiler, postL, postR);

  const bumper = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.25, 0.3),
    new THREE.MeshStandardMaterial({ color: "#20232a" })
  );
  bumper.position.set(0, 0.32, 1.35);
  group.add(bumper);

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return { group, driver };
}

/**
 * Kart handles ONLY the visual representation and its reaction to motion
 * state (tilt, lean, wheel spin/steer, boost flame, brake lights).
 * All physics/state math lives in Physics.js / the kart's state object.
 */
export class Kart {
  constructor({ bodyColor = "#ff5d3b", accentColor = "#ffd23f", isPlayer = false } = {}) {
    this.isPlayer = isPlayer;
    this.root = new THREE.Group();

    const { group: bodyGroup } = buildBody(bodyColor, accentColor);
    this.bodyGroup = bodyGroup;
    this.tiltGroup = new THREE.Group();
    this.tiltGroup.add(bodyGroup);
    this.root.add(this.tiltGroup);

    this.wheels = {
      fl: buildWheel(),
      fr: buildWheel(),
      rl: buildWheel(),
      rr: buildWheel(),
    };
    this.wheels.fl.position.set(-0.78, 0.42, -0.95);
    this.wheels.fr.position.set(0.78, 0.42, -0.95);
    this.wheels.rl.position.set(-0.82, 0.42, 0.95);
    this.wheels.rr.position.set(0.82, 0.42, 0.95);
    this.steerGroupFL = new THREE.Group();
    this.steerGroupFR = new THREE.Group();
    this.steerGroupFL.position.copy(this.wheels.fl.position);
    this.steerGroupFR.position.copy(this.wheels.fr.position);
    this.wheels.fl.position.set(0, 0, 0);
    this.wheels.fr.position.set(0, 0, 0);
    this.steerGroupFL.add(this.wheels.fl);
    this.steerGroupFR.add(this.wheels.fr);

    this.root.add(this.steerGroupFL, this.steerGroupFR, this.wheels.rl, this.wheels.rr);

    // brake lights
    const brakeMat = new THREE.MeshStandardMaterial({
      color: "#3a0d0d",
      emissive: "#ff2222",
      emissiveIntensity: 0,
    });
    this.brakeMat = brakeMat;
    const brakeGeo = new THREE.BoxGeometry(0.28, 0.12, 0.08);
    const bl = new THREE.Mesh(brakeGeo, brakeMat);
    bl.position.set(-0.55, 0.55, 1.42);
    const br = bl.clone();
    br.position.x = 0.55;
    this.root.add(bl, br);

    // drift spark / boost flame effect
    this.boostFlames = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: "#3fd1ff", transparent: true, opacity: 0 });
    for (const side of [-0.4, 0.4]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 8), flameMat.clone());
      flame.rotation.x = -Math.PI / 2;
      flame.position.set(side, 0.45, 1.6);
      this.root.add(flame);
      this.boostFlames.push(flame);
    }

    // drift sparks (small glowing particles at rear wheels)
    this.driftSparkMat = new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0 });
    this.driftSparks = [];
    for (const side of [-0.82, 0.82]) {
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), this.driftSparkMat.clone());
      spark.position.set(side, 0.25, 1.1);
      this.root.add(spark);
      this.driftSparks.push(spark);
    }

    this.root.castShadow = true;
    this._currentTilt = 0;
    this._currentLean = 0;
  }

  addToScene(scene) {
    scene.add(this.root);
  }

  /** Sync visuals with a physics state object each frame. */
  updateVisual(state, dt) {
    this.root.position.copy(state.position);
    this.root.quaternion.setFromEuler(new THREE.Euler(0, state.heading, 0));

    // suspension pitch based on acceleration, roll based on turning
    const targetTilt = THREE.MathUtils.clamp(-state.forwardAccel * 0.02, -0.12, 0.12);
    const targetLean = THREE.MathUtils.clamp(
      -state.angularVelocity * 0.35 - (state.driftDirection || 0) * (state.isDrifting ? 0.28 : 0),
      -0.5,
      0.5
    );
    this._currentTilt = THREE.MathUtils.lerp(this._currentTilt, targetTilt, 1 - Math.pow(0.001, dt));
    this._currentLean = THREE.MathUtils.lerp(this._currentLean, targetLean, 1 - Math.pow(0.0005, dt));
    this.tiltGroup.rotation.set(this._currentTilt, 0, this._currentLean);

    // wheel steering visual (front wheels turn with steering input)
    const steerAngle = state.steerVisual * 0.5;
    this.steerGroupFL.rotation.y = steerAngle;
    this.steerGroupFR.rotation.y = steerAngle;

    // wheel spin based on speed
    const spin = (state.speed / WHEEL_RADIUS) * dt;
    for (const key of Object.keys(this.wheels)) {
      this.wheels[key].rotation.x += spin;
    }

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
