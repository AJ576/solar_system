import * as THREE from 'three';

/**
 * Analytical Celestial Shadows and Eclipses
 *
 * Implements real-time mathematical shadows without shadow maps or multi-pass rendering:
 * 1. Solar eclipses (moons casting soft-edged umbra & penumbra shadows onto planets)
 * 2. Lunar eclipses (planets casting shadow onto their moons)
 * 3. Planet-on-ring shadows (planet casting its curved shadow across its rings)
 * 4. Ring shadows on planets (rings blocking sunlight from reaching the planet surface/clouds)
 */

export function createShadowUniforms() {
  return {
    uSunPosition: { value: new THREE.Vector3() },
    uSunRadius: { value: 8000.0 },
    uOccluders: {
      value: [
        new THREE.Vector4(),
        new THREE.Vector4(),
        new THREE.Vector4(),
        new THREE.Vector4()
      ]
    },
    uOccluderCount: { value: 0 },
    uHasRings: { value: 0 },
    uPlanetCenter: { value: new THREE.Vector3() },
    uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
    uRingInner: { value: 0.0 },
    uRingOuter: { value: 0.0 }
  };
}

export function createRingShadowUniforms() {
  return {
    uSunPosition: { value: new THREE.Vector3() },
    uSunRadius: { value: 8000.0 },
    uPlanetCenter: { value: new THREE.Vector3() },
    uPlanetRadius: { value: 1000.0 }
  };
}

export const CELESTIAL_SHADOW_PARS_FRAGMENT = /* glsl */`
  uniform vec3 uSunPosition;
  uniform float uSunRadius;
  uniform vec4 uOccluders[4]; // xyz = world center, w = radius
  uniform int uOccluderCount;
  uniform int uHasRings;
  uniform vec3 uPlanetCenter;
  uniform vec3 uRingNormal;
  uniform float uRingInner;
  uniform float uRingOuter;

  float calculateEclipseShadow(vec3 worldPos) {
    if (uOccluderCount == 0 && uHasRings == 0) return 1.0;
    vec3 toSun = uSunPosition - worldPos;
    float dSun = length(toSun);
    if (dSun < 1.0) return 1.0;
    vec3 L = toSun / dSun;
    float shadow = 1.0;

    for (int i = 0; i < 4; i++) {
      if (i >= uOccluderCount) break;
      vec3 occCenter = uOccluders[i].xyz;
      float occRadius = uOccluders[i].w;
      if (occRadius <= 0.0) continue;

      vec3 V = occCenter - worldPos;
      float t = dot(V, L);
      // Occluder must be in front of surface towards the sun and closer than the sun
      if (t > occRadius && t < dSun) {
        float d2 = dot(V, V) - t * t;
        float d = sqrt(max(0.0, d2));
        // Apparent sun radius projected to occluder distance
        float rSunProj = t * (uSunRadius / dSun);
        float rUmbra = max(0.0, occRadius - rSunProj);
        float rPenumbra = occRadius + rSunProj;

        if (d < rPenumbra) {
          float f = smoothstep(rUmbra, rPenumbra, d);
          shadow = min(shadow, mix(0.04, 1.0, f));
        }
      }
    }

    // Ring shadow on planet
    if (uHasRings > 0) {
      float h = dot(worldPos - uPlanetCenter, uRingNormal);
      float dProj = dot(L, uRingNormal);
      if (abs(dProj) > 1e-5) {
        float tPlane = -h / dProj;
        if (tPlane > 0.0 && tPlane < dSun) {
          vec3 hitPos = worldPos + tPlane * L;
          float rHit = length(hitPos - uPlanetCenter);
          if (rHit >= uRingInner && rHit <= uRingOuter) {
            float ringWidth = max(1.0, uRingOuter - uRingInner);
            float ringFade = smoothstep(uRingInner, uRingInner + ringWidth * 0.03, rHit) *
                             (1.0 - smoothstep(uRingOuter - ringWidth * 0.03, uRingOuter, rHit));
            shadow = min(shadow, mix(1.0, 0.12, ringFade * 0.88));
          }
        }
      }
    }

    return shadow;
  }
`;

