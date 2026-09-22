import * as THREE from "three";

function shortestAngleLerp(from, to, t) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

/**
 * Smooth third-person chase camera: follows behind the kart with lag,
 * pulls back at speed, and can be shaken on collisions/boosts. Position AND
 * the orbit angle are both lagged (not just position) so the camera swings
 * behind the kart through a turn instead of snapping to face it instantly -
 * that swing is what reads as "the camera turns naturally with the kart"
 * rather than feeling rigidly bolted on.
 */
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.baseFov = camera.fov;
    this.currentPos = new THREE.Vector3();
    this.currentLook = new THREE.Vector3();
    this.smoothedHeading = 0;
    this._initialized = false;
    this.shakeTime = 0;
    this.shakeStrength = 0;
    this.baseDistance = 7.2;
    this.baseHeight = 3.05;
  }

  shake(strength = 0.4, duration = 0.25) {
    this.shakeStrength = Math.max(this.shakeStrength, strength);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  update(state, dt) {
    const speedRatio = THREE.MathUtils.clamp(Math.abs(state.speed) / 32, 0, 1);

    if (!this._initialized) {
      this.smoothedHeading = state.heading;
    } else {
      // Slight rotational lag: the camera catches up to the kart's heading
      // rather than snapping instantly, which is what makes it feel like it
      // is swinging around behind the kart through a corner.
      const headingLag = 1 - Math.pow(0.0007, dt);
      this.smoothedHeading = shortestAngleLerp(this.smoothedHeading, state.heading, headingLag);
    }

    const distance = this.baseDistance + speedRatio * 1.8;
    const height = this.baseHeight + speedRatio * 0.35;

    const behind = new THREE.Vector3(Math.sin(this.smoothedHeading), 0, Math.cos(this.smoothedHeading)).multiplyScalar(
      -distance
    );
    const desiredPos = state.position.clone().add(behind).add(new THREE.Vector3(0, height, 0));

    const lookTarget = state.position.clone().add(new THREE.Vector3(0, 1.05, 0));
    const forwardLook = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading)).multiplyScalar(
      speedRatio * 2.5
    );
    lookTarget.add(forwardLook);

    if (!this._initialized) {
      this.currentPos.copy(desiredPos);
      this.currentLook.copy(lookTarget);
      this._initialized = true;
    }

    const posLag = 1 - Math.pow(0.00035, dt);
    const lookLag = 1 - Math.pow(0.0002, dt);
    this.currentPos.lerp(desiredPos, posLag);
    this.currentLook.lerp(lookTarget, lookLag);

    let renderPos = this.currentPos;
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const s = this.shakeStrength * (this.shakeTime > 0 ? 1 : 0);
      renderPos = this.currentPos.clone().add(
        new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s)
      );
      if (this.shakeTime <= 0) this.shakeStrength = 0;
    }

    this.camera.position.copy(renderPos);
    this.camera.lookAt(this.currentLook);

    // Subtle FOV widen at speed - a cheap, tasteful sense of velocity
    // without any post-processing.
    const targetFov = this.baseFov + speedRatio * 6;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 4));
    this.camera.updateProjectionMatrix();
  }
}
