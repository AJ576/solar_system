import * as THREE from 'three';

/**
 * Solves Kepler's equation M = E - e * sin(E) for Eccentric Anomaly E
 * using the Newton-Raphson iteration method.
 *
 * @param {number} M Mean anomaly in radians
 * @param {number} e Orbital eccentricity (0 <= e < 1)
 * @returns {number} Eccentric anomaly E in radians
 */
export function solveKepler(M, e) {
  // Normalize M into [0, 2*PI) for numerical stability
  const TWO_PI = Math.PI * 2;
  const normalizedM = ((M % TWO_PI) + TWO_PI) % TWO_PI;

  let E = normalizedM;
  for (let iter = 0; iter < 10; iter++) {
    const f = E - e * Math.sin(E) - normalizedM;
    const fPrime = 1 - e * Math.cos(E);
    const delta = f / fPrime;
    E -= delta;
    if (Math.abs(delta) < 1e-6) break;
  }
  return E;
}

/**
 * Computes the 3D position vector of a planet orbiting a central star at time totalTime.
 * Implements Keplerian orbital mechanics:
 *   - Semi-major axis: a
 *   - Eccentricity: e
 *   - Inclination: i (rotated around line of nodes)
 *   - Mean Anomaly at time t: M(t) = M0 + n * t
 *   - True Anomaly: nu
 *   - Position in orbital plane: (r * cos(nu), r * sin(nu))
 *   - 3D Position with inclination: (x_orb, z_orb * sin(i), z_orb * cos(i))
 *
 * @param {Object} planetData Planet orbital parameters
 * @param {number} totalTime Total elapsed simulation time in seconds
 * @param {THREE.Vector3} [target] Optional target vector to store result into
 * @returns {THREE.Vector3} 3D position vector { x, y, z }
 */
export function getPlanetPosition(planetData, totalTime, target = new THREE.Vector3()) {
  const a = planetData.semiMajorAxis ?? planetData.distance ?? planetData.a ?? 30;
  const e = planetData.eccentricity ?? 0;
  const inc = planetData.inclination ?? 0;
  const M0 = planetData.meanAnomaly0 ?? planetData.startAngle ?? 0;

  // Mean motion (orbital speed)
  let n = planetData.orbitalSpeed;
  if (n === undefined) {
    if (planetData.speed !== undefined) {
      n = planetData.speed;
    } else {
      const starMass = planetData.starMass ?? 2000;
      const G = planetData.G ?? 1;
      n = Math.sqrt((G * starMass) / Math.pow(a, 3));
    }
  }

  // Mean anomaly at time t
  const M = M0 + n * totalTime;

  // Solve Kepler's equation for Eccentric Anomaly E
  const E = solveKepler(M, e);

  // Position in orbital plane
  const r = a * (1 - e * Math.cos(E));
  const nu = 2 * Math.atan2(
    Math.sqrt(Math.max(0, 1 + e)) * Math.sin(E * 0.5),
    Math.sqrt(Math.max(0, 1 - e)) * Math.cos(E * 0.5)
  );

  const xOrb = r * Math.cos(nu);
  const zOrb = r * Math.sin(nu);

  // Apply inclination i (rotate around line of nodes)
  const x = xOrb;
  const y = zOrb * Math.sin(inc);
  const z = zOrb * Math.cos(inc);

  target.set(x, y, z);
  return target;
}

/**
 * Computes orbital velocity vector v = dr/dt for velocity telemetry and physics queries.
 *
 * @param {Object} planetData Planet orbital parameters
 * @param {number} totalTime Total elapsed simulation time in seconds
 * @param {THREE.Vector3} [target] Optional target vector to store result into
 * @returns {THREE.Vector3} Orbital velocity vector in 3D space
 */
export function getPlanetVelocity(planetData, totalTime, target = new THREE.Vector3()) {
  const a = planetData.semiMajorAxis ?? planetData.distance ?? planetData.a ?? 30;
  const e = planetData.eccentricity ?? 0;
  const inc = planetData.inclination ?? 0;
  const M0 = planetData.meanAnomaly0 ?? planetData.startAngle ?? 0;

  let n = planetData.orbitalSpeed;
  if (n === undefined) {
    if (planetData.speed !== undefined) {
      n = planetData.speed;
    } else {
      const starMass = planetData.starMass ?? 2000;
      const G = planetData.G ?? 1;
      n = Math.sqrt((G * starMass) / Math.pow(a, 3));
    }
  }

  const M = M0 + n * totalTime;
  const E = solveKepler(M, e);

  // Rate of change of eccentric anomaly: dE/dt = n / (1 - e * cos(E))
  const denom = Math.max(1e-7, 1 - e * Math.cos(E));
  const Edot = n / denom;

  // Derivatives in the orbital plane
  const vxOrb = -a * Math.sin(E) * Edot;
  const vzOrb = a * Math.sqrt(Math.max(0, 1 - e * e)) * Math.cos(E) * Edot;

  // Apply inclination
  const vx = vxOrb;
  const vy = vzOrb * Math.sin(inc);
  const vz = vzOrb * Math.cos(inc);

  target.set(vx, vy, vz);
  return target;
}

