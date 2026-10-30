import * as THREE from 'three';
import { getTerrainProfile } from '../src/terrain/terrainProfiles.js';
import { getTerrainHeight, getSurfacePosition, getSurfaceNormal } from '../src/terrain/terrainGenerator.js';
import { createCubeSphereGeometry } from '../src/terrain/terrainGeometry.js';
import { PlanetTerrain } from '../src/terrain/terrainLOD.js';
import { getTerrainAltitude, resolveTerrainCollision } from '../src/terrain/terrainCollision.js';
import { generateSolarSystemData, buildSolarSystemMeshes, disposeSolarSystem } from '../src/systems/solarSystemGenerator.js';
import { CelestialBodies } from '../src/systems/celestialBodies.js';
import { updateOrbits } from '../src/physics/orbitalPhysics.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

console.log('\n[Terrain Profiles & Determinism]');
{
  const pRocky1 = getTerrainProfile('Rocky', 42, 600);
  const pRocky2 = getTerrainProfile('Rocky', 42, 600);
  check('Profile generation is deterministic for identical seeds', JSON.stringify(pRocky1) === JSON.stringify(pRocky2));

  const pDesert = getTerrainProfile('Desert', 101, 800);
  check('Desert profile has terracing and canyon parameters', pDesert.terraceSteps > 0 && pDesert.canyonDepth > 0);

  const pGas = getTerrainProfile('Gas Giant', 999, 3000);
  check('Gas Giant has hasTerrain: false and 0 elevation', pGas.hasTerrain === false && pGas.maxElevation === 0);

  let lunar = null;
  for (let s = 1; s < 200 && !lunar; s++) {
    const p = getTerrainProfile('Moon', s, 200);
    if (p.variant === 'Lunar') lunar = p;
  }
  check('Lunar moon profile has high crater saturation', !!lunar && lunar.craterWeight > 0.5 && lunar.craterCount > 25);

  const variants = new Set();
  for (let s = 1; s < 200; s++) variants.add(getTerrainProfile('Ocean', s, 1000).variant);
  check('Ocean worlds pick from several coherent variants', variants.size >= 3, [...variants].join(','));

  const pOcean = getTerrainProfile('Ocean', 4242, 1000);
  check('Ocean worlds have a water surface and an atmosphere', pOcean.seaSurface === 'water' && !!pOcean.liquid && !!pOcean.atmosphere);

  const dir = new THREE.Vector3(0.577, 0.577, 0.577).normalize();
  const h1 = getTerrainHeight(dir, 42, pRocky1);
  const h2 = getTerrainHeight(dir, 42, pRocky1);
  check('getTerrainHeight is deterministic for identical direction and seed', Math.abs(h1 - h2) < 1e-6, `h1=${h1}, h2=${h2}`);

  const hGas = getTerrainHeight(dir, 999, pGas);
  check('Gas Giant terrain height is strictly 0', hGas === 0);
}

console.log('\n[Terrain Surface Geometry & Normals]');
{
  const profile = getTerrainProfile('Rocky', 12345, 500);
  const dirA = new THREE.Vector3(1, 0, 0);
  const dirB = new THREE.Vector3(0, 1, 0);
  const dirC = new THREE.Vector3(0, 0, 1);

  const posA = getSurfacePosition(dirA, 500, 12345, profile);
  check('Surface position extends beyond center by baseRadius + height', posA.length() > 400 && posA.length() < 600);

  const normalA = getSurfaceNormal(dirA, 500, 12345, profile);
  check('Surface normal is normalized and faces outward', Math.abs(normalA.length() - 1.0) < 1e-4 && normalA.dot(dirA) > 0.5);

  // Cube sphere geometry creation
  const geom = createCubeSphereGeometry(500, 12345, profile, 16);
  check('Geometry has position, normal, color, and uv attributes',
    geom.hasAttribute('position') &&
    geom.hasAttribute('normal') &&
    geom.hasAttribute('color') &&
    geom.hasAttribute('uv') &&
    geom.index !== null
  );

  const posAttr = geom.getAttribute('position');
  const colAttr = geom.getAttribute('color');
  check('Geometry contains correct vertex count for 6 faces of 16x16 grid', posAttr.count === 6 * (17 * 17));
  check('Vertex colors are within [0, 1] range', colAttr.getX(0) >= 0 && colAttr.getX(0) <= 1);

  // Every triangle must wind counter-clockwise seen from outside, or it gets back-face culled
  const idx = geom.index;
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), fn = new THREE.Vector3();
  let inward = 0;
  for (let t = 0; t < idx.count; t += 3) {
    pa.fromBufferAttribute(posAttr, idx.getX(t));
    pb.fromBufferAttribute(posAttr, idx.getX(t + 1));
    pc.fromBufferAttribute(posAttr, idx.getX(t + 2));
    fn.crossVectors(pb.clone().sub(pa), pc.clone().sub(pa));
    if (fn.dot(pa.clone().add(pb).add(pc)) <= 0) inward++;
  }
  check('All terrain triangles face outward (no inside-out faces)', inward === 0, `inward=${inward}`);

  const normAttr = geom.getAttribute('normal');
  let badNormals = 0;
  for (let v = 0; v < normAttr.count; v++) {
    pa.fromBufferAttribute(posAttr, v).normalize();
    pb.fromBufferAttribute(normAttr, v);
    if (pb.dot(pa) < 0.2) badNormals++;
  }
  check('Vertex normals point away from the core', badNormals === 0, `bad=${badNormals}`);
  geom.dispose();

  // Sea level is calibrated: an ocean world has a real share of its surface underwater
  const oceanProfile = getTerrainProfile('Ocean', 777, 1000);
  let below = 0;
  const n = 3000;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i + 1) / n;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963;
    if (getTerrainHeight({ x: r * Math.cos(th), y, z: r * Math.sin(th) }, oceanProfile.seedNum, oceanProfile) < 0) below++;
  }
  check('Ocean world has between 25% and 80% of its surface below sea level', below / n > 0.25 && below / n < 0.8, `below=${(below / n).toFixed(2)}`);
}

