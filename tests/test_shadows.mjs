import * as THREE from 'three';
import {
  createShadowUniforms,
  createRingShadowUniforms,
  applyCelestialShadows,
  updateCelestialShadows,
  canOccluderShadowReceiver,
  getCelestialShadowFactor,
  getCelestialPlanetshine,
  getBodyPrimaryColor
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
  assert(u.uPlanetshineDir && u.uPlanetshineColor, 'createShadowUniforms initializes planetshine uniforms');

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

console.log('\n[CPU Occluder Culling & Calculations]');

{
  const sunPos = new THREE.Vector3(0, 0, 50000);
  const sunRadius = 8000;
  const planetPos = new THREE.Vector3(0, 0, 0);
  const planetRadius = 1000;

  // 1. Moon directly between planet and sun -> can shadow
  const moonInFront = new THREE.Vector3(0, 0, 3000);
  const canShadow1 = canOccluderShadowReceiver(planetPos, planetRadius, moonInFront, 150, sunPos, sunRadius);
  assert(canShadow1 === true, 'Moon directly between planet and sun correctly detected as occluder');

  // 2. Moon on night side of planet (away from sun) -> culled
  const moonBehind = new THREE.Vector3(0, 0, -3000);
  const canShadow2 = canOccluderShadowReceiver(planetPos, planetRadius, moonBehind, 150, sunPos, sunRadius);
  assert(canShadow2 === false, 'Moon behind planet (night side) correctly culled on CPU');

  // 3. Moon far off to the side -> culled
  const moonOffSide = new THREE.Vector3(15000, 0, 3000);
  const canShadow3 = canOccluderShadowReceiver(planetPos, planetRadius, moonOffSide, 150, sunPos, sunRadius);
  assert(canShadow3 === false, 'Moon far off line of sight correctly culled on CPU');

  // 4. getCelestialShadowFactor: unshadowed position
  const uniforms = createShadowUniforms();
  uniforms.uSunPosition.value.copy(sunPos);
  uniforms.uSunRadius.value = sunRadius;
  uniforms.uOccluderCount.value = 0;
  const factorFull = getCelestialShadowFactor(new THREE.Vector3(0, 0, 1000), uniforms);
  assert(factorFull === 1.0, 'getCelestialShadowFactor returns 1.0 when no occluders are present');

  // 5. getCelestialShadowFactor: point under deep umbra
  uniforms.uOccluderCount.value = 1;
  uniforms.uOccluders.value[0].set(0, 0, 3000, 150);
  // Receiver right behind the moon on the line towards sun
  const factorUmbra = getCelestialShadowFactor(new THREE.Vector3(0, 0, 2000), uniforms);
  assert(factorUmbra < 0.1, `getCelestialShadowFactor returns deep totality (${factorUmbra.toFixed(3)}) under umbra`);
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

  // Check atmosphere material received shadow uniforms
  const planetWithAtmo = systemMeshes.planetEntries.find(p => p.atmoMesh && p.atmoMesh.material);
  assert(planetWithAtmo !== undefined, 'Found planet with atmosphere mesh');
  if (planetWithAtmo) {
    const atmoUniforms = planetWithAtmo.atmoMesh.material.userData?.shadowUniforms;
    assert(atmoUniforms !== undefined, 'Atmosphere material holds shadowUniforms');
    assert(atmoUniforms.uSunRadius.value > 0, 'Atmosphere shadowUniforms receives sun radius');
  }

  // Check moons receive parent planet or sibling moon occluders
  const planetWithMoons = systemMeshes.planetEntries.find(p => p.moons && p.moons.length >= 2);
  if (planetWithMoons) {
    assert(planetWithMoons.moons.length >= 2, 'Found planet with at least 2 moons');

    // Force sibling eclipse alignment: place Moon 1 directly between Moon 0 and the star
    const starWorld = new THREE.Vector3();
    systemMeshes.starMesh.getWorldPosition(starWorld);
    const m0Mesh = planetWithMoons.moons[0].mesh;
    const m1Mesh = planetWithMoons.moons[1].mesh;

    const m0World = new THREE.Vector3();
    m0Mesh.getWorldPosition(m0World);
    const dirToStar = new THREE.Vector3().subVectors(starWorld, m0World).normalize();

    // Place m1 300 units in front of m0 towards the star
    const m1TargetWorld = new THREE.Vector3().copy(m0World).addScaledVector(dirToStar, 300);
    planetWithMoons.group.worldToLocal(m1TargetWorld);
    m1Mesh.position.copy(m1TargetWorld);

    m0Mesh.updateMatrixWorld(true);
    m1Mesh.updateMatrixWorld(true);

    updateCelestialShadows(systemMeshes, systemData);

    const m0Mat = planetWithMoons.moons[0].terrainLOD?.material || planetWithMoons.moons[0].mesh?.material;
    const m0Uniforms = m0Mat?.userData?.shadowUniforms;
    assert(m0Uniforms !== undefined, 'Moon material has shadow uniforms');
    assert(m0Uniforms.uOccluderCount.value >= 1, 'Moon 0 detected occluder when sibling moon is in front of sun');

    // Check that the occluder position matches the sibling moon
    const occPos = m0Uniforms.uOccluders.value[0];
    const m1World = new THREE.Vector3();
    m1Mesh.getWorldPosition(m1World);
    const distToSibling = m1World.distanceTo(new THREE.Vector3(occPos.x, occPos.y, occPos.z));
    assert(distToSibling < 1.0, 'Sibling moon accurately registered as occluder on recipient moon');
  }
}

console.log('\n[Planetshine & Secondary Reflection]');

{
  // 1. getCelestialPlanetshine directional math & getBodyPrimaryColor
  assert(getBodyPrimaryColor({ color: 0x123456 }) === 0x123456, 'getBodyPrimaryColor returns color when no palette present');
  assert(getBodyPrimaryColor({ terrainProfile: { palette: { mid: 0xffaa00 } } }) === 0xffaa00, 'getBodyPrimaryColor extracts mid palette color');

  const pUniforms = createShadowUniforms();
  pUniforms.uPlanetshineDir.value.set(0, 1, 0);
  pUniforms.uPlanetshineColor.value.setRGB(0.8, 0.6, 0.4);

  // Facing directly toward planet (up = (0, 1, 0))
  const directLight = getCelestialPlanetshine(new THREE.Vector3(0, 1, 0), pUniforms);
  assert(directLight.r > 0.7 && directLight.g > 0.5, 'getCelestialPlanetshine delivers strong color when facing planet');

  // Facing away from planet (down = (0, -1, 0))
  const backLight = getCelestialPlanetshine(new THREE.Vector3(0, -1, 0), pUniforms);
  assert(backLight.r === 0 && backLight.g === 0 && backLight.b === 0, 'getCelestialPlanetshine is zero on surfaces facing away from planet');

  // 2. Integration: Moon orbiting parent planet
  const scene = new THREE.Scene();
  const systemData = generateSolarSystemData('Sol-Prime-42');
  const systemMeshes = buildSolarSystemMeshes(systemData, scene);
  updateOrbits(systemMeshes, systemData, 0, 0);

  const planetWithMoons = systemMeshes.planetEntries.find(p => p.moons && p.moons.length > 0);
  assert(planetWithMoons !== undefined, 'Found planet with at least one moon for planetshine test');

  if (planetWithMoons) {
    const pMesh = planetWithMoons.mesh;
    const m0 = planetWithMoons.moons[0];
    const pWorld = new THREE.Vector3();
    pMesh.getWorldPosition(pWorld);
    const starWorld = new THREE.Vector3();
    systemMeshes.starMesh.getWorldPosition(starWorld);

    // A. "Full Planet" configuration: Place moon between planet and star
    const dirPlanetToStar = new THREE.Vector3().subVectors(starWorld, pWorld).normalize();
    const mFullPos = new THREE.Vector3().copy(pWorld).addScaledVector(dirPlanetToStar, planetWithMoons.data.radius * 2.5);
    planetWithMoons.group.worldToLocal(mFullPos);
    m0.mesh.position.copy(mFullPos);
    m0.mesh.updateMatrixWorld(true);
    updateCelestialShadows(systemMeshes, systemData);

    const m0Mat = m0.terrainLOD?.material || m0.mesh?.material;
    const fullPlanetshine = m0Mat?.userData?.shadowUniforms?.uPlanetshineColor?.value;
    assert(fullPlanetshine !== undefined, 'Moon shadowUniforms contains uPlanetshineColor');
    const fullIntensity = Math.max(fullPlanetshine.r, fullPlanetshine.g, fullPlanetshine.b);
    assert(fullIntensity > 0.01, `Full planet configuration produces strong planetshine (${fullIntensity.toFixed(3)}) on moon`);

    // B. "New Planet" configuration: Place moon on the night side of the planet (opposite the star)
    const mNewPos = new THREE.Vector3().copy(pWorld).addScaledVector(dirPlanetToStar, -planetWithMoons.data.radius * 2.5);
    planetWithMoons.group.worldToLocal(mNewPos);
    m0.mesh.position.copy(mNewPos);
    m0.mesh.updateMatrixWorld(true);
    updateCelestialShadows(systemMeshes, systemData);

    const newPlanetshine = m0Mat?.userData?.shadowUniforms?.uPlanetshineColor?.value;
    const newIntensity = Math.max(newPlanetshine.r, newPlanetshine.g, newPlanetshine.b);
    assert(newIntensity < 0.001, `New planet configuration drops planetshine to zero (${newIntensity.toFixed(4)}) on moon`);

    // C. Parent planet receives faint moonshine from the moon
    const pMat = planetWithMoons.terrainLOD?.material || planetWithMoons.mesh?.material;
    const pMoonshine = pMat?.userData?.shadowUniforms?.uPlanetshineColor?.value;
    assert(pMoonshine !== undefined, 'Parent planet shadowUniforms contains uPlanetshineColor');
    const pIntensity = Math.max(pMoonshine.r, pMoonshine.g, pMoonshine.b);
    assert(pIntensity > 0 && pIntensity < fullIntensity, 'Moonshine on parent planet is active and dimmer than planetshine on moon');
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
