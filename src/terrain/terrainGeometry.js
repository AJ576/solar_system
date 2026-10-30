import * as THREE from 'three';
import { sampleTerrain } from './terrainGenerator.js';
import { computeTerrainVertexColor } from './terrainMaterials.js';

/**
 * 6 face directions for a normalized cube-sphere.
 * right × up must equal dir on every face so triangles wind counter-clockwise
 * when seen from outside; otherwise that face is back-face culled and you see
 * straight through to the inside of the planet.
 */
export const CUBE_FACES = [
  { dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(0, 0, -1), name: '+X' },
  { dir: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(0, 0, 1), name: '-X' },
  { dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0), name: '+Y' },
  { dir: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0), name: '-Y' },
  { dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0), name: '+Z' },
  { dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(-1, 0, 0), name: '-Z' }
];

/**
 * Maps a 2D point (u, v) on a cube face to a point on the unit sphere
 * using spherified cube projection for uniform quadrilateral area distribution.
 * Works slightly outside [-1, 1] too, which the normal border ring relies on.
 */
export function cubeToSphere(u, v, face, out) {
  const x = face.dir.x + face.right.x * u + face.up.x * v;
  const y = face.dir.y + face.right.y * u + face.up.y * v;
  const z = face.dir.z + face.right.z * u + face.up.z * v;
  const x2 = x * x;
  const y2 = y * y;
  const z2 = z * z;

  out.set(
    x * Math.sqrt(Math.max(0, 1.0 - y2 * 0.5 - z2 * 0.5 + (y2 * z2) / 3.0)),
    y * Math.sqrt(Math.max(0, 1.0 - z2 * 0.5 - x2 * 0.5 + (z2 * x2) / 3.0)),
    z * Math.sqrt(Math.max(0, 1.0 - x2 * 0.5 - y2 * 0.5 + (x2 * y2) / 3.0))
  );
  if (out.lengthSq() < 1e-8) out.set(x, y, z);
  return out.normalize();
}

/**
 * Builds the raw vertex data for one square patch of a cube face.
 *
 * Positions are relative to `center` (the surface point at the patch middle) so that
 * float32 vertex data stays precise even for tiny patches on a large planet.
 * The patch is sampled with a one-vertex border ring so normals come from central
 * differences of real terrain samples (no lighting seams between patches).
 *
 * Plain data in and out so it can run inside a Web Worker.
 *
 * @param {Object} p
 * @param {number} p.radius Planet base radius
 * @param {number} p.seed Planet seed
 * @param {Object} p.profile Terrain profile
 * @param {number} p.face Cube face index (0-5)
 * @param {number} p.u0 Patch min u on the face ([-1, 1] covers the whole face)
 * @param {number} p.v0 Patch min v
 * @param {number} p.size Patch size in face units (2 = whole face)
 * @param {number} p.resolution Quads along each edge
 * @param {number} [p.detailOctaves] Fine-detail octaves to evaluate
 * @param {number} [p.skirtDepth] Depth of the crack-hiding skirt (0 = no skirt)
 * @param {boolean} [p.withLiquid] Also build a sea-level patch where terrain dips below it
 */