const PLANET_ON_RING_PARS_FRAGMENT = /* glsl */`
  varying vec3 vShadowWorldPos;

  uniform vec3 uSunPosition;
  uniform float uSunRadius;
  uniform vec3 uPlanetCenter;
  uniform float uPlanetRadius;

  float calculatePlanetOnRingShadow(vec3 worldPos) {
    vec3 toSun = uSunPosition - worldPos;
    float dSun = length(toSun);
    if (dSun < 1.0) return 1.0;
    vec3 L = toSun / dSun;

    vec3 V = uPlanetCenter - worldPos;
    float t = dot(V, L);
    if (t > uPlanetRadius && t < dSun) {
      float d2 = dot(V, V) - t * t;
      float d = sqrt(max(0.0, d2));
      float rSunProj = t * (uSunRadius / dSun);
      float rUmbra = max(0.0, uPlanetRadius - rSunProj);
      float rPenumbra = uPlanetRadius + rSunProj;
      if (d < rPenumbra) {
        float f = smoothstep(rUmbra, rPenumbra, d);
        return mix(0.04, 1.0, f);
      }
    }
    return 1.0;
  }
`;

/**
 * Injects analytical celestial shadow logic into a Three.js material.
 * @param {THREE.Material} material
 * @param {boolean} [isRing=false] Whether this is a planetary ring material
 */
