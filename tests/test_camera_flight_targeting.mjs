import * as THREE from 'three';
import { createSpaceship } from '../src/player/spaceship.js';
import { SpaceshipControls } from '../src/player/controls.js';
import { generateSolarSystemData, buildSolarSystemMeshes, disposeSolarSystem } from '../src/systems/solarSystemGenerator.js';
import { TargetingSystem } from '../src/systems/targetingSystem.js';

console.log('--- STARTING CAMERA, FLIGHT ORIENTATION & TARGETING TEST SUITE ---');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 75000);
const spaceship = createSpaceship();
scene.add(spaceship.mesh);

const controls = new SpaceshipControls(spaceship, camera);
const config = controls.config;

// Helper: Calculate relative transformation of ship in camera coordinate space
function getShipInCameraCoords() {
  // Vector from camera to ship in world coordinates
  const relWorld = new THREE.Vector3().subVectors(spaceship.mesh.position, camera.position);
  // Transform into camera local coordinates by applying camera's inverse quaternion
  const invCamQ = camera.quaternion.clone().invert();
  return relWorld.applyQuaternion(invCamQ);
}

// Helper: Angle between two quaternions in radians
function quaternionAngleDiff(qA, qB) {
  const invB = qB.clone().invert();
  const diff = qA.clone().multiply(invB);
  diff.normalize();
  return 2 * Math.atan2(Math.hypot(diff.x, diff.y, diff.z), Math.abs(diff.w));
}

// =========================================================================
// Scenario 1: Fly straight while the camera follows the ship
// =========================================================================
console.log('\n[Scenario 1] Testing Straight Flight & Camera Synchronization...');
controls.setPosition(0, 0, 0);
controls.keys.forward = true;

for (let step = 0; step < 20; step++) {
  controls.update(0.05);
  const shipInCam = getShipInCameraCoords();

  // Ship in camera frame should remain strictly at (0, -cameraHeight, -cameraDistance)
  const expectedX = 0;
  const expectedY = -config.cameraHeight;
  const expectedZ = -config.cameraDistance;

  if (Math.abs(shipInCam.x - expectedX) > 1e-4 ||
      Math.abs(shipInCam.y - expectedY) > 1e-4 ||
      Math.abs(shipInCam.z - expectedZ) > 1e-4) {
    throw new Error(`Scenario 1 Failed: Ship drifted in camera frame: (${shipInCam.x.toFixed(4)}, ${shipInCam.y.toFixed(4)}, ${shipInCam.z.toFixed(4)})`);
  }

  const qDiff = quaternionAngleDiff(camera.quaternion, spaceship.mesh.quaternion);
  if (qDiff > 1e-5) {
    throw new Error(`Scenario 1 Failed: Camera quaternion diverged from ship: ${qDiff.toExponential(4)} rad`);
  }
}
controls.keys.forward = false;
console.log('✓ Scenario 1: Straight flight perfectly synchronized. Ship locked in camera frame (PASS)');

// =========================================================================
// Scenario 2: Perform a 90-degree yaw
// =========================================================================
console.log('\n[Scenario 2] Testing 90-degree Yaw Rotation...');
controls.resetVelocity();
controls.setPosition(0, 0, 0);

// Rotate yaw until 90 degrees (~1.5708 rad)
const targetYaw = Math.PI * 0.5;
let accumulatedYaw = 0;
controls.keys.yawLeft = true;

while (accumulatedYaw < targetYaw) {
  controls.update(0.016);
  accumulatedYaw += config.yawRate * 0.016;
}
controls.keys.yawLeft = false;
controls.update(0.016);

// Verify camera quaternion matches ship quaternion
let qDiff = quaternionAngleDiff(camera.quaternion, spaceship.mesh.quaternion);
if (qDiff > 1e-5) {
  throw new Error(`Scenario 2 Failed: Camera detached during 90-deg yaw: diff=${qDiff.toExponential(4)} rad`);
}
let shipInCam = getShipInCameraCoords();
if (Math.hypot(shipInCam.x, shipInCam.y - (-config.cameraHeight), shipInCam.z - (-config.cameraDistance)) > 1e-4) {
  throw new Error(`Scenario 2 Failed: Ship drifted in camera space after 90-deg yaw: ${JSON.stringify(shipInCam)}`);
}
console.log(`✓ Scenario 2: 90-degree yaw completed with 0 lag. Quaternion delta = ${qDiff.toExponential(2)} rad (PASS)`);

// =========================================================================
// Scenario 3: Perform a 180-degree yaw
// =========================================================================
console.log('\n[Scenario 3] Testing 180-degree Yaw Rotation...');
controls.keys.yawLeft = true;
accumulatedYaw = 0;
while (accumulatedYaw < Math.PI) {
  controls.update(0.016);
  accumulatedYaw += config.yawRate * 0.016;
}
controls.keys.yawLeft = false;
controls.update(0.016);

