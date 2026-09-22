import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cloneScene } from "../assets/AssetLoader.js";

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
  [-2, 0, 22],
  [-36, 0, -4],
  [-50, 0, -24],
  [-56, 0, -50],
  [-44, 0, -72],
  [-18, 0, -75],
  [-22, 0, -50],
  [-24, 0, -18],
];

const ROAD_WIDTH = 15;
const SEGMENTS = 400; // dense arc-length samples around the closed loop
const CHECKPOINT_COUNT = 12;

// A compact loop can pass close to itself elsewhere on the lap even after
// locally reshaping the tight spots (see isClearOfRoad below) - scaling the
// whole layout out from the start point multiplies every pairwise distance
// between samples by the same factor, so it enlarges every close pass at
// once instead of chasing them one at a time. Keeps the same shape/flavor,
// just bigger.
const LAYOUT_SCALE = 1.7;

function buildCurve() {
  const points = WAYPOINTS.map((p) => new THREE.Vector3(p[0] * LAYOUT_SCALE, p[1], p[2] * LAYOUT_SCALE));
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

// --- Shared ground elevation -----------------------------------------------
//
// Both the ground mesh AND every decoration placed on it need to agree on
// "how high is the terrain at this (x,z) point" - otherwise decorations
// scattered near an elevated stretch of road end up floating above a flat
// ground plane that never rises to meet them (the flat plane used to be
// the only source of ground height, entirely independent of the track's
// own elevation, which is what produced both the floating-road-on-a-cliff
// look and floating trees/rocks near the hill climb).

const GROUND_BASE_Y = -0.12;
const ELEVATION_INFLUENCE_RADIUS = 42;
const ELEVATION_SAMPLE_STRIDE = 4;

function groundElevationAt(x, z, samples) {
  let bestDistSq = Infinity;
  let bestElevation = 0;
  for (let i = 0; i < samples.length; i += ELEVATION_SAMPLE_STRIDE) {
    const p = samples[i].position;
    const dx = p.x - x;
    const dz = p.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      bestElevation = p.y;
    }
  }
  const d = Math.sqrt(bestDistSq);
  const t = THREE.MathUtils.clamp(1 - d / ELEVATION_INFLUENCE_RADIUS, 0, 1);
  const smooth = t * t * (3 - 2 * t);
  return bestElevation * smooth + GROUND_BASE_Y;
}

// Road clearance a roadside prop needs from the CLOSEST point of the track
// anywhere on the lap, not just the sample it was placed relative to - a
// compact circuit can pass close to itself elsewhere (see the reshaped
// return leg), so a prop offset from its "local" sample can still land on
// a different, nearer stretch of the same road. half-road-width + trimmed
// curb footprint + a buffer.
const ROAD_CLEAR_DISTANCE = ROAD_WIDTH / 2 + 0.9;

function isClearOfRoad(x, z, samples, minDist = ROAD_CLEAR_DISTANCE) {
  const minDistSq = minDist * minDist;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i].position;
    const dx = p.x - x;
    const dz = p.z - z;
    if (dx * dx + dz * dz < minDistSq) return false;
  }
  return true;
}

// --- Textures ----------------------------------------------------------------

