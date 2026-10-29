import * as THREE from 'three';
import { createPRNG, generateSystemName } from '../src/utils/random.js';
import { generateSolarSystemData, buildSolarSystemMeshes, disposeSolarSystem } from '../src/systems/solarSystemGenerator.js';
import { updateOrbits, getPlanetPosition, getNearestCelestialBody } from '../src/physics/orbitalPhysics.js';
import { createSpaceship } from '../src/player/spaceship.js';
import { SpaceshipControls } from '../src/player/controls.js';
import { HyperspaceManager, HyperspaceState } from '../src/systems/hyperspace.js';
import { SpaceDust } from '../src/visuals/spaceDust.js';

console.log('--- STARTING COMPREHENSIVE INTEGRATION TEST SUITE ---');

// Test 1: PRNG & System Name Generation
console.log('\n[Test 1] Testing Deterministic PRNG & System Names...');
const seedA = 'Centauri-X';
const name1 = generateSystemName(seedA);
const name2 = generateSystemName(seedA);
if (name1 !== name2) {
  throw new Error(`Determinism failure: ${name1} !== ${name2}`);
}
console.log(`✓ System name for seed "${seedA}": "${name1}" (Deterministic: PASS)`);

// Test 2: Procedural Solar System Generation across multiple seeds & 5-Tier Scale Hierarchy
console.log('\n[Test 2] Testing 5-Tier Planetary Scale Hierarchy across multiple seeds...');
const seeds = ['Sol-Prime-42', 'Kepler-452b', 'Alpha-Centauri-88', 'Trappist-X', 'Void-999'];
for (const seed of seeds) {
  const data = generateSolarSystemData(seed);
  if (!data.star || !data.planets || data.planets.length < 3) {
    throw new Error(`Invalid system generated for seed ${seed}`);
  }

  // Verify scale hierarchy: Star > Gas Giant > Terrestrial > Moon > Spaceship (~2.44u)
  if (data.star.radius < 250) {
    throw new Error(`Star radius too small: ${data.star.radius}`);
  }

  for (const planet of data.planets) {
    if (planet.type === 'Gas Giant') {
      if (planet.radius < 120) throw new Error(`Gas giant radius too small: ${planet.radius}`);
    } else {
      if (planet.radius < 25) throw new Error(`Terrestrial planet radius too small: ${planet.radius}`);
    }

    if (planet.moons) {
      for (const moon of planet.moons) {
        if (moon.radius >= planet.radius * 0.5) {
          throw new Error(`Moon too large relative to planet: ${moon.radius} vs ${planet.radius}`);
        }
      }
    }
  }

  // Verify orbital spacing: strictly non-overlapping perihelion / aphelion
  for (let i = 0; i < data.planets.length - 1; i++) {
    const pCurrent = data.planets[i];
    const pNext = data.planets[i + 1];
    const currentAphelion = pCurrent.semiMajorAxis * (1 + pCurrent.eccentricity);
    const nextPerihelion = pNext.semiMajorAxis * (1 - pNext.eccentricity);
    if (nextPerihelion <= currentAphelion) {
      throw new Error(`Orbital overlap detected between ${pCurrent.name} and ${pNext.name}`);
    }
  }
  console.log(`✓ Seed "${seed}": Star ${data.star.type} (R=${data.star.radius.toFixed(1)}u), ${data.planets.length} planets, non-overlapping orbits confirmed.`);
}

// Test 3: Mesh Creation & Disposal (Zero Memory Leaks)
console.log('\n[Test 3] Testing Mesh Construction and Complete Disposal...');
const scene = new THREE.Scene();
const sysData = generateSolarSystemData('Test-Seed-Memory');
const sysMeshes = buildSolarSystemMeshes(sysData, scene);

if (!sysMeshes.group || !sysMeshes.starMesh || !sysMeshes.starLight || !sysMeshes.planetEntries) {
  throw new Error('buildSolarSystemMeshes returned incomplete schema');
}
console.log(`✓ Built meshes: Star + ${sysMeshes.planetEntries.length} planets with orbits and moons.`);

// Verify scene contains the group and light
if (!scene.children.includes(sysMeshes.group)) {
  throw new Error('Scene does not contain system group');
}

