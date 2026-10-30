import * as THREE from 'three';
import { buildChunkData, chunkDataToGeometry, cubeToSphere, CUBE_FACES } from './terrainGeometry.js';
import { createTerrainMaterial, createLiquidMaterial, bindTerrainChunk } from './terrainMaterials.js';
import { getTerrainHeight, getMaxDetailOctaves } from './terrainGenerator.js';
import { TERRAIN_MIN_SPACING } from '../utils/scale.js';

const CHUNK_RESOLUTION = 24;
// A chunk splits when the camera is closer than SPLIT_FACTOR × its edge length
const SPLIT_FACTOR = 2.2;
const MERGE_HYSTERESIS = 1.2;
// Main-thread build budget per frame when Web Workers are unavailable (ms)
const SYNC_BUDGET_MS = 6;

/**
 * Shared pool of terrain workers. Each terrain hands it a prioritized request list every
 * frame; an idle worker immediately takes the next request, so throughput does not
 * depend on the frame rate. Falls back to synchronous builds where Worker does not
 * exist (Node tests) or fails to start.
 */
class ChunkBuilderPool {
  constructor() {
    this.workers = [];
    this.idle = [];
    this.callbacks = new Map();
    this.nextId = 1;
    this.inFlight = 0;
    this.queues = new Map(); // owner -> [{ params(), onDone, dist }]

    if (typeof Worker === 'undefined') return;
    const count = Math.max(1, Math.min(4, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 1));
    try {
      for (let i = 0; i < count; i++) {
        const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this._onMessage(w, e.data);
        w.onerror = () => this._disable();
        this.workers.push(w);
        this.idle.push(w);
      }
    } catch {
      this._disable();
    }
  }

  get async() {
    return this.workers.length > 0;
  }

  /** Replaces `owner`'s pending requests (sorted nearest first) and starts idle workers. */
  setQueue(owner, requests) {
    if (requests.length) this.queues.set(owner, requests);
    else this.queues.delete(owner);
    this._pump();
  }

  removeOwner(owner) {
    this.queues.delete(owner);
  }

  _pump() {
    while (this.idle.length > 0) {
      // Nearest request across all terrains
      let bestOwner = null;
      let best = null;
      for (const [owner, q] of this.queues) {
        if (q.length && (!best || q[0].dist < best.dist)) { best = q[0]; bestOwner = owner; }
      }
      if (!best) return;
      const q = this.queues.get(bestOwner);
      q.shift();
      if (!q.length) this.queues.delete(bestOwner);
      if (best.skip?.()) continue;

      const id = this.nextId++;
      const w = this.idle.pop();
      this.callbacks.set(id, best.onDone);
      this.inFlight++;
      best.onStart?.();
      w.postMessage({ id, params: best.params() });
    }
  }

  _onMessage(worker, { id, data }) {
    this.idle.push(worker);
    this.inFlight--;
    const cb = this.callbacks.get(id);
    this.callbacks.delete(id);
    if (cb) cb(data);
    this._pump();
  }

  _disable() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    // Anything still pending will be rebuilt synchronously on the next update
    for (const cb of this.callbacks.values()) cb(null);
    this.callbacks.clear();
    this.inFlight = 0;
  }
}

let sharedPool = null;
function getPool() {
  if (!sharedPool) sharedPool = new ChunkBuilderPool();
  return sharedPool;
}

/**
 * Streaming quadtree terrain for one celestial body.
 *
 * Each cube face is a quadtree of square chunks. Chunks near the camera split into four
 * children down to ~TERRAIN_MIN_SPACING vertex spacing, so the same planet works from
 * orbit and when standing on it. A parent stays visible until all four children are
 * built, so there are no holes while new detail streams in.
 *
 * Chunks are children of the body's own (spinning) mesh, so they inherit its rotation.
 */