function asphaltTexture() {
  // Deliberately dark, low-saturation asphalt: under any lighting this
  // stays far darker than the grass, so the road never blends into the
  // environment. Wide, bright edge lines give a second, independent visual
  // cue that survives even at grazing viewing angles.
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, "#17181b");
  grad.addColorStop(0.5, "#212327");
  grad.addColorStop(1, "#17181b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 3200; i++) {
    const shade = 26 + Math.floor(Math.random() * 18);
    ctx.fillStyle = `rgba(${shade},${shade},${shade + 2},0.5)`;
    const w = 1 + Math.random() * 2.5;
    ctx.fillRect(Math.random() * size, Math.random() * size, w, w);
  }
  // subtle tire scuff streaks along the racing line
  ctx.strokeStyle = "rgba(8,8,10,0.25)";
  ctx.lineWidth = 6;
  for (let i = 0; i < 10; i++) {
    const x = size * 0.3 + Math.random() * size * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 40, size);
    ctx.stroke();
  }
  // dashed center line
  ctx.fillStyle = "#ffe27a";
  const dashW = size * 0.028;
  for (let y = 0; y < size; y += size / 6) {
    ctx.fillRect(size / 2 - dashW / 2, y, dashW, size / 10);
  }
  // wide, bright edge lines - the road's edge must always read clearly,
  // even when the fill color's contrast is reduced by dynamic lighting
  ctx.fillStyle = "#f5f7fa";
  const edgeW = size * 0.04;
  ctx.fillRect(size * 0.03, 0, edgeW, size);
  ctx.fillRect(size * 0.97 - edgeW, 0, edgeW, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function curbTexture() {
  // Red/white rumble-strip curb running along the road edges.
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  for (let x = 0; x < size; x += 16) {
    ctx.fillStyle = (x / 16) % 2 === 0 ? "#d13a3a" : "#f2f2f2";
    ctx.fillRect(x, 0, 16, 16);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function grassTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 1.4);
  grad.addColorStop(0, "#5fb14a");
  grad.addColorStop(1, "#4a9a3c");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5000; i++) {
    const shade = Math.random();
    ctx.fillStyle = shade > 0.6 ? "#69bd52" : shade > 0.3 ? "#54a844" : "#3f8f33";
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillRect(x, y, 2, 2 + Math.random() * 2);
  }
  // faint mown-lawn stripes
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let x = 0; x < size; x += 32) ctx.fillRect(x, 0, 16, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// --- Road / ground -------------------------------------------------------------

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
    roughness: 0.92,
    metalness: 0.03,
    // The ribbon's winding can twist relative to "up" on some curves
    // (the ruled surface between left/right offsets isn't guaranteed to
    // stay consistently wound through every turn), which silently
    // backface-culls the road from a low chase-cam angle. Double-siding
    // guarantees the road is never invisible, which matters far more than
    // the negligible cost for a single thin strip.
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** Thin curb ribbons hugging both edges of the road - a clean visual line
 * separating drivable road from the grass, and a track-day visual cue. */
function buildCurbs(samples) {
  const half = ROAD_WIDTH / 2;
  const curbWidth = 0.6;
  const n = samples.length;
  const group = new THREE.Group();
  const tex = curbTexture();
  tex.repeat.set(samples.totalLength / 2.4, 1);
  const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide });

  for (const side of [-1, 1]) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const inner = s.position.clone().addScaledVector(s.right, side * (half - curbWidth * 0.15));
      const outer = s.position.clone().addScaledVector(s.right, side * (half + curbWidth * 0.85));
      positions.push(inner.x, inner.y + 0.025, inner.z);
      positions.push(outer.x, outer.y + 0.025, outer.z);
      const u = (i / n) * (samples.totalLength / 2.4);
      uvs.push(u, 0, u, 1);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = ((i + 1) % n) * 2;
      const d = ((i + 1) % n) * 2 + 1;
      if (side > 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function buildStartFinishStripe(samples) {
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

/**
 * The ground is a subdivided grid whose vertices follow the track's own
 * elevation near the road (via groundElevationAt), blending down to a flat
 * plain far away. This is what makes an elevated stretch of road (the hill
 * climb) sit on a proper sloped hillside instead of floating in mid-air
 * over flat grass with a visible gap underneath - the single biggest
 * source of "floating" complaints (both the road itself and every
 * decoration placed near it).
 */
function buildGround(curve, samples) {
  const box = new THREE.Box3().setFromPoints(curve.getPoints(200));
  const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) + 260;
  const center = new THREE.Vector3((box.max.x + box.min.x) / 2, 0, (box.max.z + box.min.z) / 2);

  const segs = 56;
  const positions = [];
  const uvs = [];
  const indices = [];
  const half = size / 2;
  for (let gz = 0; gz <= segs; gz++) {
    for (let gx = 0; gx <= segs; gx++) {
      const x = center.x - half + (gx / segs) * size;
      const z = center.z - half + (gz / segs) * size;
      const y = groundElevationAt(x, z, samples);
      positions.push(x, y, z);
      uvs.push((x / 14) % 1000, (z / 14) % 1000);
    }
  }
  const cols = segs + 1;
  for (let gz = 0; gz < segs; gz++) {
    for (let gx = 0; gx < segs; gx++) {
      const a = gz * cols + gx;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const tex = grassTexture();
  tex.repeat.set(1, 1); // uvs already carry world-space tiling
  const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return { mesh, center, size };
}

// --- Barriers ------------------------------------------------------------------

/** A continuous red/white striped guardrail ribbon plus periodic support posts. */
function buildBarriers(samples) {
  const half = ROAD_WIDTH / 2 + 0.45;
  const railHeight = 0.62;
  const n = samples.length;
  const group = new THREE.Group();

  const stripeTex = curbTexture();
  stripeTex.repeat.set(samples.totalLength / 3.2, 1);
  const railMat = new THREE.MeshStandardMaterial({
    map: stripeTex,
    roughness: 0.55,
    metalness: 0.15,
    side: THREE.DoubleSide,
  });

  for (const side of [-1, 1]) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const base = s.position.clone().addScaledVector(s.right, side * half);
      const top = base.clone();
      top.y += railHeight;
      positions.push(base.x, base.y + 0.05, base.z, top.x, top.y, top.z);
      const outward = s.right.clone().multiplyScalar(side);
      normals.push(outward.x, outward.y, outward.z, outward.x, outward.y, outward.z);
      const u = (i / n) * (samples.totalLength / 3.2);
      uvs.push(u, 0, u, 1);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = ((i + 1) % n) * 2;
      const d = ((i + 1) % n) * 2 + 1;
      if (side > 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const mesh = new THREE.Mesh(geometry, railMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // support posts
  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, railHeight + 0.35, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.6, metalness: 0.3 });
  const step = 4;
  const postCount = Math.ceil(n / step) * 2;
  const posts = new THREE.InstancedMesh(postGeo, postMat, postCount);
  posts.castShadow = true;
  const m = new THREE.Matrix4();
  const identity = new THREE.Quaternion();
  let idx = 0;
  for (let i = 0; i < n; i += step) {
    const s = samples[i];
    for (const side of [-1, 1]) {
      const pos = s.position.clone().addScaledVector(s.right, side * half);
      pos.y += (railHeight + 0.1) / 2;
      m.compose(pos, identity, new THREE.Vector3(1, 1, 1));
      posts.setMatrixAt(idx, m);
      idx++;
    }
  }
  posts.instanceMatrix.needsUpdate = true;
  group.add(posts);

  return group;
}

// --- Instancing helper -----------------------------------------------------------

/**
 * Accumulates placements (matrix + optional per-instance color) for a single
 * geometry+material pair, then bakes them into one InstancedMesh - one draw
 * call for however many copies were placed, instead of one mesh per copy.
 */
class InstanceBatch {
  constructor(geometry, material, { useColor = false } = {}) {
    this.geometry = geometry;
    this.material = material;
    this.useColor = useColor;
    this.matrices = [];
    this.colors = [];
  }

  add(position, quaternion, scale, color) {
    this.matrices.push(new THREE.Matrix4().compose(position, quaternion, scale));
    if (this.useColor) this.colors.push(color ?? new THREE.Color(1, 1, 1));
  }

  build({ castShadow = true, receiveShadow = true } = {}) {
    if (this.matrices.length === 0) return null;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.matrices.length);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    for (let i = 0; i < this.matrices.length; i++) {
      mesh.setMatrixAt(i, this.matrices[i]);
      if (this.useColor) mesh.setColorAt(i, this.colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY_Q = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _scale = new THREE.Vector3();

// --- Decoration geometry templates (built once, instanced many times) ----------

/** Merges a tree's trunk+leaf meshes into a single geometry with baked
 * vertex colors, so every placement of this variant is one instance of one
 * draw call instead of several separate meshes. */
function buildRoundTreeGeometry() {
  const trunkColor = new THREE.Color("#6b4423");
  const leafColorA = new THREE.Color().setHSL(0.34, 0.48, 0.34);
  const leafColorB = new THREE.Color().setHSL(0.35, 0.5, 0.4);

  // mergeGeometries requires every part to agree on indexed-vs-not;
  // Cylinder/Icosahedron geometries don't, so normalize them all first.
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6).toNonIndexed();
  trunk.translate(0, 0.8, 0);
  paintVertexColor(trunk, trunkColor);
  parts.push(trunk);

  const blobs = [
    [0, 2.3, 0, 1.15, leafColorA],
    [0.55, 2.0, 0.2, 0.8, leafColorB],
    [-0.5, 2.05, -0.25, 0.85, leafColorA],
    [0.1, 2.75, -0.3, 0.75, leafColorB],
  ];
  for (const [x, y, z, r, color] of blobs) {
    const blob = new THREE.IcosahedronGeometry(r, 1).toNonIndexed();
    blob.translate(x, y, z);
    paintVertexColor(blob, color);
    parts.push(blob);
  }
  return mergeGeometries(parts, false);
}

function buildBushGeometry() {
  const color = new THREE.Color().setHSL(0.32, 0.4, 0.34);
  const offsets = [
    [-0.2, 0.32, 0.15, 0.55],
    [0.22, 0.3, -0.1, 0.5],
    [0, 0.4, -0.2, 0.42],
  ];
  const parts = offsets.map(([x, y, z, r]) => {
    const geo = new THREE.IcosahedronGeometry(r, 0).toNonIndexed();
    geo.translate(x, y, z);
    return geo;
  });
  const merged = mergeGeometries(parts, false);
  paintVertexColor(merged, color);
  return merged;
}

function buildRockGeometry() {
  const offsets = [
    [-0.2, 0.42, 0.1, 0.62, 0.75],
    [0.28, 0.34, -0.18, 0.48, 1.0],
  ];
  const parts = offsets.map(([x, y, z, r, yScale]) => {
    const geo = new THREE.IcosahedronGeometry(r, 0).toNonIndexed();
    geo.scale(1, yScale, 1);
    geo.translate(x, y * yScale, z);
    return geo;
  });
  const merged = mergeGeometries(parts, false);
  paintVertexColor(merged, new THREE.Color("#8d8a83"));
  return merged;
}

function paintVertexColor(geometry, color) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function makeSignBoardTexture(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffd23f";
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = "#14181f";
  ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, 120, 56);
  ctx.fillStyle = "#14181f";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 34);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Scatters trees/rocks/bushes/signs along the track. All repeated geometry
 * (trees, rocks, bushes, GLB tree models, sign posts) is batched into a
 * handful of InstancedMesh draw calls via InstanceBatch instead of one mesh
 * per placement, which is what previously produced hundreds of draw calls
 * and unique materials for a few hundred simple props.
 */
function scatterDecorations(scene, samples, treeAssets) {
  const startPos = samples[0].position;
  // The track's closing curve loops back close to the start straight in
  // world space even though it's "far away" by arc-length index, so the
  // start-area clearance has to be a real-world-distance check, not just an
  // index range - otherwise decorations from that curve end up right next
  // to the starting grid and camera.
  const startClearance = 34;

  const pineGeo = extractFirstMeshGeometry(treeAssets?.pineGltf);
  const coconutGeo = extractFirstMeshGeometry(treeAssets?.coconutGltf);
  const PINE_GLB_SCALE = 0.0108;
  const COCONUT_GLB_SCALE = 0.9;

  const pineMat = pineGeo
    ? new THREE.MeshStandardMaterial({ map: pineGeo.map, roughness: 0.9 })
    : null;
  const coconutMat = coconutGeo
    ? new THREE.MeshStandardMaterial({ map: coconutGeo.map, roughness: 0.9 })
    : null;
  const roundTreeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const bushMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  const signPoleMat = new THREE.MeshStandardMaterial({ color: "#cfd2d6", metalness: 0.4, roughness: 0.5 });

  const batches = {
    pine: pineGeo ? new InstanceBatch(pineGeo.geometry, pineMat) : null,
    coconut: coconutGeo ? new InstanceBatch(coconutGeo.geometry, coconutMat) : null,
    roundTree: new InstanceBatch(buildRoundTreeGeometry(), roundTreeMat, { useColor: true }),
    rock: new InstanceBatch(buildRockGeometry(), rockMat, { useColor: true }),
    bush: new InstanceBatch(buildBushGeometry(), bushMat, { useColor: true }),
    signPole: new InstanceBatch(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), signPoleMat),
  };
  const signBoardGeo = new THREE.PlaneGeometry(1.6, 0.8);
  const signTexts = ["TURN", "SLOW", "GO!", "50m"];
  const signBatches = new Map(
    signTexts.map((text) => [
      text,
      new InstanceBatch(
        signBoardGeo,
        new THREE.MeshStandardMaterial({ map: makeSignBoardTexture(text), side: THREE.DoubleSide, roughness: 0.6 }),
      ),
    ])
  );
  let signIdx = 0;

  const whiteColor = new THREE.Color(1, 1, 1);
  const rockShade = () => {
    const s = 0.75 + Math.random() * 0.4;
    return new THREE.Color(s * 0.55, s * 0.53, s * 0.5).multiplyScalar(1.5);
  };
  const bushShade = () => new THREE.Color().setHSL(0.3 + Math.random() * 0.06, 1, 1).lerp(whiteColor, 0.15);

  for (let i = 0; i < samples.length; i += 4) {
    const s = samples[i];
    if (s.position.distanceTo(startPos) < startClearance) continue;

    for (const side of [-1, 1]) {
      if (Math.random() < 0.3) continue; // leave gaps, avoid a wall of props
      const dist = 4.5 + Math.random() * 11;
      const pos = s.position.clone().addScaledVector(s.right, side * (ROAD_WIDTH / 2 + dist));
      // The offset above only guarantees clearance from THIS sample; on a
      // compact loop the road can pass close to itself elsewhere, so also
      // check against the whole lap before placing anything.
      if (!isClearOfRoad(pos.x, pos.z, samples)) continue;
      pos.y = groundElevationAt(pos.x, pos.z, samples);
      const roll = Math.random();

      if (roll < 0.34 && batches.pine) {
        _q.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
        const sc = PINE_GLB_SCALE * (0.85 + Math.random() * 0.35);
        batches.pine.add(pos, _q.clone(), _scale.set(sc, sc, sc).clone());
      } else if (roll < 0.44 && batches.coconut) {
        _q.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
        const sc = COCONUT_GLB_SCALE * (0.8 + Math.random() * 0.3);
        batches.coconut.add(pos, _q.clone(), _scale.set(sc, sc, sc).clone());
      } else if (roll < 0.58) {
        _q.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
        const sc = 0.85 + Math.random() * 0.5;
        batches.roundTree.add(pos, _q.clone(), _scale.set(sc, sc, sc).clone(), whiteColor);
      } else if (roll < 0.78) {
        _q.setFromAxisAngle(UP, Math.random() * Math.PI);
        const sc = 0.6 + Math.random() * 1.0;
        batches.rock.add(pos, _q.clone(), _scale.set(sc, sc * 0.8, sc).clone(), rockShade());
      } else if (roll < 0.92) {
        _q.identity();
        const sc = 0.8 + Math.random() * 0.5;
        batches.bush.add(pos, _q.clone(), _scale.set(sc, sc, sc).clone(), bushShade());
      } else {
        const text = signTexts[signIdx % signTexts.length];
        signIdx++;
        const yaw = Math.atan2(s.tangent.x, s.tangent.z) + (side > 0 ? Math.PI : 0);
        _q.setFromAxisAngle(UP, yaw);
        const polePos = pos.clone();
        polePos.y += 1.3;
        batches.signPole.add(polePos, _q.clone(), _scale.set(1, 1, 1).clone());
        const boardPos = pos.clone();
        boardPos.y += 2.3;
        signBatches.get(text).add(boardPos, _q.clone(), _scale.set(1, 1, 1).clone());
      }
    }
  }

  const group = new THREE.Group();
  group.name = "decorations";
  for (const batch of Object.values(batches)) {
    const mesh = batch?.build();
    if (mesh) group.add(mesh);
  }
  for (const batch of signBatches.values()) {
    const mesh = batch.build();
    if (mesh) group.add(mesh);
  }
  scene.add(group);
  return group;
}

/** Pulls the geometry + base color texture out of a loaded static (non-skinned)
 * GLB so it can be driven through an InstancedMesh instead of cloning the
 * whole scene graph per placement. */
function extractFirstMeshGeometry(gltf) {
  if (!gltf) return null;
  let found = null;
  gltf.scene.traverse((o) => {
    if (!found && o.isMesh) found = o;
  });
  if (!found) return null;
  return { geometry: found.geometry, map: found.material?.map ?? null };
}

/** Distant low-poly mountain silhouettes ringing the track for a non-empty
 * horizon - one InstancedMesh (+ one for the snow caps) instead of a
 * separate mesh per mountain. */
function buildMountains(center, trackRadius, samples) {
  const coneGeo = new THREE.ConeGeometry(1, 1, 5);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, fog: true });
  paintVertexColor(coneGeo, new THREE.Color(1, 1, 1));
  const batch = new InstanceBatch(coneGeo, mat, { useColor: true });

  const capGeo = new THREE.ConeGeometry(1, 1, 5);
  const capMat = new THREE.MeshStandardMaterial({ color: "#eef3f7", roughness: 1, flatShading: true, fog: true });
  const capBatch = new InstanceBatch(capGeo, capMat);

  const ringRadius = trackRadius + 140;
  const count = 26;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.15;
    const dist = ringRadius + Math.random() * 90;
    const height = 30 + Math.random() * 55;
    const radius = 28 + Math.random() * 30;
    const hue = 0.66 + Math.random() * 0.05;
    const light = 0.42 + (height / 85) * 0.18;
    const x = center.x + Math.cos(angle) * dist;
    const z = center.z + Math.sin(angle) * dist;
    const y = groundElevationAt(x, z, samples) + height / 2 - 4;
    const pos = new THREE.Vector3(x, y, z);
    _q.setFromAxisAngle(UP, Math.random() * Math.PI);
    batch.add(pos, _q.clone(), _scale.set(radius, height, radius).clone(), new THREE.Color().setHSL(hue, 0.22, light));

    if (height > 55) {
      const capPos = pos.clone();
      capPos.y = y + height / 2 - height * 0.14;
      capBatch.add(capPos, _q.clone(), _scale.set(radius * 0.38, height * 0.32, radius * 0.38).clone());
    }
  }

  const group = new THREE.Group();
  const mountainMesh = batch.build({ castShadow: false, receiveShadow: false });
  if (mountainMesh) group.add(mountainMesh);
  const capMesh = capBatch.build({ castShadow: false, receiveShadow: false });
  if (capMesh) group.add(capMesh);
  return group;
}

