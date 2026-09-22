import * as THREE from "three";

/**
 * Smooth third-person chase camera: follows behind the kart with lag,
 * pulls back at speed, and can be shaken on collisions/boosts.
 */
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.currentPos = new THREE.Vector3();
    this.currentLook = new THREE.Vector3();
    this._initialized = false;
    this.shakeTime = 0;
    this.shakeStrength = 0;
    this.baseDistance = 6.5;
    this.baseHeight = 2.6;
  }

  shake(strength = 0.4, duration = 0.25) {
    this.shakeStrength = Math.max(this.shakeStrength, strength);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  update(state, dt) {
    const speedRatio = THREE.MathUtils.clamp(Math.abs(state.speed) / 34, 0, 1);
    const distance = this.baseDistance + speedRatio * 2.4;
    const height = this.baseHeight + speedRatio * 0.5;

    const behind = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading)).multiplyScalar(-distance);
    const desiredPos = state.position.clone().add(behind).add(new THREE.Vector3(0, height, 0));

    const lookTarget = state.position.clone().add(new THREE.Vector3(0, 1.1, 0));
    const forwardLook = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading)).multiplyScalar(speedRatio * 3);
    lookTarget.add(forwardLook);

    if (!this._initialized) {
      this.currentPos.copy(desiredPos);
      this.currentLook.copy(lookTarget);
      this._initialized = true;
    }

    const posLag = 1 - Math.pow(0.0001, dt);
    const lookLag = 1 - Math.pow(0.00005, dt);
    this.currentPos.lerp(desiredPos, posLag);
    this.currentLook.lerp(lookTarget, lookLag);

    let renderPos = this.currentPos;
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const s = this.shakeStrength * (this.shakeTime > 0 ? 1 : 0);
      renderPos = this.currentPos.clone().add(
        new THREE.Vector3(
          (Math.random() - 0.5) * s,
          (Math.random() - 0.5) * s,
          (Math.random() - 0.5) * s
        )
      );
      if (this.shakeTime <= 0) this.shakeStrength = 0;
    }

    this.camera.position.copy(renderPos);
    this.camera.lookAt(this.currentLook);
  }
}
