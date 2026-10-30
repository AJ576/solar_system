import * as THREE from 'three';

// Cheap 3D value noise shared by the terrain and lava shaders
const GLSL_VALUE_NOISE = /* glsl */`
  float tnHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float tnNoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(tnHash(i), tnHash(i + vec3(1,0,0)), f.x),
                   mix(tnHash(i + vec3(0,1,0)), tnHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(tnHash(i + vec3(0,0,1)), tnHash(i + vec3(1,0,1)), f.x),
                   mix(tnHash(i + vec3(0,1,1)), tnHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`;

/**
 * Creates the terrain material for a planet's biome profile.
 *
 * MeshStandardMaterial with vertex colors, plus an onBeforeCompile hook that adds
 * multi-scale surface texture in the fragment shader. Finer noise scales fade in as the
 * camera gets close, so the ground still has grain when you are standing on it.
 *
 * Terrain chunks store positions relative to their own center; each chunk mesh calls
 * `bindTerrainChunk` so the shader can rebuild planet-local positions for the noise.
 *
 * @param {Object} profile Terrain profile from getTerrainProfile
 * @returns {THREE.MeshStandardMaterial}
 */
export function createTerrainMaterial(profile) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: profile.seaSurface === 'ice' ? 0.6 : 0.92,
    metalness: 0.0,
    flatShading: false
  });

  const strataAmount = profile.terraceSteps > 0 ? 0.05 : 0.0;
  const uniforms = {
    uChunkOffset: { value: new THREE.Vector3() },
    uStrata: { value: strataAmount },
    uStrataFreq: { value: (profile.terraceSteps || 1) * 6.0 / Math.max(1, profile.maxElevation) },
    uPlanetRadius: { value: profile.planetRadius || 700.0 }
  };
  material.userData.terrainUniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = `
      uniform vec3 uChunkOffset;
      varying vec3 vTerrainLocalPos;
      ${shader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vTerrainLocalPos = position + uChunkOffset;
      `
    );

    shader.fragmentShader = `
      varying vec3 vTerrainLocalPos;
      uniform float uStrata;
      uniform float uStrataFreq;
      uniform float uPlanetRadius;
      ${GLSL_VALUE_NOISE}
      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      vec3 tp = vTerrainLocalPos;
      float camDist = length(vViewPosition);
      float tex = (tnNoise(tp * 0.08) - 0.5) * 0.14;
      tex += (tnNoise(tp * 0.9) - 0.5) * 0.12 * (1.0 - smoothstep(15.0, 60.0, camDist));
      tex += (tnNoise(tp * 9.0) - 0.5) * 0.12 * (1.0 - smoothstep(1.5, 6.0, camDist));
      tex += (tnNoise(tp * 80.0) - 0.5) * 0.10 * (1.0 - smoothstep(0.15, 0.6, camDist));
      float strata = sin((length(tp) - uPlanetRadius) * uStrataFreq) * uStrata;
      diffuseColor.rgb = clamp(diffuseColor.rgb * (1.0 + tex + strata), 0.0, 1.0);
      `
    );
  };

  return material;
}

/**
 * Points a chunk mesh at its planet-local offset before it draws (the terrain material
 * is shared by every chunk of a planet).
 */
export function bindTerrainChunk(mesh) {
  mesh.onBeforeRender = (renderer, scene, camera, geometry, material) => {
    const u = material.userData.terrainUniforms;
    if (u) {
      u.uChunkOffset.value.copy(mesh.position);
      material.uniformsNeedUpdate = true;
    }
  };
}

/**
 * Material for sea-level patches on worlds with a liquid surface (water or lava).
 * Returns null for worlds whose basins are dry or frozen.
 *
 * @param {Object} profile Terrain profile
 * @returns {THREE.Material|null}
 */