/** Scattered rolling-hill terrain chunks between the trackside decorations
 * and the distant mountains - fills the mid-ground so the world doesn't
 * jump straight from flat grass to a mountain wall. One InstancedMesh
 * (tinted per-instance) instead of a cloned mesh+material per hill. */
function buildTerrainHills(center, trackRadius, terrainGltf, samples) {
  const extracted = extractFirstMeshGeometry(terrainGltf);
  if (!extracted) return null;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  if (!extracted.geometry.attributes.color) paintVertexColor(extracted.geometry, new THREE.Color(1, 1, 1));
  const batch = new InstanceBatch(extracted.geometry, mat, { useColor: true });

  const ringRadius = trackRadius + 55;
  const count = 10;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
    const dist = ringRadius + Math.random() * 55;
    const hue = 0.28 + Math.random() * 0.05;
    const scale = 2.2 + Math.random() * 2.5;
    const x = center.x + Math.cos(angle) * dist;
    const z = center.z + Math.sin(angle) * dist;
    const y = groundElevationAt(x, z, samples) + 0.1;
    _q.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
    batch.add(
      new THREE.Vector3(x, y, z),
      _q.clone(),
      _scale.set(scale, scale, scale).clone(),
      new THREE.Color().setHSL(hue, 0.35, 0.4 + Math.random() * 0.1)
    );
  }
  return batch.build();
}

