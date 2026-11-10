import * as THREE from 'three';
import { applyCelestialShadows } from '../visuals/shadows.js';

// Cheap 3D value noise shared by the terrain and lava shaders
// Radius (units) of the on-foot water effects around the camera (1 unit = 100 m)
// Translucent at player's feet (< 2.5 m), smoothly transitions to 100% opaque by 8 m
const WATER_FX_NEAR = 0.025;
const WATER_FX_FAR = 0.08;

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
      // Finer octaves only run where they are visible (each one is 8 hashes per pixel)
      if (camDist < 60.0) {
        tex += (tnNoise(tp * 0.9) - 0.5) * 0.12 * (1.0 - smoothstep(15.0, 60.0, camDist));
        if (camDist < 6.0) {
          tex += (tnNoise(tp * 9.0) - 0.5) * 0.12 * (1.0 - smoothstep(1.5, 6.0, camDist));
          if (camDist < 0.6) {
            tex += (tnNoise(tp * 80.0) - 0.5) * 0.10 * (1.0 - smoothstep(0.15, 0.6, camDist));
          }
        }
      }
      float strata = sin((length(tp) - uPlanetRadius) * uStrataFreq) * uStrata;
      diffuseColor.rgb = clamp(diffuseColor.rgb * (1.0 + tex + strata), 0.0, 1.0);
      `
    );
  };

  applyCelestialShadows(material);
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
    // Water material: solid and opaque everywhere by default, with depth write enabled
    // so atmosphere and sky never leak through. Polygon offset avoids coastline z-fighting.
    const mat = new THREE.MeshStandardMaterial({
      color: profile.liquid.color,
      roughness: 0.14,
      metalness: 0.02,
      transparent: true,
      opacity: 1.0,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -4.0,
      side: THREE.FrontSide
    });

    const uniforms = {
      uChunkOffset: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      // 1 when the camera is at walking altitude, fades to 0 by ~12 m up
      uOnFoot: { value: 0 }
    };
    mat.userData.terrainUniforms = uniforms;

    // Translucency and gentle wave normals only exist in a small bubble around the camera (< 8 m):
    // full effect at player's feet (< 2.5 m), smoothly transitions to 100% opaque by 8 m.
    // Beyond that, the water is completely solid and opaque, preventing any see-through planet artifacts.
    const waterGlsl = `
      uniform float uTime;
      uniform float uOnFoot;
      varying vec3 vLiquidLocalPos;
      float waterFx(float camDist) {
        return uOnFoot * (1.0 - smoothstep(${WATER_FX_NEAR.toFixed(3)}, ${WATER_FX_FAR.toFixed(3)}, camDist));
      }
    `;

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = `
        uniform vec3 uChunkOffset;
        varying vec3 vLiquidLocalPos;
        ${shader.vertexShader}
      `.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vLiquidLocalPos = position + uChunkOffset;
        `
      );

      shader.fragmentShader = `
        ${waterGlsl}
        ${shader.fragmentShader}
      `.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        float camDist = length(vViewPosition);
        float waterFxAmt = uOnFoot > 0.001 ? waterFx(camDist) : 0.0;
        if (waterFxAmt > 0.001) {
          // Fresnel factor: looking straight down is see-through, grazing angles reflect
          float fresnel = pow(1.0 - max(0.0, dot(normalize(vNormal), normalize(vViewPosition))), 2.5);

          // Analytic low-frequency wave phases (smooth, zero coordinate jitter)
          float t = uTime * 2.0;
          float p1 = vLiquidLocalPos.x * 16.0 + vLiquidLocalPos.z * 12.0 + t;
          float p2 = -vLiquidLocalPos.x * 11.0 + vLiquidLocalPos.z * 15.0 - t * 1.3;
          float waveShimmer = (sin(p1) + sin(p2)) * 0.025;

          // Water tint highlight near shore
          vec3 waterTint = diffuseColor.rgb * 1.25 + vec3(0.02, 0.07, 0.10);
          diffuseColor.rgb = mix(diffuseColor.rgb, clamp(waterTint + waveShimmer, 0.0, 1.0), waterFxAmt * 0.5);

          // Translucency: ~0.42 looking down so the seabed shows, ~0.88 at grazing angles
          float downAlpha = 0.42;
          float footAlpha = mix(downAlpha, 0.88, fresnel);

          // Blend with distance: translucent right at player's feet, 100% opaque beyond WATER_FX_FAR
          diffuseColor.a = mix(1.0, footAlpha, waterFxAmt);
        } else {
          // Beyond the near bubble, ocean is 100% solid and opaque everywhere
          diffuseColor.a = 1.0;
        }
        `
      ).replace(
        '#include <normal_fragment_maps>',
        `
        #include <normal_fragment_maps>
        if (waterFxAmt > 0.001) {
          float t = uTime * 2.0;
          float p1 = vLiquidLocalPos.x * 16.0 + vLiquidLocalPos.z * 12.0 + t;
          float p2 = -vLiquidLocalPos.x * 11.0 + vLiquidLocalPos.z * 15.0 - t * 1.3;
          // Exact analytic cosine derivatives: mathematically smooth, zero dFdx/dFdy aliasing or flickering
          vec3 slope = vec3(
            (16.0 * cos(p1) - 11.0 * cos(p2)) * 0.0012,
            0.0,
            (12.0 * cos(p1) + 15.0 * cos(p2)) * 0.0012
          );
          normal = normalize(normal - slope * waterFxAmt);
        }
        `
      );
    };

    applyCelestialShadows(mat);
    return mat;
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
  applyCelestialShadows(mat);
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