console.log('\n[Quadtree Terrain Streaming]');
{
  const profile = getTerrainProfile('Ocean', 4242, 1000);
  const parentGroup = new THREE.Group();
  const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 16, 16), new THREE.MeshBasicMaterial());
  parentGroup.add(bodyMesh);

  const terrain = new PlanetTerrain({ name: 'Test' }, bodyMesh, profile, { sync: true });
  check('Starts with six root chunks', terrain.stats.chunks === 6);
  check('Root chunks are children of the body mesh (inherit its spin)', terrain.group.parent === bodyMesh);
  check('Quadtree is deep enough for walking-scale detail', terrain.maxDepth >= 9, `maxDepth=${terrain.maxDepth}`);

  terrain.refineFully(new THREE.Vector3(0, 0, 8000));
  check('From far away only the roots are used', terrain.stats.chunks === 6, `chunks=${terrain.stats.chunks}`);

  const dir = new THREE.Vector3(0.3, 0.5, 0.8).normalize();
  const ground = 1000 + Math.max(0, getTerrainHeight(dir, profile.seedNum, profile));
  const standing = dir.clone().multiplyScalar(ground + 0.02);
  terrain.refineFully(standing);
  let finest = Infinity;
  let deepest = 0;
  const visit = (node) => {
    if (node.children) node.children.forEach(visit);
    else if (node.mesh?.visible) {
      const dist = standing.distanceTo(node.center);
      if (dist < finest) { finest = dist; deepest = node.level; }
    }
  };
  terrain.roots.forEach(visit);
  check('Standing on the surface refines the chunk underfoot to the deepest level', deepest === terrain.maxDepth, `level=${deepest}`);
  check('Surface chunk count stays bounded', terrain.stats.visible < 700, `visible=${terrain.stats.visible}`);

  // Chunk vertices line up with the analytic surface used for collision / walking
  let chunkNode = null;
  const find = (node) => {
    if (node.children) node.children.forEach(find);
    else if (node.level === terrain.maxDepth && node.mesh && (!chunkNode || standing.distanceTo(node.center) < standing.distanceTo(chunkNode.center))) chunkNode = node;
  };
  terrain.roots.forEach(find);
  const pos = chunkNode.mesh.geometry.getAttribute('position');
  const v = new THREE.Vector3().fromBufferAttribute(pos, 0).add(chunkNode.mesh.position);
  const expected = 1000 + getTerrainHeight(v.clone().normalize(), profile.seedNum, profile);
  check('Finest chunk matches the walkable surface height', Math.abs(v.length() - expected) < 0.01, `diff=${Math.abs(v.length() - expected).toFixed(4)}`);

  terrain.refineFully(new THREE.Vector3(0, 0, 8000));
  check('Moving away merges back to the roots', terrain.stats.chunks === 6, `chunks=${terrain.stats.chunks}`);

  terrain.dispose();
  check('Terrain disposed cleanly', terrain.isDisposed && !terrain.group.parent);
}

