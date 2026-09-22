import * as THREE from "three";

/**
 * Very lightweight rubber-band AI: aims at a lookahead point on the track
 * centerline and throttles toward a per-kart target speed. Produces the
 * same abstract input shape a real InputManager source would.
 */
export class AIController {
  constructor(track, { skill = 1, lookahead = 20, laneOffset = 0 } = {}) {
    this.track = track;
    this.skill = skill;
    this.lookahead = lookahead;
    // Each AI aims for a slightly different line across the road width so a
    // pack of karts doesn't all converge on the exact same racing line and
    // permanently jam into each other.
    this.laneOffset = laneOffset;
  }

  computeInput(state) {
    const info = this.track.getTrackInfo(state.position, state.trackSampleHint);
    const sampleCount = this.track.samples.length;
    const aheadIndex = (info.sampleIndex + this.lookahead) % sampleCount;
    const aheadSample = this.track.samples[aheadIndex];
    const target = aheadSample.position.clone().addScaledVector(aheadSample.right, this.laneOffset);

    const toTarget = new THREE.Vector3().subVectors(target, state.position);
    const desiredHeading = Math.atan2(toTarget.x, toTarget.z);
    let diff = desiredHeading - state.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const steering = THREE.MathUtils.clamp(diff * 1.1, -1, 1);
    const sharpTurn = Math.abs(diff) > 0.6;
    const throttle = THREE.MathUtils.clamp(1 - Math.abs(diff) * 0.4, 0.6, 1) * this.skill;

    return {
      steering,
      throttle,
      brake: 0,
      drift: false,
      boost: !sharpTurn && Math.random() < 0.01,
      pause: false,
    };
  }
}