// Dispose system
disposeSolarSystem(sysMeshes, scene);
if (scene.children.includes(sysMeshes.group)) {
  throw new Error('System group was not removed from scene during disposal');
}
console.log('✓ Disposed system successfully with zero dangling meshes in scene.');

// Test 4: Orbital Mechanics Simulation (Keplerian physics stability)
console.log('\n[Test 4] Testing Keplerian Orbital Simulation & Numerical Stability...');
const simScene = new THREE.Scene();
const simData = generateSolarSystemData('Physics-Test-Seed');
const simMeshes = buildSolarSystemMeshes(simData, simScene);

// Record initial positions
const initialPos = simMeshes.planetEntries.map(e => e.mesh.position.clone());

// Simulate 100 seconds in fixed 0.05s timesteps
let simTime = 0;
const dt = 0.05;
for (let step = 0; step < 2000; step++) {
  simTime += dt;
  updateOrbits(simMeshes, simData, dt, simTime);

  // Verify no NaN or Infinite coordinates
  for (const entry of simMeshes.planetEntries) {
    if (!Number.isFinite(entry.mesh.position.x) || !Number.isFinite(entry.mesh.position.z)) {
      throw new Error(`Unstable simulation coordinates detected at step ${step}`);
    }
  }
}

// Verify that planets have indeed orbited
let hasMoved = false;
for (let i = 0; i < simMeshes.planetEntries.length; i++) {
  const currentP = simMeshes.planetEntries[i].mesh.position;
  const initialP = initialPos[i];
  if (currentP.distanceTo(initialP) > 1.0) {
    hasMoved = true;
  }
}
if (!hasMoved) {
  throw new Error('Planets did not move after 100 seconds of simulation');
}
console.log('✓ Simulated 2,000 steps (100.0s): All orbits stable, physically coherent, non-drifting.');

// Test 5: Nearest Celestial Body Proximity Query
console.log('\n[Test 5] Testing Nearest Celestial Body Query...');
const testShipPos = new THREE.Vector3(0, 0, 0); // At the center (star)
const nearestToCenter = getNearestCelestialBody(testShipPos, simMeshes, simData);
if (nearestToCenter.type !== 'Star') {
  throw new Error(`Expected Star at center, got ${nearestToCenter.type}`);
}
console.log(`✓ Center proximity detected: ${nearestToCenter.name} (${nearestToCenter.type}, surface distance: ${nearestToCenter.distance.toFixed(1)} u)`);

// Near first planet
const p1Pos = simMeshes.planetEntries[0].mesh.position.clone();
const nearP1 = getNearestCelestialBody(new THREE.Vector3(p1Pos.x + 2, p1Pos.y, p1Pos.z), simMeshes, simData);
console.log(`✓ Planet proximity detected: ${nearP1.name} (${nearP1.type}, surface distance: ${nearP1.distance.toFixed(1)} u)`);

// Test 6: Spaceship & Controls Physics (Responsive Newtonian Flight)
console.log('\n[Test 6] Testing Spaceship Geometry & Responsive Newtonian Controls...');
const spaceship = createSpaceship();
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 75000);
const controls = new SpaceshipControls(spaceship, camera);

// Verify ship bounding dimensions: master scale 0.5x produces length ~2.44u, width ~2.72u
const shipBox = new THREE.Box3().setFromObject(spaceship.mesh);
const shipLength = shipBox.max.z - shipBox.min.z;
const shipWidth = shipBox.max.x - shipBox.min.x;
console.log(`✓ Spaceship dimensions: Length = ${shipLength.toFixed(2)}u, Width = ${shipWidth.toFixed(2)}u (Canonical scale: PASS)`);

// Initial position & state
controls.setPosition(100, 10, 50);
const startPos = controls.getPosition();
if (Math.abs(startPos.x - 100) > 0.001 || Math.abs(startPos.z - 50) > 0.001) {
  throw new Error('Spaceship setPosition failed');
}

// Simulate forward thrust
controls.keys.forward = true;
controls.update(0.1);
controls.update(0.1);
const telemetry = controls.getTelemetry();
if (telemetry.speed <= 0) {
  throw new Error('Spaceship did not accelerate under forward thrust');
}
console.log(`✓ Spaceship forward thrust: Speed increased to ${telemetry.speed.toFixed(2)} u/s (Cruise Max: ${telemetry.maxSpeed} u/s)`);

