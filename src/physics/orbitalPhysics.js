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
 * Computes the relative 3D position vector of a moon with respect to its parent planet.
 *
 * @param {Object} moonData Moon orbital parameters (distance, orbitalSpeed, startAngle)
 * @param {number} totalTime Total elapsed simulation time in seconds
 * @param {THREE.Vector3} [target] Optional target vector to store result into
 * @returns {THREE.Vector3} Relative position offset (dx, dy, dz)
 */
export function getMoonRelativePosition(moonData, totalTime, target = new THREE.Vector3()) {
  const dMoon = moonData.distance ?? moonData.d_moon ?? moonData.dMoon ?? 2.5;
  const omegaMoon = moonData.orbitalSpeed ?? moonData.speed ?? moonData.omega_moon ?? moonData.omegaMoon ?? 0.05;
  const theta0 = moonData.startAngle ?? moonData.theta0 ?? moonData.theta_0 ?? moonData.startingAngle ?? 0;

  const theta = theta0 + omegaMoon * totalTime;
  const dx = Math.cos(theta) * dMoon;
  const dz = Math.sin(theta) * dMoon;
  const dy = Math.sin(theta * 1.5) * (dMoon * 0.15); // Slight realistic orbital tilt

  target.set(dx, dy, dz);
  return target;
}

/**
 * Computes the world 3D position vector of a moon given the parent planet's position.
 *
 * @param {Object} moonData Moon orbital parameters
 * @param {THREE.Vector3|Object} planetPosition World position of the parent planet
 * @param {number} totalTime Total elapsed simulation time in seconds
 * @param {THREE.Vector3} [target] Optional target vector to store result into
 * @returns {THREE.Vector3} Absolute world position vector
 */
export function getMoonPosition(moonData, planetPosition, totalTime, target = new THREE.Vector3()) {
  const rel = getMoonRelativePosition(moonData, totalTime);
  target.set(
    planetPosition.x + rel.x,
    planetPosition.y + rel.y,
    planetPosition.z + rel.z
  );
  return target;
}

/**
 * Updates all orbital motions, planet positions, axial rotations, and moons in the solar system.
 *
 * @param {Object|Array} systemMeshes Mesh structure containing planetEntries / planets / starMesh
 * @param {Object} systemData Procedural solar system configuration data
 * @param {number} deltaTime Frame time delta in seconds
 * @param {number} totalTime Total elapsed simulation time in seconds
 */
