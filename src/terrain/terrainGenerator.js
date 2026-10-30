import * as THREE from 'three';
import { SimplexNoise3D, CraterField, VolcanoField } from './terrainNoise.js';
import { TERRAIN_MIN_SPACING } from '../utils/scale.js';

// Fine surface detail: octaves start at this frequency (on the unit sphere) and double,
// with amplitude proportional to wavelength so slopes stay similar at every scale.
const MICRO_BASE_FREQ = 64;
const MICRO_SLOPE = 0.012;

// Cache noise samplers by seed so evaluations are high-performance and allocation-free
const samplerCache = new Map();

/**
 * Gets or creates the deterministic noise & feature sampler for a given seed and profile.
 *
 * On creation the raw continent noise is sampled over the whole sphere so sea level
 * can be placed at an exact quantile: `oceanFraction: 0.6` really floods 60% of the surface,
 * and land/sea heights are normalized to the planet's actual noise range.
 */
export function getTerrainSampler(seed, profile) {
  const seedNum = typeof seed === 'number' ? seed : hashSeed(seed);
  const cacheKey = `${seedNum}_${profile.type}_${profile.variant}_${profile.oceanFraction}_${profile.planetRadius}`;
  let sampler = samplerCache.get(cacheKey);
  if (!sampler) {
    sampler = {
      simplex: new SimplexNoise3D(seedNum),
      detailNoise: new SimplexNoise3D((seedNum * 1664525 + 1013904223) >>> 0),
      warpNoise: new SimplexNoise3D((seedNum ^ 0x5bd1e995) >>> 0),
      craters: new CraterField(seedNum + 777, profile.craterCount || 0),
      smallCraters: new CraterField(seedNum + 991, profile.smallCraterCount || 0, { minRadius: 0.008, maxRadius: 0.045 }),
      volcanoes: new VolcanoField(seedNum + 313, profile.volcanoCount || 0),
      threshold: 0,
      landSpan: 1,
      seaSpan: 1,
      maxDetailOctaves: getMaxDetailOctaves(profile.planetRadius)
    };

    const N = 2048;
    const values = new Float32Array(N);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * i + 1) / N;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      values[i] = continentRaw(sampler, profile, r * Math.cos(theta), y, r * Math.sin(theta), _warp);
    }
    values.sort();
    const q = (f) => values[Math.min(N - 1, Math.max(0, Math.floor(f * N)))];
    sampler.threshold = q(profile.oceanFraction ?? 0.4);
    sampler.landSpan = Math.max(1e-3, q(0.985) - sampler.threshold);
    sampler.seaSpan = Math.max(1e-3, sampler.threshold - q(0.015));

    samplerCache.set(cacheKey, sampler);
  }
  return sampler;
}

const _warp = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0 };

/**
 * Number of fine-detail octaves worth evaluating for a mesh with the given vertex spacing.
 * Octaves shorter than ~4 vertex spacings would only alias, so they are skipped.
 *
 * @param {number} planetRadius
 * @param {number} [spacing] Vertex spacing in world units (defaults to the finest terrain spacing)
 */
export function getMaxDetailOctaves(planetRadius, spacing = TERRAIN_MIN_SPACING) {
  const circumference = 2 * Math.PI * (planetRadius || 700);
  const octaves = Math.floor(Math.log2(circumference / (MICRO_BASE_FREQ * 4 * spacing)));
  const max = Math.floor(Math.log2(circumference / (MICRO_BASE_FREQ * 4 * TERRAIN_MIN_SPACING)));
  return Math.max(0, Math.min(max, octaves));
}

/**
 * Domain-warped low-frequency continent noise. Writes the warped position into `w`
 * so mountains and canyons can follow the same swirled coastlines.
 */
function continentRaw(sampler, profile, x, y, z, w) {
  const W = sampler.warpNoise;
  const wf = 1.1 * profile.continentFreq;
  const qx = W.fbm(x * wf + 3.1, y * wf, z * wf, 3);
  const qy = W.fbm(x * wf, y * wf + 7.7, z * wf + 1.3, 3);
  const qz = W.fbm(x * wf + 5.9, y * wf + 2.2, z * wf, 3);
  w.qx = qx; w.qy = qy; w.qz = qz;
  w.x = x + profile.warp * qx;
  w.y = y + profile.warp * qy;
  w.z = z + profile.warp * qz;
  const cf = profile.continentFreq;
  return sampler.simplex.fbm(w.x * cf, w.y * cf, w.z * cf, 6, 2.0, 0.5);
}

const _sample = { height: 0, moisture: 0, crack: 0, sea: 0 };

/**
 * Full terrain sample at a unit direction.
 *
 * @returns {{ height: number, moisture: number, crack: number, sea: number }}
 *   height   – elevation in kilometers relative to the base radius (sea level)
 *   moisture – 0..1 field used to vary vegetation / ground colors
 *   crack    – 0..1 strength of canyon / ice-crack features
 *   sea      – 0..1, how far into the ocean/basin region this point is
 */
