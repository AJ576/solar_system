import * as THREE from 'three';
import {
  createShadowUniforms,
  createRingShadowUniforms,
  applyCelestialShadows,
  updateCelestialShadows
} from '../src/visuals/shadows.js';
import { ShipContactShadow } from '../src/visuals/shipShadow.js';
import { generateSolarSystemData, buildSolarSystemMeshes } from '../src/systems/solarSystemGenerator.js';
import { updateOrbits } from '../src/physics/orbitalPhysics.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    failed++;
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
  passed++;
}

console.log('\n[Celestial Shadows & Uniforms]');

{
  const u = createShadowUniforms();
  assert(u.uSunPosition && u.uOccluders && u.uOccluderCount, 'createShadowUniforms initializes required uniforms');
  assert(u.uOccluders.value.length === 4, 'createShadowUniforms provides 4 occluder slots');

  const ru = createRingShadowUniforms();
  assert(ru.uSunPosition && ru.uPlanetCenter && ru.uPlanetRadius, 'createRingShadowUniforms initializes required uniforms');

  const mat = new THREE.MeshStandardMaterial();
  applyCelestialShadows(mat, false);
  assert(mat.userData.shadowUniforms !== undefined, 'applyCelestialShadows assigns shadowUniforms to userData');
  assert(typeof mat.customProgramCacheKey === 'function', 'applyCelestialShadows sets customProgramCacheKey');
  assert(mat.customProgramCacheKey().includes('celestialShadow'), 'customProgramCacheKey includes celestialShadow identifier');

  const ringMat = new THREE.MeshStandardMaterial();
  applyCelestialShadows(ringMat, true);
  assert(ringMat.customProgramCacheKey().includes('celestialRingShadow'), 'customProgramCacheKey distinguishes ring shadows');
}

console.log('\n[System Shadow Update Integration]');

{
  const scene = new THREE.Scene();
  const systemData = generateSolarSystemData('Sol-Prime-42');
  const systemMeshes = buildSolarSystemMeshes(systemData, scene);
  updateOrbits(systemMeshes, systemData, 0, 0);

  // Run updateCelestialShadows
  updateCelestialShadows(systemMeshes, systemData);

  // Check that star position got copied
  const p0 = systemMeshes.planetEntries[0];
  const mat = p0.terrainLOD?.material || p0.mesh?.material;
  assert(mat !== undefined, 'Found planet material');
  if (mat && mat.userData.shadowUniforms) {
    const sunPos = mat.userData.shadowUniforms.uSunPosition.value;
    assert(!isNaN(sunPos.x) && !isNaN(sunPos.y) && !isNaN(sunPos.z), 'Sun position is finite vector in shadow uniforms');
  }

  // Find a planet with moons and check occluders
  const planetWithMoons = systemMeshes.planetEntries.find(p => p.moons && p.moons.length > 0);
  if (planetWithMoons) {
    const pMat = planetWithMoons.terrainLOD?.material || planetWithMoons.mesh?.material;
    const u = pMat.userData.shadowUniforms;
    assert(u.uOccluderCount.value === planetWithMoons.moons.length, `Occluder count (${u.uOccluderCount.value}) matches moon count (${planetWithMoons.moons.length})`);
    assert(u.uOccluders.value[0].w > 0, 'First moon occluder has positive radius');

    // Check moon lunar eclipse occluder (planet)
    const moon = planetWithMoons.moons[0];
    const moonMat = moon.terrainLOD?.material || moon.mesh?.material;
    if (moonMat && moonMat.userData.shadowUniforms) {
      assert(moonMat.userData.shadowUniforms.uOccluderCount.value === 1, 'Moon has 1 occluder (the planet)');
      assert(moonMat.userData.shadowUniforms.uOccluders.value[0].w === planetWithMoons.data.radius, 'Moon occluder radius matches parent planet radius');
    }
  }
}

console.log('\n[Ship Contact Shadow]');

{
  const scene = new THREE.Scene();
  const shadow = new ShipContactShadow(scene);
  assert(shadow.mesh !== null, 'ShipContactShadow creates shadow mesh in scene');
  assert(shadow.mesh.visible === false, 'ShipContactShadow starts invisible');

  const ship = new THREE.Object3D();
  ship.position.set(0, 1000, 0);

  const mockBody = {
    position: new THREE.Vector3(0, 0, 0),
    radius: 700,
    mesh: new THREE.Object3D(),
    terrainProfile: { hasTerrain: false }
  };
  mockBody.mesh.position.copy(mockBody.position);
  mockBody.mesh.updateMatrixWorld(true);

  // 1. High altitude -> hidden
  shadow.update(ship, { body: mockBody, altitude: 300 }, new THREE.Vector3(5000, 5000, 0), false);
  assert(shadow.mesh.visible === false, 'Shadow is hidden when ship altitude > 4 units');

  // 2. Low altitude (touchdown) -> visible & aligned
  ship.position.set(0, 700.5, 0); // 0.5 units (50 m) above surface
  shadow.update(ship, { body: mockBody, altitude: 0.5 }, new THREE.Vector3(5000, 5000, 0), false);
  assert(shadow.mesh.visible === true, 'Shadow is visible when ship is close to ground');
  assert(shadow.uniforms.uOpacity.value > 0.4, 'Shadow opacity is strong near surface');
  assert(Math.abs(shadow.mesh.position.y - 700.0) < 0.1, 'Shadow rests near the 700 u surface');

  // 3. Parked mode -> max opacity
  shadow.update(ship, { body: mockBody, altitude: 0.0 }, new THREE.Vector3(5000, 5000, 0), true);
  assert(shadow.mesh.visible === true, 'Shadow remains visible when parked');
  assert(shadow.uniforms.uOpacity.value >= 0.75, 'Shadow has parked landing opacity');

  shadow.dispose();
  assert(scene.children.indexOf(shadow.mesh) === -1, 'Shadow mesh removed from scene on dispose');
}

console.log(`\nAll ${passed} shadow tests passed!\n`);