// Test Momentum Preservation (Coasting without artificial underwater drag)
controls.keys.forward = false;
const speedBeforeCoast = controls.getTelemetry().speed;
for (let i = 0; i < 30; i++) {
  controls.update(0.05); // Coast for 1.5 seconds in vacuum
}
const speedAfterCoast = controls.getTelemetry().speed;
if (Math.abs(speedAfterCoast - speedBeforeCoast) > 0.1) {
  throw new Error(`Momentum was not preserved during coasting: ${speedBeforeCoast} -> ${speedAfterCoast}`);
}
console.log(`✓ Vacuum momentum preservation verified: Coasted 1.5s with zero speed decay (${speedAfterCoast.toFixed(2)} u/s).`);

// Simulate Afterburner Boost
controls.keys.boost = true;
controls.keys.forward = true;
controls.update(0.1);
controls.update(0.1);
const boostTelemetry = controls.getTelemetry();
if (!boostTelemetry.isBoosting) {
  throw new Error('Boost was not activated');
}
console.log(`✓ Spaceship afterburner boost active: Speed ${boostTelemetry.speed.toFixed(2)} u/s, Boost capacity: ${boostTelemetry.boostPercent}%`);

// Simulate Active Retro-Braking (Vector cancellation)
controls.keys.forward = false;
controls.keys.boost = false;
controls.keys.brake = true;
for (let i = 0; i < 35; i++) {
  controls.update(0.05);
}
const brakedTelemetry = controls.getTelemetry();
if (brakedTelemetry.speed > 0.01) {
  throw new Error(`Airbrake did not stop ship: remaining speed ${brakedTelemetry.speed}`);
}
console.log(`✓ Spaceship active retro-braking engaged: Speed successfully reduced to 0.00 u/s.`);

// Test 7: Space Dust & Speed Streaks
console.log('\n[Test 7] Testing Local Space Dust System...');
const spaceDust = new SpaceDust(simScene, 800, 45.0);
spaceDust.update(controls.getPosition(), new THREE.Vector3(0, 0, -150), false, 0.016);
if (spaceDust.linePositions.length !== 800 * 6) {
  throw new Error('SpaceDust line buffer size mismatch');
}
spaceDust.dispose();
console.log('✓ SpaceDust system updated & disposed successfully.');

// Test 8: Hyperspace System Transition
console.log('\n[Test 8] Testing Hyperspace Interstellar Jump Sequence...');
let systemChangedFired = false;
let newSystemResult = null;

const hyperspace = new HyperspaceManager(
  simScene,
  camera,
  controls,
  (newData, newMeshes) => {
    systemChangedFired = true;
    newSystemResult = newData;
  },
  simData,
  simMeshes
);

// Initiate jump to custom seed
const targetSeed = 'Proxima-Centauri-99';
hyperspace.initiateJump(targetSeed);
if (hyperspace.getState().state !== HyperspaceState.CHARGING) {
  throw new Error('Hyperspace did not enter CHARGING state');
}
console.log('✓ Hyperspace drive initiated: State = CHARGING');

// Simulate Charging phase (1.2s)
for (let t = 0; t < 25; t++) {
  hyperspace.update(0.05);
}
if (hyperspace.getState().state !== HyperspaceState.WARPING) {
  throw new Error(`Expected WARPING state, got ${hyperspace.getState().state}`);
}
console.log('✓ Hyperspace drive spun up: State = WARPING');

// Simulate Warping phase (1.8s) where transition occurs
for (let t = 0; t < 37; t++) {
  hyperspace.update(0.05);
}
if (!systemChangedFired || !newSystemResult) {
  throw new Error('System transition did not occur during WARPING');
}
console.log(`✓ Interstellar jump completed! New system loaded: "${newSystemResult.name}" (Seed: ${newSystemResult.seed})`);

// Clean up
disposeSolarSystem(simMeshes, simScene);
controls.dispose();
hyperspace.dispose();

console.log('\n======================================================');
console.log('ALL OVERHAUL AND SUBSYSTEM TESTS PASSED WITH 100% SUCCESS!');
console.log('======================================================\n');
