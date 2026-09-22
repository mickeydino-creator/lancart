import * as THREE from "three";

export const PHYSICS = {
  maxSpeed: 32, // m/s, normal top speed
  maxReverseSpeed: 11,
  engineForce: 26,
  brakeForce: 38,
  reverseForce: 20,
  rollingFriction: 0.5, // 1/s decay when coasting
  dragCoeff: 0.0022,
  baseTurnRate: 2.15, // rad/s at full grip - moderate, predictable sensitivity
  lowSpeedTurnFloor: 3, // m/s below which turning authority ramps from 0
  driftTurnMultiplier: 1.35,
  driftSlipAngle: 0.3, // tamer slide than a full oversteer spin
  driftMinSpeed: 8,
  driftChargeLevel1: 0.7, // seconds held to reach mini-boost
  driftChargeLevel2: 1.6, // seconds held to reach super-boost
  boostSpeedLevel1: 1.18,
  boostSpeedLevel2: 1.32,
  boostDurationLevel1: 0.9,
  boostDurationLevel2: 1.5,
  manualBoostMultiplier: 1.3,
  manualBoostDrain: 0.6, // fuel per second
  manualBoostRegen: 0.18, // fuel per second when not boosting
  offRoadDrag: 2.6,
  barrierMargin: 0.4,
  kartRadius: 1.0,
  collisionSpeedRetention: 0.78, // softer barrier hits, less frustrating
};

export function createKartState(position, heading) {
  return {
    position: position.clone(),
    heading,
    moveHeading: heading,
    speed: 0,
    angularVelocity: 0,
    steeringSmoothed: 0,
    forwardAccel: 0,
    steerVisual: 0,
    braking: false,
    isDrifting: false,
    driftDirection: 0,
    driftCharge: 0,
    driftBoostLevel: 0,
    isBoosting: false,
    boostTimer: 0,
    boostSpeedMult: 1,
    manualBoostFuel: 1,
    offRoad: false,
    collisionImpulse: 0,
    trackSampleHint: null,
  };
}

/**
 * Advance one kart's physics state by dt using abstract input values
 * ({steering, throttle, brake, drift, boost}, each 0..1 or -1..1).
 */
