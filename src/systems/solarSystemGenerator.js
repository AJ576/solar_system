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

/**
 * World scale: 1 unit = 1 km. The ship is ~2.5 u long, so a rocky planet is
 * hundreds of times larger than the player and a star dwarfs everything.
 * Inter-planet distances are tens of thousands of units, crossed with the cruise drive.
 */

// Gravitational parameter that gives a ~20 minute orbit at 40,000 u (Kepler's 3rd law).
const REFERENCE_GM = Math.pow((Math.PI * 2) / 1200, 2) * Math.pow(40000, 3);

const STAR_TYPES = [
  {
    type: 'Yellow Dwarf',
    radiusRange: [7000, 9000],
    color: 0xffd27a,
    lightColor: 0xfff1dc,
    massFactorRange: [0.9, 1.1]
  },
  {
    type: 'Blue Giant',
    radiusRange: [11000, 14000],
    color: 0x9cc4ff,
    lightColor: 0xdce9ff,
    massFactorRange: [1.6, 2.2]
  },
  {
    type: 'Red Dwarf',
    radiusRange: [4500, 6000],
    color: 0xff7a4d,
    lightColor: 0xffc2a3,
    massFactorRange: [0.45, 0.65]
  },
  {
    type: 'Orange Subgiant',
    radiusRange: [8000, 10000],
    color: 0xffa95e,
    lightColor: 0xffdcb8,
    massFactorRange: [1.0, 1.3]
  },
  {
    type: 'White Star',
    radiusRange: [6500, 8000],
    color: 0xf4f6ff,
    lightColor: 0xffffff,
    massFactorRange: [1.1, 1.4]
  }
];

const PLANET_TYPE_CONFIGS = {
  'Rocky': {
    radiusRange: [500, 800],
    colors: [0x8c7853, 0x9e8b70, 0x7a6b58, 0x6e7f80, 0xa08264, 0x5a524c, 0x82705f],
    roughnessRange: [0.85, 0.95],
    atmosphere: null
  },
  'Desert': {
    radiusRange: [650, 950],
    colors: [0xd49b52, 0xcc7733, 0xe29d52, 0xc16a3c, 0xdf8437, 0xbb5a28, 0xdaa06d],
    roughnessRange: [0.8, 0.92],
    atmosphere: { color: 0xffb27a, strength: 0.55 }
  },
  'Ocean': {
    radiusRange: [850, 1250],
    colors: [0x1f4e79, 0x2471a3, 0x1b4f72, 0x2e86c1, 0x117864, 0x148f77, 0x2980b9],
    roughnessRange: [0.45, 0.6],
    atmosphere: { color: 0x6fb6ff, strength: 1.0 }
  },
  'Ice': {
    radiusRange: [750, 1050],
    colors: [0xcceeff, 0xa6d8f0, 0xd0f0fd, 0x88c4e0, 0xbfe3f7, 0xdaeef8],
    roughnessRange: [0.35, 0.5],
    atmosphere: { color: 0xbfe6ff, strength: 0.5 }
  },
  'Gas Giant': {
    radiusRange: [2600, 4200],
    colors: [0xd9822b, 0xbf5700, 0x9b59b6, 0x6c3483, 0xaf601a, 0xca6f1e, 0x884ea0],
    secondaryColors: [0x3c1b63, 0x873600, 0x1a5276, 0xf39c12, 0x512e5f],
    roughnessRange: [0.6, 0.75],
    atmosphere: { color: 0xffd9a8, strength: 0.7 }
  }
};

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const MOON_LETTERS = ['a', 'b', 'c', 'd'];

/**
 * Deterministically generates solar system data based on a given seed.
 *
 * @param {string|number} seed
 * @returns {Object} Procedurally generated solar system data
 */
