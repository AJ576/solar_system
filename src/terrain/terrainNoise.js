import { createPRNG } from '../utils/random.js';

/**
 * 3D Simplex Noise with seeded permutation table.
 * Fully continuous and isotropic on the unit sphere (no polar seams or pinching).
 */
export class SimplexNoise3D {
  constructor(seed = 12345) {
    const prng = createPRNG(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }
    // Fisher-Yates shuffle
    for (let i = 255; i > 0; i--) {
      const j = prng.rangeInt(0, i);
      const temp = p[i];
      p[i] = p[j];
      p[j] = temp;
    }

    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }

    // 12 3D gradient vectors
    this.grad3 = new Float32Array([
      1, 1, 0,  -1, 1, 0,   1, -1, 0,  -1, -1, 0,
      1, 0, 1,  -1, 0, 1,   1, 0, -1,  -1, 0, -1,
      0, 1, 1,   0, -1, 1,  0, 1, -1,   0, -1, -1
    ]);
  }

  noise(x, y, z) {
    const F3 = 1.0 / 3.0;
    const G3 = 1.0 / 6.0;

    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);

    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;

    const x0 = x - X0;
    const y0 = y - Y0;
    const z0 = z - Z0;

    let i1, j1, k1;
    let i2, j2, k2;

    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else {
      if (y0 < z0) {
        i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
      } else if (x0 < z0) {
        i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
      } else {
        i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;

    const x2 = x0 - i2 + 2.0 * G3;
    const y2 = y0 - j2 + 2.0 * G3;
    const z2 = z0 - k2 + 2.0 * G3;

    const x3 = x0 - 1.0 + 3.0 * G3;
    const y3 = y0 - 1.0 + 3.0 * G3;
    const z3 = z0 - 1.0 + 3.0 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let n0 = 0.0;
    let n1 = 0.0;
    let n2 = 0.0;
    let n3 = 0.0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      t0 *= t0;
      const gi0 = this.permMod12[ii + this.perm[jj + this.perm[kk]]] * 3;
      n0 = t0 * t0 * (this.grad3[gi0] * x0 + this.grad3[gi0 + 1] * y0 + this.grad3[gi0 + 2] * z0);
    }

    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      t1 *= t1;
      const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]]] * 3;
      n1 = t1 * t1 * (this.grad3[gi1] * x1 + this.grad3[gi1 + 1] * y1 + this.grad3[gi1 + 2] * z1);
    }

    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      t2 *= t2;
      const gi2 = this.permMod12[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]]] * 3;
      n2 = t2 * t2 * (this.grad3[gi2] * x2 + this.grad3[gi2 + 1] * y2 + this.grad3[gi2 + 2] * z2);
    }

    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      t3 *= t3;
      const gi3 = this.permMod12[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]]] * 3;
      n3 = t3 * t3 * (this.grad3[gi3] * x3 + this.grad3[gi3 + 1] * y3 + this.grad3[gi3 + 2] * z3);
    }

    // Scaled to roughly [-1, 1]
    return 32.0 * (n0 + n1 + n2 + n3);
  }

  /**
   * Fractal Brownian Motion (fBm)
   */
  fbm(x, y, z, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let sum = 0.0;
    let amp = 1.0;
    let freq = 1.0;
    let maxAmp = 0.0;

    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq, y * freq, z * freq) * amp;
      maxAmp += amp;
      freq *= lacunarity;
      amp *= gain;
    }

    return sum / maxAmp;
  }

  /**
   * Ridged multifractal noise for sharp mountain peaks and ridges.
   */
  ridged(x, y, z, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let sum = 0.0;
    let amp = 1.0;
    let freq = 1.0;
    let weight = 1.0;
    let maxAmp = 0.0;

    for (let i = 0; i < octaves; i++) {
      let n = 1.0 - Math.abs(this.noise(x * freq, y * freq, z * freq));
      n = n * n; // Sharpen ridges
      n *= weight;
      weight = Math.max(0.0, Math.min(1.0, n * 2.0));

      sum += n * amp;
      maxAmp += amp;
      freq *= lacunarity;
      amp *= gain;
    }

    return sum / maxAmp;
  }

  /**
   * Domain-warped fBm for organic, swirling tectonic patterns and river basins.
   */
  warpedFbm(x, y, z, warpStrength = 0.35, octaves = 4) {
    const qx = this.fbm(x, y, z, 3);
    const qy = this.fbm(x + 5.2, y + 1.3, z + 2.8, 3);
    const qz = this.fbm(x + 1.8, y + 8.1, z + 4.3, 3);

    return this.fbm(
      x + warpStrength * qx,
      y + warpStrength * qy,
      z + warpStrength * qz,
      octaves
    );
  }
}

