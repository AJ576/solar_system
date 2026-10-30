import * as THREE from 'three';
import { createPRNG } from '../utils/random.js';

/**
 * Terrain profiles specifying noise parameters, geological features,
 * sea level, climate, atmosphere and color palettes per biome.
 *
 * Every planet type picks one hand-tuned *variant* (e.g. "Temperate", "Rust",
 * "Glacial"). The seed only jitters numbers inside that variant's ranges, so
 * a planet always looks coherent instead of mixing unrelated random choices.
 *
 * Heights inside the generator are normalized: 0 is sea level (the base
 * radius), 1 is maxElevation, negative values are basins / ocean floor.
 */
export const TERRAIN_BIOMES = {
  ROCKY: 'Rocky',
  DESERT: 'Desert',
  OCEAN: 'Ocean',
  TERRESTRIAL: 'Terrestrial',
  ICE: 'Ice',
  MOON: 'Moon',
  GAS_GIANT: 'Gas Giant'
};

// Defaults shared by every variant; variants override what they need.
// [a, b] pairs are ranges sampled per seed.
const BASE = {
  weight: 1,
  elevationScale: [0.03, 0.04],
  oceanFraction: [0.4, 0.5],    // share of the surface below sea level
  oceanDepth: [0.45, 0.6],      // normalized depth of the abyssal floor
  seaSurface: 'basin',          // what sits below sea level: water | lava | ice | basin
  continentFreq: [0.9, 1.25],
  warp: [0.35, 0.6],
  plainsHeight: [0.15, 0.25],   // how high inland plains rise
  mountainHeight: [0.55, 0.75],
  mountainFreq: [3.0, 4.0],
  beltFreq: [1.4, 2.0],         // frequency of mountain-range belts
  beltWidth: [0.1, 0.16],
  ruggedness: [0.06, 0.12],     // ridged relief outside the belts
  basinMountains: 0.0,          // mountains allowed in basins (0 = only on land)
  hillAmp: [0.04, 0.06],
  hillFreq: [7, 9],
  craterWeight: 0,
  craterCount: 0,
  smallCraterCount: 0,
  volcanoCount: 0,
  volcanoHeight: [0.6, 0.9],
  terraceSteps: 0,
  terraceAmount: 0,
  canyonDepth: 0,
  canyonFreq: [2.5, 3.5],
  canyonWidth: [0.05, 0.08],
  duneAmp: 0,
  duneFreq: [38, 48],
  mariaFlatten: 0,              // flattens basins into smooth plains
  polarIce: 0,                  // freezes the sea surface near the poles
  liquid: null,
  climate: { latWeight: 1.0, altWeight: 0.6, snowTemp: -10 }, // snowTemp < -1 = never snows
  atmosphere: null,
  atmosphereChance: 1
};