/**
 * Computes the position of a moon relative to its parent planet: a circular orbit
 * tilted by the moon's inclination about the X axis.
 *
 * @param {Object} moonData Moon orbital parameters (distance, orbitalSpeed, startAngle, inclination)
 * @param {number} totalTime Total elapsed simulation time in seconds
 * @param {THREE.Vector3} [target] Optional target vector to store result into
 * @returns {THREE.Vector3} Relative position offset
 */
export function getMoonRelativePosition(moonData, totalTime, target = new THREE.Vector3()) {
  const dMoon = moonData.distance ?? 2.5;
  const omegaMoon = moonData.orbitalSpeed ?? moonData.speed ?? 0.01;
  const theta0 = moonData.startAngle ?? 0;
  const inc = moonData.inclination ?? 0;

  const theta = theta0 + omegaMoon * totalTime;
  const x = Math.cos(theta) * dMoon;
  const zFlat = Math.sin(theta) * dMoon;

  target.set(x, zFlat * Math.sin(inc), zFlat * Math.cos(inc));
  return target;
}

/**
 * Computes the world 3D position vector of a moon given the parent planet's position.
 */
export function getMoonPosition(moonData, planetPosition, totalTime, target = new THREE.Vector3()) {
  getMoonRelativePosition(moonData, totalTime, target);
  target.x += planetPosition.x;
  target.y += planetPosition.y;
  target.z += planetPosition.z;
  return target;
}

/**
 * Advances every body in the system to time `totalTime`.
 *
 * Planet entries (from buildSolarSystemMeshes) carry a non-rotating `group` that
 * follows the orbit, and a `mesh` that spins on its axis inside it. Moons are
 * children of the group, so they orbit the planet without inheriting its spin.
 *
 * @param {Object} systemMeshes Mesh structure from buildSolarSystemMeshes
 * @param {Object} systemData Procedural solar system configuration data
 * @param {number} deltaTime Frame time delta in seconds
 * @param {number} totalTime Total elapsed simulation time in seconds
 */
export function updateOrbits(systemMeshes, systemData, deltaTime, totalTime) {
  if (!systemMeshes) return;

  const dt = typeof deltaTime === 'number' ? deltaTime : 0.016;
  const t = typeof totalTime === 'number' ? totalTime : 0;

  if (systemMeshes.starMesh) {
    systemMeshes.starMesh.rotation.y += 0.004 * dt;
  }

  const entries = systemMeshes.planetEntries || [];
  const planetDataList = systemData?.planets || [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;

    const planetData = entry.data || planetDataList[i];
    const frame = entry.group || entry.mesh;
    if (!planetData || !frame) continue;

    getPlanetPosition(planetData, t, frame.position);

    const rotSpeed = planetData.rotationSpeed ?? 0.01;
    if (entry.mesh) entry.mesh.rotation.y += rotSpeed * dt;
    if (entry.cloudMesh) entry.cloudMesh.rotation.y += rotSpeed * 1.15 * dt;

    const moonEntries = entry.moons || [];
    for (let m = 0; m < moonEntries.length; m++) {
      const moonEntry = moonEntries[m];
      if (!moonEntry?.mesh) continue;
      const moonData = moonEntry.data || planetData.moons?.[m] || {};

      if (moonEntry.mesh.parent === frame) {
        getMoonRelativePosition(moonData, t, moonEntry.mesh.position);
      } else {
        getMoonPosition(moonData, frame.position, t, moonEntry.mesh.position);
      }
      moonEntry.mesh.rotation.y += (moonData.rotationSpeed ?? 0.01) * dt;
    }
  }
}

/**
 * Finds the nearest celestial body (Star, Planet, or Moon) to a given 3D position vector.
 * Computes Euclidean distance to the celestial body's surface:
 *   distance = Math.max(0, centerDistance - bodyRadius)
 *
 * @param {THREE.Vector3|Object} position 3D position vector (e.g., player's spaceship)
 * @param {Object} systemMeshes Mesh structure containing celestial bodies
 * @param {Object} [systemData] Procedural solar system configuration data
 * @returns {{ name: string, type: 'Star'|'Planet'|'Moon', distance: number, position: THREE.Vector3, radius: number }}
 */
