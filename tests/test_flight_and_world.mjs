import * as THREE from 'three';
import { generateSolarSystemData, buildSolarSystemMeshes, disposeSolarSystem } from '../src/systems/solarSystemGenerator.js';
import { updateOrbits } from '../src/physics/orbitalPhysics.js';
import { CelestialBodies } from '../src/systems/celestialBodies.js';
import { TargetingSystem } from '../src/systems/targetingSystem.js';
import { createSpaceship } from '../src/player/spaceship.js';
import { SpaceshipControls } from '../src/player/controls.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

const DT = 1 / 60;
function makeShip() {
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.5, 4e6);
  const ship = createSpaceship();
  const controls = new SpaceshipControls(ship, camera);
  return { camera, ship, controls };
}
function run(controls, seconds, onStep) {
  for (let t = 0; t < seconds; t += DT) {
    controls.update(DT);
    controls.updateCamera(DT);
    if (onStep) onStep(t);
  }
}

// ---------------------------------------------------------------------------
console.log('\n[World scale & orbits]');
{
  for (const seed of ['Sol-Prime-42', 'Kepler-452b', 'Void-999', 'ALPHA-123']) {
    const data = generateSolarSystemData(seed);
    const again = generateSolarSystemData(seed);
    check(`${seed}: deterministic`, JSON.stringify(data) === JSON.stringify(again));

    let ok = true;
    let prevAphelion = data.star.radius;
    for (const p of data.planets) {
      const peri = p.semiMajorAxis * (1 - p.eccentricity);
      if (peri - p.radius * 3 < prevAphelion) ok = false;
      prevAphelion = p.semiMajorAxis * (1 + p.eccentricity) + p.radius * 3;
      for (const m of p.moons) if (m.distance - m.radius < p.radius * 1.5) ok = false;
    }
    check(`${seed}: orbits and moons clear of each other`, ok);

    const inner = data.planets[0];
    const periodMin = (Math.PI * 2) / inner.orbitalSpeed / 60;
    check(`${seed}: inner planet orbit is slow (${periodMin.toFixed(1)} min)`, periodMin > 5);
    check(`${seed}: rocky/inner planet is hundreds of times the ship (${inner.radius.toFixed(0)} u)`, inner.radius > 400);
  }
}

// ---------------------------------------------------------------------------
console.log('\n[Throttle & boost]');
{
  const { controls } = makeShip();
  const max = controls.config.normalMaxSpeed;

  controls.keys.forward = true;
  run(controls, 1.5);
  controls.keys.forward = false;
  run(controls, 3);
  const cruiseSpeed = controls.velocity.length();
  check('W raises throttle and it persists after release', controls.throttle >= 0.99 && cruiseSpeed > max * 0.95, `speed=${cruiseSpeed.toFixed(1)}`);

  controls.keys.boost = true;
  run(controls, 2.5);
  const boosted = controls.velocity.length();
  check('Boost accelerates well past normal max', boosted > max * 2, `speed=${boosted.toFixed(1)}`);

  controls.keys.boost = false;
  let maxDrop = 0;
  let prev = controls.velocity.length();
  run(controls, 4, () => {
    const s = controls.velocity.length();
    maxDrop = Math.max(maxDrop, prev - s);
    prev = s;
  });
  const afterBoost = controls.velocity.length();
  check('Releasing boost eases back down (no snap)', maxDrop < 10, `largest per-frame drop=${maxDrop.toFixed(2)}`);
  check('…and settles at the throttle speed', Math.abs(afterBoost - max) < 5, `speed=${afterBoost.toFixed(1)}`);

  controls.keys.forward = true;
  controls.keys.boost = true;
  run(controls, 1);
  controls.keys.forward = false;
  run(controls, 0.5);
  const boostNoW = controls.velocity.length();
  check('Holding/releasing W during boost does not change boost speed', boostNoW > max * 2, `speed=${boostNoW.toFixed(1)}`);
  controls.keys.boost = false;

  controls.keys.brake = true;
  run(controls, 3);
  controls.keys.brake = false;
  run(controls, 1);
  check('Brake stops the ship and it stays stopped', controls.velocity.length() < 1, `speed=${controls.velocity.length().toFixed(2)}`);
}