const VARIANTS = {
  Ocean: [
    {
      name: 'Temperate', weight: 3,
      elevationScale: [0.024, 0.03],
      oceanFraction: [0.58, 0.7],
      seaSurface: 'water', polarIce: 0.83,
      liquid: { color: 0x0c3558, opacity: 0.8 },
      palette: {
        deep: 0x0a1f3a, shallow: 0x2e8a92, beach: 0xd6c69a,
        low: 0x3d6b2a, lowAlt: 0x8c8a4c, mid: 0x5d6b3a, high: 0x6e6152,
        rock: 0x4b4540, snow: 0xf1f4f7, crack: 0x3a3430
      },
      climate: { latWeight: 1.0, altWeight: 1.0, snowTemp: 0.22 },
      atmosphere: { color: 0x4f86ff, sunsetColor: 0xff8a45, density: 1.0, height: 0.06, falloff: 3.5 }
    },
    {
      name: 'Tropical', weight: 2,
      elevationScale: [0.022, 0.028],
      oceanFraction: [0.66, 0.78],
      seaSurface: 'water', polarIce: 0.9,
      liquid: { color: 0x0b4a6a, opacity: 0.74 },
      palette: {
        deep: 0x0a2440, shallow: 0x3fc4bf, beach: 0xefe2b4,
        low: 0x2b6a1e, lowAlt: 0x4f8a2a, mid: 0x3c5a26, high: 0x6a5a44,
        rock: 0x4a4038, snow: 0xf4f6f8, crack: 0x3a3028
      },
      climate: { latWeight: 1.0, altWeight: 0.6, snowTemp: 0.12 },
      atmosphere: { color: 0x4a8cff, sunsetColor: 0xff9a50, density: 1.15, height: 0.065, falloff: 3.2 }
    },
    {
      name: 'Savanna', weight: 2,
      elevationScale: [0.026, 0.032],
      oceanFraction: [0.38, 0.5],
      seaSurface: 'water', polarIce: 0.86,
      liquid: { color: 0x10405e, opacity: 0.8 },
      palette: {
        deep: 0x0b223c, shallow: 0x3a8f8a, beach: 0xd9c08a,
        low: 0x6f7a35, lowAlt: 0xb3995a, mid: 0x8a6a42, high: 0x7a6250,
        rock: 0x51433a, snow: 0xf0f2f4, crack: 0x5a3e2c
      },
      climate: { latWeight: 1.0, altWeight: 0.7, snowTemp: 0.2 },
      atmosphere: { color: 0x5a8cf0, sunsetColor: 0xff7a3a, density: 0.9, height: 0.06, falloff: 3.5 }
    },
    {
      name: 'Alien', weight: 1,
      elevationScale: [0.024, 0.03],
      oceanFraction: [0.5, 0.65],
      seaSurface: 'water', polarIce: 0.85,
      liquid: { color: 0x0c3f3a, opacity: 0.8 },
      palette: {
        deep: 0x082a2a, shallow: 0x2fa58a, beach: 0xb9b08a,
        low: 0x6a2440, lowAlt: 0x9a4a2a, mid: 0x5a2a3e, high: 0x5e5060,
        rock: 0x3a3440, snow: 0xeef0f6, crack: 0x2a2030
      },
      climate: { latWeight: 1.0, altWeight: 0.7, snowTemp: 0.2 },
      atmosphere: { color: 0x5fe0b8, sunsetColor: 0xc86aff, density: 1.0, height: 0.06, falloff: 3.5 }
    }
  ],

  Desert: [
    {
      name: 'Rust', weight: 3,
      elevationScale: [0.034, 0.042],
      oceanFraction: [0.3, 0.42],
      basinMountains: 0.3,
      craterWeight: [0.25, 0.4], craterCount: [10, 18], smallCraterCount: [40, 70],
      volcanoCount: [2, 4], volcanoHeight: [0.8, 1.1],
      terraceSteps: [4, 5], terraceAmount: 0.25,
      canyonDepth: [0.3, 0.45],
      palette: {
        deep: 0x3d2219, shallow: 0x5e3322, beach: 0x6e3a24,
        low: 0x9a4a28, lowAlt: 0xb05a30, mid: 0xb8693c, high: 0xc99060,
        rock: 0x4c2618, snow: 0xf2ece6, crack: 0x3a1c12
      },
      climate: { latWeight: 1.0, altWeight: 0.2, snowTemp: 0.12 },
      atmosphere: { color: 0xd89a72, sunsetColor: 0x6f9cff, density: 0.45, height: 0.05, falloff: 3.0 }
    },
    {
      name: 'Dune Sea', weight: 2,
      elevationScale: [0.026, 0.034],
      oceanFraction: [0.25, 0.35],
      mountainHeight: [0.4, 0.6],
      terraceSteps: [4, 6], terraceAmount: 0.6,
      canyonDepth: [0.2, 0.3],
      duneAmp: [0.06, 0.09],
      palette: {
        deep: 0xe6dccb, shallow: 0xd8c6a4, beach: 0xd9b57a,
        low: 0xd9a25a, lowAlt: 0xe2b26a, mid: 0xc98a48, high: 0xa86a3a,
        rock: 0x6e4428, snow: 0xf5efe6, crack: 0x7a4a2a
      },
      atmosphere: { color: 0xffc58a, sunsetColor: 0xff6a35, density: 0.6, height: 0.055, falloff: 3.0 }
    },
    {
      name: 'Badlands', weight: 2,
      elevationScale: [0.032, 0.04],
      oceanFraction: [0.3, 0.4],
      basinMountains: 0.4,
      terraceSteps: [5, 7], terraceAmount: 0.85,
      canyonDepth: [0.45, 0.6], canyonWidth: [0.07, 0.1],
      palette: {
        deep: 0x6a3020, shallow: 0x8a4428, beach: 0x9a5530,
        low: 0xb86a3a, lowAlt: 0xc98a52, mid: 0xd9a46e, high: 0xe8cfa0,
        rock: 0x7a3a22, snow: 0xf5efe6, crack: 0x5a2616
      },
      atmosphere: { color: 0xffb27a, sunsetColor: 0xff5a2a, density: 0.55, height: 0.05, falloff: 3.0 }
    }
  ],

  Ice: [
    {
      name: 'Glacial', weight: 3,
      elevationScale: [0.03, 0.038],
      oceanFraction: [0.45, 0.6],
      seaSurface: 'ice',
      mountainHeight: [0.7, 0.9],
      canyonDepth: [0.15, 0.25], canyonWidth: [0.03, 0.05],
      palette: {
        deep: 0x9fc3d8, shallow: 0xc6e0ee, beach: 0xdcebf3,
        low: 0xe8f1f6, lowAlt: 0xd2e6f2, mid: 0xbcd4e4, high: 0xf6fafc,
        rock: 0x3c4a58, snow: 0xf8fbfd, crack: 0x4f8db5
      },
      climate: { latWeight: 0.4, altWeight: 0.3, snowTemp: 0.9 },
      atmosphere: { color: 0xa8d8ff, sunsetColor: 0xff9ac8, density: 0.4, height: 0.05, falloff: 3.5 }
    },
    {
      name: 'Frozen Highlands', weight: 2,
      elevationScale: [0.036, 0.042],
      oceanFraction: [0.25, 0.38],
      seaSurface: 'ice',
      mountainHeight: [0.8, 1.0], ruggedness: [0.18, 0.26], beltWidth: [0.18, 0.24],
      canyonDepth: [0.25, 0.35],
      palette: {
        deep: 0x6fa6c8, shallow: 0x8fc0dc, beach: 0x9fb8c8,
        low: 0x5d6873, lowAlt: 0x7a8794, mid: 0x9aa8b4, high: 0xf4f8fb,
        rock: 0x343b44, snow: 0xf8fbfd, crack: 0x2a5a7a
      },
      climate: { latWeight: 0.5, altWeight: 1.4, snowTemp: 0.55 },
      atmosphere: { color: 0x9fd0ff, sunsetColor: 0xffb08a, density: 0.35, height: 0.05, falloff: 3.5 }
    },
    {
      name: 'Nitrogen', weight: 1,
      elevationScale: [0.028, 0.034],
      oceanFraction: [0.35, 0.45],
      seaSurface: 'ice',
      mariaFlatten: 0.85,
      craterWeight: [0.2, 0.35], craterCount: [8, 14],
      palette: {
        deep: 0xf2e8dc, shallow: 0xefe2d2, beach: 0xd8bfa4,
        low: 0xc89e7c, lowAlt: 0xb07a58, mid: 0x8a5a40, high: 0xe8d8c8,
        rock: 0x4a2c20, snow: 0xf4ece4, crack: 0x6a4030
      },
      atmosphere: { color: 0xd89a50, sunsetColor: 0x8a4a20, density: 1.2, height: 0.07, falloff: 2.5 }
    }
  ],

  Rocky: [
    {
      name: 'Barren', weight: 3,
      elevationScale: [0.036, 0.044],
      oceanFraction: [0.25, 0.4],
      mariaFlatten: 0.6, basinMountains: 0.5,
      craterWeight: [0.7, 0.9], craterCount: [26, 40], smallCraterCount: [120, 180],
      palette: {
        deep: 0x3a3836, shallow: 0x4a4744, beach: 0x5a5651,
        low: 0x7a756e, lowAlt: 0x6e6862, mid: 0x8c867e, high: 0xa8a29a,
        rock: 0x3a3632, snow: 0xd8d4ce, crack: 0x2a2826
      }
    },
    {
      name: 'Volcanic', weight: 2,
      elevationScale: [0.034, 0.042],
      oceanFraction: [0.12, 0.22], oceanDepth: [0.2, 0.3],
      seaSurface: 'lava',
      volcanoCount: [5, 9], volcanoHeight: [0.8, 1.1],
      canyonDepth: [0.15, 0.25],
      craterWeight: [0.15, 0.25], craterCount: [6, 10],
      liquid: { color: 0x2a0800, emissive: 0xff4a10 },
      palette: {
        deep: 0x1a0c08, shallow: 0x2a1410, beach: 0x4a1c10,
        low: 0x24201e, lowAlt: 0x2e2724, mid: 0x3a3330, high: 0x5a524c,
        rock: 0x141212, snow: 0x8a8278, crack: 0x5a1a0a
      },
      atmosphereChance: 0.7,
      atmosphere: { color: 0xc89a58, sunsetColor: 0xff4a1a, density: 0.8, height: 0.055, falloff: 2.8 }
    },
    {
      name: 'Iron', weight: 2,
      elevationScale: [0.036, 0.044],
      oceanFraction: [0.3, 0.42],
      basinMountains: 0.4,
      craterWeight: [0.35, 0.5], craterCount: [14, 22], smallCraterCount: [60, 90],
      canyonDepth: [0.3, 0.45],
      palette: {
        deep: 0x3a2018, shallow: 0x4e2a1e, beach: 0x5e3424,
        low: 0x6e3c26, lowAlt: 0x7e4a30, mid: 0x8e6046, high: 0xb08c6e,
        rock: 0x2e1a12, snow: 0xe0d6cc, crack: 0x24120c
      },
      atmosphereChance: 0.35,
      atmosphere: { color: 0xd8a080, sunsetColor: 0x8aa0ff, density: 0.3, height: 0.045, falloff: 3.5 }
    },
    {
      name: 'Toxic', weight: 1,
      elevationScale: [0.028, 0.036],
      oceanFraction: [0.3, 0.45],
      mariaFlatten: 0.5,
      volcanoCount: [2, 5],
      craterWeight: [0.1, 0.2], craterCount: [5, 10],
      palette: {
        deep: 0x4a4a22, shallow: 0x5e5a2a, beach: 0x7a7034,
        low: 0x9a8e44, lowAlt: 0xb0a052, mid: 0x8a7a40, high: 0xc8bc80,
        rock: 0x3a3418, snow: 0xe8e2b0, crack: 0x3a3012
      },
      atmosphere: { color: 0xe0d070, sunsetColor: 0xff8a2a, density: 1.6, height: 0.07, falloff: 2.2 }
    }
  ],

  Moon: [
    {
      name: 'Lunar', weight: 4,
      elevationScale: [0.045, 0.06],
      oceanFraction: [0.25, 0.4],
      mariaFlatten: 0.85, basinMountains: 0.4,
      plainsHeight: [0.2, 0.3], mountainHeight: [0.35, 0.5],
      craterWeight: [0.85, 1.05], craterCount: [35, 55], smallCraterCount: [160, 220],
      palette: {
        deep: 0x2e2f31, shallow: 0x3a3b3e, beach: 0x4a4b4e,
        low: 0x7d7f82, lowAlt: 0x737578, mid: 0x8e9093, high: 0xb2b4b6,
        rock: 0x3c3d40, snow: 0xd0d2d4, crack: 0x262729
      }
    },
    {
      name: 'Dusty', weight: 2,
      elevationScale: [0.045, 0.06],
      oceanFraction: [0.3, 0.4],
      mariaFlatten: 0.5, basinMountains: 0.5,
      craterWeight: [0.8, 1.0], craterCount: [30, 45], smallCraterCount: [140, 200],
      palette: {
        deep: 0x4a3a2e, shallow: 0x5a4838, beach: 0x6a5644,
        low: 0x8a7460, lowAlt: 0x7e6a56, mid: 0x9a8670, high: 0xbaa892,
        rock: 0x3e3026, snow: 0xd8ccbe, crack: 0x302419
      }
    },
    {
      name: 'Icy Moon', weight: 2,
      elevationScale: [0.025, 0.035],
      oceanFraction: [0.4, 0.5],
      mariaFlatten: 0.7,
      mountainHeight: [0.2, 0.35],
      canyonDepth: [0.12, 0.2], canyonWidth: [0.08, 0.11], canyonFreq: [3.5, 5],
      craterWeight: [0.2, 0.35], craterCount: [8, 14], smallCraterCount: [20, 40],
      palette: {
        deep: 0xd8d2c8, shallow: 0xe4ded4, beach: 0xe8e4dc,
        low: 0xeeeae4, lowAlt: 0xe2d8cc, mid: 0xf0ece6, high: 0xf8f6f2,
        rock: 0x9a8a7a, snow: 0xffffff, crack: 0x8a4a2a
      }
    },
    {
      name: 'Sulfur Moon', weight: 1,
      elevationScale: [0.03, 0.04],
      oceanFraction: [0.08, 0.14], oceanDepth: [0.2, 0.3],
      seaSurface: 'lava',
      volcanoCount: [6, 10], volcanoHeight: [0.5, 0.8],
      liquid: { color: 0x2a0800, emissive: 0xff5a14 },
      palette: {
        deep: 0x2a1a0a, shallow: 0x3a220e, beach: 0x2a2018,
        low: 0xd8b84a, lowAlt: 0xc89a3a, mid: 0xe0c870, high: 0xf0e0a0,
        rock: 0x5a3a1a, snow: 0xf4f0d8, crack: 0x6a2a0e
      }
    }
  ]
};
VARIANTS.Terrestrial = VARIANTS.Ocean;