function buildStartLights(samples) {
  const group = new THREE.Group();
  const s = samples[0];
  const gantryWidth = ROAD_WIDTH + 2;
  const postMat = new THREE.MeshStandardMaterial({ color: "#23262c", roughness: 0.55, metalness: 0.4 });
  const leftPost = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.28, 6, 8), postMat);
  const rightPost = leftPost.clone();
  leftPost.position.copy(s.position).addScaledVector(s.right, -gantryWidth / 2);
  rightPost.position.copy(s.position).addScaledVector(s.right, gantryWidth / 2);
  leftPost.position.y += 3;
  rightPost.position.y += 3;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(gantryWidth + 0.6, 0.45, 0.45), postMat);
  beam.position.copy(s.position);
  beam.position.y += 6;
  const beamBasis = new THREE.Matrix4().makeBasis(s.right, new THREE.Vector3(0, 1, 0), s.tangent);
  beam.quaternion.setFromRotationMatrix(beamBasis);

  // Small name placard mounted ON TOP of the beam - well clear of the
  // driving lane and camera sightline, purely a landmark/decoration.
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 40;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ff5d3b";
  ctx.fillRect(0, 0, 256, 40);
  ctx.fillStyle = "#ffd23f";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("SUNSET CIRCUIT", 128, 21);
  const bannerTex = new THREE.CanvasTexture(canvas);
  const bannerWidth = Math.min(9, gantryWidth * 0.55);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(bannerWidth, bannerWidth * (40 / 256)),
    new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide })
  );
  banner.position.copy(s.position);
  banner.position.y += 7.55;
  // Face the plane's front (readable, non-mirrored) side back toward
  // approaching traffic: normal = -tangent, since karts travel toward +tangent.
  const bannerBasis = new THREE.Matrix4().makeBasis(
    s.right.clone().negate(),
    new THREE.Vector3(0, 1, 0),
    s.tangent.clone().negate()
  );
  banner.quaternion.setFromRotationMatrix(bannerBasis);
  group.add(banner);

  const lights = [];
  const lightGeo = new THREE.SphereGeometry(0.34, 12, 12);
  for (let i = -1; i <= 1; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: "#3a0d0d", emissive: "#3a0d0d", emissiveIntensity: 1 });
    const bulb = new THREE.Mesh(lightGeo, mat);
    bulb.position.copy(s.position);
    bulb.position.addScaledVector(s.right, i * 1.2);
    bulb.position.y += 6.7;
    lights.push(bulb);
    group.add(bulb);
  }

  group.add(leftPost, rightPost, beam);
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return { group, lights };
}