export function updateOrbits(systemMeshes, systemData, deltaTime, totalTime) {
  if (!systemMeshes) return;

  const dt = typeof deltaTime === 'number' ? deltaTime : 0.016;
  const t = typeof totalTime === 'number' ? totalTime : 0;

  // 1. Star gentle axial rotation if starMesh exists
  const starMesh = systemMeshes.starMesh || systemMeshes.star;
  if (starMesh && starMesh.rotation) {
    starMesh.rotation.y += 0.002 * dt;
  }

  // 2. Identify planet entries list
  const entries = systemMeshes.planetEntries || systemMeshes.planets || systemMeshes.planetMeshes || (Array.isArray(systemMeshes) ? systemMeshes : []);
  const planetDataList = systemData?.planets || [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;

    // Resolve planet mesh and planet data
    const planetMesh = entry.isMesh ? entry : (entry.mesh || entry.planetMesh || entry);
    if (!planetMesh || !planetMesh.position) continue;

    const planetData = entry.data || planetDataList[i] || planetMesh.userData || {};

    // Compute updated Keplerian position
    const pos = getPlanetPosition(planetData, t);
    planetMesh.position.copy(pos);

    // Compute and cache orbital velocity vector on mesh userData
    const vel = getPlanetVelocity(planetData, t);
    if (!planetMesh.userData) planetMesh.userData = {};
    planetMesh.userData.velocity = vel;
    planetMesh.userData.currentPosition = pos;

    // Update planet axial rotation
    const rotSpeed = planetData.axialRotationSpeed ?? planetData.rotationSpeed ?? planetData.rotation ?? 0.01;
    planetMesh.rotation.y += rotSpeed * dt;

    // Differential cloud rotation for oceanic/terrestrial worlds
    if (planetMesh.userData && planetMesh.userData.cloudMesh) {
      planetMesh.userData.cloudMesh.rotation.y += rotSpeed * 1.35 * dt;
    }

    // 3. Update Moons
    const moonsData = planetData.moons || [];
    const moonEntries = entry.moons || entry.moonMeshes || planetMesh.userData.moons || planetMesh.userData.moonMeshes || (systemMeshes.moons && systemMeshes.moons[i]);

    if (moonEntries && Array.isArray(moonEntries)) {
      for (let m = 0; m < moonEntries.length; m++) {
        const moonEntry = moonEntries[m];
        if (!moonEntry) continue;

        const moonMesh = moonEntry.isMesh ? moonEntry : (moonEntry.mesh || moonEntry.moonMesh || moonEntry);
        if (!moonMesh || !moonMesh.position) continue;

        const moonData = moonEntry.data || moonsData[m] || moonMesh.userData || {};

        const dMoon = moonData.distance ?? moonData.d_moon ?? moonData.dMoon ?? 2.5;
        const omegaMoon = moonData.orbitalSpeed ?? moonData.speed ?? moonData.omega_moon ?? moonData.omegaMoon ?? 0.05;
        const theta0 = moonData.startAngle ?? moonData.theta0 ?? moonData.theta_0 ?? moonData.startingAngle ?? 0;

        const theta = theta0 + omegaMoon * t;
        const dx = Math.cos(theta) * dMoon;
        const dz = Math.sin(theta) * dMoon;
        const dy = Math.sin(theta * 1.5) * (dMoon * 0.15);

        // Position moon correctly based on parent hierarchy
        if (moonMesh.parent === planetMesh) {
          moonMesh.position.set(dx, dy, dz);
        } else {
          moonMesh.position.set(pos.x + dx, pos.y + dy, pos.z + dz);
        }

        // Moon axial rotation
        const moonRotSpeed = moonData.rotationSpeed ?? moonData.rotation ?? (omegaMoon * 0.5);
        moonMesh.rotation.y += moonRotSpeed * dt;

        // Cache moon velocity telemetry
        if (!moonMesh.userData) moonMesh.userData = {};
        const vrelX = -Math.sin(theta) * dMoon * omegaMoon;
        const vrelZ = Math.cos(theta) * dMoon * omegaMoon;
        const vrelY = 1.5 * Math.cos(theta * 1.5) * (dMoon * 0.15) * omegaMoon;
        moonMesh.userData.velocity = new THREE.Vector3(vel.x + vrelX, vel.y + vrelY, vel.z + vrelZ);
      }
    } else if (planetMesh.children && planetMesh.children.length > 0) {
      // Fallback: check planetMesh.children for moons
      let mIndex = 0;
      for (let c = 0; c < planetMesh.children.length; c++) {
        const child = planetMesh.children[c];
        if (child.isMesh && (child.name?.startsWith('Moon') || moonsData[mIndex])) {
          const moonData = moonsData[mIndex] || child.userData || {};
          const dMoon = moonData.distance ?? 2.5;
          const omegaMoon = moonData.orbitalSpeed ?? moonData.speed ?? 0.05;
          const theta0 = moonData.startAngle ?? 0;

          const theta = theta0 + omegaMoon * t;
          const dx = Math.cos(theta) * dMoon;
          const dz = Math.sin(theta) * dMoon;
          const dy = Math.sin(theta * 1.5) * (dMoon * 0.15);

          child.position.set(dx, dy, dz);
          child.rotation.y += (moonData.rotationSpeed ?? 0.02) * dt;
          mIndex++;
        }
      }
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