export function stepKartPhysics(state, input, dt, track) {
  const prevSpeed = state.speed;

  // --- Drift state machine -------------------------------------------------
  const wantsDrift = input.drift && Math.abs(input.steering) > 0.05 && Math.abs(state.speed) > PHYSICS.driftMinSpeed;
  if (wantsDrift && !state.isDrifting) {
    state.isDrifting = true;
    state.driftDirection = Math.sign(input.steering);
    state.driftCharge = 0;
  }
  if (state.isDrifting) {
    if (!input.drift || Math.abs(state.speed) <= PHYSICS.driftMinSpeed * 0.6) {
      // release drift -> grant boost based on charge
      if (state.driftCharge >= PHYSICS.driftChargeLevel2) {
        state.isBoosting = true;
        state.boostTimer = PHYSICS.boostDurationLevel2;
        state.boostSpeedMult = PHYSICS.boostSpeedLevel2;
      } else if (state.driftCharge >= PHYSICS.driftChargeLevel1) {
        state.isBoosting = true;
        state.boostTimer = PHYSICS.boostDurationLevel1;
        state.boostSpeedMult = PHYSICS.boostSpeedLevel1;
      }
      state.isDrifting = false;
      state.driftDirection = 0;
      state.driftCharge = 0;
      state.driftBoostLevel = 0;
    } else {
      state.driftCharge += dt;
      state.driftBoostLevel = state.driftCharge >= PHYSICS.driftChargeLevel2 ? 2 : state.driftCharge >= PHYSICS.driftChargeLevel1 ? 1 : 0;
    }
  }

  // --- Manual boost ---------------------------------------------------------
  if (input.boost && state.manualBoostFuel > 0.02 && !state.isDrifting) {
    state.isBoosting = true;
    state.boostTimer = 0.15; // refresh each frame while held
    state.boostSpeedMult = PHYSICS.manualBoostMultiplier;
    state.manualBoostFuel = Math.max(0, state.manualBoostFuel - PHYSICS.manualBoostDrain * dt);
  } else {
    state.manualBoostFuel = Math.min(1, state.manualBoostFuel + PHYSICS.manualBoostRegen * dt);
  }

  if (state.boostTimer > 0) {
    state.boostTimer -= dt;
    if (state.boostTimer <= 0) {
      state.isBoosting = false;
      state.boostSpeedMult = 1;
    }
  }

  // --- Longitudinal (speed) ---------------------------------------------------
  const effectiveMax = PHYSICS.maxSpeed * (state.isBoosting ? state.boostSpeedMult : 1) * (state.offRoad ? 0.6 : 1);
  state.braking = false;
  if (input.throttle > 0) {
    // Taper acceleration as the kart approaches top speed so it climbs to
    // speed with a natural curve instead of a flat ramp that hard-clamps.
    const headroom = THREE.MathUtils.clamp(1 - Math.max(0, state.speed) / effectiveMax, 0.15, 1);
    state.speed += PHYSICS.engineForce * input.throttle * headroom * dt;
  } else if (input.brake > 0) {
    if (state.speed > 0.5) {
      state.speed -= PHYSICS.brakeForce * input.brake * dt;
      state.braking = true;
    } else {
      state.speed -= PHYSICS.reverseForce * input.brake * dt;
    }
  } else {
    const decay = Math.max(0, 1 - PHYSICS.rollingFriction * dt);
    state.speed *= decay;
    if (Math.abs(state.speed) < 0.05) state.speed = 0;
  }

  // aerodynamic + off-road drag
  const drag = (PHYSICS.dragCoeff + (state.offRoad ? PHYSICS.offRoadDrag * 0.01 : 0)) * state.speed * Math.abs(state.speed);
  state.speed -= drag * dt * Math.sign(state.speed || 1);

  state.speed = THREE.MathUtils.clamp(state.speed, -PHYSICS.maxReverseSpeed, effectiveMax);

  state.forwardAccel = (state.speed - prevSpeed) / Math.max(dt, 1e-4);

  // --- Lateral (steering / drift) ---------------------------------------------
  // Steering is smoothed (rate-limited) before it drives rotation so full-lock
  // taps don't cause twitchy snap-turns; this is what makes "moderate
  // sensitivity" possible while keeping instantaneous response to input.
  const steerRate = state.isDrifting ? 8 : 12;
  state.steeringSmoothed = THREE.MathUtils.lerp(
    state.steeringSmoothed ?? 0,
    input.steering,
    Math.min(1, dt * steerRate)
  );

  const speedFactor = THREE.MathUtils.clamp(Math.abs(state.speed) / PHYSICS.lowSpeedTurnFloor, 0, 1);
  // Turning authority tapers off at very high speed so full-lock turns stay
  // controllable instead of snapping the kart into a spin.
  const highSpeedFactor = THREE.MathUtils.clamp(1 - (Math.abs(state.speed) / PHYSICS.maxSpeed) * 0.45, 0.55, 1);
  const reverseSign = state.speed < 0 ? -1 : 1;
  const driftMult = state.isDrifting ? PHYSICS.driftTurnMultiplier : 1;
  // NOTE: negated so positive steering (D / Right, turning right on screen)
  // actually rotates the kart's heading toward the camera's right side -
  // heading is measured as atan2(x, z), and world -X is screen-right for a
  // kart facing +Z, so a rightward turn must DECREASE heading.
  state.angularVelocity = -state.steeringSmoothed * PHYSICS.baseTurnRate * speedFactor * highSpeedFactor * driftMult * reverseSign;
  state.heading += state.angularVelocity * dt;
  state.steerVisual = THREE.MathUtils.lerp(state.steerVisual, input.steering, Math.min(1, dt * 10));

  // Slide angle during a drift: the kart's travel direction lags behind
  // (stays straighter than) its nose, so the tail visually slides wide.
  const targetSlip = state.isDrifting ? state.driftDirection * PHYSICS.driftSlipAngle : 0;
  state.moveHeading = THREE.MathUtils.lerp(state.moveHeading ?? state.heading, state.heading + targetSlip, Math.min(1, dt * 6));

  // --- Integrate position -------------------------------------------------
  const dir = new THREE.Vector3(Math.sin(state.moveHeading), 0, Math.cos(state.moveHeading));
  state.position.addScaledVector(dir, state.speed * dt);

  // --- Track boundary + elevation follow -----------------------------------
  if (track) {
    const info = track.getTrackInfo(state.position, state.trackSampleHint);
    state.trackSampleHint = info.sampleIndex;
    const half = track.roadWidth / 2;
    state.offRoad = Math.abs(info.lateral) > half;
    const limit = half + PHYSICS.barrierMargin;
    if (Math.abs(info.lateral) > limit) {
      const clampedLateral = Math.sign(info.lateral) * limit;
      const correction = clampedLateral - info.lateral;
      state.position.addScaledVector(info.right, correction);
      state.speed *= PHYSICS.collisionSpeedRetention;
      state.collisionImpulse = Math.max(state.collisionImpulse, Math.min(1, Math.abs(state.speed) / 10));
    }
    const targetY = info.elevation + 0.32;
    state.position.y = THREE.MathUtils.lerp(state.position.y, targetY, Math.min(1, dt * 8));
  }

  state.collisionImpulse *= Math.max(0, 1 - dt * 4);
}

/** Simple circle-circle push-apart collision between karts. */
export function resolveKartCollisions(states) {
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const a = states[i];
      const b = states[j];
      const delta = new THREE.Vector3().subVectors(a.position, b.position);
      delta.y = 0;
      const dist = delta.length();
      const minDist = PHYSICS.kartRadius * 2;
      if (dist > 0 && dist < minDist) {
        const overlap = minDist - dist;
        const push = delta.normalize().multiplyScalar(overlap / 2);
        a.position.add(push);
        b.position.sub(push);
        const speedLoss = 0.93;
        a.speed *= speedLoss;
        b.speed *= speedLoss;
        a.collisionImpulse = Math.max(a.collisionImpulse, 0.6);
        b.collisionImpulse = Math.max(b.collisionImpulse, 0.6);
      }
    }
  }
}