export function generateSolarSystemData(seed) {
  const prng = createPRNG(seed);
  const systemName = generateSystemName(seed);

  // 1. Star
  const starTemplate = prng.choice(STAR_TYPES);
  const starRadius = prng.range(starTemplate.radiusRange[0], starTemplate.radiusRange[1]);
  const massFactor = prng.range(starTemplate.massFactorRange[0], starTemplate.massFactorRange[1]);

  const star = {
    name: systemName,
    type: starTemplate.type,
    radius: starRadius,
    color: starTemplate.color,
    lightColor: starTemplate.lightColor,
    mass: REFERENCE_GM * massFactor
  };

  // 2. Planets (3 to 8)
  const planetCount = prng.rangeInt(3, 8);
  const planets = [];

  let currentDistance = star.radius * 3.5 + 8000;
  let prevAphelion = currentDistance;

  for (let i = 0; i < planetCount; i++) {
    const eccentricity = prng.range(0.01, 0.1);

    // Non-overlapping orbits: perihelion clears the previous aphelion by a generous gap
    const buffer = 14000 + i * 3000;
    const minSemiMajorAxis = (prevAphelion + buffer) / (1 - eccentricity);
    const candidateDistance = i === 0 ? currentDistance : currentDistance + prng.range(18000, 36000);
    const semiMajorAxis = Math.max(candidateDistance, minSemiMajorAxis);

    currentDistance = semiMajorAxis;
    prevAphelion = semiMajorAxis * (1 + eccentricity);

    const inclination = prng.range(-0.04, 0.04);
    const meanAnomaly0 = prng.range(0, Math.PI * 2);
    const orbitalSpeed = Math.sqrt(star.mass / Math.pow(semiMajorAxis, 3));

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
    // Axial spin: one rotation every 4–12 minutes
    const rotationSpeed = (Math.PI * 2) / prng.range(240, 720) * (prng.chance(0.85) ? 1 : -1);
    const axialTilt = prng.range(-0.4, 0.4);

    let hasRings = false;
    let ringProps = null;
    if (planetType === 'Gas Giant' ? prng.chance(0.55) : prng.chance(0.12)) {
      hasRings = true;
      ringProps = {
        innerRadius: radius * 1.4,
        outerRadius: radius * 2.4,
        color: prng.choice([0xdfd3b8, 0xc2a67e, 0x9b8565, 0xb8c5d6, 0x8b6508]),
        opacity: 0.88
      };
    }

    // Moons orbit well clear of the planet (and of its rings)
    const moonCount = planetType === 'Gas Giant' ? prng.rangeInt(1, 3) : (prng.chance(0.65) ? prng.rangeInt(1, 2) : 0);
    const moons = [];
    const roman = ROMAN_NUMERALS[i] || String(i + 1);
    const planetName = `${systemName} ${roman}`;

    let currentMoonDist = radius * (hasRings ? 3.0 : 2.4);
    for (let m = 0; m < moonCount; m++) {
      const moonRadiusScale = planetType === 'Gas Giant' ? prng.range(0.06, 0.12) : prng.range(0.18, 0.28);
      const moonRadius = radius * moonRadiusScale;
      const moonDistance = currentMoonDist + prng.range(radius * 0.8, radius * 1.6);
      currentMoonDist = moonDistance;

      moons.push({
        id: `${systemName}_P${i + 1}_M${m + 1}`,
        name: `${planetName}${MOON_LETTERS[m] || m + 1}`,
        radius: moonRadius,
        distance: moonDistance,
        // One revolution every 6–14 minutes
        orbitalSpeed: (Math.PI * 2) / prng.range(360, 840),
        inclination: prng.range(-0.15, 0.15),
        color: prng.choice([0x888888, 0xaaaaaa, 0xbbbbbb, 0x998877, 0x778899]),
        startAngle: prng.range(0, Math.PI * 2),
        rotationSpeed: (Math.PI * 2) / prng.range(300, 900)
      });
    }

    planets.push({
      id: `${systemName}_P${i + 1}`,
      name: planetName,
      type: planetType,
      radius,
      color,
      secondaryColor,
      roughness,
      metalness: 0.0,
      semiMajorAxis,
      eccentricity,
      inclination,
      meanAnomaly0,
      orbitalSpeed,
      rotationSpeed,
      axialTilt,
      hasRings,
      ringProps,
      ringTilt: prng.range(-0.25, 0.25),
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
 * Fresnel rim atmosphere, brightest on the day side. Includes the log-depth chunks
 * because the renderer uses a logarithmic depth buffer.
 */
function createAtmosphereMaterial(color, strength) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength },
      uSunPosition: { value: new THREE.Vector3(0, 0, 0) }
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform float uStrength;
      uniform vec3 uSunPosition;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 n = normalize(vWorldNormal);
        // Back-face shell: rim where the normal is perpendicular to the view
        float rim = 1.0 - abs(dot(viewDir, n));
        float glow = pow(rim, 3.0);
        float day = smoothstep(-0.35, 0.45, dot(-n, normalize(uSunPosition - vWorldPos)));
        gl_FragColor = vec4(uColor * glow * day * uStrength, 1.0);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  });
}