export function sampleTerrain(direction, planetSeed, profile, out = _sample, detailOctaves = -1) {
  out.height = 0; out.moisture = 0.5; out.crack = 0; out.sea = 0;
  if (!profile || !profile.hasTerrain) return out;

  const x = direction.x;
  const y = direction.y;
  const z = direction.z;

  const S = getTerrainSampler(planetSeed, profile);
  const N = S.simplex;
  const D = S.detailNoise;
  const w = _warp;

  // 1. Continents and ocean basins
  const raw = continentRaw(S, profile, x, y, z, w);
  let land = 0;
  let depth = 0;
  let h;
  if (raw >= S.threshold) {
    land = Math.min(1, (raw - S.threshold) / S.landSpan);
    h = profile.plainsHeight * Math.pow(land, 1.4);
  } else {
    depth = Math.min(1.3, (S.threshold - raw) / S.seaSpan);
    // Shallow continental shelf, then a slope down to the abyssal plain
    const shelf = 0.05;
    h = -(shelf * smoothstep(0, 0.06, depth) + (profile.oceanDepth - shelf) * smoothstep(0.12, 0.7, depth));
  }
  out.sea = smoothstep(0, 0.05, depth);

  const landMask = Math.max(smoothstep(0.02, 0.22, land), profile.basinMountains * (1 - out.sea * 0.5));

  // 2. Mountain ranges: ridged noise concentrated along sinuous belts
  const bf = profile.beltFreq;
  const belt = 1 - smoothstep(0, profile.beltWidth, Math.abs(N.noise(w.x * bf + 11.3, w.y * bf - 4.1, w.z * bf + 2.7)));
  const mf = profile.mountainFreq;
  const ridge = D.ridged(w.x * mf, w.y * mf, w.z * mf, 5, 2.1, 0.5);
  h += profile.mountainHeight * landMask * (belt * ridge * ridge * 1.8 + profile.ruggedness * ridge);

  // 3. Rolling hills
  const hf = profile.hillFreq;
  h += profile.hillAmp * D.fbm(x * hf, y * hf, z * hf, 4, 2.0, 0.5) * (0.4 + 0.6 * landMask) * (1 - 0.8 * out.sea);

  // 4. Mesas / stepped plateaus, only in some regions
  if (profile.terraceSteps > 0 && h > 0) {
    const mesaMask = smoothstep(-0.15, 0.25, N.noise(x * 2.3 + 40, y * 2.3, z * 2.3)) * profile.terraceAmount;
    if (mesaMask > 0) {
      const steps = profile.terraceSteps;
      const f = h * steps;
      const fl = Math.floor(f);
      const stepped = (fl + smoothstep(0.35, 0.65, f - fl)) / steps;
      h += (stepped - h) * mesaMask;
    }
  }

  // 5. Canyons / ice cracks: sinuous valleys that follow the warp field
  if (profile.canyonDepth > 0) {
    const cf = profile.canyonFreq;
    const n = D.noise(w.x * cf + w.qx * 1.5, w.y * cf + w.qy * 1.5, w.z * cf + w.qz * 1.5);
    const v = 1 - smoothstep(0, profile.canyonWidth, Math.abs(n));
    const region = smoothstep(-0.25, 0.25, N.noise(x * 1.7 + 70, y * 1.7, z * 1.7));
    out.crack = v * region;
    h -= profile.canyonDepth * out.crack;
  }

  // 6. Dune fields on low flat ground (anisotropic noise gives long parallel crests)
  if (profile.duneAmp > 0) {
    const df = profile.duneFreq;
    const d = 1 - Math.abs(D.noise(x * df, y * df * 0.3, z * df));
    const flat = 1 - smoothstep(0.12, 0.35, h);
    const field = smoothstep(-0.2, 0.3, N.noise(x * 3.1 - 20, y * 3.1, z * 3.1));
    h += d * d * profile.duneAmp * flat * field;
  }

  // 7. What fills the basins
  if (h < 0) {
    if (profile.seaSurface === 'ice') {
      // Frozen ocean: flat ice sheet with low pressure ridges
      h = 0.004 + 0.012 * D.ridged(x * 18, y * 18, z * 18, 2);
    } else if (profile.mariaFlatten > 0) {
      // Smooth lava-flooded plains (lunar maria)
      h *= 1 - profile.mariaFlatten;
    }
  }

  // Sea ice at the poles of water worlds
  if (profile.polarIce > 0 && h < 0.006) {
    const lat = Math.abs(y) + 0.05 * N.noise(x * 6, y * 6, z * 6);
    const ice = smoothstep(profile.polarIce - 0.02, profile.polarIce + 0.02, lat);
    h += (0.006 - h) * ice;
  }

  // 8. Impacts and volcanoes
  if (profile.craterWeight > 0) {
    h += profile.craterWeight * (S.craters.getElevation(x, y, z) + 0.6 * S.smallCraters.getElevation(x, y, z));
  }
  if (profile.volcanoCount > 0) {
    h += profile.volcanoHeight * S.volcanoes.getElevation(x, y, z);
  }

  out.moisture = Math.min(1, Math.max(0, 0.5 + 1.6 * D.fbm(x * 2.4 + 19, y * 2.4, z * 2.4, 3)));

  // 9. Fine detail (rocks, bumps, gullies) – only as many octaves as the caller can resolve
  const octaves = detailOctaves < 0 ? S.maxDetailOctaves : Math.min(detailOctaves, S.maxDetailOctaves);
  if (octaves > 0) {
    const frozenOrFlooded = h <= 0.02 && (profile.seaSurface === 'ice' || profile.mariaFlatten > 0);
    const rough = (frozenOrFlooded ? 0.25 : 0.35 + 0.65 * landMask) * (profile.duneAmp > 0 ? 0.6 : 1.0);
    let freq = MICRO_BASE_FREQ;
    let amp = rough * MICRO_SLOPE * (2 * Math.PI * profile.planetRadius / MICRO_BASE_FREQ) / profile.maxElevation;
    for (let k = 0; k < octaves; k++) {
      h += amp * D.noise(x * freq + 17.3, y * freq - 9.1, z * freq + 4.7);
      freq *= 2;
      amp *= 0.5;
    }
  }

  // Scale to world kilometers (units), clamped within nominal bounds
  let finalHeight = h * profile.maxElevation;
  if (finalHeight < profile.minElevation) finalHeight = profile.minElevation;
  if (finalHeight > profile.maxElevation * 1.25) finalHeight = profile.maxElevation * 1.25;
  out.height = finalHeight;
  return out;
}