export function buildChunkData({
  radius, seed, profile, face: faceIndex, u0, v0, size, resolution,
  detailOctaves = -1, skirtDepth = 0, withLiquid = false
}) {
  const face = CUBE_FACES[faceIndex];
  const N = resolution;
  const side = N + 1;
  const g = N + 3;

  const gridPos = new Float64Array(g * g * 3);
  const gridHeight = new Float32Array(g * g);
  const gridMoist = new Float32Array(g * g);
  const gridCrack = new Float32Array(g * g);
  const gridSea = new Float32Array(g * g);

  const dir = new THREE.Vector3();
  const sample = { height: 0, moisture: 0, crack: 0, sea: 0 };

  // 1. Sample terrain on the bordered grid
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let j = 0; j < g; j++) {
    const v = v0 + ((j - 1) / N) * size;
    for (let i = 0; i < g; i++) {
      const u = u0 + ((i - 1) / N) * size;
      cubeToSphere(u, v, face, dir);
      sampleTerrain(dir, seed, profile, sample, detailOctaves);
      const r = radius + sample.height;
      const k = j * g + i;
      gridPos[k * 3] = dir.x * r;
      gridPos[k * 3 + 1] = dir.y * r;
      gridPos[k * 3 + 2] = dir.z * r;
      gridHeight[k] = sample.height;
      gridMoist[k] = sample.moisture;
      gridCrack[k] = sample.crack;
      gridSea[k] = sample.sea;
      if (i > 0 && j > 0 && i < g - 1 && j < g - 1) {
        if (sample.height < minHeight) minHeight = sample.height;
        if (sample.height > maxHeight) maxHeight = sample.height;
      }
    }
  }

  const mid = (Math.floor(N / 2) + 1) * g + (Math.floor(N / 2) + 1);
  const cx = gridPos[mid * 3];
  const cy = gridPos[mid * 3 + 1];
  const cz = gridPos[mid * 3 + 2];

  const edgeCount = skirtDepth > 0 ? 4 * N : 0;
  const vertCount = side * side + (skirtDepth > 0 ? 4 * side : 0);
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);

  const n = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const vColor = new THREE.Color();

  // 2. Interior vertices with central-difference normals
  let vi = 0;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = (j + 1) * g + (i + 1);
      const kL = k - 1, kR = k + 1, kD = k - g, kU = k + g;

      a.set(gridPos[kR * 3] - gridPos[kL * 3], gridPos[kR * 3 + 1] - gridPos[kL * 3 + 1], gridPos[kR * 3 + 2] - gridPos[kL * 3 + 2]);
      b.set(gridPos[kU * 3] - gridPos[kD * 3], gridPos[kU * 3 + 1] - gridPos[kD * 3 + 1], gridPos[kU * 3 + 2] - gridPos[kD * 3 + 2]);
      n.crossVectors(a, b).normalize();

      const px = gridPos[k * 3], py = gridPos[k * 3 + 1], pz = gridPos[k * 3 + 2];
      dir.set(px, py, pz).normalize();
      if (n.dot(dir) < 0) n.negate();

      positions[vi * 3] = px - cx;
      positions[vi * 3 + 1] = py - cy;
      positions[vi * 3 + 2] = pz - cz;
      normals[vi * 3] = n.x;
      normals[vi * 3 + 1] = n.y;
      normals[vi * 3 + 2] = n.z;

      // Slope: 0 = flat perpendicular to radial, 1 = steep vertical cliff
      const slope = Math.max(0.0, Math.min(1.0, 1.0 - n.dot(dir)));
      sample.height = gridHeight[k];
      sample.moisture = gridMoist[k];
      sample.crack = gridCrack[k];
      sample.sea = gridSea[k];
      computeTerrainVertexColor(sample, slope, dir, profile, vColor);
      colors[vi * 3] = vColor.r;
      colors[vi * 3 + 1] = vColor.g;
      colors[vi * 3 + 2] = vColor.b;
      vi++;
    }
  }

  // 3. Skirt: a copy of the border ring pushed toward the core, hiding T-junction cracks
  //    against neighbouring patches of a different level of detail
  const edgeIndex = (e, t) => {
    // e: 0 bottom (j=0), 1 right (i=N), 2 top (j=N), 3 left (i=0); t runs 0..N
    if (e === 0) return t;
    if (e === 1) return t * side + N;
    if (e === 2) return N * side + t;
    return t * side;
  };
  const skirtBase = vi;
  if (skirtDepth > 0) {
    for (let e = 0; e < 4; e++) {
      for (let t = 0; t <= N; t++) {
        const src = edgeIndex(e, t);
        const px = positions[src * 3] + cx;
        const py = positions[src * 3 + 1] + cy;
        const pz = positions[src * 3 + 2] + cz;
        const len = Math.sqrt(px * px + py * py + pz * pz);
        const f = (len - skirtDepth) / len;
        positions[vi * 3] = px * f - cx;
        positions[vi * 3 + 1] = py * f - cy;
        positions[vi * 3 + 2] = pz * f - cz;
        normals[vi * 3] = normals[src * 3];
        normals[vi * 3 + 1] = normals[src * 3 + 1];
        normals[vi * 3 + 2] = normals[src * 3 + 2];
        colors[vi * 3] = colors[src * 3];
        colors[vi * 3 + 1] = colors[src * 3 + 1];
        colors[vi * 3 + 2] = colors[src * 3 + 2];
        vi++;
      }
    }
  }

  const indices = buildPatchIndices(N, vertCount, skirtDepth > 0 ? skirtBase : -1, edgeIndex);

  const result = {
    positions, normals, colors, indices,
    center: [cx, cy, cz],
    minHeight, maxHeight,
    liquid: null
  };

  // 4. Optional sea-level patch (water or lava) with the same grid and its own skirt
  if (withLiquid && minHeight < 0) {
    const lPos = new Float32Array(vertCount * 3);
    const lNorm = new Float32Array(vertCount * 3);
    let li = 0;
    for (let j = 0; j <= N; j++) {
      const v = v0 + (j / N) * size;
      for (let i = 0; i <= N; i++) {
        const u = u0 + (i / N) * size;
        cubeToSphere(u, v, face, dir);
        lPos[li * 3] = dir.x * radius - cx;
        lPos[li * 3 + 1] = dir.y * radius - cy;
        lPos[li * 3 + 2] = dir.z * radius - cz;
        lNorm[li * 3] = dir.x;
        lNorm[li * 3 + 1] = dir.y;
        lNorm[li * 3 + 2] = dir.z;
        li++;
      }
    }
    if (skirtDepth > 0) {
      const liquidSkirt = Math.min(skirtDepth, radius * 0.002);
      for (let e = 0; e < 4; e++) {
        for (let t = 0; t <= N; t++) {
          const src = edgeIndex(e, t);
          const px = lPos[src * 3] + cx, py = lPos[src * 3 + 1] + cy, pz = lPos[src * 3 + 2] + cz;
          const f = (radius - liquidSkirt) / radius;
          lPos[li * 3] = px * f - cx;
          lPos[li * 3 + 1] = py * f - cy;
          lPos[li * 3 + 2] = pz * f - cz;
          lNorm[li * 3] = lNorm[src * 3];
          lNorm[li * 3 + 1] = lNorm[src * 3 + 1];
          lNorm[li * 3 + 2] = lNorm[src * 3 + 2];
          li++;
        }
      }
    }
    result.liquid = { positions: lPos, normals: lNorm, indices: indices.slice() };
  }

  return result;
}