/** A slim arch with a colored flag panel at each checkpoint - a visual
 * landmark so players can tell where they are on the loop at a glance.
 * Posts share one InstancedMesh (identical geometry everywhere); flags
 * share another, tinted per-instance since each checkpoint's hue differs. */
function buildCheckpointArches(samples, checkpoints) {
  const half = ROAD_WIDTH / 2;
  const postBatch = new InstanceBatch(
    new THREE.CylinderGeometry(0.12, 0.14, 4.6, 7),
    new THREE.MeshStandardMaterial({ color: "#e8e8e8", roughness: 0.5, metalness: 0.3 })
  );
  const flagBatch = new InstanceBatch(
    new THREE.PlaneGeometry(1.1, 0.6),
    new THREE.MeshStandardMaterial({ roughness: 0.5, side: THREE.DoubleSide, vertexColors: true }),
    { useColor: true }
  );
  paintVertexColor(flagBatch.geometry, new THREE.Color(1, 1, 1));

  for (const cp of checkpoints) {
    if (cp.index === 0) continue; // start/finish already has its own gantry
    const s = samples[cp.sampleIndex];
    const hue = (cp.index / CHECKPOINT_COUNT) % 1;
    const flagColor = new THREE.Color().setHSL(hue, 0.65, 0.55);

    for (const side of [-1, 1]) {
      const pos = s.position.clone().addScaledVector(s.right, side * (half + 0.4));
      pos.y += 2.3;
      postBatch.add(pos, IDENTITY_Q, _scale.set(1, 1, 1).clone());
    }

    const flagPos = s.position.clone().addScaledVector(s.right, half + 0.4);
    flagPos.y += 4.2;
    const basis = new THREE.Matrix4().makeBasis(s.tangent, new THREE.Vector3(0, 1, 0), s.right);
    _q.setFromRotationMatrix(basis);
    flagBatch.add(flagPos, _q.clone(), _scale.set(1, 1, 1).clone(), flagColor);
  }

  const group = new THREE.Group();
  const postMesh = postBatch.build();
  if (postMesh) group.add(postMesh);
  const flagMesh = flagBatch.build();
  if (flagMesh) group.add(flagMesh);
  return group;
}