// ---------------------------------------------------------------------------
console.log('\n[Cruise drive]');
{
  const { controls } = makeShip();
  const toBody = new THREE.Vector3(0, 0, -1);
  let altitude = 50000;
  controls.setEnvironment({ altitude, radius: 800, name: 'Test', toBody });

  let engaged = false;
  let dropAltitude = null;
  let dropSpeed = null;
  let peakSpeed = 0;
  controls.onEvent = (type) => {
    if (type === 'cruise-engaged') engaged = true;
    if (type === 'cruise-disengaged' && dropAltitude === null) {
      dropAltitude = altitude;
      dropSpeed = controls.velocity.length();
    }
  };
  controls.toggleCruise();
  run(controls, 90, () => {
    altitude = Math.max(0, altitude - controls.velocity.length() * DT);
    peakSpeed = Math.max(peakSpeed, controls.velocity.length());
    controls.setEnvironment({ altitude, radius: 800, name: 'Test', toBody });
  });
  check('Cruise engages after spool', engaged);
  check(`Cruise reaches high speed (${peakSpeed.toFixed(0)} u/s)`, peakSpeed > 5000);
  check('Cruise drops out near the body at normal speed',
    dropAltitude !== null && dropAltitude > controls.config.cruiseDropAltitude * 0.5 && dropSpeed <= controls.config.normalMaxSpeed + 1,
    `dropAltitude=${dropAltitude?.toFixed(0)} dropSpeed=${dropSpeed?.toFixed(0)}`);
}

// ---------------------------------------------------------------------------
console.log('\n[Collisions & local frames]');
{
  const data = generateSolarSystemData('Sol-Prime-42');
  const meshes = buildSolarSystemMeshes(data, null);
  let t = 0;
  updateOrbits(meshes, data, 0, t);
  const bodies = new CelestialBodies(data, meshes);
  const planet = bodies.getById('planet_1');

  // Fly straight into the planet at boost speed
  const from = planet.position.clone().add(new THREE.Vector3(planet.radius + 50, 0, 0));
  const to = planet.position.clone().add(new THREE.Vector3(-planet.radius - 50, 0, 0)); // tunnels through in one step
  const hit = bodies.resolveCollision(from, to, 1.6);
  check('Swept collision stops a ship that would tunnel through a planet', !!hit && to.distanceTo(planet.position) >= planet.radius);

  // Ship flying near the planet at safe altitude within maxElevation does not get falsely collided or stuck
  const nearFrom = planet.position.clone().add(new THREE.Vector3(planet.radius + 15, 0, 0));
  const nearTo = nearFrom.clone().add(new THREE.Vector3(0, 5, 0));
  const nearHit = bodies.resolveCollision(nearFrom, nearTo, 1.6);
  check('Ship flying above terrain within maxElevation range does not falsely collide', !nearHit);

  // Ship inside a planet is cleanly pushed out to the surface with an outward normal
  const insideFrom = planet.position.clone().add(new THREE.Vector3(planet.radius * 0.5, 0, 0));
  const insideTo = insideFrom.clone();
  const insideHit = bodies.resolveCollision(insideFrom, insideTo, 1.6);
  const outwardDot = insideHit ? insideHit.normal.dot(new THREE.Vector3(1, 0, 0)) : 0;
  check('Ship inside planet is ejected outside surface', !!insideHit && insideTo.distanceTo(planet.position) >= planet.radius);
  check('Collision normal points outward away from core', outwardDot > 0.5, `outwardDot=${outwardDot.toFixed(3)}`);

  // Park near the planet and let time pass: relative offset should stay put
  const ship = planet.position.clone().add(new THREE.Vector3(0, 0, planet.radius * 3));
  const offset0 = ship.clone().sub(planet.position);
  for (let i = 0; i < 600; i++) {
    t += DT;
    updateOrbits(meshes, data, DT, t);
    bodies.sample();
    ship.add(bodies.computeFrameCarry(ship).displacement);
  }
  const drift = ship.clone().sub(planet.position).distanceTo(offset0);
  check('Ship inside a planet\'s frame is carried with it', drift < 1, `drift=${drift.toFixed(3)}`);

  // Targeting reads the same positions
  const targeting = new TargetingSystem(bodies);
  targeting.reset('planet_1');
  const tel = targeting.getTelemetry(ship, new THREE.Vector3(), bodies.computeFrameCarry(ship).frameBody, DT);
  check('Target telemetry uses the live body position', tel.position === planet.position && Math.abs(tel.closingSpeed) < 0.5,
    `closing=${tel.closingSpeed.toFixed(2)}`);

  const dir = planet.position.clone().sub(ship).normalize();
  targeting.selectById('star');
  check('Crosshair pick selects the body in front', targeting.selectByRay(ship, dir)?.id === 'planet_1');
  check('Target list contains star, planets and moons',
    targeting.getTargetList().length === 1 + data.planets.length + data.planets.reduce((n, p) => n + p.moons.length, 0));

  disposeSolarSystem(meshes, null);
}