export class PlanetTerrain {
  /**
   * @param {Object} planetData Body data (name etc.)
   * @param {THREE.Mesh} mesh The body's mesh; its own geometry is replaced by the chunks
   * @param {Object} profile Terrain profile
   * @param {{ sync?: boolean }} [options] sync: build every chunk on the main thread
   */
  constructor(planetData, mesh, profile, options = {}) {
    this.data = planetData;
    this.mesh = mesh;
    this.profile = profile;
    this.radius = profile.planetRadius;
    this.seed = profile.seedNum;
    this.isDisposed = false;
    this.pool = options.sync ? null : getPool();

    // Deepest level: leaf vertex spacing reaches TERRAIN_MIN_SPACING
    const rootEdge = (Math.PI / 2) * this.radius;
    this.maxDepth = Math.max(0, Math.ceil(Math.log2(rootEdge / (CHUNK_RESOLUTION * TERRAIN_MIN_SPACING))));
    this.splitFactor = SPLIT_FACTOR;

    this.material = createTerrainMaterial(profile);
    this.liquidMaterial = createLiquidMaterial(profile);

    // The body mesh becomes an invisible transform parent for the chunks
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
    mesh.geometry = new THREE.BufferGeometry();
    mesh.material = new THREE.MeshBasicMaterial({ visible: false });

    this.group = new THREE.Group();
    this.group.name = `${planetData.name || 'Body'}_Terrain`;
    mesh.add(this.group);

    this._camLocal = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._requests = [];
    this.stats = { chunks: 0, visible: 0 };

    this.roots = CUBE_FACES.map((_, f) => this._makeNode(f, -1, -1, 2, 0));
    for (const root of this.roots) {
      this._buildSync(root);
      this._setVisible(root, true);
    }
    this._isCollapsed = false;
  }

  _makeNode(face, u0, v0, size, level) {
    cubeToSphere(u0 + size / 2, v0 + size / 2, CUBE_FACES[face], this._dir);
    const h = getTerrainHeight(this._dir, this.seed, this.profile);
    return {
      face, u0, v0, size, level,
      center: this._dir.clone().multiplyScalar(this.radius + h),
      dir: this._dir.clone(),
      edge: (size / 2) * (Math.PI / 2) * this.radius,
      // Angular radius of the chunk as seen from the planet center
      angle: (size / 2) * (Math.PI / 4) * 1.5,
      mesh: null,
      liquid: null,
      children: null,
      pending: false,
      disposed: false
    };
  }

  _params(node) {
    const edge = node.edge;
    const spacing = edge / CHUNK_RESOLUTION;
    return {
      radius: this.radius,
      seed: this.seed,
      profile: this.profile,
      face: node.face,
      u0: node.u0,
      v0: node.v0,
      size: node.size,
      resolution: CHUNK_RESOLUTION,
      detailOctaves: getMaxDetailOctaves(this.radius, spacing),
      skirtDepth: Math.max(spacing * 2.5, this.profile.maxElevation * 0.002),
      withLiquid: !!this.liquidMaterial
    };
  }

  _buildSync(node) {
    this._attach(node, buildChunkData(this._params(node)));
  }

  _attach(node, data) {
    node.pending = false;
    if (node.disposed || this.isDisposed || !data) return;

    const mesh = new THREE.Mesh(chunkDataToGeometry(data), this.material);
    mesh.position.fromArray(data.center);
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    bindTerrainChunk(mesh);
    this.group.add(mesh);
    node.mesh = mesh;
    this.stats.chunks++;

    if (data.liquid && this.liquidMaterial) {
      const liquid = new THREE.Mesh(chunkDataToGeometry(data.liquid), this.liquidMaterial);
      liquid.position.fromArray(data.center);
      liquid.visible = false;
      liquid.matrixAutoUpdate = false;
      liquid.updateMatrix();
      bindTerrainChunk(liquid);
      this.group.add(liquid);
      node.liquid = liquid;
    }
  }

  _setVisible(node, on) {
    if (node.mesh) node.mesh.visible = on;
    if (node.liquid) node.liquid.visible = on;
  }

  _hideSubtree(node) {
    this._setVisible(node, false);
    if (node.children) for (const c of node.children) this._hideSubtree(c);
  }