/**
 * Returns a configured terrain profile for a celestial body based on its type and seed.
 * Different seeds pick different variants and jitter their parameters.
 *
 * @param {string} type Planet type ('Rocky', 'Desert', 'Ocean', 'Ice', 'Gas Giant', or 'Moon')
 * @param {number|string} seed Planet seed number
 * @param {number} planetRadius Base radius of the body in kilometers
 * @returns {Object} Configured terrain profile (plain JSON data)
 */
export function getTerrainProfile(type, seed, planetRadius = 700) {
  const prng = createPRNG(seed);

  // Gas Giants do not have solid terrain geometry
  if (type === 'Gas Giant') {
    return {
      type: 'Gas Giant',
      hasTerrain: false,
      maxElevation: 0,
      minElevation: 0
    };
  }

  const effectiveType = type === 'moon' ? 'Moon' : (VARIANTS[type] ? type : 'Rocky');
  const variants = VARIANTS[effectiveType];
  const v = { ...BASE, ...pickWeighted(prng, variants) };

  const pick = (val) => Array.isArray(val) ? prng.range(val[0], val[1]) : val;
  const pickInt = (val) => Array.isArray(val) ? prng.rangeInt(val[0], val[1]) : val;

  const elevationScale = pick(v.elevationScale);
  const oceanDepth = pick(v.oceanDepth);
  const maxElevation = planetRadius * elevationScale;

  // Small hue/lightness jitter keeps sibling planets distinct but on-theme
  const hueShift = prng.range(-0.015, 0.015);
  const lightShift = prng.range(-0.03, 0.03);
  const palette = {};
  for (const key of Object.keys(v.palette)) {
    palette[key] = jitterColor(v.palette[key], hueShift, lightShift);
  }

  const hasAtmosphere = v.atmosphere && prng.chance(v.atmosphereChance);

  return {
    type: effectiveType,
    variant: v.name,
    hasTerrain: true,
    planetRadius,
    maxElevation,
    // Craters and canyons can cut a bit below the abyssal floor
    minElevation: -maxElevation * (oceanDepth + 0.4),
    elevationScale,
    oceanFraction: pick(v.oceanFraction),
    oceanDepth,
    seaSurface: v.seaSurface,
    continentFreq: pick(v.continentFreq),
    warp: pick(v.warp),
    plainsHeight: pick(v.plainsHeight),
    mountainHeight: pick(v.mountainHeight),
    mountainFreq: pick(v.mountainFreq),
    beltFreq: pick(v.beltFreq),
    beltWidth: pick(v.beltWidth),
    ruggedness: pick(v.ruggedness),
    basinMountains: v.basinMountains,
    hillAmp: pick(v.hillAmp),
    hillFreq: pick(v.hillFreq),
    craterWeight: pick(v.craterWeight),
    craterCount: pickInt(v.craterCount),
    smallCraterCount: pickInt(v.smallCraterCount),
    volcanoCount: pickInt(v.volcanoCount),
    volcanoHeight: pick(v.volcanoHeight),
    terraceSteps: pickInt(v.terraceSteps),
    terraceAmount: v.terraceAmount,
    canyonDepth: pick(v.canyonDepth),
    canyonFreq: pick(v.canyonFreq),
    canyonWidth: pick(v.canyonWidth),
    duneAmp: pick(v.duneAmp),
    duneFreq: pick(v.duneFreq),
    mariaFlatten: v.mariaFlatten,
    polarIce: v.polarIce ? v.polarIce + prng.range(-0.04, 0.04) : 0,
    liquid: v.liquid ? { ...v.liquid } : null,
    climate: {
      ...v.climate,
      snowTemp: v.climate.snowTemp + prng.range(-0.05, 0.05)
    },
    atmosphere: hasAtmosphere
      ? { ...v.atmosphere, density: v.atmosphere.density * prng.range(0.85, 1.15) }
      : null,
    palette,
    seedNum: typeof seed === 'number' ? seed : hashSeed(seed)
  };
}

function pickWeighted(prng, list) {
  const total = list.reduce((s, item) => s + item.weight, 0);
  let r = prng.next() * total;
  for (const item of list) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return list[list.length - 1];
}

const _hsl = { h: 0, s: 0, l: 0 };
const _jitter = new THREE.Color();
function jitterColor(hex, hueShift, lightShift) {
  _jitter.setHex(hex).getHSL(_hsl);
  _jitter.setHSL((_hsl.h + hueShift + 1) % 1, _hsl.s, Math.min(1, Math.max(0, _hsl.l + lightShift)));
  return _jitter.getHex();
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
