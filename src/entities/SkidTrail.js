import * as THREE from "three";

const POOL_SIZE = 160;
const MARK_LIFETIME = 1.6;

function skidMarkTexture() {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(15,15,18,0.8)");
  grad.addColorStop(1, "rgba(15,15,18,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * A small pooled system of fading tire-mark quads dropped behind a drifting
 * kart's rear wheels - cheap "game feel" polish with no per-frame allocation
 * once the pool is warmed up.
 */
export class SkidTrail {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    const geometry = new THREE.PlaneGeometry(0.32, 0.7);
    const material = new THREE.MeshBasicMaterial({
      map: skidMarkTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    this.pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(geometry, material.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({ mesh, life: 0 });
    }
    this._cursor = 0;
  }

  spawn(position, heading) {
    const slot = this.pool[this._cursor];
    this._cursor = (this._cursor + 1) % this.pool.length;
    slot.life = MARK_LIFETIME;
    slot.mesh.visible = true;
    slot.mesh.position.copy(position);
    slot.mesh.rotation.y = heading;
    slot.mesh.material.opacity = 0.55;
  }

  update(dt) {
    for (const slot of this.pool) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.mesh.visible = false;
      } else {
        slot.mesh.material.opacity = 0.55 * Math.min(1, slot.life / 0.4);
      }
    }
  }
}
