import * as THREE from "three";

// Waypoints for "Sunset Circuit": long straight, hill climb, sweeping curves,
// a hairpin, and a descent back to the start/finish straight.
const WAYPOINTS = [
  [0, 0, 0],
  [0, 0, -35],
  [0, 0, -70],
  [18, 0.5, -92],
  [45, 2.5, -98],
  [68, 6, -88],
  [80, 9.5, -62],
  [78, 9.5, -35],
  [64, 7, -10],
  [42, 4, 8],
  [18, 1, 18],
  [-8, 0, 14],
  [-30, 0, -2],
  [-40, 0, -20],
  [-46, 0, -45],
  [-38, 0, -68],
  [-18, 0, -75],
  [-6, 0, -55],
  [-4, 0, -25],
];

const ROAD_WIDTH = 15;
const SEGMENTS = 400; // dense arc-length samples around the closed loop
const CHECKPOINT_COUNT = 12;

function buildCurve() {
  const points = WAYPOINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  return new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.5);
}

function sampleTrack(curve) {
  // Build arc-length-parameterized samples so distance-along-track and
  // nearest-point queries are cheap and uniform.
  const raw = curve.getSpacedPoints(SEGMENTS);
  const samples = [];
  let cumulative = 0;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const next = raw[(i + 1) % raw.length];
    if (i > 0) cumulative += p.distanceTo(raw[i - 1]);
    const tangent = next.clone().sub(p).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
    samples.push({ position: p, tangent, right, arcLength: cumulative });
  }
  samples.totalLength = cumulative + raw[0].distanceTo(raw[raw.length - 1]);
  return samples;
}

function asphaltTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3a3d42";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const shade = 55 + Math.floor(Math.random() * 20);
    ctx.fillStyle = `rgb(${shade},${shade},${shade + 2})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  // lane dashes down the center
  ctx.fillStyle = "#e8d97a";
  const dashW = size * 0.035;
  ctx.fillRect(size / 2 - dashW / 2, 0, dashW, size * 0.5);
  // edge lines
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(size * 0.06, 0, size * 0.02, size);
  ctx.fillRect(size * 0.94 - size * 0.02, 0, size * 0.02, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function grassTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#4c9a3a";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    const shade = Math.random();
    ctx.fillStyle = shade > 0.5 ? "#5aab45" : "#428a33";
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildRoadMesh(samples) {
  const half = ROAD_WIDTH / 2;
  const positions = [];
  const uvs = [];
  const indices = [];
  const n = samples.length;
  const lengthTiling = samples.totalLength / (ROAD_WIDTH * 1.3);

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const left = s.position.clone().addScaledVector(s.right, -half);
    const right = s.position.clone().addScaledVector(s.right, half);
    positions.push(left.x, left.y + 0.02, left.z);
    positions.push(right.x, right.y + 0.02, right.z);
    const v = (i / n) * lengthTiling;
    uvs.push(0, v, 1, v);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = ((i + 1) % n) * 2;
    const d = ((i + 1) % n) * 2 + 1;
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    map: asphaltTexture(),
    roughness: 0.95,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function buildStartFinishStripe(samples) {
  const half = ROAD_WIDTH / 2;
  const s = samples[0];
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#f4f4f4" : "#151515";
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  const geometry = new THREE.PlaneGeometry(ROAD_WIDTH, 3);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(geometry, mat);
  // Local X (plane width) -> track right vector, local Y (plane height) -> tangent,
  // local Z (plane normal) -> world up, so the stripe lies flat across the road.
  const basis = new THREE.Matrix4().makeBasis(s.right, s.tangent, new THREE.Vector3(0, 1, 0));
  mesh.quaternion.setFromRotationMatrix(basis);
  mesh.position.copy(s.position).add(new THREE.Vector3(0, 0.03, 0));
  mesh.position.addScaledVector(s.tangent, 0.2);
  return mesh;
}

function buildGround(curve) {
  const box = new THREE.Box3().setFromPoints(curve.getPoints(200));
  const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) + 220;
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  const tex = grassTexture();
  tex.repeat.set(size / 12, size / 12);
  const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    (box.max.x + box.min.x) / 2,
    -0.05,
    (box.max.z + box.min.z) / 2
  );
  mesh.receiveShadow = true;
  return mesh;
}

function buildBarriers(samples) {
  const half = ROAD_WIDTH / 2 + 0.6;
  const geometry = new THREE.BoxGeometry(0.5, 0.9, 2.1);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const step = 2; // place a segment every 2 samples for a continuous rail look
  const count = Math.ceil(samples.length / step) * 2;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const color = new THREE.Color();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let idx = 0;
  for (let i = 0; i < samples.length; i += step) {
    const s = samples[i];
    const stripe = Math.floor(i / step) % 2 === 0;
    for (const side of [-1, 1]) {
      const pos = s.position.clone().addScaledVector(s.right, side * half);
      pos.y += 0.5;
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.tangent);
      m.compose(pos, q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(idx, m);
      color.set(stripe ? "#e6e6e6" : "#e03a3a");
      mesh.setColorAt(idx, color);
      idx++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function makeTreeGeometry() {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.35, 2, 6),
    new THREE.MeshStandardMaterial({ color: "#6b4423", roughness: 1 })
  );
  trunk.position.y = 1;
  const leaves = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 3.2, 8),
    new THREE.MeshStandardMaterial({ color: "#2f7d3c", roughness: 0.9 })
  );
  leaves.position.y = 3.2;
  const leaves2 = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 2.4, 8),
    new THREE.MeshStandardMaterial({ color: "#3a9048", roughness: 0.9 })
  );
  leaves2.position.y = 4.4;
  group.add(trunk, leaves, leaves2);
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

function makeRockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: "#8b8d94", flatShading: true, roughness: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeSignGeometry(text) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6),
    new THREE.MeshStandardMaterial({ color: "#cccccc" })
  );
  pole.position.y = 1.3;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffd23f";
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = "#14181f";
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(canvas);
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.8),
    new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide })
  );
  board.position.y = 2.3;
  group.add(pole, board);
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return group;
}

function scatterDecorations(scene, samples, curve) {
  const group = new THREE.Group();
  group.name = "decorations";
  const signTexts = ["TURN", "SLOW", "GO!", "50m"];
  let signIdx = 0;

  for (let i = 0; i < samples.length; i += 5) {
    const s = samples[i];
    // skip decorations too close to the start/finish grid
    if (i < 8 || i > samples.length - 8) continue;

    for (const side of [-1, 1]) {
      if (Math.random() < 0.35) continue; // leave gaps, avoid a wall of props
      const dist = 5 + Math.random() * 10;
      const pos = s.position.clone().addScaledVector(s.right, side * (ROAD_WIDTH / 2 + dist));
      const roll = Math.random();
      let obj;
      if (roll < 0.55) {
        obj = makeTreeGeometry();
        const scale = 0.8 + Math.random() * 0.6;
        obj.scale.setScalar(scale);
      } else if (roll < 0.85) {
        obj = makeRockGeometry();
        const scale = 0.6 + Math.random() * 1.1;
        obj.scale.set(scale, scale * 0.8, scale);
        obj.rotation.y = Math.random() * Math.PI;
      } else {
        obj = makeSignGeometry(signTexts[signIdx % signTexts.length]);
        signIdx++;
        obj.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) + (side > 0 ? Math.PI : 0);
      }
      obj.position.copy(pos);
      group.add(obj);
    }
  }
  scene.add(group);
  return group;
}

function buildStartLights(samples) {
  const group = new THREE.Group();
  const s = samples[0];
  const gantryWidth = ROAD_WIDTH + 2;
  const postMat = new THREE.MeshStandardMaterial({ color: "#2a2e35" });
  const leftPost = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 8), postMat);
  const rightPost = leftPost.clone();
  leftPost.position.copy(s.position).addScaledVector(s.right, -gantryWidth / 2);
  rightPost.position.copy(s.position).addScaledVector(s.right, gantryWidth / 2);
  leftPost.position.y += 3;
  rightPost.position.y += 3;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(gantryWidth + 0.6, 0.4, 0.4), postMat);
  beam.position.copy(s.position);
  beam.position.y += 6;
  const beamBasis = new THREE.Matrix4().makeBasis(s.right, new THREE.Vector3(0, 1, 0), s.tangent);
  beam.quaternion.setFromRotationMatrix(beamBasis);

  const lights = [];
  const lightGeo = new THREE.SphereGeometry(0.35, 12, 12);
  for (let i = -1; i <= 1; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: "#3a0d0d", emissive: "#3a0d0d", emissiveIntensity: 1 });
    const bulb = new THREE.Mesh(lightGeo, mat);
    bulb.position.copy(s.position);
    bulb.position.addScaledVector(s.right, i * 1.2);
    bulb.position.y += 5.3;
    lights.push(bulb);
    group.add(bulb);
  }

  group.add(leftPost, rightPost, beam);
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return { group, lights };
}

function buildCheckpoints(samples) {
  const checkpoints = [];
  const n = samples.length;
  const step = Math.floor(n / CHECKPOINT_COUNT);
  for (let c = 0; c < CHECKPOINT_COUNT; c++) {
    const i = (c * step) % n;
    const s = samples[i];
    checkpoints.push({
      index: c,
      position: s.position.clone(),
      arcLength: s.arcLength,
      sampleIndex: i,
    });
  }
  return checkpoints;
}

export class Track {
  constructor(scene) {
    this.scene = scene;
    this.curve = buildCurve();
    this.samples = sampleTrack(this.curve);
    this.roadWidth = ROAD_WIDTH;
    this.totalLength = this.samples.totalLength;

    this.group = new THREE.Group();
    this.group.add(buildGround(this.curve));
    this.group.add(buildRoadMesh(this.samples));
    this.group.add(buildStartFinishStripe(this.samples));
    this.group.add(buildBarriers(this.samples));
    scene.add(this.group);

    scatterDecorations(scene, this.samples, this.curve);

    const { group: lightsGroup, lights } = buildStartLights(this.samples);
    scene.add(lightsGroup);
    this.startLights = lights;

    this.checkpoints = buildCheckpoints(this.samples);

    const s0 = this.samples[0];
    this.startPosition = s0.position.clone().add(new THREE.Vector3(0, 0.4, 0));
    this.startHeading = Math.atan2(s0.tangent.x, s0.tangent.z);
  }

  /**
   * Grid start position for a given kart index (0 = pole position).
   * Walks backward along the actual sampled curve (not a straight-line
   * extrapolation) so grid slots stay on the road even where the track
   * curves sharply right behind the start line.
   */
  getGridPosition(index) {
    const n = this.samples.length;
    const metersPerSample = this.totalLength / n;
    const row = Math.floor(index / 2);
    const side = index % 2 === 0 ? -1 : 1;
    const distanceBehind = row * 4.5 + 3;
    const sampleOffset = Math.round(distanceBehind / metersPerSample);
    const s = this.samples[((0 - sampleOffset) % n + n) % n];
    const pos = s.position.clone();
    pos.addScaledVector(s.right, side * 2.8);
    pos.y += 0.4;
    const heading = Math.atan2(s.tangent.x, s.tangent.z);
    return { position: pos, heading };
  }

  /**
   * Nearest sample to a world position, used for road-following & collision.
   * Distance is measured on the horizontal (x,z) plane only: elevation
   * differences must never make a distant, unrelated arc of the loop look
   * "closer" than the section of road the kart is actually driving on.
   *
   * When a `hint` sample index is given (the kart's last known position on
   * the loop), the search stays within a local window around it instead of
   * scanning the whole track. This keeps a kart "locked on" to the arc of
   * the loop it is actually driving, which matters because this track's
   * loop passes near itself in plan view (e.g. a hill overlapping the
   * start straight) - a full scan could otherwise snap a kart's reference
   * point onto the wrong, unrelated stretch of road.
   */
  nearestSample(position, hint = null) {
    const n = this.samples.length;
    const scanFull = hint == null;
    const window = 60;
    let best = 0;
    let bestDist = Infinity;
    if (scanFull) {
      for (let i = 0; i < n; i++) {
        const p = this.samples[i].position;
        const dx = p.x - position.x;
        const dz = p.z - position.z;
        const d = dx * dx + dz * dz;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
    } else {
      for (let o = -window; o <= window; o++) {
        const i = ((hint + o) % n + n) % n;
        const p = this.samples[i].position;
        const dx = p.x - position.x;
        const dz = p.z - position.z;
        const d = dx * dx + dz * dz;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
    }
    return best;
  }

  /** Returns lateral offset (signed, +right), forward tangent, and arc length at a position. */
  getTrackInfo(position, hint = null) {
    const i = this.nearestSample(position, hint);
    const s = this.samples[i];
    const toPoint = position.clone().sub(s.position);
    const lateral = toPoint.dot(s.right);
    const elevation = s.position.y;
    return {
      sampleIndex: i,
      arcLength: s.arcLength,
      lateral,
      tangent: s.tangent,
      right: s.right,
      centerPosition: s.position,
      elevation,
    };
  }
}
