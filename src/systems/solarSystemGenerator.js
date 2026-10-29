import * as THREE from 'three';
import { createPRNG, generateSystemName } from '../utils/random.js';
import {
  createGasGiantTexture,
  createTerrestrialTexture,
  createCrateredTexture,
  createCloudTexture,
  createRingTexture,
  createStarPhotosphereTexture
} from '../visuals/proceduralTextures.js';

// Star Configuration presets (5-Tier Canonical Scale Hierarchy)
const STAR_TYPES = [
  {
    type: 'Yellow Dwarf',
    radiusRange: [380.0, 480.0],
    color: 0xffcc33,
    lightColor: 0xfff3d6,
    emissiveIntensityRange: [2.5, 3.8],
    massRange: [22000000, 32000000]
  },
  {
    type: 'Blue Giant',
    radiusRange: [550.0, 720.0],
    color: 0x66aaff,
    lightColor: 0x99ccff,
    emissiveIntensityRange: [3.5, 5.0],
    massRange: [45000000, 60000000]
  },
  {
    type: 'Red Dwarf',
    radiusRange: [260.0, 340.0],
    color: 0xff4422,
    lightColor: 0xff6644,
    emissiveIntensityRange: [2.0, 3.2],
    massRange: [12000000, 18000000]
  },
  {
    type: 'Orange Subgiant',
    radiusRange: [440.0, 560.0],
    color: 0xff8833,
    lightColor: 0xffaa55,
    emissiveIntensityRange: [2.5, 4.0],
    massRange: [26000000, 38000000]
  },
  {
    type: 'White Star',
    radiusRange: [340.0, 420.0],
    color: 0xffffff,
    lightColor: 0xffffff,
    emissiveIntensityRange: [3.0, 4.5],
    massRange: [28000000, 38000000]
  }
];

// Planet Type archetypes (Visually Distinct & Scaled)
const PLANET_TYPE_CONFIGS = {
  'Rocky': {
    radiusRange: [28.0, 38.0],
    colors: [0x8c7853, 0x9e8b70, 0x7a6b58, 0x6e7f80, 0xa08264, 0x5a524c, 0x82705f],
    roughnessRange: [0.8, 0.95],
    metalnessRange: [0.08, 0.25]
  },
  'Desert': {
    radiusRange: [34.0, 46.0],
    colors: [0xd49b52, 0xcc7733, 0xe29d52, 0xc16a3c, 0xdf8437, 0xbb5a28, 0xdaa06d],
    roughnessRange: [0.75, 0.92],
    metalnessRange: [0.05, 0.18]
  },
  'Ocean': {
    radiusRange: [45.0, 60.0],
    colors: [0x1f4e79, 0x2471a3, 0x1b4f72, 0x2e86c1, 0x117864, 0x148f77, 0x2980b9],
    roughnessRange: [0.35, 0.55],
    metalnessRange: [0.1, 0.28]
  },
  'Ice': {
    radiusRange: [36.0, 48.0],
    colors: [0xcceeff, 0xa6d8f0, 0xd0f0fd, 0x88c4e0, 0xbfe3f7, 0xdaeef8],
    roughnessRange: [0.25, 0.42],
    metalnessRange: [0.15, 0.32]
  },
  'Gas Giant': {
    radiusRange: [130.0, 210.0],
    colors: [0xd9822b, 0xbf5700, 0x9b59b6, 0x6c3483, 0xaf601a, 0xca6f1e, 0x884ea0],
    secondaryColors: [0x3c1b63, 0x873600, 0x1a5276, 0xf39c12, 0x512e5f],
    roughnessRange: [0.45, 0.65],
    metalnessRange: [0.05, 0.18]
  }
};

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/**
 * Deterministically generates solar system data based on a given seed.
 * 
 * @param {string|number} seed
 * @returns {Object} Procedurally generated solar system data
 */