/**
 * Evaluates the deterministic terrain elevation displacement in kilometers (units)
 * for a given normalized spherical direction vector.
 *
 * @param {THREE.Vector3|Object} direction Unit vector on sphere { x, y, z }
 * @param {number|string} planetSeed Planet seed number
 * @param {Object} profile Terrain profile from getTerrainProfile
 * @returns {number} Elevation displacement in kilometers (negative below sea level)
 */
export function getTerrainHeight(direction, planetSeed, profile) {
  if (!profile || !profile.hasTerrain) return 0.0;
  return sampleTerrain(direction, planetSeed, profile, _sample).height;
}

/**
 * Height of the surface something can stand or rest on: the terrain, or the top of a
 * water / lava sea where the terrain is below sea level.
 */
export function getSolidSurfaceHeight(direction, planetSeed, profile) {
  const h = getTerrainHeight(direction, planetSeed, profile);
  if (profile && (profile.seaSurface === 'water' || profile.seaSurface === 'lava') && h < 0) return 0;
  return h;
}

/**
 * Computes 3D world position on the displaced terrain surface.
 *
 * @param {THREE.Vector3} direction Unit vector from body center
 * @param {number} baseRadius Base spherical radius of the body
 * @param {number|string} planetSeed Planet seed
 * @param {Object} profile Terrain profile
 * @param {THREE.Vector3} [target] Output vector
 * @returns {THREE.Vector3} Displaced position vector
 */
export function getSurfacePosition(direction, baseRadius, planetSeed, profile, target = new THREE.Vector3()) {
  const height = getTerrainHeight(direction, planetSeed, profile);
  return target.copy(direction).multiplyScalar(baseRadius + height);
}

const _snUp = new THREE.Vector3();
const _snTangentU = new THREE.Vector3();
const _snTangentV = new THREE.Vector3();
const _snDirU = new THREE.Vector3();
const _snDirV = new THREE.Vector3();
const _snP0 = new THREE.Vector3();
const _snPU = new THREE.Vector3();
const _snPV = new THREE.Vector3();
const _snDU = new THREE.Vector3();
const _snDV = new THREE.Vector3();

/**
 * Computes the perturbed surface normal vector on the terrain using finite differences.
 *
 * @param {THREE.Vector3} direction Unit vector
 * @param {number} baseRadius Base radius
 * @param {number|string} planetSeed Planet seed
 * @param {Object} profile Terrain profile
 * @param {THREE.Vector3} [target] Output normal vector
 * @returns {THREE.Vector3} Normalized surface normal
 */
export function getSurfaceNormal(direction, baseRadius, planetSeed, profile, target = new THREE.Vector3()) {
  const eps = 0.003; // Angular step

  // Build two orthogonal tangent vectors to direction
  if (Math.abs(direction.y) < 0.99) {
    _snUp.set(0, 1, 0);
  } else {
    _snUp.set(1, 0, 0);
  }
  _snTangentU.crossVectors(direction, _snUp).normalize();
  _snTangentV.crossVectors(direction, _snTangentU).normalize();

  // Perturbed sample directions
  _snDirU.copy(direction).addScaledVector(_snTangentU, eps).normalize();
  _snDirV.copy(direction).addScaledVector(_snTangentV, eps).normalize();

  getSurfacePosition(direction, baseRadius, planetSeed, profile, _snP0);
  getSurfacePosition(_snDirU, baseRadius, planetSeed, profile, _snPU);
  getSurfacePosition(_snDirV, baseRadius, planetSeed, profile, _snPV);

  _snDU.subVectors(_snPU, _snP0);
  _snDV.subVectors(_snPV, _snP0);

  return target.crossVectors(_snDU, _snDV).normalize();
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function hashSeed(seed) {
  let str = String(seed);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}