function chevronBoardTexture(direction) {
  const w = 128;
  const h = 96;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffcc1f";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#14181f";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.strokeStyle = "#14181f";
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // three chevrons (>>> or <<<) pointing the turn direction
  for (let i = 0; i < 3; i++) {
    const cx = direction > 0 ? 30 + i * 28 : w - 30 - i * 28;
    ctx.beginPath();
    if (direction > 0) {
      ctx.moveTo(cx - 14, h / 2 - 22);
      ctx.lineTo(cx + 14, h / 2);
      ctx.lineTo(cx - 14, h / 2 + 22);
    } else {
      ctx.moveTo(cx + 14, h / 2 - 22);
      ctx.lineTo(cx - 14, h / 2);
      ctx.lineTo(cx + 14, h / 2 + 22);
    }
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Chevron "turn direction" boards on the outside edge of sharp corners -
 * the same visual language real circuits use so the route is obvious from
 * the 3D scene itself, not just the HUD. Boards batch into two
 * InstancedMeshes (one per chevron direction); posts share a third.
 */
function buildTurnArrows(samples) {
  const n = samples.length;
  const window = 9;

  // signed lateral deviation of the path ahead from a straight extrapolation
  // - the sign says which way the track bends, the magnitude says how hard.
  const bend = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const cur = samples[i];
    const ahead = samples[(i + window) % n];
    const straight = cur.position.clone().addScaledVector(cur.tangent, ahead.position.distanceTo(cur.position));
    bend[i] = ahead.position.clone().sub(straight).dot(cur.right);
  }

  const threshold = 1.1;
  const minSpacing = 22;
  let lastPick = -1000;
  const half = ROAD_WIDTH / 2;

  const boardGeo = new THREE.PlaneGeometry(1.7, 1.2);
  const rightBatch = new InstanceBatch(
    boardGeo,
    new THREE.MeshStandardMaterial({ map: chevronBoardTexture(1), roughness: 0.55, side: THREE.DoubleSide })
  );
  const leftBatch = new InstanceBatch(
    boardGeo,
    new THREE.MeshStandardMaterial({ map: chevronBoardTexture(-1), roughness: 0.55, side: THREE.DoubleSide })
  );
  const postBatch = new InstanceBatch(
    new THREE.CylinderGeometry(0.07, 0.08, 1.5, 6),
    new THREE.MeshStandardMaterial({ color: "#2a2e35", roughness: 0.6, metalness: 0.3 })
  );

  for (let i = 0; i < n; i++) {
    const mag = Math.abs(bend[i]);
    if (mag < threshold) continue;
    if (i - lastPick < minSpacing) continue;
    // require a local peak so we place one sign per turn, not a cluster
    const prevMag = Math.abs(bend[(i - 1 + n) % n]);
    const nextMag = Math.abs(bend[(i + 1) % n]);
    if (mag < prevMag || mag < nextMag) continue;
    lastPick = i;

    const turnsPositive = bend[i] > 0;
    const outsideSide = turnsPositive ? -1 : 1; // outside is opposite the bend direction
    const s = samples[i];
    const boardPos = s.position.clone().addScaledVector(s.right, outsideSide * (half + 1.6));
    if (!isClearOfRoad(boardPos.x, boardPos.z, samples)) continue;
    boardPos.y += 1.5;
    const basis = new THREE.Matrix4().makeBasis(s.right, new THREE.Vector3(0, 1, 0), s.tangent);
    _q.setFromRotationMatrix(basis);
    (turnsPositive ? rightBatch : leftBatch).add(boardPos, _q.clone(), _scale.set(1, 1, 1).clone());

    const postPos = boardPos.clone();
    postPos.y -= 0.75;
    postBatch.add(postPos, IDENTITY_Q, _scale.set(1, 1, 1).clone());
  }

  const group = new THREE.Group();
  for (const batch of [rightBatch, leftBatch, postBatch]) {
    const mesh = batch.build();
    if (mesh) group.add(mesh);
  }
  return group;
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
  constructor(scene, treeAssets = null) {
    this.scene = scene;
    this.curve = buildCurve();
    this.samples = sampleTrack(this.curve);
    this.roadWidth = ROAD_WIDTH;
    this.totalLength = this.samples.totalLength;

    this.group = new THREE.Group();
    const { mesh: groundMesh, center, size } = buildGround(this.curve, this.samples);
    this.group.add(groundMesh);
    this.group.add(buildRoadMesh(this.samples));
    this.group.add(buildCurbs(this.samples));
    this.group.add(buildStartFinishStripe(this.samples));
    this.group.add(buildBarriers(this.samples));
    scene.add(this.group);

    scatterDecorations(scene, this.samples, treeAssets);
    scene.add(buildMountains(center, size / 2, this.samples));
    if (treeAssets?.terrainGltf) {
      const hills = buildTerrainHills(center, size / 2, treeAssets.terrainGltf, this.samples);
      if (hills) scene.add(hills);
    }

    this.checkpoints = buildCheckpoints(this.samples);
    scene.add(buildCheckpointArches(this.samples, this.checkpoints));
    scene.add(buildTurnArrows(this.samples));

    const { group: lightsGroup, lights } = buildStartLights(this.samples);
    scene.add(lightsGroup);
    this.startLights = lights;

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