export function generateSolarSystemData(seed) {
  const prng = createPRNG(seed);
  const systemName = generateSystemName(seed);

  // 1. Star Generation
  const starTemplate = prng.choice(STAR_TYPES);
  const starRadius = prng.range(starTemplate.radiusRange[0], starTemplate.radiusRange[1]);
  const starColor = starTemplate.color;
  const starLightColor = starTemplate.lightColor;
  const starEmissiveIntensity = prng.range(
    starTemplate.emissiveIntensityRange[0],
    starTemplate.emissiveIntensityRange[1]
  );
  const starMass = prng.range(starTemplate.massRange[0], starTemplate.massRange[1]);

  const star = {
    name: systemName,
    type: starTemplate.type,
    radius: starRadius,
    color: starColor,
    lightColor: starLightColor,
    emissiveIntensity: starEmissiveIntensity,
    mass: starMass
  };

  // 2. Planets Generation (3 to 8 planets)
  const planetCount = prng.rangeInt(3, 8);
  const planets = [];

  // Orbital distance semiMajorAxis start (scaled outside stellar corona)
  let currentDistance = star.radius * 2.2 + 250;
  let prevAphelion = currentDistance;

  for (let i = 0; i < planetCount; i++) {
    const eccentricity = prng.range(0.01, 0.18);

    // Guaranteed non-overlapping orbits:
    // perihelion = a * (1 - e) > prevAphelion + buffer
    const buffer = 100.0 + i * 35.0;
    const minSemiMajorAxis = (prevAphelion + buffer) / (1 - eccentricity);
    const candidateDistance = i === 0 ? currentDistance : currentDistance + prng.range(400, 850);
    const semiMajorAxis = Math.max(candidateDistance, minSemiMajorAxis);

    currentDistance = semiMajorAxis;
    prevAphelion = semiMajorAxis * (1 + eccentricity);

    // Orbital inclination: subtle realistic tilt
    const inclination = prng.range(-0.06, 0.06);

    // Starting phase (mean anomaly)
    const meanAnomaly0 = prng.range(0, Math.PI * 2);

    // Scaled mean motion strictly preserving Kepler's 3rd Law
    const orbitalSpeed = Math.sqrt(star.mass / Math.pow(semiMajorAxis, 3)) * 0.6;

    // Archetype selection by distance zone
    const isInner = i <= 1;
    const isOuter = i >= Math.floor(planetCount * 0.6);
    let planetType;

    if (isInner) {
      planetType = prng.choice(['Rocky', 'Desert']);
    } else if (isOuter) {
      planetType = prng.choice(['Gas Giant', 'Ice']);
    } else {
      planetType = prng.choice(['Ocean', 'Desert', 'Rocky']);
    }

    const typeConfig = PLANET_TYPE_CONFIGS[planetType];
    const radius = prng.range(typeConfig.radiusRange[0], typeConfig.radiusRange[1]);
    const color = prng.choice(typeConfig.colors);
    const secondaryColor = typeConfig.secondaryColors ? prng.choice(typeConfig.secondaryColors) : color;
    const roughness = prng.range(typeConfig.roughnessRange[0], typeConfig.roughnessRange[1]);
    const metalness = prng.range(typeConfig.metalnessRange[0], typeConfig.metalnessRange[1]);
    const rotationSpeed = prng.range(0.005, 0.02) * (prng.chance(0.85) ? 1 : -1);

    // Planetary Rings: 50% chance on Gas Giants, 15% on Ice/Desert worlds
    let hasRings = false;
    let ringProps = null;
    let ringTilt = 0;

    if (planetType === 'Gas Giant' ? prng.chance(0.55) : prng.chance(0.12)) {
      hasRings = true;
      ringProps = {
        innerRadius: radius * 1.4,
        outerRadius: radius * 2.4,
        color: prng.choice([0xdfd3b8, 0xc2a67e, 0x9b8565, 0xb8c5d6, 0x8b6508]),
        opacity: 0.88
      };
      ringTilt = prng.range(-0.25, 0.25);
    }

    // Moons generation (scaled proportionally)
    const moonCount = planetType === 'Gas Giant' ? prng.rangeInt(1, 3) : (prng.chance(0.65) ? prng.rangeInt(1, 2) : 0);
    const moons = [];

    let currentMoonDist = radius * 2.2;
    for (let m = 0; m < moonCount; m++) {
      const moonRadiusScale = planetType === 'Gas Giant' ? prng.range(0.09, 0.16) : prng.range(0.20, 0.32);
      const moonRadius = radius * moonRadiusScale;
      const moonDistance = currentMoonDist + prng.range(radius * 0.5, radius * 1.2);
      currentMoonDist = moonDistance;

      const moonSpeed = prng.range(0.02, 0.06);
      const moonStartAngle = prng.range(0, Math.PI * 2);
      const moonColor = prng.choice([0x888888, 0xaaaaaa, 0xbbbbbb, 0x998877, 0x778899]);

      moons.push({
        id: `${systemName}_P${i+1}_M${m+1}`,
        name: `${systemName} ${ROMAN_NUMERALS[i] || (i + 1)} - Moon ${m + 1}`,
        radius: moonRadius,
        distance: moonDistance,
        orbitalSpeed: moonSpeed,
        color: moonColor,
        startAngle: moonStartAngle,
        rotationSpeed: prng.range(0.01, 0.04)
      });
    }

    const roman = ROMAN_NUMERALS[i] || (i + 1);
    const planetName = `${systemName} ${roman}`;

    planets.push({
      id: `${systemName}_P${i+1}`,
      name: planetName,
      type: planetType,
      radius,
      color,
      secondaryColor,
      roughness,
      metalness,
      semiMajorAxis,
      eccentricity,
      inclination,
      meanAnomaly0,
      orbitalSpeed,
      rotationSpeed,
      hasRings,
      ringProps,
      ringTilt,
      moons,
      seedNum: (hashSeed(seed) + i * 37) >>> 0
    });
  }

  return {
    seed,
    name: systemName,
    star,
    planets
  };
}