function createGlowTexture() {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds Three.js meshes for the given solar system data.
 *
 * Each planet entry has:
 *   group – positioned on the orbit every frame (moons, rings and clouds hang off it)
 *   mesh  – the planet sphere, which spins on its axis inside the group
 *
 * @param {Object} systemData Solar system data from generateSolarSystemData
 * @param {THREE.Scene} scene The Three.js scene to attach objects to
 * @returns {Object} Meshes, light, entries, and container group
 */
export function buildSolarSystemMeshes(systemData, scene) {
  const systemGroup = new THREE.Group();
  systemGroup.name = `SolarSystem_${systemData.name}`;

  // -------------------------------------------------------------
  // 1. Star
  // -------------------------------------------------------------
  const starRadius = systemData.star.radius;
  const starGeo = new THREE.SphereGeometry(starRadius, 96, 64);
  const starTex = createStarPhotosphereTexture(systemData.star.color, hashSeed(systemData.seed));
  const starMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(systemData.star.color).multiplyScalar(1.6),
    map: starTex || null,
    toneMapped: false
  });
  const starMesh = new THREE.Mesh(starGeo, starMat);
  starMesh.name = `Star_${systemData.star.name}`;
  systemGroup.add(starMesh);

  const glowTex = createGlowTexture();
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: systemData.star.color,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(starRadius * 7);
  starMesh.add(glow);

  const starLight = new THREE.PointLight(systemData.star.lightColor, 5.5, 0, 0);
  starLight.name = `StarLight_${systemData.name}`;
  systemGroup.add(starLight);

  // -------------------------------------------------------------
  // 2. Planets, Moons, and Orbit Lines
  // -------------------------------------------------------------
  const planetEntries = [];

  systemData.planets.forEach((planetData) => {
    const a = planetData.semiMajorAxis;
    const e = planetData.eccentricity;
    const inc = planetData.inclination;
    const p = a * (1 - e * e);

    // Orbit line uses the same plane convention as getPlanetPosition()
    const segments = 360;
    const orbitPoints = [];
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const r = p / (1 + e * Math.cos(theta));
      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);
      orbitPoints.push(new THREE.Vector3(x, z * Math.sin(inc), z * Math.cos(inc)));
    }
    const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPoints);
    const orbitMat = new THREE.LineBasicMaterial({
      color: 0x8a95a8,
      transparent: true,
      opacity: 0.16,
      depthWrite: false
    });
    const orbitLine = new THREE.LineLoop(orbitGeo, orbitMat);
    orbitLine.name = `Orbit_${planetData.name}`;
    systemGroup.add(orbitLine);

    // Orbit frame (non-rotating) – everything that should not spin with the surface
    const planetGroup = new THREE.Group();
    planetGroup.name = `PlanetFrame_${planetData.name}`;

    // Tilted axis frame holding the spinning surface, clouds and rings
    const axisGroup = new THREE.Group();
    axisGroup.rotation.z = planetData.axialTilt || 0;
    planetGroup.add(axisGroup);

    const isGiant = planetData.type === 'Gas Giant';
    const planetGeo = new THREE.SphereGeometry(planetData.radius, isGiant ? 128 : 96, isGiant ? 96 : 64);

    let surfaceTex = null;
    if (isGiant) {
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
    axisGroup.add(planetMesh);

    let cloudMesh = null;
    if (planetData.type === 'Ocean') {
      const cloudGeo = new THREE.SphereGeometry(planetData.radius * 1.012, 96, 64);
      const cloudTex = createCloudTexture(planetData.seedNum + 55);
      const cloudMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: cloudTex || null,
        transparent: true,
        opacity: 0.85,
        roughness: 1.0,
        depthWrite: false
      });
      cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
      axisGroup.add(cloudMesh);
    }

    const atmoConfig = PLANET_TYPE_CONFIGS[planetData.type]?.atmosphere;
    if (atmoConfig) {
      const atmoGeo = new THREE.SphereGeometry(planetData.radius * (isGiant ? 1.04 : 1.06), 64, 48);
      const atmoMesh = new THREE.Mesh(atmoGeo, createAtmosphereMaterial(atmoConfig.color, atmoConfig.strength));
      atmoMesh.name = `Atmosphere_${planetData.name}`;
      planetGroup.add(atmoMesh);
    }

    if (planetData.hasRings && planetData.ringProps) {
      const { innerRadius, outerRadius, color } = planetData.ringProps;
      const ringGeo = new THREE.RingGeometry(innerRadius, outerRadius, 256, 1);
      // Remap UVs radially so the ring texture's x axis runs from inner to outer edge
      const pos = ringGeo.attributes.position;
      const uv = ringGeo.attributes.uv;
      const v = new THREE.Vector3();
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k);
        const t = (v.length() - innerRadius) / (outerRadius - innerRadius);
        uv.setXY(k, t, 0.5);
      }
      const ringTex = createRingTexture(color, planetData.seedNum);
      const ringMat = new THREE.MeshStandardMaterial({
        color: ringTex ? 0xffffff : color,
        map: ringTex || null,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        roughness: 0.9,
        metalness: 0.0,
        depthWrite: false
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.name = `Ring_${planetData.name}`;
      ringMesh.rotation.x = Math.PI / 2 + (planetData.ringTilt || 0);
      axisGroup.add(ringMesh);
    }

    planetMesh.userData = { ...planetData, cloudMesh };

    // Moons orbit the non-rotating planet frame
    const moonEntries = [];
    (planetData.moons || []).forEach((moonData) => {
      const moonGeo = new THREE.SphereGeometry(moonData.radius, 64, 48);
      const moonTex = createCrateredTexture(moonData.color, hashSeed(moonData.id));
      const moonMat = new THREE.MeshStandardMaterial({
        color: moonTex ? 0xffffff : moonData.color,
        map: moonTex || null,
        roughness: 0.92,
        metalness: 0.0
      });
      const moonMesh = new THREE.Mesh(moonGeo, moonMat);
      moonMesh.name = `Moon_${moonData.name}`;
      moonMesh.userData = { ...moonData };
      planetGroup.add(moonMesh);
      moonEntries.push({ data: moonData, mesh: moonMesh });
    });

    systemGroup.add(planetGroup);

    planetEntries.push({
      data: planetData,
      group: planetGroup,
      mesh: planetMesh,
      cloudMesh,
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
 */
export function disposeSolarSystem(systemObject, scene) {
  if (!systemObject) return;

  const { group, starLight } = systemObject;

  if (group) {
    group.traverse((child) => {
      if (child.isMesh || child.isLine || child.isPoints || child.isSprite) {
        if (child.geometry && !child.isSprite) {
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
    if (starLight.parent) {
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