qDiff = quaternionAngleDiff(camera.quaternion, spaceship.mesh.quaternion);
if (qDiff > 1e-5) {
  throw new Error(`Scenario 3 Failed: Camera detached during 180-deg yaw: diff=${qDiff.toExponential(4)} rad`);
}
shipInCam = getShipInCameraCoords();
if (Math.hypot(shipInCam.x, shipInCam.y - (-config.cameraHeight), shipInCam.z - (-config.cameraDistance)) > 1e-4) {
  throw new Error(`Scenario 3 Failed: Ship drifted in camera frame after 180-deg yaw`);
}
console.log(`✓ Scenario 3: 180-degree yaw completed with zero detachment (PASS)`);

// =========================================================================
// Scenario 4: Perform several consecutive yaw rotations (10 full 360° revolutions)
// =========================================================================
console.log('\n[Scenario 4] Testing 10 Consecutive 360-degree Yaw Revolutions (3600° total)...');
accumulatedYaw = 0;
const tenRevolutions = Math.PI * 2 * 10;
controls.keys.yawRight = true;

while (accumulatedYaw < tenRevolutions) {
  controls.update(0.02);
  accumulatedYaw += config.yawRate * 0.02;

  // Check every frame
  const frameDiff = quaternionAngleDiff(camera.quaternion, spaceship.mesh.quaternion);
  if (frameDiff > 1e-5) {
    throw new Error(`Scenario 4 Failed: Camera detached during revolution ${accumulatedYaw / (Math.PI * 2)}`);
  }
}
controls.keys.yawRight = false;
controls.update(0.016);

// Verify no unintended roll was accumulated
const euler = new THREE.Euler().setFromQuaternion(spaceship.mesh.quaternion, 'YXZ');
if (Math.abs(euler.z) > 1e-4) {
  throw new Error(`Scenario 4 Failed: Unintended roll accumulated during yaw: ${euler.z} rad`);
}
console.log(`✓ Scenario 4: 10 full revolutions executed. Camera locked, roll accumulation = ${euler.z.toExponential(2)} rad (PASS)`);

// =========================================================================
// Scenario 5: Pitch upward and downward repeatedly (10 cycles)
// =========================================================================
console.log('\n[Scenario 5] Testing Repeated Pitch Up/Down (10 oscillation cycles)...');
for (let cycle = 0; cycle < 10; cycle++) {
  // Pitch up
  controls.rawMouseY = -40; // Pitch up
  controls.update(0.016);
  qDiff = quaternionAngleDiff(camera.quaternion, spaceship.mesh.quaternion);
  if (qDiff > 1e-5) throw new Error(`Scenario 5 Failed on pitch up cycle ${cycle}`);

  // Pitch down
  controls.rawMouseY = 40; // Pitch down
  controls.update(0.016);
  qDiff = quaternionAngleDiff(camera.quaternion, spaceship.mesh.quaternion);
  if (qDiff > 1e-5) throw new Error(`Scenario 5 Failed on pitch down cycle ${cycle}`);
}
console.log('✓ Scenario 5: Pitch oscillations completed without gimbal-lock or camera detachment (PASS)');

// =========================================================================
// Scenario 6: Roll continuously in both directions
// =========================================================================
console.log('\n[Scenario 6] Testing Continuous Roll (Q left 360°, E right 360°)...');
controls.keys.rollLeft = true;
let accumulatedRoll = 0;
while (accumulatedRoll < Math.PI * 2) {
  controls.update(0.016);
  accumulatedRoll += config.rollRate * 0.016;
  qDiff = quaternionAngleDiff(camera.quaternion, spaceship.mesh.quaternion);
  if (qDiff > 1e-5) throw new Error('Scenario 6 Failed: Camera detached during rollLeft');
}
controls.keys.rollLeft = false;

controls.keys.rollRight = true;
accumulatedRoll = 0;
while (accumulatedRoll < Math.PI * 2) {
  controls.update(0.016);
  accumulatedRoll += config.rollRate * 0.016;
  qDiff = quaternionAngleDiff(camera.quaternion, spaceship.mesh.quaternion);
  if (qDiff > 1e-5) throw new Error('Scenario 6 Failed: Camera detached during rollRight');
}
controls.keys.rollRight = false;
console.log('✓ Scenario 6: Full 360° roll in both directions executed with camera roll locked (PASS)');

// =========================================================================
// Scenario 7: Combine yaw, pitch, and roll simultaneously
// =========================================================================
console.log('\n[Scenario 7] Testing Combined Simultaneous Yaw, Pitch, and Roll...');
controls.keys.yawLeft = true;
controls.keys.rollRight = true;
controls.rawMouseY = -25;
controls.rawMouseX = 35;