function hashSeed(seed) {
  let str = String(seed);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/**
 * Builds Three.js meshes and visualization objects for the given solar system data.
 * 
 * @param {Object} systemData Solar system data from generateSolarSystemData
 * @param {THREE.Scene} scene The Three.js scene to attach objects to
 * @returns {Object} Meshes, light, entries, and container group
 */
export function buildSolarSystemMeshes(systemData, scene) {
  const systemGroup = new THREE.Group();
  systemGroup.name = `SolarSystem_${systemData.name}`;

  // -------------------------------------------------------------
  // 1. Star Mesh (Procedural Photosphere + Multi-Tier Corona)
  // -------------------------------------------------------------
  const starGeo = new THREE.SphereGeometry(systemData.star.radius, 48, 48);
  const starTex = createStarPhotosphereTexture(systemData.star.color, hashSeed(systemData.seed));

  const starMat = new THREE.MeshBasicMaterial({
    color: systemData.star.color,
    map: starTex || null
  });
  const starMesh = new THREE.Mesh(starGeo, starMat);
  starMesh.name = `Star_${systemData.star.name}`;
  systemGroup.add(starMesh);

  // Inner radiant corona
  const innerCoronaGeo = new THREE.SphereGeometry(systemData.star.radius * 1.10, 32, 32);
  const innerCoronaMat = new THREE.MeshBasicMaterial({
    color: systemData.star.color,
    transparent: true,
    opacity: 0.45,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const innerCorona = new THREE.Mesh(innerCoronaGeo, innerCoronaMat);
  starMesh.add(innerCorona);

  // Outer radiant prominence corona
  const outerCoronaGeo = new THREE.SphereGeometry(systemData.star.radius * 1.35, 32, 32);
  const outerCoronaMat = new THREE.MeshBasicMaterial({
    color: systemData.star.lightColor,
    transparent: true,
    opacity: 0.22,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const outerCorona = new THREE.Mesh(outerCoronaGeo, outerCoronaMat);
  starMesh.add(outerCorona);

  // Star PointLight (Scaled for canonical system distances)
  const starLight = new THREE.PointLight(
    systemData.star.lightColor,
    85000,
    32000,
    1.2
  );
  starLight.position.set(0, 0, 0);
  systemGroup.add(starLight);

  // -------------------------------------------------------------
  // 2. Planets, Moons, and Orbit Visualization
  // -------------------------------------------------------------
  const planetEntries = [];

  systemData.planets.forEach((planetData) => {
    // --- Elliptical Orbit Visualization Line ---
    const segments = 128;
    const orbitPoints = [];
    const a = planetData.semiMajorAxis;
    const e = planetData.eccentricity;
    const inc = planetData.inclination;
    const p = a * (1 - e * e);

    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const r = p / (1 + e * Math.cos(theta));
      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);

      // Rotate by inclination around X axis
      const rotX = x;
      const rotY = -z * Math.sin(inc);
      const rotZ = z * Math.cos(inc);
      orbitPoints.push(new THREE.Vector3(rotX, rotY, rotZ));
    }

    const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPoints);
    const orbitMat = new THREE.LineBasicMaterial({
      color: 0x3d5a80,
      transparent: true,
      opacity: 0.38
    });
    const orbitLine = new THREE.LineLoop(orbitGeo, orbitMat);
    orbitLine.name = `Orbit_${planetData.name}`;
    systemGroup.add(orbitLine);

    // --- Planet Mesh & Procedural Material ---
    const planetGeo = new THREE.SphereGeometry(planetData.radius, 40, 40);

    // Generate procedural surface texture based on archetype
    let surfaceTex = null;
    if (planetData.type === 'Gas Giant') {
      surfaceTex = createGasGiantTexture(planetData.color, planetData.secondaryColor, planetData.seedNum);
    } else if (planetData.type === 'Ocean' || planetData.type === 'Desert') {
      surfaceTex = createTerrestrialTexture(planetData.type, planetData.color, planetData.seedNum);
    } else {
      surfaceTex = createCrateredTexture(planetData.color, planetData.seedNum);
    }

    const planetMat = new THREE.MeshStandardMaterial({
      color: surfaceTex ? 0xffffff : planetData.color,
      map: surfaceTex || null,
      roughness: planetData.roughness,
      metalness: planetData.metalness
    });

    const planetMesh = new THREE.Mesh(planetGeo, planetMat);
    planetMesh.name = `Planet_${planetData.name}`;
    planetMesh.castShadow = true;
    planetMesh.receiveShadow = true;

    // Atmospheric Fresnel Rim Glow (for Ocean / Gas Giant worlds)
    if (planetData.type === 'Ocean' || planetData.type === 'Gas Giant') {
      const atmoGeo = new THREE.SphereGeometry(planetData.radius * 1.032, 32, 32);
      const atmoMat = new THREE.MeshBasicMaterial({
        color: planetData.type === 'Ocean' ? 0x48cae4 : 0xffd166,
        transparent: true,
        opacity: 0.16,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
      planetMesh.add(atmoMesh);
    }

    // Secondary Rotating Cloud Layer (for Ocean / Terrestrial worlds)
    let cloudMesh = null;
    if (planetData.type === 'Ocean') {
      const cloudGeo = new THREE.SphereGeometry(planetData.radius * 1.018, 36, 36);
      const cloudTex = createCloudTexture(planetData.seedNum + 55);
      const cloudMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: cloudTex || null,
        transparent: true,
        opacity: 0.72,
        blending: THREE.NormalBlending,
        roughness: 0.9,
        depthWrite: false
      });
      cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
      planetMesh.add(cloudMesh);
    }

    // Initial position calculated from starting phase (meanAnomaly0)
    const theta0 = planetData.meanAnomaly0;
    const r0 = p / (1 + e * Math.cos(theta0));
    const initX = r0 * Math.cos(theta0);
    const initZ = r0 * Math.sin(theta0);
    planetMesh.position.set(
      initX,
      -initZ * Math.sin(inc),
      initZ * Math.cos(inc)
    );

    planetMesh.userData = {
      ...planetData,
      cloudMesh,
      moons: []
    };

    // --- Planetary Rings ---
    if (planetData.hasRings && planetData.ringProps) {
      const { innerRadius, outerRadius, color } = planetData.ringProps;
      const ringGeo = new THREE.RingGeometry(innerRadius, outerRadius, 64);
      const ringTex = createRingTexture(color, planetData.seedNum);

      const ringMat = new THREE.MeshStandardMaterial({
        color: ringTex ? 0xffffff : color,
        map: ringTex || null,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.88,
        roughness: 0.6,
        metalness: 0.1
      });

      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.name = `Ring_${planetData.name}`;
      ringMesh.rotation.x = Math.PI / 2 + (planetData.ringTilt || 0.15);
      planetMesh.add(ringMesh);
    }

    // --- Moons ---
    const moonEntries = [];
    if (planetData.moons && planetData.moons.length > 0) {
      planetData.moons.forEach((moonData) => {
        const moonGeo = new THREE.SphereGeometry(moonData.radius, 24, 24);
        const moonTex = createCrateredTexture(moonData.color, hashSeed(moonData.id));

        const moonMat = new THREE.MeshStandardMaterial({
          color: moonTex ? 0xffffff : moonData.color,
          map: moonTex || null,
          roughness: 0.85,
          metalness: 0.1
        });
        const moonMesh = new THREE.Mesh(moonGeo, moonMat);
        moonMesh.name = `Moon_${moonData.name}`;
        moonMesh.castShadow = true;
        moonMesh.receiveShadow = true;

        const mAngle = moonData.startAngle;
        moonMesh.position.set(
          Math.cos(mAngle) * moonData.distance,
          0,
          Math.sin(mAngle) * moonData.distance
        );

        moonMesh.userData = {
          ...moonData,
          currentAngle: mAngle
        };

        planetMesh.add(moonMesh);

        moonEntries.push({
          data: moonData,
          mesh: moonMesh
        });
      });
    }

    systemGroup.add(planetMesh);

    planetEntries.push({
      data: planetData,
      mesh: planetMesh,
      orbitLine,
      moons: moonEntries
    });
  });

  if (scene) {
    scene.add(systemGroup);
  }

  return {
    group: systemGroup,
    starMesh,
    starLight,
    planetEntries
  };
}

/**
 * Disposes all geometries, materials, textures, and lights associated with a solar system.
 * Prevents WebGL memory leaks.
 */
export function disposeSolarSystem(systemObject, scene) {
  if (!systemObject) return;

  const { group, starLight } = systemObject;

  if (group) {
    group.traverse((child) => {
      if (child.isMesh || child.isLine || child.isPoints) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => disposeMaterial(mat));
          } else {
            disposeMaterial(child.material);
          }
        }
      }
    });

    if (scene) {
      scene.remove(group);
    } else if (group.parent) {
      group.parent.remove(group);
    }
  }

  if (starLight) {
    if (scene) {
      scene.remove(starLight);
    } else if (starLight.parent) {
      starLight.parent.remove(starLight);
    }
    if (starLight.dispose) {
      starLight.dispose();
    }
  }
}

function disposeMaterial(mat) {
  if (!mat) return;
  for (const key of Object.keys(mat)) {
    const val = mat[key];
    if (val && typeof val === 'object' && val.isTexture) {
      val.dispose();
    }
  }
  mat.dispose();
}