/**
 * Procedural Crater Field on a sphere.
 * Generates deterministic crater distributions with bowl depressions and raised rims.
 */
export class CraterField {
  constructor(seed = 12345, count = 30, { minRadius = 0.03, maxRadius = 0.31 } = {}) {
    const prng = createPRNG(seed);
    this.craters = [];

    for (let i = 0; i < count; i++) {
      // Uniform point on sphere
      const z = prng.range(-1, 1);
      const theta = prng.range(0, Math.PI * 2);
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const cx = r * Math.cos(theta);
      const cy = r * Math.sin(theta);
      const cz = z;

      // Crater size distribution: power law (many small, few large)
      const sizeFactor = Math.pow(prng.next(), 3.2);
      const angularRadius = minRadius + sizeFactor * (maxRadius - minRadius);
      // Big basins are shallow relative to their width; small craters are sharp bowls
      const depth = 0.12 + Math.sqrt(sizeFactor) * 0.35;
      const rimHeight = depth * 0.45;
      const hasCentralPeak = sizeFactor > 0.35 && prng.chance(0.7);

      this.craters.push({
        cx, cy, cz,
        angularRadius,
        depth,
        rimHeight,
        hasCentralPeak,
        // Precompute cos of outer influence threshold (1.35x radius)
        cosOuter: Math.cos(angularRadius * 1.35)
      });
    }
  }

  /**
   * Calculates crater elevation displacement at a given unit direction vector.
   * Returns a normalized height offset (negative for bowl, positive for rim).
   */
  getElevation(dx, dy, dz) {
    let totalOffset = 0.0;

    for (let i = 0; i < this.craters.length; i++) {
      const c = this.craters[i];
      // Dot product = cos of angle between direction and crater center
      const dot = dx * c.cx + dy * c.cy + dz * c.cz;

      if (dot < c.cosOuter) continue; // Outside crater influence

      const u = Math.acos(Math.min(1.0, dot)) / c.angularRadius; // 0 at center, 1 at rim

      let h;
      if (u < 0.85) {
        // Flat-ish floor with steep walls
        const t = u / 0.85;
        h = -c.depth * (1.0 - t * t * t * t);

        // Central rebound peak for large impact basins
        if (c.hasCentralPeak && u < 0.22) {
          const pt = 1.0 - (u / 0.22);
          h += c.depth * 0.55 * (pt * pt * (3.0 - 2.0 * pt));
        }
      } else if (u <= 1.0) {
        // Wall rising to a raised rim
        const t = (u - 0.85) / 0.15;
        const s = t * t * (3.0 - 2.0 * t);
        h = -c.depth * (1.0 - s) + c.rimHeight * s;
      } else {
        // Outer ejecta blanket: decays smoothly from rim to 0
        const t = (u - 1.0) / 0.35;
        const falloff = 1.0 - t;
        h = c.rimHeight * falloff * falloff;
      }
      totalOffset += h;
    }

    return totalOffset;
  }
}

/**
 * Shield volcanoes: broad cones with a summit caldera.
 */
export class VolcanoField {
  constructor(seed = 12345, count = 4, { minRadius = 0.06, maxRadius = 0.2 } = {}) {
    const prng = createPRNG(seed);
    this.volcanoes = [];

    for (let i = 0; i < count; i++) {
      const z = prng.range(-1, 1);
      const theta = prng.range(0, Math.PI * 2);
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const angularRadius = prng.range(minRadius, maxRadius);
      this.volcanoes.push({
        cx: r * Math.cos(theta),
        cy: r * Math.sin(theta),
        cz: z,
        angularRadius,
        height: prng.range(0.55, 1.0),
        cosOuter: Math.cos(angularRadius)
      });
    }
  }

  getElevation(dx, dy, dz) {
    let total = 0.0;
    for (let i = 0; i < this.volcanoes.length; i++) {
      const v = this.volcanoes[i];
      const dot = dx * v.cx + dy * v.cy + dz * v.cz;
      if (dot < v.cosOuter) continue;

      const u = Math.acos(Math.min(1.0, dot)) / v.angularRadius;
      // Concave shield profile
      const f = 1.0 - u;
      let h = v.height * f * f * (1.0 + f) * 0.5;
      // Summit caldera
      if (u < 0.1) {
        const t = 1.0 - u / 0.1;
        h -= v.height * 0.22 * t * t * (3.0 - 2.0 * t);
      }
      total += h;
    }
    return total;
  }
}