export function applyCelestialShadows(material, isRing = false) {
  if (!material) return;

  const uniforms = isRing ? createRingShadowUniforms() : createShadowUniforms();
  material.userData = material.userData || {};
  material.userData.shadowUniforms = uniforms;

  const existingKey = typeof material.customProgramCacheKey === 'function'
    ? material.customProgramCacheKey.bind(material)
    : null;
  material.customProgramCacheKey = () => {
    return (existingKey ? existingKey() : '') + (isRing ? '_celestialRingShadow' : '_celestialShadow');
  };

  const existingOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof existingOnBeforeCompile === 'function') {
      existingOnBeforeCompile(shader, renderer);
    }

    Object.assign(shader.uniforms, uniforms);

    // 1. Vertex shader world position
    if (!shader.vertexShader.includes('vShadowWorldPos')) {
      shader.vertexShader = `
        varying vec3 vShadowWorldPos;
        ${shader.vertexShader}
      `.replace(
        '#include <worldpos_vertex>',
        `
        #include <worldpos_vertex>
        vShadowWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );
    }

    // 2. Fragment shader shadow application
    if (isRing) {
      shader.fragmentShader = `
        ${PLANET_ON_RING_PARS_FRAGMENT}
        ${shader.fragmentShader}
      `.replace(
        '#include <lights_fragment_begin>',
        `
        #include <lights_fragment_begin>
        float ringShadowFactor = calculatePlanetOnRingShadow(vShadowWorldPos);
        reflectedLight.directDiffuse *= ringShadowFactor;
        reflectedLight.directSpecular *= ringShadowFactor;
        `
      );
    } else {
      shader.fragmentShader = `
        varying vec3 vShadowWorldPos;
        ${CELESTIAL_SHADOW_PARS_FRAGMENT}
        ${shader.fragmentShader}
      `.replace(
        '#include <lights_fragment_begin>',
        `
        #include <lights_fragment_begin>
        float celestialShadow = calculateEclipseShadow(vShadowWorldPos);
        reflectedLight.directDiffuse *= celestialShadow;
        reflectedLight.directSpecular *= celestialShadow;
        `
      );
    }
  };
}

const _starPos = new THREE.Vector3();
const _planetPos = new THREE.Vector3();
const _moonPos = new THREE.Vector3();
const _siblingPos = new THREE.Vector3();
const _axisQuat = new THREE.Quaternion();
const _ringNormal = new THREE.Vector3();

// Scratch variables for CPU occluder culling
const _vToSun = new THREE.Vector3();
const _vSunDir = new THREE.Vector3();
const _vToOcc = new THREE.Vector3();

// Preallocated scratch storage for up to 4 occluders per body (zero GC allocations)
const _occScratch = [
  new THREE.Vector4(),
  new THREE.Vector4(),
  new THREE.Vector4(),
  new THREE.Vector4()
];

// Scratch variables for getCelestialShadowFactor
const _scratchToSun = new THREE.Vector3();
const _scratchSunDir = new THREE.Vector3();
const _scratchToOcc = new THREE.Vector3();
const _scratchWorldToCenter = new THREE.Vector3();
const _scratchHitPos = new THREE.Vector3();

/**
 * Tests whether an occluder sphere can cast a shadow on any part of a receiver sphere.
 * Used for zero-cost CPU culling when no eclipse is occurring.
 *
 * @param {THREE.Vector3} receiverPos World position of receiver center
 * @param {number} receiverRadius Radius of receiver bounding sphere
 * @param {THREE.Vector3} occluderPos World position of occluder center
 * @param {number} occluderRadius Radius of occluder sphere
 * @param {THREE.Vector3} sunPos World position of sun center
 * @param {number} sunRadius Radius of sun
 * @returns {boolean} True if shadow is geometrically possible
 */
export function canOccluderShadowReceiver(
  receiverPos, receiverRadius,
  occluderPos, occluderRadius,
  sunPos, sunRadius
) {
  _vToSun.subVectors(sunPos, receiverPos);
  const dSun = _vToSun.length();
  if (dSun < 1.0) return false;
  _vSunDir.copy(_vToSun).divideScalar(dSun);

  _vToOcc.subVectors(occluderPos, receiverPos);
  const t = _vToOcc.dot(_vSunDir);
  // Occluder must be in front of receiver toward the sun, and closer than the sun
  if (t <= 0 || t >= dSun) return false;

  const distSq = _vToOcc.lengthSq() - t * t;
  const rPenumbraSpread = t * (sunRadius / dSun);
  // Add a 10% safety margin + 50 units for atmosphere shell and numerical precision
  const maxPerpDist = (receiverRadius + occluderRadius + rPenumbraSpread) * 1.1 + 50.0;
  return distSq <= maxPerpDist * maxPerpDist;
}

/**
 * Evaluates the celestial shadow factor (0.04 to 1.0) at a specific world position on the CPU.
 * Used for dimming ambient sky light and triggering lighting hints during totality.
 *
 * @param {THREE.Vector3} worldPos World position (e.g. camera or player position)
 * @param {Object} shadowUniforms Material userData.shadowUniforms object
 * @returns {number} Shadow factor (1.0 = full light, 0.04 = deep totality)
 */
export function getCelestialShadowFactor(worldPos, shadowUniforms) {
  if (!shadowUniforms) return 1.0;
  const count = shadowUniforms.uOccluderCount?.value || 0;
  const hasRings = shadowUniforms.uHasRings?.value || 0;
  if (count === 0 && hasRings === 0) return 1.0;

  const sunPos = shadowUniforms.uSunPosition.value;
  const sunRadius = shadowUniforms.uSunRadius?.value || 8000;

  _scratchToSun.subVectors(sunPos, worldPos);
  const dSun = _scratchToSun.length();
  if (dSun < 1.0) return 1.0;
  _scratchSunDir.copy(_scratchToSun).divideScalar(dSun);

  let shadow = 1.0;
  const occluders = shadowUniforms.uOccluders?.value;

  for (let i = 0; i < count && i < 4; i++) {
    const occ = occluders[i];
    const occRadius = occ.w;
    if (occRadius <= 0.0) continue;

    _scratchToOcc.set(occ.x, occ.y, occ.z).sub(worldPos);
    const t = _scratchToOcc.dot(_scratchSunDir);
    if (t > occRadius && t < dSun) {
      const d2 = _scratchToOcc.lengthSq() - t * t;
      const d = Math.sqrt(Math.max(0.0, d2));
      const rSunProj = t * (sunRadius / dSun);
      const rUmbra = Math.max(0.0, occRadius - rSunProj);
      const rPenumbra = occRadius + rSunProj;

      if (d < rPenumbra) {
        const f = THREE.MathUtils.clamp((d - rUmbra) / Math.max(1e-4, rPenumbra - rUmbra), 0, 1);
        const smoothF = f * f * (3 - 2 * f);
        shadow = Math.min(shadow, THREE.MathUtils.lerp(0.04, 1.0, smoothF));
      }
    }
  }

  // Ring shadow on planet
  if (hasRings > 0 && shadowUniforms.uPlanetCenter && shadowUniforms.uRingNormal) {
    const pCenter = shadowUniforms.uPlanetCenter.value;
    const rNormal = shadowUniforms.uRingNormal.value;
    _scratchWorldToCenter.subVectors(worldPos, pCenter);
    const h = _scratchWorldToCenter.dot(rNormal);
    const dProj = _scratchSunDir.dot(rNormal);
    if (Math.abs(dProj) > 1e-5) {
      const tPlane = -h / dProj;
      if (tPlane > 0.0 && tPlane < dSun) {
        _scratchHitPos.copy(worldPos).addScaledVector(_scratchSunDir, tPlane);
        const rHit = _scratchHitPos.distanceTo(pCenter);
        const inner = shadowUniforms.uRingInner?.value || 0;
        const outer = shadowUniforms.uRingOuter?.value || 0;
        if (rHit >= inner && rHit <= outer) {
          const ringWidth = Math.max(1.0, outer - inner);
          const f1 = THREE.MathUtils.clamp((rHit - inner) / (ringWidth * 0.03), 0, 1);
          const f2 = THREE.MathUtils.clamp((outer - rHit) / (ringWidth * 0.03), 0, 1);
          const ringFade = (f1 * f1 * (3 - 2 * f1)) * (f2 * f2 * (3 - 2 * f2));
          shadow = Math.min(shadow, THREE.MathUtils.lerp(1.0, 0.12, ringFade * 0.88));
        }
      }
    }
  }

  return shadow;
}

/**
 * Updates all celestial shadow uniforms per frame. Call after updating orbits.
 * Automatically performs CPU culling so unaligned moons incur zero GPU fragment cost.
 *
 * @param {Object} systemMeshes
 * @param {Object} systemData
 */
export function updateCelestialShadows(systemMeshes, systemData) {
  if (!systemMeshes || !systemData || !systemMeshes.starMesh) return;

  systemMeshes.starMesh.getWorldPosition(_starPos);
  const starRadius = systemData.star?.radius || 8000;

  const entries = systemMeshes.planetEntries || [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const pMesh = entry.mesh || entry.group;
    if (!pMesh) continue;
    pMesh.getWorldPosition(_planetPos);
    const pRadius = entry.data.radius;

    const moons = entry.moons || [];
    const moonCount = Math.min(4, moons.length);

    // Collect materials associated with this planet
    const pMaterials = [];
    if (entry.terrainLOD) {
      if (entry.terrainLOD.material) pMaterials.push(entry.terrainLOD.material);
      if (entry.terrainLOD.liquidMaterial) pMaterials.push(entry.terrainLOD.liquidMaterial);
    }
    if (entry.mesh?.material) pMaterials.push(entry.mesh.material);
    if (entry.cloudMesh?.material) pMaterials.push(entry.cloudMesh.material);
    if (entry.atmoMesh?.material) pMaterials.push(entry.atmoMesh.material);

    // Ring properties
    const hasRings = !!(entry.data.hasRings && entry.data.ringProps && entry.ringMesh);
    let innerR = 0;
    let outerR = 0;
    if (hasRings) {
      innerR = entry.data.ringProps.innerRadius;
      outerR = entry.data.ringProps.outerRadius;
      entry.ringMesh.getWorldQuaternion(_axisQuat);
      _ringNormal.set(0, 0, 1).applyQuaternion(_axisQuat).normalize();
    }

    // CPU culling for planet: only add moons that can geometrically shadow the planet or atmosphere
    let pOccCount = 0;
    for (let m = 0; m < moonCount; m++) {
      const moon = moons[m];
      if (moon.mesh) {
        moon.mesh.getWorldPosition(_moonPos);
        const moonRadius = moon.data.radius;
        if (canOccluderShadowReceiver(_planetPos, pRadius * 1.15, _moonPos, moonRadius, _starPos, starRadius)) {
          if (pOccCount < 4) {
            _occScratch[pOccCount].set(_moonPos.x, _moonPos.y, _moonPos.z, moonRadius);
            pOccCount++;
          }
        }
      }
    }

    for (let mIdx = 0; mIdx < pMaterials.length; mIdx++) {
      const mat = pMaterials[mIdx];
      const u = mat.userData?.shadowUniforms;
      if (!u) continue;
      u.uSunPosition.value.copy(_starPos);
      u.uSunRadius.value = starRadius;
      u.uOccluderCount.value = pOccCount;
      for (let o = 0; o < pOccCount; o++) {
        u.uOccluders.value[o].copy(_occScratch[o]);
      }
      u.uHasRings.value = hasRings ? 1 : 0;
      if (hasRings) {
        u.uPlanetCenter.value.copy(_planetPos);
        u.uRingNormal.value.copy(_ringNormal);
        u.uRingInner.value = innerR;
        u.uRingOuter.value = outerR;
      }
    }

    // Planet shadow on ring
    if (hasRings && entry.ringMesh.material) {
      const ru = entry.ringMesh.material.userData?.shadowUniforms;
      if (ru) {
        ru.uSunPosition.value.copy(_starPos);
        ru.uSunRadius.value = starRadius;
        ru.uPlanetCenter.value.copy(_planetPos);
        ru.uPlanetRadius.value = pRadius;
      }
    }

    // Shadows on each moon: test parent planet AND sibling moons
    for (let m = 0; m < moons.length; m++) {
      const moon = moons[m];
      if (!moon.mesh) continue;
      moon.mesh.getWorldPosition(_moonPos);
      const moonRadius = moon.data.radius;

      let mOccCount = 0;

      // 1. Parent planet occluder (lunar eclipse)
      if (canOccluderShadowReceiver(_moonPos, moonRadius, _planetPos, pRadius, _starPos, starRadius)) {
        if (mOccCount < 4) {
          _occScratch[mOccCount].set(_planetPos.x, _planetPos.y, _planetPos.z, pRadius);
          mOccCount++;
        }
      }

      // 2. Sibling moon occluders (moon-on-moon eclipse)
      for (let s = 0; s < moons.length; s++) {
        if (s === m) continue;
        const sibling = moons[s];
        if (!sibling.mesh) continue;
        sibling.mesh.getWorldPosition(_siblingPos);
        const siblingRadius = sibling.data.radius;
        if (canOccluderShadowReceiver(_moonPos, moonRadius, _siblingPos, siblingRadius, _starPos, starRadius)) {
          if (mOccCount < 4) {
            _occScratch[mOccCount].set(_siblingPos.x, _siblingPos.y, _siblingPos.z, siblingRadius);
            mOccCount++;
          }
        }
      }

      const mMaterials = [];
      if (moon.mesh?.material) mMaterials.push(moon.mesh.material);
      if (moon.terrainLOD) {
        if (moon.terrainLOD.material) mMaterials.push(moon.terrainLOD.material);
        if (moon.terrainLOD.liquidMaterial) mMaterials.push(moon.terrainLOD.liquidMaterial);
      }
      for (let matIdx = 0; matIdx < mMaterials.length; matIdx++) {
        const mu = mMaterials[matIdx].userData?.shadowUniforms;
        if (!mu) continue;
        mu.uSunPosition.value.copy(_starPos);
        mu.uSunRadius.value = starRadius;
        mu.uOccluderCount.value = mOccCount;
        for (let o = 0; o < mOccCount; o++) {
          mu.uOccluders.value[o].copy(_occScratch[o]);
        }
        mu.uHasRings.value = 0;
      }
    }
  }
}
