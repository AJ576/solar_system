import * as THREE from 'three';
import { createDiffractionStarTexture } from './proceduralTextures.js';

/**
 * Creates a circular soft-glow texture for star points.
 */
function createStarTexture() {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.85)');
  gradient.addColorStop(0.5, 'rgba(220, 235, 255, 0.35)');
  gradient.addColorStop(1.0, 'rgba(200, 220, 255, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates an organic radial puff texture for subtle cosmic nebulae.
 */
function createNebulaTexture() {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
  gradient.addColorStop(0.35, 'rgba(210, 225, 255, 0.15)');
  gradient.addColorStop(0.7, 'rgba(180, 200, 250, 0.04)');
  gradient.addColorStop(1.0, 'rgba(140, 160, 220, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates the deep space environment:
 * 1. 3-tier deep space starfield (12k background galactic disk, 3.5k mid-field, 400 foreground diffraction anchors)
 * 2. Distant subtle cosmic dust lanes (restrained deep navy/indigo/charcoal tones)
 * 3. High-contrast cinematic ambient light
 *
 * @param {THREE.Scene} scene - Three.js scene to add visual objects to
 * @returns {Object} Environment controller with references and a dispose() method
 */
export function createEnvironment(scene) {
  const envGroup = new THREE.Group();
  envGroup.name = 'DeepSpaceEnvironment';

  // -------------------------------------------------------------
  // 1. Layer 1: Deep Distant Galactic Disk Field (12,000 Stars)
  // -------------------------------------------------------------
  const bgCount = 12000;
  const bgPositions = new Float32Array(bgCount * 3);
  const bgColors = new Float32Array(bgCount * 3);

  // Natural astronomical spectral colors
  const spectralPalette = [
    new THREE.Color(0xd8e5ff), // O/B Blue-White (25%)
    new THREE.Color(0xfbfcfe), // A/F Pure White (40%)
    new THREE.Color(0xfff2d4), // G Solar Yellow-White (20%)
    new THREE.Color(0xffd0a2), // K Orange Giant (10%)
    new THREE.Color(0xffab94), // M Red Dwarf (5%)
  ];

  for (let i = 0; i < bgCount; i++) {
    // Galactic disk bias: 65% of stars concentrated along an inclined galactic plane
    let theta = Math.random() * Math.PI * 2;
    let phi;

    if (Math.random() < 0.65) {
      // Gaussian distribution around equator (galactic plane)
      const u1 = Math.random();
      const u2 = Math.random();
      const randStd = Math.sqrt(-2.0 * Math.log(u1 || 0.0001)) * Math.cos(2.0 * Math.PI * u2);
      const lat = randStd * 0.28; // tight galactic disk
      phi = Math.PI / 2.0 + lat;
    } else {
      // Isotropic background
      const u = Math.random() * 2 - 1;
      phi = Math.acos(u);
    }

    // Radius scaled for canonical 20,000u solar system
    const radius = 52000 + Math.random() * 16000;

    const sinPhi = Math.sin(phi);
    const x = radius * sinPhi * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * sinPhi * Math.sin(theta);

    bgPositions[i * 3] = x;
    bgPositions[i * 3 + 1] = y;
    bgPositions[i * 3 + 2] = z;

    // Pick spectral class
    const roll = Math.random();
    let col;
    if (roll < 0.25) col = spectralPalette[0];
    else if (roll < 0.65) col = spectralPalette[1];
    else if (roll < 0.85) col = spectralPalette[2];
    else if (roll < 0.95) col = spectralPalette[3];
    else col = spectralPalette[4];

    const brightness = 0.55 + Math.random() * 0.45;
    bgColors[i * 3] = col.r * brightness;
    bgColors[i * 3 + 1] = col.g * brightness;
    bgColors[i * 3 + 2] = col.b * brightness;
  }

  const bgGeometry = new THREE.BufferGeometry();
  bgGeometry.setAttribute('position', new THREE.BufferAttribute(bgPositions, 3));
  bgGeometry.setAttribute('color', new THREE.BufferAttribute(bgColors, 3));

  const starTexture = createStarTexture();
  const bgMaterial = new THREE.PointsMaterial({
    size: 1.4,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: starTexture,
  });

  const bgStarfield = new THREE.Points(bgGeometry, bgMaterial);
  bgStarfield.name = 'GalacticBackgroundStarfield';
  // Slight 23 deg inclination to galactic plane
  bgStarfield.rotation.z = 0.4;
  envGroup.add(bgStarfield);

  // -------------------------------------------------------------
  // 2. Layer 2: Mid-Field Field Stars (3,500 Stars)
  // -------------------------------------------------------------
  const midCount = 3500;
  const midPositions = new Float32Array(midCount * 3);
  const midColors = new Float32Array(midCount * 3);

  for (let i = 0; i < midCount; i++) {
    const u = Math.random() * 2 - 1;
    const phi = Math.acos(u);
    const theta = Math.random() * Math.PI * 2;
    const radius = 42000 + Math.random() * 12000;

    const sinPhi = Math.sin(phi);
    midPositions[i * 3] = radius * sinPhi * Math.cos(theta);
    midPositions[i * 3 + 1] = radius * Math.cos(phi);
    midPositions[i * 3 + 2] = radius * sinPhi * Math.sin(theta);

    const col = spectralPalette[Math.floor(Math.random() * spectralPalette.length)];
    const mag = 0.7 + Math.random() * 0.3;
    midColors[i * 3] = col.r * mag;
    midColors[i * 3 + 1] = col.g * mag;
    midColors[i * 3 + 2] = col.b * mag;
  }

  const midGeometry = new THREE.BufferGeometry();
  midGeometry.setAttribute('position', new THREE.BufferAttribute(midPositions, 3));
  midGeometry.setAttribute('color', new THREE.BufferAttribute(midColors, 3));

  const midMaterial = new THREE.PointsMaterial({
    size: 3.2,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: starTexture,
  });

  const midStarfield = new THREE.Points(midGeometry, midMaterial);
  midStarfield.name = 'MidFieldStars';
  envGroup.add(midStarfield);

  // -------------------------------------------------------------
  // 3. Layer 3: Prominent Foreground Diffraction Anchors (400 Stars)
  // -------------------------------------------------------------
  const anchorCount = 400;
  const anchorPositions = new Float32Array(anchorCount * 3);
  const anchorColors = new Float32Array(anchorCount * 3);

  for (let i = 0; i < anchorCount; i++) {
    const u = Math.random() * 2 - 1;
    const phi = Math.acos(u);
    const theta = Math.random() * Math.PI * 2;
    const radius = 35000 + Math.random() * 10000;

    const sinPhi = Math.sin(phi);
    anchorPositions[i * 3] = radius * sinPhi * Math.cos(theta);
    anchorPositions[i * 3 + 1] = radius * Math.cos(phi);
    anchorPositions[i * 3 + 2] = radius * sinPhi * Math.sin(theta);

    const col = spectralPalette[Math.floor(Math.random() * spectralPalette.length)];
    anchorColors[i * 3] = col.r;
    anchorColors[i * 3 + 1] = col.g;
    anchorColors[i * 3 + 2] = col.b;
  }

  const anchorGeometry = new THREE.BufferGeometry();
  anchorGeometry.setAttribute('position', new THREE.BufferAttribute(anchorPositions, 3));
  anchorGeometry.setAttribute('color', new THREE.BufferAttribute(anchorColors, 3));

  const diffractionTexture = createDiffractionStarTexture();
  const anchorMaterial = new THREE.PointsMaterial({
    size: 7.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: diffractionTexture || starTexture,
  });

  const anchorStars = new THREE.Points(anchorGeometry, anchorMaterial);
  anchorStars.name = 'AnchorDiffractionStars';
  envGroup.add(anchorStars);

  // -------------------------------------------------------------
  // 4. Distant Cosmic Dust & Nebulae (Restrained Deep-Space Palette)
  // -------------------------------------------------------------
  const dustCount = 1400;
  const dustPositions = new Float32Array(dustCount * 3);
  const dustColors = new Float32Array(dustCount * 3);

  // Cold, deep space interstellar palette
  const nebulaTones = [
    new THREE.Color(0x0e182a), // Cold Interstellar Navy
    new THREE.Color(0x131d36), // Deep Cosmic Indigo
    new THREE.Color(0x0a1c24), // Subtle Ethereal Teal
    new THREE.Color(0x28121a), // Faint H-Alpha Ember
  ];

  // Large distant clusters placed outside planetary space
  const clusters = [
    { center: new THREE.Vector3(38000, 12000, -32000), radius: 14000, color: nebulaTones[0] },
    { center: new THREE.Vector3(-36000, 15000, 28000), radius: 15000, color: nebulaTones[2] },
    { center: new THREE.Vector3(12000, -35000, 36000), radius: 13000, color: nebulaTones[3] },
    { center: new THREE.Vector3(-25000, -22000, -38000), radius: 16000, color: nebulaTones[1] },
  ];

  for (let i = 0; i < dustCount; i++) {
    const cl = clusters[i % clusters.length];
    const u = Math.random() * 2 - 1;
    const phi = Math.acos(u);
    const theta = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.6) * cl.radius;

    dustPositions[i * 3] = cl.center.x + r * Math.sin(phi) * Math.cos(theta);
    dustPositions[i * 3 + 1] = cl.center.y + r * Math.cos(phi);
    dustPositions[i * 3 + 2] = cl.center.z + r * Math.sin(phi) * Math.sin(theta);

    const jitter = 0.85 + Math.random() * 0.3;
    dustColors[i * 3] = cl.color.r * jitter;
    dustColors[i * 3 + 1] = cl.color.g * jitter;
    dustColors[i * 3 + 2] = cl.color.b * jitter;
  }

  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute('color', new THREE.BufferAttribute(dustColors, 3));

  const nebulaTexture = createNebulaTexture();
  const dustMaterial = new THREE.PointsMaterial({
    size: 180.0,
    vertexColors: true,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: nebulaTexture,
  });

  const nebula = new THREE.Points(dustGeometry, dustMaterial);
  nebula.name = 'DeepSpaceNebula';
  envGroup.add(nebula);

  if (scene) {
    scene.add(envGroup);
  }

  // -------------------------------------------------------------
  // 5. Cinematic Space Ambient Light (Calibrated High Contrast)
  // -------------------------------------------------------------
  // Ambient is kept very subtle (0.10) so star shadow terminators remain crisp & dramatic
  const ambientLight = new THREE.AmbientLight(0x0a0e18, 0.10);
  ambientLight.name = 'SpaceAmbientLight';
  if (scene) scene.add(ambientLight);

  return {
    group: envGroup,
    bgStarfield,
    midStarfield,
    anchorStars,
    nebula,
    ambientLight,

    /**
     * Keeps the infinite background starfield centered around the player's camera.
     * @param {THREE.Vector3} cameraPosition
     * @param {number} delta
     */
    update(cameraPosition, delta = 0.016) {
      if (cameraPosition && envGroup) {
        envGroup.position.copy(cameraPosition);
      }
      if (bgStarfield) {
        bgStarfield.rotation.y += 0.000015 * (delta / 0.016);
      }
    },

    dispose() {
      if (scene) {
        if (envGroup) scene.remove(envGroup);
        if (ambientLight) scene.remove(ambientLight);
      }

      if (bgGeometry) bgGeometry.dispose();
      if (bgMaterial) bgMaterial.dispose();
      if (midGeometry) midGeometry.dispose();
      if (midMaterial) midMaterial.dispose();
      if (anchorGeometry) anchorGeometry.dispose();
      if (anchorMaterial) anchorMaterial.dispose();
      if (dustGeometry) dustGeometry.dispose();
      if (dustMaterial) dustMaterial.dispose();

      if (starTexture) starTexture.dispose();
      if (diffractionTexture) diffractionTexture.dispose();
      if (nebulaTexture) nebulaTexture.dispose();

      if (ambientLight && typeof ambientLight.dispose === 'function') {
        ambientLight.dispose();
      }
    }
  };
}

export default createEnvironment;