export function createLiquidMaterial(profile) {
  if (!profile?.liquid || (profile.seaSurface !== 'water' && profile.seaSurface !== 'lava')) return null;

  if (profile.seaSurface === 'water') {
    // Translucent so the shallow seabed colors show through near coasts
    return new THREE.MeshStandardMaterial({
      color: profile.liquid.color,
      roughness: 0.16,
      metalness: 0.0,
      transparent: true,
      opacity: profile.liquid.opacity ?? 0.8
    });
  }

  const mat = new THREE.MeshStandardMaterial({
    color: profile.liquid.color,
    emissive: profile.liquid.emissive,
    emissiveIntensity: 1.4,
    roughness: 0.7,
    metalness: 0.0
  });
  const uniforms = { uChunkOffset: { value: new THREE.Vector3() } };
  mat.userData.terrainUniforms = uniforms;
  // Cooling crust: darken the glow in a cellular-ish noise pattern
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `uniform vec3 uChunkOffset;\nvarying vec3 vLavaPos;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvLavaPos = position + uChunkOffset;'
    );
    shader.fragmentShader = `
      varying vec3 vLavaPos;
      ${GLSL_VALUE_NOISE}
      ${shader.fragmentShader}
    `.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float crust = tnNoise(vLavaPos * 0.05) * 0.6 + tnNoise(vLavaPos * 0.2) * 0.4;
      totalEmissiveRadiance *= (1.0 - smoothstep(0.35, 0.75, crust)) * 0.9 + 0.1;`
    );
  };
  return mat;
}

// THREE.Color palettes are cached per planet so per-vertex coloring is allocation-free
// (keyed by value, since workers receive a fresh copy of the profile with every request)
const paletteCache = new Map();
function getPaletteColors(profile) {
  const key = `${profile.seedNum}_${profile.variant}_${profile.planetRadius}`;
  let colors = paletteCache.get(key);
  if (!colors) {
    colors = {};
    for (const [key, hex] of Object.entries(profile.palette)) {
      colors[key] = new THREE.Color(hex);
    }
    paletteCache.set(key, colors);
  }
  return colors;
}

const _base = new THREE.Color();

/**
 * Computes vertex color from elevation, slope, latitude and the biome palette.
 *
 * @param {{ height: number, moisture: number, crack: number, sea: number }} sample From sampleTerrain
 * @param {number} slope Slope factor (0 = flat, 1 = vertical cliff)
 * @param {{ y: number }} dir Unit direction (y is the spin axis, used for latitude)
 * @param {Object} profile Terrain profile
 * @param {THREE.Color} [target] Output color
 * @returns {THREE.Color}
 */
export function computeTerrainVertexColor(sample, slope, dir, profile, target = new THREE.Color()) {
  const P = getPaletteColors(profile);
  const hN = sample.height / Math.max(1e-4, profile.maxElevation);
  const isLiquid = profile.seaSurface === 'water' || profile.seaSurface === 'lava';

  if (hN < 0) {
    // Seabed / basin floor: shallow → deep
    const d = smoothstep(0.0, isLiquid ? 0.25 : 0.4, -hN);
    target.copy(P.shallow).lerp(P.deep, d);
  } else if (profile.seaSurface === 'ice' && sample.sea > 0.5) {
    // Frozen sea surface, bluer where it is thin over the coast
    target.copy(P.deep).lerp(P.shallow, 0.5 + 0.5 * sample.moisture);
  } else {
    // Land: ground cover varies with moisture, then rises through mid to high colors
    _base.copy(P.low).lerp(P.lowAlt, sample.moisture);
    if (hN < 0.35) {
      target.copy(_base).lerp(P.mid, smoothstep(0.08, 0.35, hN));
    } else {
      target.copy(P.mid).lerp(P.high, smoothstep(0.35, 0.8, hN));
    }
    // Beaches / shorelines just above the liquid
    if (isLiquid) {
      target.lerp(P.beach, 1 - smoothstep(0.006, 0.025, hN));
    }
  }

  // Canyon floors and ice cracks
  if (sample.crack > 0) {
    target.lerp(P.crack, smoothstep(0.2, 0.9, sample.crack) * 0.75);
  }

  // Exposed rock on cliffs
  const rock = smoothstep(0.12, 0.3, slope);
  target.lerp(P.rock, rock * 0.85);

  // Snow from a simple temperature model: cold at the poles and up high
  const c = profile.climate;
  if (c && c.snowTemp > -1) {
    const lat = Math.abs(dir.y);
    const temp = 1 - lat * lat * lat * c.latWeight - Math.max(0, hN) * c.altWeight + (sample.moisture - 0.5) * 0.12;
    let snow = smoothstep(c.snowTemp + 0.04, c.snowTemp - 0.04, temp);
    snow *= 1 - smoothstep(0.2, 0.45, slope) * 0.75; // snow slides off steep cliffs
    if ((hN < 0 && isLiquid) || (profile.seaSurface === 'ice' && sample.sea > 0.5)) snow = 0;
    target.lerp(P.snow, snow);
  }

  // Polar sea ice
  if (profile.polarIce > 0 && hN >= 0 && hN < 0.01 && sample.sea > 0.5) {
    target.copy(P.snow);
  }

  return target;
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
