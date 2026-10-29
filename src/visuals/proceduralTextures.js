import * as THREE from 'three';

/**
 * Procedural Texture Generator for Space Exploration.
 * Produces deterministic, high-quality celestial textures using HTML5 Canvas.
 * Safe for headless execution (returns null when document/canvas is unavailable).
 */

// Simple 2D Value Noise generator for procedural synthesis
function createNoise2D(seed = 12345) {
  let s = seed >>> 0;
  function hash(x, y) {
    let n = Math.sin(x * 12.9898 + y * 78.233 + s * 0.01) * 43758.5453;
    return n - Math.floor(n);
  }

  return function (x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    // Smoothstep easing
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);

    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);

    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

// Multi-octave Fractal Brownian Motion (fBm)
function createFBM(seed = 12345, octaves = 5) {
  const noise = createNoise2D(seed);
  return function (x, y) {
    let val = 0;
    let amp = 0.5;
    let freq = 1.0;
    for (let o = 0; o < octaves; o++) {
      val += noise(x * freq, y * freq) * amp;
      freq *= 2.02;
      amp *= 0.5;
    }
    return val;
  };
}

/**
 * Creates procedural texture for Gas Giants featuring atmospheric bands,
 * high-speed jet streams, and a Great Cyclonic Storm vortex.
 */