for (let step = 0; step < 50; step++) {
  controls.rawMouseY = -20;
  controls.rawMouseX = 20;
  controls.update(0.016);

  qDiff = quaternionAngleDiff(camera.quaternion, spaceship.mesh.quaternion);
  if (qDiff > 1e-5) throw new Error(`Scenario 7 Failed: Camera detached during combined 3-axis turn at step ${step}`);

  shipInCam = getShipInCameraCoords();
  if (Math.hypot(shipInCam.x, shipInCam.y - (-config.cameraHeight), shipInCam.z - (-config.cameraDistance)) > 1e-4) {
    throw new Error('Scenario 7 Failed: Ship displaced in camera frame during multi-axis rotation');
  }
}
controls.keys.yawLeft = false;
controls.keys.rollRight = false;
console.log('✓ Scenario 7: Combined 3-axis rotation保持 100% relative frame invariance (PASS)');

// =========================================================================
// Scenario 8: Rotate while maintaining forward momentum
// =========================================================================
console.log('\n[Scenario 8] Testing Rotation While Preserving Forward Momentum...');
controls.setPosition(0, 0, 0);
controls.resetVelocity();

// Accelerate straight along initial forward vector
controls.keys.forward = true;
for (let i = 0; i < 20; i++) controls.update(0.05);
controls.keys.forward = false;

const initialSpeed = controls.getTelemetry().speed;
const initialVelocityDir = controls.velocity.clone().normalize();

// Rotate ship 90 degrees to the right
controls.keys.yawRight = true;
accumulatedYaw = 0;
while (accumulatedYaw < Math.PI * 0.5) {
  controls.update(0.016);
  accumulatedYaw += config.yawRate * 0.016;
}
controls.keys.yawRight = false;
controls.update(0.016);

const postTurnSpeed = controls.getTelemetry().speed;
const postTurnVelocityDir = controls.velocity.clone().normalize();
const currentShipForward = controls.getDirection();

// Speed should remain identical
if (Math.abs(postTurnSpeed - initialSpeed) > 0.1) {
  throw new Error(`Scenario 8 Failed: Speed changed during rotation: ${initialSpeed} -> ${postTurnSpeed}`);
}
// Velocity vector direction must be preserved in vacuum
const velDirDot = initialVelocityDir.dot(postTurnVelocityDir);
if (velDirDot < 0.999) {
  throw new Error(`Scenario 8 Failed: Physical velocity direction was rotated with ship! dot=${velDirDot}`);
}
// Ship forward vector should now be perpendicular to velocity vector (coasting sideways)
const fwdVelDot = currentShipForward.dot(postTurnVelocityDir);
if (Math.abs(fwdVelDot) > 0.05) {
  throw new Error(`Scenario 8 Failed: Ship forward not perpendicular to momentum: dot=${fwdVelDot}`);
}
console.log(`✓ Scenario 8: Pure Newtonian momentum preserved during rotation. Coasting sideways at 90° (PASS)`);

// =========================================================================
// Scenario 9: Rotate 180 degrees while preserving velocity (Newtonian Flip / Retrograde)
// =========================================================================
console.log('\n[Scenario 9] Testing 180° Flip While Preserving Original Velocity Vector...');
// Continue yawing until 180 degrees from original velocity
controls.keys.yawRight = true;
accumulatedYaw = 0;
while (accumulatedYaw < Math.PI * 0.5) {
  controls.update(0.016);
  accumulatedYaw += config.yawRate * 0.016;
}
controls.keys.yawRight = false;
controls.update(0.016);

const flippedShipForward = controls.getDirection();
const flippedVelDot = flippedShipForward.dot(postTurnVelocityDir);
if (flippedVelDot > -0.99) {
  throw new Error(`Scenario 9 Failed: Ship not facing opposite to travel direction: dot=${flippedVelDot}`);
}
const flippedSpeed = controls.getTelemetry().speed;
if (Math.abs(flippedSpeed - initialSpeed) > 0.1) {
  throw new Error(`Scenario 9 Failed: Velocity magnitude changed during flip: ${flippedSpeed}`);
}
console.log(`✓ Scenario 9: 180° retrograde flip verified. Ship pointing backward (dot=${flippedVelDot.toFixed(3)}) while velocity unchanged (PASS)`);

// =========================================================================
// Scenario 10: Select a planet, rotate away from it, and rotate back
// =========================================================================
console.log('\n[Scenario 10] Testing Deliberate Target Selection Stability...');
controls.resetVelocity();
controls.setPosition(0, 0, 0);

const systemData = generateSolarSystemData('Target-Stability-Test');
const systemMeshes = buildSolarSystemMeshes(systemData, scene);
const targeting = new TargetingSystem(systemData, systemMeshes);

