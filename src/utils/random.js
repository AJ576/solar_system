// Seeded pseudo-random number generator (Mulberry32)
// Provides reproducible procedural generation across systems.

export function createPRNG(seed) {
  let s = typeof seed === 'number' ? seed : hashString(String(seed));
  // Ensure non-zero 32-bit unsigned integer
  s = s >>> 0;
  if (s === 0) s = 1337;

  function next() {
    let t = (s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next, // float [0, 1)
    range(min, max) {
      return min + next() * (max - min);
    },
    rangeInt(min, max) {
      return Math.floor(this.range(min, max + 1));
    },
    choice(array) {
      if (!array || array.length === 0) return null;
      return array[Math.floor(next() * array.length)];
    },
    chance(probability) {
      return next() < probability;
    },
    color() {
      // Return a random hue with good saturation and brightness
      const h = next();
      const s = 0.5 + next() * 0.4;
      const l = 0.4 + next() * 0.4;
      return hslToHex(h, s, l);
    },
    getSeed() {
      return seed;
    }
  };
}

// Convert string seed to 32-bit integer
export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return (hash ^ 0x9e3779b9) >>> 0;
}

// Helper: HSL to Hex number (e.g. 0x3366cc)
function hslToHex(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = x => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return parseInt(`0x${toHex(r)}${toHex(g)}${toHex(b)}`, 16);
}

// System Name Generator based on seed
const PREFIXES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Proxima', 'Kepler', 'Gliese', 'Trappist', 'Vega', 'Sirius', 'Altair', 'Cygnus', 'Orion'];
const ROOTS = ['Centauri', 'Cygni', 'Eridani', 'Andromedae', 'Draconis', 'Pegasi', 'Aquilae', 'Aurigae', 'Bootis', 'Cassiopeiae', 'Cephei', 'Hydrae', 'Lupi', 'Majoris', 'Minoris', 'Sagittarii', 'Vela', 'Volantis'];
const SUFFIXES = ['Prime', 'Major', 'Minor', 'Secundus', 'IV', 'V', 'VI', 'VII', 'IX', 'X', 'B', 'C', 'System'];

export function generateSystemName(seed) {
  const prng = createPRNG(seed);
  const p = prng.choice(PREFIXES);
  const r = prng.choice(ROOTS);
  const s = prng.chance(0.6) ? ` ${prng.choice(SUFFIXES)}` : '';
  const num = prng.chance(0.4) ? `-${prng.rangeInt(10, 999)}` : '';
  return `${p} ${r}${num}${s}`;
}