export function getNearestCelestialBody(position, systemMeshes, systemData) {
  // Support flexible argument signatures
  let data = systemData;
  let meshes = systemMeshes;
  if (!data && meshes && (meshes.star || meshes.planets)) {
    if (!meshes.planetEntries && !meshes.isMesh) {
      data = meshes;
      meshes = null;
    }
  }

  const px = position ? (position.x || 0) : 0;
  const py = position ? (position.y || 0) : 0;
  const pz = position ? (position.z || 0) : 0;

  // 1. Star comparison
  const starData = data?.star || {};
  const starRadius = starData.radius ?? 12;
  const starName = starData.name || 'Central Star';
  const starPos = new THREE.Vector3(0, 0, 0);

  const starMesh = meshes?.starMesh || meshes?.star;
  if (starMesh && starMesh.position) {
    if (typeof starMesh.getWorldPosition === 'function') {
      starMesh.getWorldPosition(starPos);
    } else {
      starPos.copy(starMesh.position);
    }
  }

  const starCenterDist = Math.hypot(px - starPos.x, py - starPos.y, pz - starPos.z);
  const starSurfaceDist = Math.max(0, starCenterDist - starRadius);

  let nearest = {
    name: starName,
    type: 'Star',
    distance: starSurfaceDist,
    position: starPos.clone(),
    radius: starRadius
  };

  // 2. Planets and Moons comparison
  const entries = meshes?.planetEntries || meshes?.planets || meshes?.planetMeshes || (Array.isArray(meshes) ? meshes : []);
  const planetDataList = data?.planets || [];
  const count = Math.max(entries.length, planetDataList.length);

  const tempPos = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const entry = entries[i];
    const pData = planetDataList[i] || entry?.data || entry?.userData || {};
    const planetMesh = entry?.isMesh ? entry : (entry?.mesh || entry?.planetMesh);

    const pRadius = pData.radius ?? 1.5;
    const pName = pData.name || `Planet ${i + 1}`;

    // Get planet world position
    let planetPos;
    if (planetMesh && planetMesh.position) {
      planetMesh.updateWorldMatrix?.(true, false);
      planetPos = planetMesh.getWorldPosition ? planetMesh.getWorldPosition(tempPos).clone() : planetMesh.position.clone();
    } else {
      planetPos = getPlanetPosition(pData, 0);
    }

    const pCenterDist = Math.hypot(px - planetPos.x, py - planetPos.y, pz - planetPos.z);
    const pSurfaceDist = Math.max(0, pCenterDist - pRadius);

    if (pSurfaceDist < nearest.distance) {
      nearest = {
        name: pName,
        type: 'Planet',
        distance: pSurfaceDist,
        position: planetPos.clone(),
        radius: pRadius
      };
    }

    // Moons for this planet
    const moonsData = pData.moons || [];
    const moonEntries = entry?.moons || entry?.moonMeshes || (planetMesh?.userData?.moons) || [];
    const moonCount = Math.max(moonsData.length, moonEntries.length);

    for (let m = 0; m < moonCount; m++) {
      const mData = moonsData[m] || moonEntries[m]?.data || moonEntries[m]?.userData || {};
      const moonEntry = moonEntries[m];
      const moonMesh = moonEntry?.isMesh ? moonEntry : (moonEntry?.mesh || moonEntry?.moonMesh);

      const mRadius = mData.radius ?? 0.3;
      const mName = mData.name || `${pName} - Moon ${m + 1}`;

      let moonPos;
      if (moonMesh && moonMesh.position) {
        moonMesh.updateWorldMatrix?.(true, false);
        moonPos = moonMesh.getWorldPosition ? moonMesh.getWorldPosition(tempPos).clone() : moonMesh.position.clone();
      } else {
        moonPos = getMoonPosition(mData, planetPos, 0);
      }

      const mCenterDist = Math.hypot(px - moonPos.x, py - moonPos.y, pz - moonPos.z);
      const mSurfaceDist = Math.max(0, mCenterDist - mRadius);

      if (mSurfaceDist < nearest.distance) {
        nearest = {
          name: mName,
          type: 'Moon',
          distance: mSurfaceDist,
          position: moonPos.clone(),
          radius: mRadius
        };
      }
    }
  }

  return nearest;
}

/**
 * Generates an array of 3D points representing the full closed Keplerian orbit curve.
 * Useful for rendering orbit paths or collision trajectories.
 *
 * @param {Object} planetData Planet orbital parameters
 * @param {number} [segments=128] Number of point samples along the orbit
 * @returns {Array<THREE.Vector3>} Array of points along the orbital path
 */
export function generateOrbitPath(planetData, segments = 128) {
  const points = [];
  const a = planetData.semiMajorAxis ?? planetData.distance ?? 30;
  const e = planetData.eccentricity ?? 0;
  const inc = planetData.inclination ?? 0;

  for (let s = 0; s < segments; s++) {
    const E = (s / segments) * Math.PI * 2;
    const r = a * (1 - e * Math.cos(E));
    const nu = 2 * Math.atan2(
      Math.sqrt(Math.max(0, 1 + e)) * Math.sin(E * 0.5),
      Math.sqrt(Math.max(0, 1 - e)) * Math.cos(E * 0.5)
    );

    const xOrb = r * Math.cos(nu);
    const zOrb = r * Math.sin(nu);

    const x = xOrb;
    const y = zOrb * Math.sin(inc);
    const z = zOrb * Math.cos(inc);

    points.push(new THREE.Vector3(x, y, z));
  }
  return points;
}
