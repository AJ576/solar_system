/**
 * Galactic Cruise — Procedural Audio & Music Engine
 *
 * Full procedural synthesizer & sound manager built with the Web Audio API:
 * - Dynamic flight audio (reactive engine hum, turbine whine, boost afterburner, thrusters)
 * - Atmospheric flight (re-entry wind rush dynamically scaled by speed and atmospheric density)
 * - Cruise drive (spool-up whine, slipstream drone, dropout surge)
 * - Kinetic impacts & collisions (low-frequency sub-thud + metallic resonance scaled to impact speed)
 * - Surface & on-foot audio (procedural footsteps with terrain cadence, jump, land, airlock hatch)
 * - Cockpit & UI avionics (targeting chimes, headlight switch, notification blips)
 * - Hyperspace jump audio (charging spin-up, warp boom, decelerating arrival hum)
 * - Generative cosmic music (lush, evolving ambient space pads with modal chord progressions)
 * - Custom soundtrack support (seamlessly plays custom audio files if placed in /audio/)
 */

// Helper to convert MIDI note number to frequency (Hz)
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Chords for generative ambient space pads (MIDI note numbers)
const SPACE_CHORDS = [
  [38, 45, 53, 60, 64], // Dm9 (D2, A2, F3, C4, E4)
  [43, 50, 57, 59, 65], // G9sus4 (G2, D3, A3, B3, F4)
  [36, 43, 52, 59, 62], // Cmaj9 (C2, G2, E3, B3, D4)
  [41, 48, 57, 64, 67], // Fmaj9#11 (F2, C3, A3, E4, G4)
  [33, 40, 48, 55, 59], // Am9 (A1, E2, C3, G3, B3)
  [34, 41, 50, 57, 60], // Bbmaj9 (Bb1, F2, D3, A3, C4)
  [40, 47, 55, 62, 66], // Em9 (E2, B2, G3, D4, F#4)
];

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;
    this.muted = false;

    // Bus Gains
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.compressor = null;

    // Shared Noise Buffer (for engine rumble, wind, footsteps, impacts)
    this.noiseBuffer = null;

    // Continuous Flight Engine State
    this.engine = {
      active: false,
      subOsc: null,
      turbineOsc: null,
      noiseSource: null,
      noiseFilter: null,
      gainNode: null,
      atmoSource: null,
      atmoFilter: null,
      atmoGain: null,
      cruiseOsc: null,
      cruiseGain: null
    };

    // On-Foot Audio State
    this.footsteps = {
      stepTimer: 0,
      stepInterval: 0.44, // walking cadence (seconds)
      lastGrounded: false
    };

    // Generative Music State
    this.music = {
      enabled: true,
      currentChordIndex: 0,
      timer: null,
      activeVoices: [],
      filter: null,
      lfo: null,
      customAudio: null,
      hasCustomTrack: false
    };

    // Auto-unlock audio on user gesture
    this._bindUnlockEvents();
  }

  _bindUnlockEvents() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'running') {
        window.removeEventListener('click', unlock);
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('touchstart', unlock);
      }
    };
    window.addEventListener('click', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
  }

  init() {
    if (this.isInitialized) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      this.ctx = new AudioContextClass();

      // 1. Dynamics Compressor to prevent clipping and give professional polish
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(18, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(4.5, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.15, this.ctx.currentTime);
      this.compressor.connect(this.ctx.destination);

      // 2. Master Gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.75, this.ctx.currentTime);
      this.masterGain.connect(this.compressor);

      // 3. SFX Bus Gain
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(0.85, this.ctx.currentTime);
      this.sfxGain.connect(this.masterGain);

      // 4. Music Bus Gain
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.setValueAtTime(0.42, this.ctx.currentTime);
      this.musicGain.connect(this.masterGain);

      // 5. Pre-generate shared warm noise buffer (2.5 seconds looped)
      this._buildNoiseBuffer();

      // 6. Setup Continuous Sound Loops (Engine, Atmospheric Wind, Cruise)
      this._setupContinuousEngines();

      // 7. Initialize Ambient Music
      this._setupMusicEngine();

      this.isInitialized = true;
    } catch (e) {
      console.warn('AudioManager initialization error:', e);
    }
  }

  ensureContext() {
    if (!this.isInitialized) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx && this.ctx.state === 'running';
  }

  _buildNoiseBuffer() {
    if (!this.ctx) return;
    const sampleRate = this.ctx.sampleRate;
    const duration = 2.5;
    const bufferSize = Math.floor(sampleRate * duration);
    this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
    const output = this.noiseBuffer.getChannelData(0);

    // Warm pinkish/brownish noise generator
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
      output[i] = pink;
    }
  }

  _setupContinuousEngines() {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // --- Ship Main Engine Loop ---
    this.engine.gainNode = this.ctx.createGain();
    this.engine.gainNode.gain.setValueAtTime(0.0001, now);
    this.engine.gainNode.connect(this.sfxGain);

    // Sub-harmonic sine (deep bass rumble)
    this.engine.subOsc = this.ctx.createOscillator();
    this.engine.subOsc.type = 'sine';
    this.engine.subOsc.frequency.setValueAtTime(45, now);
    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(0.65, now);
    this.engine.subOsc.connect(subGain);
    subGain.connect(this.engine.gainNode);
    this.engine.subOsc.start(now);

    // Turbine whine (triangle through bandpass)
    this.engine.turbineOsc = this.ctx.createOscillator();
    this.engine.turbineOsc.type = 'triangle';
    this.engine.turbineOsc.frequency.setValueAtTime(140, now);
    const turbineFilter = this.ctx.createBiquadFilter();
    turbineFilter.type = 'bandpass';
    turbineFilter.frequency.setValueAtTime(260, now);
    turbineFilter.Q.setValueAtTime(2.2, now);
    const turbineGain = this.ctx.createGain();
    turbineGain.gain.setValueAtTime(0.28, now);
    this.engine.turbineOsc.connect(turbineFilter);
    turbineFilter.connect(turbineGain);
    turbineGain.connect(this.engine.gainNode);
    this.engine.turbineOsc.start(now);

    // Jet / plasma noise roar
    this.engine.noiseSource = this.ctx.createBufferSource();
    this.engine.noiseSource.buffer = this.noiseBuffer;
    this.engine.noiseSource.loop = true;
    this.engine.noiseFilter = this.ctx.createBiquadFilter();
    this.engine.noiseFilter.type = 'lowpass';
    this.engine.noiseFilter.frequency.setValueAtTime(120, now);
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    this.engine.noiseSource.connect(this.engine.noiseFilter);
    this.engine.noiseFilter.connect(noiseGain);
    noiseGain.connect(this.engine.gainNode);
    this.engine.noiseSource.start(now);

    // --- Atmospheric Entry Wind Loop ---
    this.engine.atmoGain = this.ctx.createGain();
    this.engine.atmoGain.gain.setValueAtTime(0.0001, now);
    this.engine.atmoGain.connect(this.sfxGain);

    this.engine.atmoSource = this.ctx.createBufferSource();
    this.engine.atmoSource.buffer = this.noiseBuffer;
    this.engine.atmoSource.loop = true;
    this.engine.atmoFilter = this.ctx.createBiquadFilter();
    this.engine.atmoFilter.type = 'bandpass';
    this.engine.atmoFilter.frequency.setValueAtTime(450, now);
    this.engine.atmoFilter.Q.setValueAtTime(1.2, now);
    this.engine.atmoSource.connect(this.engine.atmoFilter);
    this.engine.atmoFilter.connect(this.engine.atmoGain);
    this.engine.atmoSource.start(now);

    // --- Cruise Drive Slipstream Hum ---
    this.engine.cruiseGain = this.ctx.createGain();
    this.engine.cruiseGain.gain.setValueAtTime(0.0001, now);
    this.engine.cruiseGain.connect(this.sfxGain);

    this.engine.cruiseOsc = this.ctx.createOscillator();
    this.engine.cruiseOsc.type = 'sine';
    this.engine.cruiseOsc.frequency.setValueAtTime(220, now);
    this.engine.cruiseOsc.connect(this.engine.cruiseGain);
    this.engine.cruiseOsc.start(now);
  }

  /**
   * Called every frame from game.js to dynamically modulate engine sounds
   */
  updateFlightAudio({
    mode = 'flight',
    throttle = 0,
    speed = 0,
    isBoosting = false,
    cruiseSpool = 0,
    isCruise = false,
    atmoDensity = 0,
    altitude = Infinity,
    bodyRadius = 1
  }) {
    if (!this.ensureContext() || !this.engine.gainNode) return;
    const now = this.ctx.currentTime;
    const timeConstant = 0.08;

    // Only flight mode has ship engine sounds
    if (mode !== 'flight') {
      this.engine.gainNode.gain.setTargetAtTime(0.0001, now, 0.1);
      this.engine.atmoGain.gain.setTargetAtTime(0.0001, now, 0.1);
      this.engine.cruiseGain.gain.setTargetAtTime(0.0001, now, 0.1);
      return;
    }

    // 1. Engine Pitch & Gain modulation
    const normThrottle = Math.max(0, Math.min(1, Math.abs(throttle)));
    const baseFreq = 42 + normThrottle * 38 + (isBoosting ? 28 : 0);
    const turbineFreq = 140 + normThrottle * 220 + (isBoosting ? 180 : 0);
    const noiseCutoff = 100 + normThrottle * 320 + (isBoosting ? 400 : 0);

    let targetEngineVol = 0.08 + normThrottle * 0.22;
    if (isBoosting) targetEngineVol = 0.42;
    if (isCruise) targetEngineVol = 0.15;

    this.engine.subOsc.frequency.setTargetAtTime(baseFreq, now, timeConstant);
    this.engine.turbineOsc.frequency.setTargetAtTime(turbineFreq, now, timeConstant);
    this.engine.noiseFilter.frequency.setTargetAtTime(noiseCutoff, now, timeConstant);
    this.engine.gainNode.gain.setTargetAtTime(targetEngineVol, now, timeConstant);

    // 2. Cruise Drive Audio Modulation
    let cruiseVol = 0.0001;
    let cruiseFreq = 220;
    if (cruiseSpool > 0) {
      cruiseVol = 0.25 * cruiseSpool;
      cruiseFreq = 180 + cruiseSpool * 600;
    } else if (isCruise) {
      cruiseVol = 0.22;
      // Frequency pitch shifts slightly with relativistic speed
      const speedK = Math.min(1, speed / 25000);
      cruiseFreq = 320 + speedK * 280;
    }
    this.engine.cruiseOsc.frequency.setTargetAtTime(cruiseFreq, now, 0.06);
    this.engine.cruiseGain.gain.setTargetAtTime(cruiseVol, now, 0.08);

    // 3. Atmospheric Wind Re-entry Rush
    let atmoVol = 0.0001;
    if (atmoDensity > 0.05 && altitude < bodyRadius * 0.8) {
      const atmoCloseness = 1 - Math.min(1, altitude / (bodyRadius * 0.8));
      const speedFactor = Math.min(1, speed / 18);
      atmoVol = Math.min(0.48, atmoDensity * atmoCloseness * speedFactor * 0.6);
      const atmoCutoff = 250 + speedFactor * 1200;
      this.engine.atmoFilter.frequency.setTargetAtTime(atmoCutoff, now, 0.1);
    }
    this.engine.atmoGain.gain.setTargetAtTime(atmoVol, now, 0.12);
  }

  // ---------------------------------------------------------------------------
  // SFX: Impact & Collisions
  // ---------------------------------------------------------------------------
  playImpact(intensity = 0.5) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const power = Math.max(0.1, Math.min(1.0, intensity));

      // 1. Deep Sub Thud (Sine pitch dive)
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120 * power + 40, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.45);

      oscGain.gain.setValueAtTime(0.45 * power, now);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

      osc.connect(oscGain);
      oscGain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.5);

      // 2. Metallic Impact Transient (Filtered noise burst)
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.setValueAtTime(450, now);
        noiseFilter.Q.setValueAtTime(3.5, now);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.6 * power, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.sfxGain);
        noise.start(now);
        noise.stop(now + 0.35);
      }
    } catch {
      // Graceful fallback
    }
  }

  // ---------------------------------------------------------------------------
  // SFX: Surface & On-Foot Exploration
  // ---------------------------------------------------------------------------

  updateFootsteps(speed, isRunning, isGrounded, dt) {
    if (!this.ensureContext()) return;
    if (!isGrounded || speed < 0.001) {
      this.footsteps.stepTimer = 0;
      return;
    }

    const interval = isRunning ? 0.32 : 0.46;
    this.footsteps.stepTimer += dt;
    if (this.footsteps.stepTimer >= interval) {
      this.footsteps.stepTimer = 0;
      this.playFootstep(isRunning);
    }
  }

  playFootstep(isRunning = false) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      // Slight pitch variation so steps don't sound repetitive
      const pitchJitter = 0.9 + Math.random() * 0.2;

      // Ground crunch (filtered noise)
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime((isRunning ? 600 : 450) * pitchJitter, now);
        filter.Q.setValueAtTime(2.0, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime((isRunning ? 0.22 : 0.14), now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        noise.start(now);
        noise.stop(now + 0.09);
      }

      // Low heel thud
      const thud = this.ctx.createOscillator();
      const thudGain = this.ctx.createGain();
      thud.type = 'triangle';
      thud.frequency.setValueAtTime(75 * pitchJitter, now);
      thud.frequency.exponentialRampToValueAtTime(35, now + 0.07);

      thudGain.gain.setValueAtTime(0.12, now);
      thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

      thud.connect(thudGain);
      thudGain.connect(this.sfxGain);
      thud.start(now);
      thud.stop(now + 0.08);
    } catch {}
  }

  playJump() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(280, now + 0.16);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.18);
    } catch {}
  }

  playJumpLanding() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.15);

      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.16);
    } catch {}
  }

  playAirlock(isBoarding = false) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      // Pneumatic pressure equalizing hiss
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(1800, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.24, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        noise.start(now);
        noise.stop(now + 0.7);
      }

      // Mechanical latch click
      const click = this.ctx.createOscillator();
      const clickGain = this.ctx.createGain();
      click.type = 'square';
      click.frequency.setValueAtTime(isBoarding ? 520 : 680, now + 0.15);
      clickGain.gain.setValueAtTime(0.08, now + 0.15);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

      click.connect(clickGain);
      clickGain.connect(this.sfxGain);
      click.start(now + 0.15);
      click.stop(now + 0.25);
    } catch {}
  }

  playLanding() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      // Hydraulic cushion hiss + gear touchdown lock
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(600, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        noise.start(now);
        noise.stop(now + 0.85);
      }

      const clunk = this.ctx.createOscillator();
      const clunkGain = this.ctx.createGain();
      clunk.type = 'sine';
      clunk.frequency.setValueAtTime(95, now + 0.2);
      clunk.frequency.exponentialRampToValueAtTime(32, now + 0.55);

      clunkGain.gain.setValueAtTime(0.35, now + 0.2);
      clunkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

      clunk.connect(clunkGain);
      clunkGain.connect(this.sfxGain);
      clunk.start(now + 0.2);
      clunk.stop(now + 0.65);
    } catch {}
  }

  playTakeoff() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      // Blast-off surge
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(180, now);
        filter.frequency.exponentialRampToValueAtTime(700, now + 0.6);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.01, now);
        gain.gain.linearRampToValueAtTime(0.38, now + 0.35);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        noise.start(now);
        noise.stop(now + 1.25);
      }
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // SFX: Avionics & Cockpit UI
  // ---------------------------------------------------------------------------
  playTargetSelect() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      // High-tech sci-fi blip (dual pitch ping)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(950, now);
      osc.frequency.setValueAtTime(1420, now + 0.04);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.13);
    } catch {}
  }

  playLightSwitch(on = true) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(on ? 720 : 540, now);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.06);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // SFX: Cruise Drive Spool
  // ---------------------------------------------------------------------------
  playCruiseSpool(duration = 1.5) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(780, now + duration);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300, now);
      filter.frequency.exponentialRampToValueAtTime(1800, now + duration);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.2, now + duration * 0.8);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + duration);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // SFX: Hyperspace Jump Transitions
  // ---------------------------------------------------------------------------
  playCharging(duration = 1.2) {
    this.playHyperspaceCharge(duration);
  }

  playHyperspaceCharge(duration = 1.2) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      // Drive Spin-Up Oscillator
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.exponentialRampToValueAtTime(850, now + duration);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(250, now);
      filter.frequency.exponentialRampToValueAtTime(3500, now + duration);
      filter.Q.setValueAtTime(3.2, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.28, now + duration * 0.85);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + duration);
    } catch {}
  }

  playWarpBoom() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      // Sub-bass warp boom
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 1.1);

      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 1.35);
    } catch {}
  }

  playArrival(duration = 1.0) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + duration * 0.85);

      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + duration);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Generative Cosmic Ambient Soundtrack / Music Engine
  // ---------------------------------------------------------------------------
  _setupMusicEngine() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Master filter for ethereal, warm cosmic space pads
    this.music.filter = this.ctx.createBiquadFilter();
    this.music.filter.type = 'lowpass';
    this.music.filter.frequency.setValueAtTime(650, now);
    this.music.filter.Q.setValueAtTime(1.5, now);
    this.music.filter.connect(this.musicGain);

    // Subtle LFO sweep on the pad filter for space shimmer
    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.08, now); // Very slow breathing (12.5s cycle)
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(120, now);
    lfo.connect(lfoGain);
    lfoGain.connect(this.music.filter.frequency);
    lfo.start(now);
    this.music.lfo = lfo;

    // Check if custom music file is provided in public/audio/
    this._probeCustomMusic();

    // Start procedural pad progression
    this._playNextAmbientChord();
  }

  _probeCustomMusic() {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
    try {
      // Look for /audio/music.mp3 or /audio/music.ogg or /audio/ambient.mp3
      const audio = new Audio();
      audio.src = './audio/music.mp3';
      audio.loop = true;
      audio.volume = 0.5;

      audio.addEventListener('canplaythrough', () => {
        this.music.hasCustomTrack = true;
        this.music.customAudio = audio;
        // Fade out generative pads when custom track is available and played
        if (this.ctx && !this.muted) {
          audio.play().catch(() => {});
        }
      }, { once: true });

      // Trigger load check silently
      audio.load();
    } catch {}
  }

  _playNextAmbientChord() {
    if (!this.music.enabled || !this.ctx || this.music.hasCustomTrack) return;

    try {
      const now = this.ctx.currentTime;
      const chord = SPACE_CHORDS[this.music.currentChordIndex];
      this.music.currentChordIndex = (this.music.currentChordIndex + 1) % SPACE_CHORDS.length;

      const chordDuration = 11.0; // seconds per chord
      const attack = 3.5;
      const release = 4.0;

      // Clean up dead voices
      this.music.activeVoices = this.music.activeVoices.filter(v => v.endTime > now);

      // Play each note of the chord with gentle detuned dual oscillators
      for (let i = 0; i < chord.length; i++) {
        const freq = midiToFreq(chord[i]);

        // Dual detuned oscillators for rich lush chorus
        for (const detune of [-4.5, 4.5]) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();

          osc.type = i === 0 ? 'sine' : 'triangle';
          osc.frequency.setValueAtTime(freq, now);
          osc.detune.setValueAtTime(detune, now);

          const peakVol = (0.05 / chord.length) * (i === 0 ? 1.6 : 1.0);

          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.linearRampToValueAtTime(peakVol, now + attack);
          gain.gain.setValueAtTime(peakVol, now + chordDuration - release);
          gain.gain.linearRampToValueAtTime(0.0001, now + chordDuration);

          osc.connect(gain);
          gain.connect(this.music.filter);

          osc.start(now);
          osc.stop(now + chordDuration);

          this.music.activeVoices.push({ osc, gain, endTime: now + chordDuration });
        }
      }

      // Schedule next chord
      const nextTimeMs = (chordDuration - release * 0.75) * 1000;
      this.music.timer = setTimeout(() => this._playNextAmbientChord(), nextTimeMs);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Master Controls & Mute
  // ---------------------------------------------------------------------------
  toggleMute() {
    this.ensureContext();
    this.muted = !this.muted;

    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      const targetGain = this.muted ? 0.0001 : 0.75;
      this.masterGain.gain.setTargetAtTime(targetGain, now, 0.05);
    }

    if (this.music.customAudio) {
      if (this.muted) {
        this.music.customAudio.pause();
      } else {
        this.music.customAudio.play().catch(() => {});
      }
    }

    return this.muted;
  }

  isMuted() {
    return this.muted;
  }

  dispose() {
    if (this.music.timer) clearTimeout(this.music.timer);
    if (this.music.customAudio) {
      try { this.music.customAudio.pause(); } catch {}
    }
    if (this.ctx) {
      try { this.ctx.close(); } catch {}
      this.ctx = null;
      this.isInitialized = false;
    }
  }
}