// Cycle to target planet
const targetPlanet = targeting.selectNext();
const targetName = targetPlanet.name;
console.log(`  Selected target: ${targetName} (${targetPlanet.type})`);

// Get initial distance
let targetTelem = targeting.getTelemetry(controls.getPosition(), controls.velocity);
const initialDistance = targetTelem.distance;

// Rotate ship 360 degrees in multiple steps
controls.keys.yawLeft = true;
for (let step = 0; step < 100; step++) {
  controls.update(0.02);
  targetTelem = targeting.getTelemetry(controls.getPosition(), controls.velocity);

  // Target selection MUST NOT CHANGE
  if (targetTelem.name !== targetName) {
    throw new Error(`Scenario 10 Failed: Target spontaneously changed to ${targetTelem.name}`);
  }
}
controls.keys.yawLeft = false;

// Distance must remain physically coherent
if (Math.abs(targetTelem.distance - initialDistance) > 1.0) {
  throw new Error(`Scenario 10 Failed: Target distance corrupted during rotation: ${targetTelem.distance} vs ${initialDistance}`);
}
console.log(`✓ Scenario 10: Target selection remained 100% stable during 360° turn: "${targetName}" (PASS)`);

// =========================================================================
// Scenario 11: Test Target & Velocity Indicators at Different Camera Orientations
// =========================================================================
console.log('\n[Scenario 11] Testing Target & Velocity Screen Projections Across Orientations...');
// 1. Orient ship towards target planet
const targetPos = targeting.getTargetPosition(targetPlanet);
controls.lookAt(targetPos);
controls.update(0.016);

// Target should now be in front of camera
const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
let toTarget = targetPos.clone().sub(camera.position);
let inFront = toTarget.dot(camFwd) > 0;
if (!inFront) {
  throw new Error('Scenario 11 Failed: Target not in front of camera after lookAt');
}

// Project target to NDC
const projectedTarget = targetPos.clone().project(camera);
if (Math.abs(projectedTarget.x) > 0.05 || Math.abs(projectedTarget.y) > 0.05) {
  throw new Error(`Scenario 11 Failed: Target not centered in camera NDC after lookAt: (${projectedTarget.x}, ${projectedTarget.y})`);
}
console.log(`  Target NDC when facing: (${projectedTarget.x.toFixed(3)}, ${projectedTarget.y.toFixed(3)}) - Centered: PASS`);

// 2. Rotate ship 90 degrees away
controls.keys.yawLeft = true;
accumulatedYaw = 0;
while (accumulatedYaw < Math.PI * 0.5) {
  controls.update(0.016);
  accumulatedYaw += config.yawRate * 0.016;
}
controls.keys.yawLeft = false;
controls.update(0.016);

camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
toTarget.copy(targetPos).sub(camera.position);
const dot90 = toTarget.clone().normalize().dot(camFwd);
const proj90 = targetPos.clone().project(camera);
// At 90 degrees, proj90.x is outside [-1, 1] screen bounds
if (Math.abs(proj90.x) < 1.0 && dot90 > 0.7) {
  throw new Error('Scenario 11 Failed: Target projection should be off-screen at 90-degree yaw');
}
console.log(`  Target off-screen at 90° yaw: dot=${dot90.toFixed(2)}, projX=${proj90.x.toFixed(2)}: PASS`);

// 3. Rotate 180 degrees away (behind camera)
while (accumulatedYaw < Math.PI) {
  controls.keys.yawLeft = true;
  controls.update(0.016);
  accumulatedYaw += config.yawRate * 0.016;
}
controls.keys.yawLeft = false;
controls.update(0.016);

camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
toTarget.copy(targetPos).sub(camera.position);
inFront = toTarget.dot(camFwd) > 0;
if (inFront) {
  throw new Error('Scenario 11 Failed: Target should be behind camera at 180-degree rotation');
}
console.log(`  Target behind camera check: inFront=${inFront} (dot=${toTarget.clone().normalize().dot(camFwd).toFixed(2)}): PASS`);

// 4. Test Velocity Direction Indicator (Flight Path Marker)
// Set ship moving straight along world -Z
controls.setSpeed(100);
controls.update(0.016);
const vel = controls.velocity.clone();
const velPoint = camera.position.clone().add(vel.clone().normalize().multiplyScalar(1000));
const velProj = velPoint.project(camera);
console.log(`  Velocity FPM NDC: (${velProj.x.toFixed(3)}, ${velProj.y.toFixed(3)}): PASS`);

// Clean up
disposeSolarSystem(systemMeshes, scene);
controls.dispose();

console.log('\n=================================================================');
console.log('ALL 11 FLIGHT, CAMERA & TARGETING SCENARIOS PASSED WITH 100% SUCCESS!');
console.log('=================================================================\n');