export function createGasGiantTexture(primaryColorHex, secondaryColorHex, seed = 42) {
  if (typeof document === 'undefined') return null;

  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const fbm = createFBM(seed, 4);
  const colA = new THREE.Color(primaryColorHex);
  const colB = new THREE.Color(secondaryColorHex);
  const colDark = colA.clone().multiplyScalar(0.45);
  const colLight = colB.clone().lerp(new THREE.Color(0xffffff), 0.35);

  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  // Great storm vortex coordinates
  const stormX = (0.35 + ((seed % 100) / 200)) * width;
  const stormY = (0.55 + (((seed * 7) % 100) / 400)) * height;
  const stormRadiusX = 75;
  const stormRadiusY = 42;

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    // Latitudinal banded harmonic function
    const bandFreq = 18.0;
    const bandBase = Math.sin(ny * Math.PI * bandFreq);

    for (let x = 0; x < width; x++) {
      const nx = x / width;

      // Atmospheric turbulence perturbation
      const turbulence = fbm(nx * 6.0, ny * 12.0) * 0.35;
      const bandVal = (bandBase + Math.sin(ny * Math.PI * 4.0) * 0.5 + turbulence + 1.0) * 0.5;

      // Base interpolation between colA and colB
      const pixelCol = colA.clone().lerp(colB, THREE.MathUtils.clamp(bandVal, 0, 1));

      // Jet stream shear contrast
      const shear = Math.abs(fbm(nx * 14.0, ny * 20.0) - 0.5) * 2.0;
      if (shear > 0.6) {
        pixelCol.lerp(colLight, (shear - 0.6) * 0.8);
      } else if (shear < 0.2) {
        pixelCol.lerp(colDark, (0.2 - shear) * 1.5);
      }

      // Great Storm Oval calculation
      const dx = (x - stormX) / stormRadiusX;
      const dy = (y - stormY) / stormRadiusY;
      const distSq = dx * dx + dy * dy;
      if (distSq < 1.0) {
        const stormFade = 1.0 - Math.sqrt(distSq);
        const spiral = fbm(dx * 4.0 + Math.atan2(dy, dx), dy * 4.0);
        const stormCol = colLight.clone().lerp(new THREE.Color(0xff4422), 0.6);
        pixelCol.lerp(stormCol, stormFade * (0.6 + spiral * 0.4));
      }

      const idx = (y * width + x) * 4;
      data[idx] = Math.round(pixelCol.r * 255);
      data[idx + 1] = Math.round(pixelCol.g * 255);
      data[idx + 2] = Math.round(pixelCol.b * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates procedural texture for Terrestrial & Ocean Worlds
 * featuring continents, coastal shelves, deep abyssal oceans, and polar ice caps.
 */
export function createTerrestrialTexture(planetType, primaryColorHex, seed = 77) {
  if (typeof document === 'undefined') return null;

  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const fbm = createFBM(seed, 6);
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  // Palette definitions based on archetype
  const oceanDeep = new THREE.Color(0x0a1e3f);
  const oceanShallow = new THREE.Color(0x196f97);
  const landLow = new THREE.Color(primaryColorHex);
  const landHigh = landLow.clone().multiplyScalar(0.7).lerp(new THREE.Color(0x8a7960), 0.5);
  const polarIce = new THREE.Color(0xf0f8ff);

  const seaLevel = planetType === 'Ocean' ? 0.48 : (planetType === 'Desert' ? 0.15 : 0.42);

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    const lat = Math.abs(ny - 0.5) * 2.0; // 0 at equator, 1 at poles

    for (let x = 0; x < width; x++) {
      const nx = x / width;

      // Spherical projection approximation for noise
      const elev = fbm(nx * 4.0, ny * 2.5);

      let pixelCol = new THREE.Color();

      // Polar Ice Caps
      const polarThreshold = 0.82 + fbm(nx * 8.0, 0) * 0.08;
      if (lat > polarThreshold) {
        pixelCol.copy(polarIce);
      } else if (elev < seaLevel) {
        // Ocean / Waters
        if (planetType === 'Desert') {
          // Desert dry basin
          pixelCol.copy(landLow).multiplyScalar(0.65);
        } else {
          const depthRatio = elev / seaLevel;
          pixelCol.copy(oceanDeep).lerp(oceanShallow, depthRatio);
        }
      } else {
        // Continental Landmass
        const altitude = (elev - seaLevel) / (1.0 - seaLevel);
        pixelCol.copy(landLow).lerp(landHigh, altitude);

        // Mountain snow peaks
        if (altitude > 0.75 && lat > 0.35) {
          pixelCol.lerp(polarIce, (altitude - 0.75) * 3.5);
        }
      }

      const idx = (y * width + x) * 4;
      data[idx] = Math.round(pixelCol.r * 255);
      data[idx + 1] = Math.round(pixelCol.g * 255);
      data[idx + 2] = Math.round(pixelCol.b * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates procedural texture for Rocky / Cratered Planets and Moons.
 */
export function createCrateredTexture(baseColorHex, seed = 99) {
  if (typeof document === 'undefined') return null;

  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const fbm = createFBM(seed, 5);
  const baseCol = new THREE.Color(baseColorHex);
  const darkMaria = baseCol.clone().multiplyScalar(0.55);
  const lightHighland = baseCol.clone().lerp(new THREE.Color(0xdde3ea), 0.45);

  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;

      const n = fbm(nx * 5.0, ny * 3.0);
      const pixelCol = darkMaria.clone().lerp(lightHighland, n);

      // Micro-crater ring highlights
      const micro = Math.abs(fbm(nx * 18.0, ny * 18.0) - 0.5) * 2.0;
      if (micro > 0.85) {
        pixelCol.lerp(new THREE.Color(0xffffff), 0.3);
      }

      const idx = (y * width + x) * 4;
      data[idx] = Math.round(pixelCol.r * 255);
      data[idx + 1] = Math.round(pixelCol.g * 255);
      data[idx + 2] = Math.round(pixelCol.b * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates procedural texture for Cloud layers.
 */
export function createCloudTexture(seed = 101) {
  if (typeof document === 'undefined') return null;

  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const fbm = createFBM(seed, 5);
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;

      // Swirling trade winds and storm cyclonic swirls
      const windOffset = Math.sin(ny * Math.PI * 6.0) * 0.1;
      const density = fbm(nx * 5.0 + windOffset, ny * 3.0);

      const alpha = density > 0.45 ? Math.min(255, Math.round((density - 0.45) * 480)) : 0;

      const idx = (y * width + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates procedural banded texture for Planetary Rings with Cassini Division.
 */
export function createRingTexture(ringColorHex, seed = 55) {
  if (typeof document === 'undefined') return null;

  const width = 512;
  const height = 16;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const baseCol = new THREE.Color(ringColorHex);
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  for (let x = 0; x < width; x++) {
    const u = x / width; // 0 = inner edge, 1 = outer edge

    // Cassini Division gap at u ~ [0.62, 0.68]
    let opacity = 0.8;
    if (u < 0.05 || u > 0.96) {
      opacity = 0.0; // Soft ring edges
    } else if (u > 0.62 && u < 0.68) {
      opacity = 0.04; // Cassini gap
    } else if (u > 0.88 && u < 0.90) {
      opacity = 0.08; // Encke gap
    } else {
      // Harmonic micro-banding
      const band = Math.sin(u * 140.0) * 0.2 + Math.sin(u * 45.0) * 0.25;
      opacity = THREE.MathUtils.clamp(0.65 + band, 0.2, 0.95);
    }

    const r = Math.round(baseCol.r * 255);
    const g = Math.round(baseCol.g * 255);
    const b = Math.round(baseCol.b * 255);
    const a = Math.round(opacity * 255);

    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates procedural texture for Star Photosphere (solar granulation + limb darkening).
 */
export function createStarPhotosphereTexture(starColorHex, seed = 12) {
  if (typeof document === 'undefined') return null;

  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const fbm = createFBM(seed, 4);
  const baseCol = new THREE.Color(starColorHex);
  const hotCore = baseCol.clone().lerp(new THREE.Color(0xffffff), 0.7);
  const darkFilament = baseCol.clone().multiplyScalar(0.7);

  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;

      // High-frequency convective plasma granulation cells
      const gran = fbm(nx * 16.0, ny * 10.0);
      const pixelCol = darkFilament.clone().lerp(hotCore, gran);

      const idx = (y * width + x) * 4;
      data[idx] = Math.round(pixelCol.r * 255);
      data[idx + 1] = Math.round(pixelCol.g * 255);
      data[idx + 2] = Math.round(pixelCol.b * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates diffraction spike texture for prominent foreground stars.
 */
export function createDiffractionStarTexture() {
  if (typeof document === 'undefined') return null;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const center = size / 2;

  // Central soft glow
  const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.12, 'rgba(220, 240, 255, 0.9)');
  grad.addColorStop(0.35, 'rgba(160, 210, 255, 0.25)');
  grad.addColorStop(1.0, 'rgba(100, 180, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // 4-point anamorphic diffraction spikes
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.lineWidth = 1.2;

  // Horizontal spike
  ctx.beginPath();
  ctx.moveTo(2, center);
  ctx.lineTo(size - 2, center);
  ctx.stroke();

  // Vertical spike
  ctx.beginPath();
  ctx.moveTo(center, 2);
  ctx.lineTo(center, size - 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
