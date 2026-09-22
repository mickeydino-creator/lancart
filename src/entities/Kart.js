import * as THREE from "three";

const WHEEL_RADIUS = 0.42;

function buildWheel(accentColor) {
  const group = new THREE.Group();
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.34, 18),
    new THREE.MeshStandardMaterial({ color: "#181818", roughness: 0.92 })
  );
  tire.rotation.z = Math.PI / 2;
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.36, 10),
    new THREE.MeshStandardMaterial({ color: "#d8dbe0", metalness: 0.75, roughness: 0.25 })
  );
  rim.rotation.z = Math.PI / 2;
  const accent = new THREE.Mesh(
    new THREE.TorusGeometry(0.23, 0.035, 6, 14),
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4, metalness: 0.2 })
  );
  accent.rotation.y = Math.PI / 2;
  group.add(tire, rim, accent);
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/** Tapered pod (used for both the nose and tail) via a low-poly cylinder frustum. */
function buildPod(radiusFront, radiusBack, length, material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusBack, radiusFront, length, 8), material);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function buildBody(bodyColor, accentColor) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4, metalness: 0.2 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.35, metalness: 0.15 });
  const darkMat = new THREE.MeshStandardMaterial({ color: "#1b1e24", roughness: 0.55, metalness: 0.1 });

  // Nose pod: pointed tip at the front (-Z), blends into the tub.
  const nose = buildPod(0.09, 0.58, 1.3, bodyMat);
  nose.position.set(0, 0.52, -1.28);
  group.add(nose);

  // Main tub / cockpit floor - a wide, low, rounded-feeling hull.
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.5, 1.55), bodyMat);
  tub.position.set(0, 0.52, 0.15);
  group.add(tub);

  // Shoulder line - a slimmer upper deck to break up the box silhouette.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.22, 1.3), bodyMat);
  deck.position.set(0, 0.84, 0.05);
  group.add(deck);

  // Belly pan - a contrasting dark underside sliver for a two-tone look.
  const belly = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, 2.7), darkMat);
  belly.position.set(0, 0.24, 0.1);
  group.add(belly);

  // Tail pod: tapers to a narrow point at the back (+Z).
  const tail = buildPod(0.52, 0.12, 0.95, bodyMat);
  tail.position.set(0, 0.5, 1.42);
  group.add(tail);

  // Side pods / fenders over the wheels - what makes the silhouette read as
  // a kart rather than a generic wedge.
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.35, 3, 8), accentMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 0.95, 0.42, 0.02);
    group.add(pod);

    // side accent stripe (livery detail)
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 2.0), bodyMat);
    stripe.position.set(side * 1.18, 0.5, 0.05);
    group.add(stripe);
  }

  // Cockpit shell
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.8),
    darkMat
  );
  cockpit.position.set(0, 0.95, 0.05);
  cockpit.scale.set(1, 0.7, 1.25);
  group.add(cockpit);

  // Small curved windscreen in front of the driver.
  const windscreen = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI, 0, Math.PI / 2.6),
    new THREE.MeshStandardMaterial({ color: "#bfe8ff", roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 })
  );
  windscreen.position.set(0, 0.98, -0.55);
  windscreen.rotation.x = Math.PI;
  windscreen.scale.set(1, 0.7, 0.6);
  group.add(windscreen);

  const driver = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.27, 0.38, 4, 8),
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.6 })
  );
  driver.position.set(0, 1.12, 0.25);
  group.add(driver);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 14, 10),
    new THREE.MeshStandardMaterial({ color: "#eef0f3", roughness: 0.3 })
  );
  helmet.position.set(0, 1.48, 0.25);
  group.add(helmet);
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2.2),
    new THREE.MeshStandardMaterial({ color: "#171a1f", roughness: 0.2, metalness: 0.3 })
  );
  visor.position.set(0, 1.47, 0.02);
  group.add(visor);

  // Spoiler assembly
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.07, 0.34), accentMat);
  spoiler.position.set(0, 0.98, 1.5);
  const spoilerPostGeo = new THREE.BoxGeometry(0.07, 0.34, 0.07);
  const postL = new THREE.Mesh(spoilerPostGeo, darkMat);
  postL.position.set(-0.58, 0.78, 1.5);
  const postR = postL.clone();
  postR.position.x = 0.58;
  group.add(spoiler, postL, postR);

  // Rear diffuser fins
  for (const side of [-0.35, 0, 0.35]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.4), darkMat);
    fin.position.set(side, 0.24, 1.85);
    group.add(fin);
  }

  // Front splitter + bumper
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 0.22), darkMat);
  bumper.position.set(0, 0.28, -1.82);
  group.add(bumper);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.05, 0.32), accentMat);
  splitter.position.set(0, 0.17, -1.86);
  group.add(splitter);

  // Headlights
  const headlightMat = new THREE.MeshStandardMaterial({
    color: "#fff6d8",
    emissive: "#fff2b0",
    emissiveIntensity: 0.9,
  });
  for (const side of [-0.32, 0.32]) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), headlightMat);
    light.position.set(side, 0.58, -1.86);
    group.add(light);
  }

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
      fl: buildWheel(accentColor),
      fr: buildWheel(accentColor),
      rl: buildWheel(accentColor),
      rr: buildWheel(accentColor),
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
    const brakeGeo = new THREE.BoxGeometry(0.26, 0.12, 0.06);
    const bl = new THREE.Mesh(brakeGeo, brakeMat);
    bl.position.set(-0.55, 0.58, 1.9);
    const br = bl.clone();
    br.position.x = 0.55;
    this.root.add(bl, br);

    // drift spark / boost flame effect
    this.boostFlames = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: "#3fd1ff", transparent: true, opacity: 0 });
    for (const side of [-0.38, 0.38]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.85, 8), flameMat.clone());
      flame.rotation.x = -Math.PI / 2;
      flame.position.set(side, 0.42, 2.0);
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
    this._bobPhase = Math.random() * Math.PI * 2;
  }

  addToScene(scene) {
    scene.add(this.root);
  }

  /** World-space positions of the rear wheel contact points (for skid trails). */
  getRearWheelPositions() {
    return [this.wheels.rl, this.wheels.rr].map((w) => {
      const p = new THREE.Vector3();
      w.getWorldPosition(p);
      p.y = 0.05;
      return p;
    });
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

    // subtle idle suspension bob, faster and slightly stronger with speed
    const speedRatio = Math.min(1, Math.abs(state.speed) / 32);
    this._bobPhase += dt * (3 + speedRatio * 6);
    const bob = Math.sin(this._bobPhase) * (0.012 + speedRatio * 0.01);

    this.tiltGroup.rotation.set(this._currentTilt, 0, this._currentLean);
    this.tiltGroup.position.y = bob;

    // wheel steering visual (front wheels turn with steering input; negated
    // to match Physics.js's heading convention - see the note there)
    const steerAngle = -state.steerVisual * 0.5;
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
