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

const CELESTIAL_SHADOW_PARS_FRAGMENT = /* glsl */`
  varying vec3 vShadowWorldPos;

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
const _axisQuat = new THREE.Quaternion();
const _ringNormal = new THREE.Vector3();

/**
 * Updates all celestial shadow uniforms per frame. Call after updating orbits.
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

    for (let mIdx = 0; mIdx < pMaterials.length; mIdx++) {
      const mat = pMaterials[mIdx];
      const u = mat.userData?.shadowUniforms;
      if (!u) continue;
      u.uSunPosition.value.copy(_starPos);
      u.uSunRadius.value = starRadius;
      u.uOccluderCount.value = moonCount;
      for (let m = 0; m < moonCount; m++) {
        const moon = moons[m];
        if (moon.mesh) {
          moon.mesh.getWorldPosition(_moonPos);
          u.uOccluders.value[m].set(_moonPos.x, _moonPos.y, _moonPos.z, moon.data.radius);
        }
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

    // Planet shadow on each moon (lunar eclipse)
    for (let m = 0; m < moons.length; m++) {
      const moon = moons[m];
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
        mu.uOccluderCount.value = 1;
        mu.uOccluders.value[0].set(_planetPos.x, _planetPos.y, _planetPos.z, pRadius);
        mu.uHasRings.value = 0;
      }
    }
  }
}