function buildPatchIndices(N, vertCount, skirtBase, edgeIndex) {
  const side = N + 1;
  const skirtTris = skirtBase >= 0 ? 4 * N * 4 : 0; // both windings
  const count = N * N * 6 + skirtTris * 3;
  const indices = vertCount < 65535 ? new Uint16Array(count) : new Uint32Array(count);
  let o = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const ia = j * side + i;
      const ib = ia + 1;
      const ic = (j + 1) * side + i;
      const id = ic + 1;
      indices[o++] = ia; indices[o++] = ib; indices[o++] = ic;
      indices[o++] = ib; indices[o++] = id; indices[o++] = ic;
    }
  }
  if (skirtBase >= 0) {
    for (let e = 0; e < 4; e++) {
      for (let t = 0; t < N; t++) {
        const a = edgeIndex(e, t);
        const b = edgeIndex(e, t + 1);
        const as = skirtBase + e * side + t;
        const bs = as + 1;
        // Skirts are seen from either side depending on which neighbour is higher
        indices[o++] = a; indices[o++] = as; indices[o++] = b;
        indices[o++] = b; indices[o++] = as; indices[o++] = bs;
        indices[o++] = a; indices[o++] = b; indices[o++] = as;
        indices[o++] = b; indices[o++] = bs; indices[o++] = as;
      }
    }
  }
  return indices;
}

/**
 * Wraps chunk data (from buildChunkData) in a BufferGeometry.
 */
export function chunkDataToGeometry(data) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  if (data.colors) geom.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geom.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geom.computeBoundingSphere();
  return geom;
}

/**
 * Generates a whole displaced cube-sphere as one BufferGeometry (no skirts),
 * with positions relative to the planet center.
 *
 * @param {number} planetRadius Base sphere radius
 * @param {number|string} planetSeed Planet seed number
 * @param {Object} profile Terrain profile
 * @param {number} resolution Number of segments along each edge of a cube face (e.g. 16, 32, 64)
 * @returns {THREE.BufferGeometry}
 */
export function createCubeSphereGeometry(planetRadius, planetSeed, profile, resolution = 32) {
  const side = resolution + 1;
  const perFace = side * side;
  const totalVertices = perFace * 6;
  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const colors = new Float32Array(totalVertices * 3);
  const uvs = new Float32Array(totalVertices * 2);
  const perFaceIdx = resolution * resolution * 6;
  const indices = totalVertices < 65535 ? new Uint16Array(perFaceIdx * 6) : new Uint32Array(perFaceIdx * 6);

  for (let f = 0; f < 6; f++) {
    const d = buildChunkData({
      radius: planetRadius, seed: planetSeed, profile, face: f,
      u0: -1, v0: -1, size: 2, resolution, detailOctaves: 0
    });
    for (let k = 0; k < perFace; k++) {
      const o = (f * perFace + k) * 3;
      positions[o] = d.positions[k * 3] + d.center[0];
      positions[o + 1] = d.positions[k * 3 + 1] + d.center[1];
      positions[o + 2] = d.positions[k * 3 + 2] + d.center[2];
      normals[o] = d.normals[k * 3];
      normals[o + 1] = d.normals[k * 3 + 1];
      normals[o + 2] = d.normals[k * 3 + 2];
      colors[o] = d.colors[k * 3];
      colors[o + 1] = d.colors[k * 3 + 1];
      colors[o + 2] = d.colors[k * 3 + 2];
      uvs[(f * perFace + k) * 2] = (k % side) / resolution;
      uvs[(f * perFace + k) * 2 + 1] = Math.floor(k / side) / resolution;
    }
    for (let k = 0; k < perFaceIdx; k++) {
      indices[f * perFaceIdx + k] = d.indices[k] + f * perFace;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeBoundingSphere();
  return geom;
}
