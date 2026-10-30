/**
 * Graphics Quality Settings Manager
 * Provides Low, Medium, and High presets controlling:
 * - Pixel ratio (1.0, 1.5, 2.0)
 * - Atmosphere ray-march steps (6, 10, 16)
 * - Terrain refinement aggressiveness (LOD split distance factor)
 * - Space dust streak count (250, 600, 1000)
 *
 * Persisted in localStorage so preferences survive reloads.
 */

export const QUALITY_PRESETS = {
  Low: {
    label: 'Low',
    pixelRatioMax: 1.0,
    atmoSteps: 6,
    splitFactor: 1.4,
    dustCount: 250,
    description: 'Max performance for laptops and integrated GPUs'
  },
  Medium: {
    label: 'Medium',
    pixelRatioMax: 1.5,
    atmoSteps: 10,
    splitFactor: 2.0,
    dustCount: 600,
    description: 'Balanced visual fidelity and frame rate'
  },
  High: {
    label: 'High',
    pixelRatioMax: 2.0,
    atmoSteps: 16,
    splitFactor: 2.6,
    dustCount: 1000,
    description: 'Full resolution and deepest terrain detail'
  }
};

const STORAGE_KEY = 'sol_graphics_quality';

export class QualitySettings {
  constructor(initialPreset = null) {
    this.current = this._loadInitial(initialPreset);
    this.listeners = [];
  }

  _loadInitial(preset) {
    if (preset && QUALITY_PRESETS[preset]) return preset;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && QUALITY_PRESETS[saved]) return saved;
    } catch {
      // localStorage unavailable (sandboxed / tests)
    }
    // Default to Medium for smooth laptop performance
    return 'Medium';
  }

  getPreset() {
    return QUALITY_PRESETS[this.current];
  }

  getEffectivePixelRatio() {
    const maxRatio = this.getPreset().pixelRatioMax;
    const deviceRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    return Math.min(deviceRatio, maxRatio);
  }

  setQuality(level, game = null) {
    if (!QUALITY_PRESETS[level]) return;
    this.current = level;
    try {
      localStorage.setItem(STORAGE_KEY, level);
    } catch {
      // ignore
    }

    if (game) {
      this.applyToGame(game);
    }

    for (const fn of this.listeners) {
      try {
        fn(level, this.getPreset());
      } catch (err) {
        console.error('Quality listener error:', err);
      }
    }
  }

  cycleQuality(game = null) {
    const levels = ['Low', 'Medium', 'High'];
    const nextIdx = (levels.indexOf(this.current) + 1) % levels.length;
    this.setQuality(levels[nextIdx], game);
    return levels[nextIdx];
  }

  onQualityChanged(fn) {
    this.listeners.push(fn);
  }

  /**
   * Applies the active preset settings to all relevant game subsystems.
   * @param {Object} game Game instance
   */
  applyToGame(game) {
    if (!game) return;
    const preset = this.getPreset();

    // 1. Pixel Ratio
    if (game.renderer && typeof window !== 'undefined') {
      const pr = this.getEffectivePixelRatio();
      game.renderer.setPixelRatio(pr);
      game.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // 2. Space Dust Particle Count
    if (game.spaceDust && typeof game.spaceDust.setCount === 'function') {
      game.spaceDust.setCount(preset.dustCount);
    }

    // 3. Terrain LOD Aggressiveness (split factor)
    const entries = game.systemMeshes?.planetEntries || [];
    for (let i = 0; i < entries.length; i++) {
      const pe = entries[i];
      if (pe.terrainLOD) {
        pe.terrainLOD.splitFactor = preset.splitFactor;
      }
      const moons = pe.moons || [];
      for (let m = 0; m < moons.length; m++) {
        if (moons[m].terrainLOD) {
          moons[m].terrainLOD.splitFactor = preset.splitFactor;
        }
      }

      // 4. Atmosphere Ray-March Steps
      if (pe.atmoMesh?.material?.uniforms?.uSteps) {
        pe.atmoMesh.material.uniforms.uSteps.value = preset.atmoSteps;
      }
    }
  }
}