// ---------------------------------------------------------------------------
console.log('\n[Flying close to terrain]');
{
  const { getTerrainHeight, getSolidSurfaceHeight } = await import('../src/terrain/terrainGenerator.js');
  const data = generateSolarSystemData('Sol-Prime-42');
  const meshes = buildSolarSystemMeshes(data, null);
  let simTime = 0;
  updateOrbits(meshes, data, 0, simTime);
  const bodies = new CelestialBodies(data, meshes);
  const planet = bodies.bodies.find(b => b.kind === 'planet' && b.terrainProfile?.hasTerrain);
  const p = planet.terrainProfile;

  // Find a spot in a basin (below the base radius) and one on high ground
  const golden = Math.PI * (3 - Math.sqrt(5));
  let basin = null, high = null;
  for (let i = 0; i < 4000 && (!basin || !high); i++) {
    const y = 1 - (2 * i + 1) / 4000, r = Math.sqrt(1 - y * y);
    const d = new THREE.Vector3(r * Math.cos(golden * i), y, r * Math.sin(golden * i));
    const h = getSolidSurfaceHeight(d, p.seedNum, p);
    if (!basin && h < -p.maxElevation * 0.15) basin = d;
    if (!high && h > p.maxElevation * 0.3) high = d;
  }

  const flyFrom = (localDir, label) => {
    const { controls } = makeShip();
    const ship = controls.ship;
    const mesh = planet.mesh;
    mesh.updateWorldMatrix(true, false);
    const h = getSolidSurfaceHeight(localDir, p.seedNum, p);
    const start = localDir.clone().multiplyScalar(planet.radius + h + 0.3).applyMatrix4(mesh.matrixWorld);
    ship.position.copy(start);
    // Nose 35° above the horizon
    const up = start.clone().sub(planet.position).normalize();
    const tangent = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0.3, 1, 0.2).normalize()).normalize();
    const look = start.clone().addScaledVector(tangent, Math.cos(0.6)).addScaledVector(up, Math.sin(0.6));
    ship.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(start, look, up));
    controls.throttle = 1;
    bodies.sample(true);

    const prev = new THREE.Vector3();
    let hits = 0;
    for (let t = 0; t < 6; t += DT) {
      simTime += DT;
      updateOrbits(meshes, data, DT, simTime);
      bodies.sample();
      const carry = bodies.computeFrameCarry(ship.position);
      ship.position.add(carry.displacement);
      if (carry.rotation) controls.applyFrameRotation(carry.rotation);
      const near = bodies.findNearest(ship.position);
      controls.setEnvironment({ altitude: near.altitude, radius: near.body.radius, name: '', toBody: near.body.position.clone().sub(ship.position).normalize() });
      prev.copy(ship.position);
      controls.update(DT);
      const hit = bodies.resolveCollision(prev, ship.position, controls.config.shipRadius);
      if (hit) { hits++; controls.applyImpact(hit.normal); }
    }
    const alt = bodies.findNearest(ship.position).altitude;
    check(`${label}: full throttle nose-up climbs away from the ground`, alt > 20, `alt=${alt.toFixed(2)} hits=${hits} throttle=${controls.throttle.toFixed(2)}`);
  };
  if (basin) flyFrom(basin, 'Basin'); else check('found a basin to test', false);
  if (high) flyFrom(high, 'Highland'); else check('found high ground to test', false);

  // Hovering low with no throttle must not be dragged into or stuck to the ground
  {
    const { controls } = makeShip();
    const ship = controls.ship;
    const dir = (high || basin).clone();
    planet.mesh.updateWorldMatrix(true, false);
    const h = getSolidSurfaceHeight(dir, p.seedNum, p);
    ship.position.copy(dir.clone().multiplyScalar(planet.radius + h + 0.5).applyMatrix4(planet.mesh.matrixWorld));
    bodies.sample(true);
    const prev = new THREE.Vector3();
    let hits = 0;
    for (let t = 0; t < 3; t += DT) {
      simTime += DT;
      updateOrbits(meshes, data, DT, simTime);
      bodies.sample();
      const carry = bodies.computeFrameCarry(ship.position);
      ship.position.add(carry.displacement);
      if (carry.rotation) controls.applyFrameRotation(carry.rotation);
      prev.copy(ship.position);
      controls.update(DT);
      if (bodies.resolveCollision(prev, ship.position, controls.config.shipRadius)) hits++;
    }
    const alt = bodies.findNearest(ship.position).altitude;
    check('Hovering 50 m up stays put with no ground contact', hits === 0 && Math.abs(alt - 0.5) < 0.1, `alt=${alt.toFixed(3)} hits=${hits}`);
  }
  disposeSolarSystem(meshes, null);
}

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