console.log('\n[Terrain Altitude & Collision Integration]');
{
  const systemData = generateSolarSystemData('Sol-Prime-42');
  const meshes = buildSolarSystemMeshes(systemData, null);
  const bodies = new CelestialBodies(systemData, meshes);

  const rockyBody = bodies.bodies.find(b => b.kind === 'planet' && b.terrainProfile?.hasTerrain);
  check('CelestialBodies registered rocky body with terrain profile', !!rockyBody);

  const surfaceAltitudeQuery = getTerrainAltitude(rockyBody, rockyBody.position.clone().add(new THREE.Vector3(0, rockyBody.radius + 100, 0)));
  check('Altitude query returns altitude, surfaceRadius and normal',
    surfaceAltitudeQuery.altitude > 0 &&
    surfaceAltitudeQuery.surfaceRadius > rockyBody.radius * 0.9 &&
    surfaceAltitudeQuery.normal.length() > 0.99
  );

  // Penetration collision test
  const from = rockyBody.position.clone().add(new THREE.Vector3(0, rockyBody.radius + 30, 0));
  const to = rockyBody.position.clone().add(new THREE.Vector3(0, rockyBody.radius - 20, 0)); // Inside terrain
  const hit = bodies.resolveCollision(from, to, 1.6);
  check('Collision prevents ship from penetrating inside terrain', !!hit && to.distanceTo(rockyBody.position) >= rockyBody.radius);

  disposeSolarSystem(meshes, null);
}

console.log('\n[Co-rotating frames, belts and gas giants]');
{
  const systemData = generateSolarSystemData('Sol-Prime-42');
  const meshes = buildSolarSystemMeshes(systemData, null);
  updateOrbits(meshes, systemData, 0, 0);
  const bodies = new CelestialBodies(systemData, meshes);
  const planet = bodies.bodies.find(b => b.kind === 'planet' && b.terrainProfile?.hasTerrain);

  // A ship hovering just above the surface should keep its spot as the planet spins
  const mesh = planet.mesh;
  mesh.updateWorldMatrix(true, false);
  const local = new THREE.Vector3(0, 0, planet.radius + planet.terrainProfile.maxElevation * 1.3);
  const ship = local.clone().applyMatrix4(mesh.matrixWorld);
  mesh.rotation.y += 0.05;
  planet.object.position.x += 3;
  bodies.sample();
  const carry = bodies.computeFrameCarry(ship);
  ship.add(carry.displacement);
  mesh.updateWorldMatrix(true, false);
  const expected = local.clone().applyMatrix4(mesh.matrixWorld);
  check('Near the surface the ship co-rotates with the planet', ship.distanceTo(expected) < 1e-3, `err=${ship.distanceTo(expected).toExponential(2)}`);
  check('Co-rotation also returns the frame rotation for the ship heading', !!carry.rotation && carry.rotation.angleTo(new THREE.Quaternion()) > 0.04);

  const far = planet.position.clone().add(new THREE.Vector3(0, 0, planet.radius * 1.8));
  check('High above the surface there is no co-rotation', bodies.coRotationWeight(planet, far) === 0);

  let gasless = 0;
  let belts = 0;
  for (let i = 0; i < 60; i++) {
    const d = generateSolarSystemData(`belt-test-${i}`);
    if (!d.planets.some(p => p.type === 'Gas Giant')) gasless++;
    if (d.asteroidBelt) {
      belts++;
      const b = d.asteroidBelt;
      const clear = d.planets.every(p => p.semiMajorAxis * (1 + p.eccentricity) < b.innerRadius - 2000 || p.semiMajorAxis * (1 - p.eccentricity) > b.outerRadius + 2000);
      if (!clear) gasless += 1000;
    }
  }
  check('Every system has at least one gas giant, and belts never overlap planet orbits', gasless === 0, `bad=${gasless}`);
  check('Most systems have an asteroid belt', belts > 30, `belts=${belts}/60`);

  if (meshes.asteroidBelt) {
    const belt = meshes.asteroidBelt;
    const mid = (systemData.asteroidBelt.innerRadius + systemData.asteroidBelt.outerRadius) / 2;
    const inside = new THREE.Vector3(mid, 0, 0);
    belt.update(inside);
    const rocks = belt.layers[0].rocks.length + belt.layers[1].rocks.length;
    check('Flying into the belt streams in rocks around you', rocks > 50, `rocks=${rocks}`);
    const rock = belt.layers[0].rocks[0];
    const into = new THREE.Vector3(rock.x, rock.y, rock.z);
    const rockHit = belt.resolveCollision(into, 0.14);
    check('Rocks are solid', !!rockHit && into.distanceTo(new THREE.Vector3(rock.x, rock.y, rock.z)) >= rock.r);
    belt.update(new THREE.Vector3(0, 0, 0));
    check('Rocks are released when you leave the belt', belt.layers[0].rocks.length === 0);
  }
  disposeSolarSystem(meshes, null);
}

console.log(failures === 0 ? '\nAll terrain tests passed!' : `\n${failures} terrain test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
