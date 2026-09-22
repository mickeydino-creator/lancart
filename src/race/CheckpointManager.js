/**
 * Tracks each kart's progress through the track's checkpoint sequence so a
 * lap can only be completed by actually driving the loop (no shortcutting),
 * and produces a continuous "distance traveled" value used for race
 * position ranking.
 *
 * Checkpoint 0 is the start/finish line. A kart starts needing checkpoint 1,
 * must hit every checkpoint in order, and only completes a lap by finally
 * reaching checkpoint 0 again.
 */
export class CheckpointManager {
  constructor(track, kartCount) {
    this.track = track;
    this.radius = track.roadWidth * 1.1;
    this.count = kartCount;
    this.reset();
  }

  reset() {
    this.nextCheckpoint = new Array(this.count).fill(1);
    this.lapCount = new Array(this.count).fill(0);
    this.distance = new Array(this.count).fill(0);
  }

  /**
   * Call once per kart per frame, after physics has stepped `state`.
   * Returns true the frame a lap is completed.
   */
  update(kartIndex, state) {
    const checkpoints = this.track.checkpoints;
    const targetIndex = this.nextCheckpoint[kartIndex];
    const target = checkpoints[targetIndex];
    let lapCompleted = false;

    if (state.position.distanceTo(target.position) < this.radius) {
      if (targetIndex === 0) {
        this.lapCount[kartIndex] += 1;
        lapCompleted = true;
      }
      this.nextCheckpoint[kartIndex] = (targetIndex + 1) % checkpoints.length;
    }

    // Physics already resolved this kart's nearest track sample this frame;
    // reuse it instead of re-searching the whole loop.
    const arcLength = this.track.samples[state.trackSampleHint ?? 0].arcLength;
    this.distance[kartIndex] = this.lapCount[kartIndex] * this.track.totalLength + arcLength;

    return lapCompleted;
  }

  getLap(kartIndex) {
    return this.lapCount[kartIndex];
  }

  getDistance(kartIndex) {
    return this.distance[kartIndex];
  }
}