  _disposeNode(node) {
    node.disposed = true;
    if (node.children) for (const c of node.children) this._disposeNode(c);
    node.children = null;
    for (const m of [node.mesh, node.liquid]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    if (node.mesh) this.stats.chunks--;
    node.mesh = null;
    node.liquid = null;
  }

  _updateNode(node, cam) {
    const d = cam.distanceTo(node.center);
    const splitDist = node.edge * (this.splitFactor || SPLIT_FACTOR) * (node.children ? MERGE_HYSTERESIS : 1);
    const wantSplit = node.level < this.maxDepth && d < splitDist && !this._beyondHorizon(node);

    if (!wantSplit) {
      if (node.children) {
        for (const c of node.children) this._disposeNode(c);
        node.children = null;
      }
      this._setVisible(node, true);
      this.stats.visible++;
      return;
    }

    if (!node.children) {
      const h = node.size / 2;
      const l = node.level + 1;
      node.children = [
        this._makeNode(node.face, node.u0, node.v0, h, l),
        this._makeNode(node.face, node.u0 + h, node.v0, h, l),
        this._makeNode(node.face, node.u0, node.v0 + h, h, l),
        this._makeNode(node.face, node.u0 + h, node.v0 + h, h, l)
      ];
    }

    let ready = true;
    for (const c of node.children) {
      if (!c.mesh) {
        ready = false;
        if (!c.pending) this._requests.push({ node: c, dist: cam.distanceTo(c.center) });
      }
    }

    if (ready) {
      this._setVisible(node, false);
      for (const c of node.children) this._updateNode(c, cam);
    } else {
      this._setVisible(node, true);
      this.stats.visible++;
      for (const c of node.children) this._hideSubtree(c);
    }
  }

  /**
   * True when the whole chunk is hidden behind the curve of the planet, even allowing
   * for the tallest mountains peeking over the horizon. Such chunks are never refined.
   */
  _beyondHorizon(node) {
    const camDist = this._camLocal.length();
    if (camDist <= this.radius) return false;
    const peak = this.radius + Math.max(0, this.profile.maxElevation) * 1.25;
    const visibleAngle = Math.acos(this.radius / camDist) + Math.acos(this.radius / peak);
    const cosAngle = node.dir.dot(this._camDir);
    const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    return angle - node.angle > visibleAngle;
  }

  /**
   * Refines / coarsens the quadtree for the current camera. Call once per frame.
   * @param {THREE.Vector3} cameraPosition World-space camera position
   */
  update(cameraPosition) {
    if (this.isDisposed) return;
    this.mesh.updateWorldMatrix(true, false);
    this._camLocal.copy(cameraPosition);
    this.mesh.worldToLocal(this._camLocal);
    const camDist = this._camLocal.length();

    // Distance gating: if camera is far from the body (root chunks only split within ~3.5 * radius),
    // and the quadtree is already collapsed to its root nodes, skip traversal entirely.
    if (camDist > this.radius * 4.5 && this._isCollapsed) {
      return;
    }

    this._camDir.copy(this._camLocal).normalize();

    this._requests.length = 0;
    this.stats.visible = 0;
    for (const root of this.roots) this._updateNode(root, this._camLocal);

    this._isCollapsed = !this.roots.some((r) => r.children !== null);

    this._requests.sort((a, b) => a.dist - b.dist);

    if (this.pool && this.pool.async) {
      this.pool.setQueue(this, this._requests.map(({ node, dist }) => ({
        dist,
        params: () => this._params(node),
        skip: () => node.disposed || node.pending || !!node.mesh,
        onStart: () => { node.pending = true; },
        onDone: (data) => {
          if (data === null) node.pending = false; // worker died; retry synchronously
          else this._attach(node, data);
        }
      })));
    } else if (this._requests.length) {
      const start = performance.now();
      for (const req of this._requests) {
        this._buildSync(req.node);
        if (!this.pool && this._syncUnlimited) continue;
        if (performance.now() - start > SYNC_BUDGET_MS) break;
      }
    }
  }

  /**
   * Updates repeatedly until no more chunks are requested for this camera position
   * (used by tests and when teleporting onto a surface).
   */
  refineFully(cameraPosition, maxIterations = 64) {
    this._syncUnlimited = true;
    const pool = this.pool;
    this.pool = null;
    for (let i = 0; i < maxIterations; i++) {
      this.update(cameraPosition);
      if (this._requests.length === 0) break;
    }
    this.pool = pool;
    this._syncUnlimited = false;
  }

  dispose() {
    this.isDisposed = true;
    this.pool?.removeOwner?.(this);
    for (const root of this.roots) this._disposeNode(root);
    this.roots = [];
    if (this.group.parent) this.group.parent.remove(this.group);
    this.material.dispose();
    if (this.liquidMaterial) this.liquidMaterial.dispose();
  }
}
