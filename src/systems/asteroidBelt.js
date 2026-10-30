import * as THREE from 'three';
import { createPRNG } from '../utils/random.js';
import { SimplexNoise3D } from '../terrain/terrainNoise.js';

/**
 * Asteroid belt around the star.
 *
 * Two parts:
 *  - a dust band of points, visible from anywhere in the system;
 *  - real rocks, streamed in cells around the camera when it is in or near the belt.
 *    Rocks are deterministic per cell, so flying away and back gives the same field.
 *
 * Rock instance matrices are stored relative to an anchor near the camera so they stay
 * precise even ~100,000 u from the star.
 */

const LAYERS = [
  // Small rocks, dense, short view range
  { cellSize: 18, range: 3, maxPerCell: 5, minRadius: 0.04, maxRadius: 1.2, sizePower: 3.0, capacity: 1600 },
  // Big asteroids, sparse, long view range
  { cellSize: 320, range: 2, maxPerCell: 2, minRadius: 3, maxRadius: 28, sizePower: 2.2, capacity: 300 }
];

const ROCK_VARIANTS = 4;

function makeRockGeometry(seed) {
  const noise = new SimplexNoise3D(seed);
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise.fbm(v.x * 1.3, v.y * 1.3, v.z * 1.3, 4, 2.0, 0.5);
    const lumps = noise.ridged(v.x * 2.2 + 5, v.y * 2.2, v.z * 2.2, 2) * 0.15;
    v.multiplyScalar(1 + n * 0.35 - lumps);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function hashCell(seed, layer, x, y, z) {
  let h = seed ^ (layer * 0x9e3779b1);
  h = Math.imul(h ^ x, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  h = Math.imul(h ^ z, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

export class AsteroidBelt {
  /**
   * @param {Object} data Belt data from generateSolarSystemData
   *   { innerRadius, outerRadius, thickness, density, seed, color }
   */
  constructor(data) {
    this.data = data;
    this.group = new THREE.Group();
    this.group.name = 'AsteroidBelt';
    this.mid = (data.innerRadius + data.outerRadius) / 2;
    this.halfWidth = (data.outerRadius - data.innerRadius) / 2;

    this._buildDust();

    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true
    });
    this.geometries = [];
    for (let i = 0; i < ROCK_VARIANTS; i++) this.geometries.push(makeRockGeometry(data.seed + i * 101));

    this.layers = LAYERS.map((cfg) => {
      const anchor = new THREE.Group();
      this.group.add(anchor);
      const perVariant = Math.ceil(cfg.capacity / ROCK_VARIANTS);
      const meshes = this.geometries.map((g) => {
        const m = new THREE.InstancedMesh(g, this.material, perVariant);
        m.count = 0;
        m.frustumCulled = false;
        anchor.add(m);
        return m;
      });
      return { cfg, anchor, meshes, cell: null, rocks: [], cellRocks: new Map() };
    });

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this._c = new THREE.Color();
    this._hitNormal = new THREE.Vector3();
    this._baseColor = new THREE.Color(data.color);
  }

  _buildDust() {
    const d = this.data;
    const prng = createPRNG(d.seed);
    const count = 18000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const base = new THREE.Color(d.color);
    for (let i = 0; i < count; i++) {
      // Denser toward the middle of the belt
      const f = (prng.next() + prng.next()) / 2;
      const r = d.innerRadius + f * (d.outerRadius - d.innerRadius);
      const a = prng.next() * Math.PI * 2;
      const y = (prng.next() + prng.next() + prng.next() - 1.5) * d.thickness * 0.6;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(a) * r;
      const l = 0.6 + prng.next() * 0.6;
      col[i * 3] = base.r * l;
      col[i * 3 + 1] = base.g * l;
      col[i * 3 + 2] = base.b * l;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.name = 'AsteroidDust';
    this.group.add(this.dust);
  }

  /** 0..1 rock density at a point (in the belt's frame). */
  densityAt(x, y, z) {
    const d = this.data;
    const r = Math.hypot(x, z);
    const radial = 1 - Math.min(1, Math.abs(r - this.mid) / this.halfWidth);
    if (radial <= 0) return 0;
    const vertical = Math.exp(-((y / (d.thickness * 0.5)) ** 2));
    return Math.min(1, radial * 1.6) * vertical * d.density;
  }

  /** True when `pos` (world) is inside the belt volume. */
  contains(pos) {
    this._p.copy(pos);
    this.group.worldToLocal(this._p);
    return this.densityAt(this._p.x, this._p.y, this._p.z) > 0.08;
  }

  /**
   * Streams rocks around the camera. Cheap when the camera stays in the same cell.
   * @param {THREE.Vector3} cameraPos World position
   */
  update(cameraPos) {
    const local = this._p.copy(cameraPos);
    this.group.updateWorldMatrix(true, false);
    this.group.worldToLocal(local);
    const lx = local.x, ly = local.y, lz = local.z;

    const r = Math.hypot(lx, lz);
    const nearBelt = Math.abs(r - this.mid) < this.halfWidth + 1500 && Math.abs(ly) < this.data.thickness + 1500;

    for (let li = 0; li < this.layers.length; li++) {
      const layer = this.layers[li];
      if (!nearBelt) {
        if (layer.cell !== null) {
          layer.cell = null;
          layer.rocks = [];
          layer.cellRocks.clear();
          for (const m of layer.meshes) m.count = 0;
        }
        continue;
      }
      const cs = layer.cfg.cellSize;
      const cx = Math.floor(lx / cs), cy = Math.floor(ly / cs), cz = Math.floor(lz / cs);
      const key = `${cx},${cy},${cz}`;
      if (layer.cell === key) continue;
      layer.cell = key;
      this._fillLayer(li, layer, cx, cy, cz);
    }
  }

  _fillLayer(li, layer, cx, cy, cz) {
    const { cfg, anchor, meshes } = layer;
    const cs = cfg.cellSize;
    const ax = (cx + 0.5) * cs, ay = (cy + 0.5) * cs, az = (cz + 0.5) * cs;
    anchor.position.set(ax, ay, az);
    anchor.updateMatrixWorld(true);

    const perVariant = meshes[0].instanceMatrix.count;
    const counts = new Array(ROCK_VARIANTS).fill(0);
    layer.rocks = [];
    layer.cellRocks.clear();

    for (let dx = -cfg.range; dx <= cfg.range; dx++) {
      for (let dy = -cfg.range; dy <= cfg.range; dy++) {
        for (let dz = -cfg.range; dz <= cfg.range; dz++) {
          const x = cx + dx, y = cy + dy, z = cz + dz;
          const density = this.densityAt((x + 0.5) * cs, (y + 0.5) * cs, (z + 0.5) * cs);
          if (density <= 0.01) continue;
          const prng = createPRNG(hashCell(this.data.seed, li, x, y, z));
          const n = Math.floor(density * cfg.maxPerCell + prng.next());
          for (let k = 0; k < n; k++) {
            const variant = Math.floor(prng.next() * ROCK_VARIANTS);
            if (counts[variant] >= perVariant) continue;
            const radius = cfg.minRadius + Math.pow(prng.next(), cfg.sizePower) * (cfg.maxRadius - cfg.minRadius);
            const px = (x + prng.next()) * cs - ax;
            const py = (y + prng.next()) * cs - ay;
            const pz = (z + prng.next()) * cs - az;

            this._e.set(prng.next() * 6.28, prng.next() * 6.28, prng.next() * 6.28);
            this._q.setFromEuler(this._e);
            this._s.set(radius, radius * prng.range(0.65, 1), radius * prng.range(0.55, 0.95));
            this._p.set(px, py, pz);
            this._m.compose(this._p, this._q, this._s);
            const mesh = meshes[variant];
            mesh.setMatrixAt(counts[variant], this._m);
            this._c.copy(this._baseColor).multiplyScalar(prng.range(0.55, 1.15));
            mesh.setColorAt(counts[variant], this._c);
            counts[variant]++;

            // Collision sphere slightly inside the lumpy surface
            const rock = { x: px + ax, y: py + ay, z: pz + az, r: radius * 0.8 };
            layer.rocks.push(rock);
            const cellKey = `${x},${y},${z}`;
            let bucket = layer.cellRocks.get(cellKey);
            if (!bucket) {
              bucket = [];
              layer.cellRocks.set(cellKey, bucket);
            }
            bucket.push(rock);
          }
        }
      }
    }

    for (let v = 0; v < ROCK_VARIANTS; v++) {
      const mesh = meshes[v];
      mesh.count = counts[v];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Pushes a ship sphere out of any rock it ended up inside.
   * Spatial partition tests the ship's cell and its 26 immediate neighbor cells.
   * @returns {{ normal: THREE.Vector3 }|null}
   */
  resolveCollision(to, shipRadius) {
    const local = this._p.copy(to);
    this.group.worldToLocal(local);
    let hit = null;

    for (let li = 0; li < this.layers.length; li++) {
      const layer = this.layers[li];
      if (!layer.cellRocks || layer.cellRocks.size === 0) continue;
      const cs = layer.cfg.cellSize;
      const scx = Math.floor(local.x / cs);
      const scy = Math.floor(local.y / cs);
      const scz = Math.floor(local.z / cs);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = layer.cellRocks.get(`${scx + dx},${scy + dy},${scz + dz}`);
            if (!bucket) continue;
            for (let i = 0; i < bucket.length; i++) {
              const rock = bucket[i];
              const rdx = local.x - rock.x, rdy = local.y - rock.y, rdz = local.z - rock.z;
              const min = rock.r + shipRadius;
              const d2 = rdx * rdx + rdy * rdy + rdz * rdz;
              if (d2 >= min * min) continue;
              const d = Math.sqrt(d2);
              if (d > 1e-6) {
                this._hitNormal.set(rdx / d, rdy / d, rdz / d);
              } else {
                this._hitNormal.set(0, 1, 0);
              }
              local.set(rock.x + this._hitNormal.x * min, rock.y + this._hitNormal.y * min, rock.z + this._hitNormal.z * min);
              if (!hit) hit = { normal: new THREE.Vector3() };
              hit.normal.copy(this._hitNormal);
            }
          }
        }
      }
    }
    if (hit) {
      this.group.localToWorld(local);
      to.copy(local);
      hit.normal.transformDirection(this.group.matrixWorld);
    }
    return hit;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.dust.geometry.dispose();
    this.dust.material.dispose();
    for (const g of this.geometries) g.dispose();
    for (const layer of this.layers) for (const m of layer.meshes) m.dispose();
    this.material.dispose();
  }
}
