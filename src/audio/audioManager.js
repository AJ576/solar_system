/**
 * Galactic Cruise — Refined Cinematic & Ambient Audio Engine
 *
 * Professional procedural synthesizer & sound manager:
 * 1. Shared Reverb & Echo bus:
 *    - Procedural 3.8s stereo impulse response convolver
 *    - Warm feedback delay (480ms) with lowpass damping feeding the reverb
 * 2. Tamed Engine:
 *    - Warm dual-sine reactor with audible body in 110–220 Hz range (laptop-friendly)
 *    - Fades to near-silence at zero throttle (0.008 idle)
 *    - Majestic 0.6s glide response
 *    - 10-second decorrelated noise loop
 * 3. Soft Cruise Drive:
 *    - Soft "warp whoosh" slipstream with noise filter opening with speed
 *    - Low drone anchored strictly to the music key (D) — NO tension-building pitch climbing
 *    - Spool is a deep muffled capacitor surge instead of a siren
 * 4. Ethereal Music:
 *    - Strict D Dorian modal harmony (no jarring tritone leaps)
 *    - Chords hold 22–28s with smooth 6s crossfades, picked randomly
 *    - Bass notes raised out of mud into 110–150 Hz range
 *    - Sparse high bell/chime notes echoing through delay and space reverb
 * 5. Dynamic Ambience:
 *    - Quiet, vast deep space presence
 *    - Planetary wind scaled by atmospheric density and altitude (dead quiet on airless moons)
 *    - Solar magnetosphere hum near the star
 *    - Gas giant low resonant drone
 * 6. Gentle Mixing & Tactile UI:
 *    - Transparent compressor (slow 35ms attack, 2.2:1 ratio) to eliminate pumping
 *    - Tactile cockpit instrument clicks (no harsh square waves)
 *    - Soft pneumatic airlock breath (no piercing 1.8kHz hiss)
 *    - Low-key radar avionics chirp (no loud notification ding)
 *    - Organic suit rustle for jump (no cartoon boing)
 */

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// Pure D Dorian Modal Chords (Bass raised to octave 2/3 so audible on laptops)
// Scale: D, E, F, G, A, B, C (all natural keys, anchored to D)
// ---------------------------------------------------------------------------
const SPACE_CHORDS = [
  // 0. Dm9: D3, A3, C4, E4, F4
  { name: 'Dm9', bass: 50, notes: [57, 60, 64, 65] },
  // 1. G9/D: D3, G3, B3, D4, E4
  { name: 'G9/D', bass: 50, notes: [55, 59, 62, 64] },
  // 2. Cmaj9: C3, G3, B3, D4, E4
  { name: 'Cmaj9', bass: 48, notes: [55, 59, 62, 64] },
  // 3. F6/9: F3, A3, C4, D4, G4
  { name: 'F6/9', bass: 53, notes: [57, 60, 62, 67] },
  // 4. Am7/Asus4: A2 (110 Hz), E3, G3, C4, D4
  { name: 'Am7', bass: 45, notes: [52, 55, 60, 62] },
  // 5. Dsus2/Dm11: D3, A3, C4, D4, G4
  { name: 'Dm11', bass: 50, notes: [57, 60, 62, 67] },
];

// Sparse high chime notes in D Dorian Pentatonic (D5, E5, G5, A5, C6, D6)
const CHIME_NOTES = [74, 76, 79, 81, 84, 86];

/**
 * Creates a procedural stereo impulse response for vast, lush space reverb
 */
function createReverbImpulse(ctx, duration = 3.8, decay = 2.6) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * (3.0 / decay));
    // Air absorption: high frequencies decay faster
    const damping = Math.exp(-t * 1.8);
    left[i] = (Math.random() * 2 - 1) * damping * envelope;
    right[i] = (Math.random() * 2 - 1) * damping * envelope;
  }
  return impulse;
}

/**
 * Creates a seamless 10-second high-precision pink/brown noise buffer
 */
function createNoiseBuffer(ctx, duration = 10.0) {
  const sampleRate = ctx.sampleRate;
  const bufferSize = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
  const output = buffer.getChannelData(0);

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
  return buffer;
}

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;
    this.muted = false;

    // Bus Gains
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.ambienceGain = null;
    this.compressor = null;

    // Shared Reverb & Delay Nodes
    this.convolver = null;
    this.reverbGain = null;
    this.delayNode = null;
    this.delayFeedback = null;
    this.delayFilter = null;
    this.delayOutput = null;

    // Shared 10s Noise Buffer
    this.noiseBuffer = null;

    // Tamed Flight Engine State
    this.engine = {
      gainNode: null,
      primaryOsc: null,   // Warm sine ~110-146 Hz (audible on laptops)
      harmonicOsc: null,  // Second harmonic ~220-292 Hz for gentle purr
      subOsc: null,       // Sub harmonic ~55-73 Hz for headphones/subs
      noiseSource: null,
      noiseFilter: null,
      noiseGain: null
    };

    // Soft Cruise Drive State
    this.cruise = {
      gainNode: null,
      droneOsc1: null,    // D2 = 73.4 Hz
      droneOsc2: null,    // D3 = 146.8 Hz
      noiseSource: null,
      noiseFilter: null,
      noiseGain: null,
      active: false
    };

    // Ambience Layer State
    this.ambience = {
      spaceSource: null,
      spaceFilter: null,
      spaceGain: null,
      atmoSource: null,
      atmoFilter: null,
      atmoGain: null,
      starOsc: null,
      starGain: null,
      gasGiantOsc: null,
      gasGiantGain: null
    };

    // On-Foot Audio State
    this.footsteps = {
      stepTimer: 0,
      stepInterval: 0.44
    };

    // Generative Music State
    this.music = {
      enabled: true,
      currentChordIndex: -1,
      timer: null,
      bellTimer: null,
      activeVoices: [],
      filter: null,
      lfo: null,
      customAudio: null,
      hasCustomTrack: false
    };

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
      const now = this.ctx.currentTime;

      // 1. Transparent Master Dynamics Compressor (gentle leveling, no pumping)
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-18, now);
      this.compressor.knee.setValueAtTime(24, now);
      this.compressor.ratio.setValueAtTime(2.2, now); // Gentle ratio
      this.compressor.attack.setValueAtTime(0.035, now); // 35ms avoids squashing transients & music
      this.compressor.release.setValueAtTime(0.28, now);
      this.compressor.connect(this.ctx.destination);

      // 2. Master Gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.72, now);
      this.masterGain.connect(this.compressor);

      // 3. Shared Reverb & Echo Network
      this._setupReverbAndEcho();

      // 4. Sub-Mix Buses
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(0.70, now);
      this.sfxGain.connect(this.masterGain);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.setValueAtTime(0.55, now);
      this.musicGain.connect(this.masterGain);

      this.ambienceGain = this.ctx.createGain();
      this.ambienceGain.gain.setValueAtTime(0.48, now);
      this.ambienceGain.connect(this.masterGain);

      // 5. Pre-generate 10-second warm noise buffer
      this.noiseBuffer = createNoiseBuffer(this.ctx, 10.0);

      // 6. Setup Audio Subsystems
      this._setupTamedEngine();
      this._setupSoftCruise();
      this._setupAmbienceLayers();
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

  // ---------------------------------------------------------------------------
  // 1. Shared Reverb & Echo Network
  // ---------------------------------------------------------------------------
  _setupReverbAndEcho() {
    const now = this.ctx.currentTime;

    // Procedural Stereo Space Convolver (3.8s tail)
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = createReverbImpulse(this.ctx, 3.8, 2.6);

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.setValueAtTime(0.42, now);
    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.masterGain);

    // Warm Echo / Delay Network (480ms repeat)
    this.delayNode = this.ctx.createDelay(2.0);
    this.delayNode.delayTime.setValueAtTime(0.48, now);

    this.delayFeedback = this.ctx.createGain();
    this.delayFeedback.gain.setValueAtTime(0.32, now);

    // Filter in feedback loop: echoes get progressively warmer/darker
    this.delayFilter = this.ctx.createBiquadFilter();
    this.delayFilter.type = 'lowpass';
    this.delayFilter.frequency.setValueAtTime(1200, now);

    this.delayNode.connect(this.delayFilter);
    this.delayFilter.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);

    // Delay output routes to master and diffuses into space reverb
    this.delayOutput = this.ctx.createGain();
    this.delayOutput.gain.setValueAtTime(0.24, now);
    this.delayFilter.connect(this.delayOutput);
    this.delayOutput.connect(this.masterGain);
    this.delayOutput.connect(this.convolver);
  }

  // ---------------------------------------------------------------------------
  // 2. Tamed Ship Engine (Warm, audible on laptops, peaceful idle)
  // ---------------------------------------------------------------------------
  _setupTamedEngine() {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    this.engine.gainNode = this.ctx.createGain();
    this.engine.gainNode.gain.setValueAtTime(0.0001, now);
    this.engine.gainNode.connect(this.sfxGain);

    // Primary warm sine in 110–146 Hz range (clearly audible on laptop speakers)
    this.engine.primaryOsc = this.ctx.createOscillator();
    this.engine.primaryOsc.type = 'sine';
    this.engine.primaryOsc.frequency.setValueAtTime(110, now);
    const primGain = this.ctx.createGain();
    primGain.gain.setValueAtTime(0.50, now);
    this.engine.primaryOsc.connect(primGain);
    primGain.connect(this.engine.gainNode);
    this.engine.primaryOsc.start(now);

    // Second harmonic in 220–292 Hz range (adds warm body and gentle purr)
    this.engine.harmonicOsc = this.ctx.createOscillator();
    this.engine.harmonicOsc.type = 'sine';
    this.engine.harmonicOsc.frequency.setValueAtTime(220, now);
    const harmGain = this.ctx.createGain();
    harmGain.gain.setValueAtTime(0.18, now);
    this.engine.harmonicOsc.connect(harmGain);
    harmGain.connect(this.engine.gainNode);
    this.engine.harmonicOsc.start(now);

    // Sub-harmonic in 55–73 Hz range (adds bottom-end weight on headphones/subs)
    this.engine.subOsc = this.ctx.createOscillator();
    this.engine.subOsc.type = 'sine';
    this.engine.subOsc.frequency.setValueAtTime(55, now);
    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(0.35, now);
    this.engine.subOsc.connect(subGain);
    subGain.connect(this.engine.gainNode);
    this.engine.subOsc.start(now);

    // Low-pass filtered noise rumble (no buzzy narrow bandpass!)
    this.engine.noiseSource = this.ctx.createBufferSource();
    this.engine.noiseSource.buffer = this.noiseBuffer;
    this.engine.noiseSource.loop = true;
    this.engine.noiseFilter = this.ctx.createBiquadFilter();
    this.engine.noiseFilter.type = 'lowpass';
    this.engine.noiseFilter.frequency.setValueAtTime(140, now);

    this.engine.noiseGain = this.ctx.createGain();
    this.engine.noiseGain.gain.setValueAtTime(0.25, now);
    this.engine.noiseSource.connect(this.engine.noiseFilter);
    this.engine.noiseFilter.connect(this.engine.noiseGain);
    this.engine.noiseGain.connect(this.engine.gainNode);
    this.engine.noiseSource.start(now);
  }

  // ---------------------------------------------------------------------------
  // 3. Soft Cruise Drive (Warp whoosh slipstream, drone anchored to D)
  // ---------------------------------------------------------------------------
  _setupSoftCruise() {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    this.cruise.gainNode = this.ctx.createGain();
    this.cruise.gainNode.gain.setValueAtTime(0.0001, now);
    this.cruise.gainNode.connect(this.sfxGain);

    // Quiet warm drones anchored to root key D (D2 = 73.4 Hz, D3 = 146.8 Hz)
    // PITCH NEVER CLIMBS WITH SPEED!
    this.cruise.droneOsc1 = this.ctx.createOscillator();
    this.cruise.droneOsc1.type = 'sine';
    this.cruise.droneOsc1.frequency.setValueAtTime(73.4, now);

    this.cruise.droneOsc2 = this.ctx.createOscillator();
    this.cruise.droneOsc2.type = 'sine';
    this.cruise.droneOsc2.frequency.setValueAtTime(146.8, now);

    const droneGain = this.ctx.createGain();
    droneGain.gain.setValueAtTime(0.35, now);
    this.cruise.droneOsc1.connect(droneGain);
    this.cruise.droneOsc2.connect(droneGain);
    droneGain.connect(this.cruise.gainNode);
    this.cruise.droneOsc1.start(now);
    this.cruise.droneOsc2.start(now);

    // Soft low-passed noise whoosh (opens with speed from 140 Hz to ~380 Hz)
    this.cruise.noiseSource = this.ctx.createBufferSource();
    this.cruise.noiseSource.buffer = this.noiseBuffer;
    this.cruise.noiseSource.loop = true;
    this.cruise.noiseFilter = this.ctx.createBiquadFilter();
    this.cruise.noiseFilter.type = 'lowpass';
    this.cruise.noiseFilter.frequency.setValueAtTime(150, now);

    this.cruise.noiseGain = this.ctx.createGain();
    this.cruise.noiseGain.gain.setValueAtTime(0.40, now);
    this.cruise.noiseSource.connect(this.cruise.noiseFilter);
    this.cruise.noiseFilter.connect(this.cruise.noiseGain);
    this.cruise.noiseGain.connect(this.cruise.gainNode);
    // Decorrelate phase by starting at an offset
    this.cruise.noiseSource.start(now);
  }

  // ---------------------------------------------------------------------------
  // 4. Ambience Engine (Space void, planetary wind, star hum, gas giant drone)
  // ---------------------------------------------------------------------------
  _setupAmbienceLayers() {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // A. Deep Space Void (subtle, vast low presence)
    this.ambience.spaceSource = this.ctx.createBufferSource();
    this.ambience.spaceSource.buffer = this.noiseBuffer;
    this.ambience.spaceSource.loop = true;
    this.ambience.spaceFilter = this.ctx.createBiquadFilter();
    this.ambience.spaceFilter.type = 'bandpass';
    this.ambience.spaceFilter.frequency.setValueAtTime(160, now);
    this.ambience.spaceFilter.Q.setValueAtTime(0.9, now);

    this.ambience.spaceGain = this.ctx.createGain();
    this.ambience.spaceGain.gain.setValueAtTime(0.04, now);
    this.ambience.spaceSource.connect(this.ambience.spaceFilter);
    this.ambience.spaceFilter.connect(this.ambience.spaceGain);
    this.ambience.spaceGain.connect(this.ambienceGain);
    this.ambience.spaceSource.start(now);

    // B. Planetary Surface Wind (active only on bodies with atmosphere)
    this.ambience.atmoSource = this.ctx.createBufferSource();
    this.ambience.atmoSource.buffer = this.noiseBuffer;
    this.ambience.atmoSource.loop = true;
    this.ambience.atmoFilter = this.ctx.createBiquadFilter();
    this.ambience.atmoFilter.type = 'lowpass';
    this.ambience.atmoFilter.frequency.setValueAtTime(260, now);

    this.ambience.atmoGain = this.ctx.createGain();
    this.ambience.atmoGain.gain.setValueAtTime(0.0001, now);
    this.ambience.atmoSource.connect(this.ambience.atmoFilter);
    this.ambience.atmoFilter.connect(this.ambience.atmoGain);
    this.ambience.atmoGain.connect(this.ambienceGain);
    this.ambience.atmoSource.start(now);

    // C. Solar Magnetosphere Hum (warm radiant drone near star)
    this.ambience.starOsc = this.ctx.createOscillator();
    this.ambience.starOsc.type = 'sine';
    this.ambience.starOsc.frequency.setValueAtTime(110, now); // A2

    this.ambience.starGain = this.ctx.createGain();
    this.ambience.starGain.gain.setValueAtTime(0.0001, now);
    this.ambience.starOsc.connect(this.ambience.starGain);
    this.ambience.starGain.connect(this.ambienceGain);
    this.ambience.starGain.connect(this.convolver); // Reverb warmth
    this.ambience.starOsc.start(now);

    // D. Gas Giant Planetary Resonance (deep majestic magnetic hum)
    this.ambience.gasGiantOsc = this.ctx.createOscillator();
    this.ambience.gasGiantOsc.type = 'sine';
    this.ambience.gasGiantOsc.frequency.setValueAtTime(82.4, now); // E2

    this.ambience.gasGiantGain = this.ctx.createGain();
    this.ambience.gasGiantGain.gain.setValueAtTime(0.0001, now);
    this.ambience.gasGiantOsc.connect(this.ambience.gasGiantGain);
    this.ambience.gasGiantGain.connect(this.ambienceGain);
    this.ambience.gasGiantOsc.start(now);
  }

  // ---------------------------------------------------------------------------
  // Frame-by-frame Audio Updates
  // ---------------------------------------------------------------------------
  updateFlightAudio({
    mode = 'flight',
    throttle = 0,
    speed = 0,
    isBoosting = false,
    cruiseSpool = 0,
    isCruise = false,
    atmoDensity = 0,
    altitude = Infinity,
    bodyRadius = 1,
    nearestBody = null,
    starPos = null,
    camPos = null
  }) {
    if (!this.ensureContext() || !this.engine.gainNode) return;
    const now = this.ctx.currentTime;
    // Majestic, peaceful gliding time constant (0.6s)
    const smoothTau = 0.6;

    // 1. ENGINE UPDATE
    if (mode === 'flight') {
      const normThrottle = Math.max(0, Math.min(1, Math.abs(throttle)));

      // At zero throttle: drop to near silence (0.008 idle purr)
      let targetEngineVol = 0.008;
      if (normThrottle > 0.01) {
        targetEngineVol = 0.01 + normThrottle * 0.17;
      }
      if (isBoosting) targetEngineVol = 0.28;
      if (isCruise) targetEngineVol = 0.015; // Engine stays very quiet during cruise

      // Pitches stay in pleasant, laptop-audible warm range:
      // Primary: 110 Hz idle up to 138 Hz max throttle (+20 Hz on boost)
      const primPitch = 110 + normThrottle * 28 + (isBoosting ? 20 : 0);
      const harmPitch = primPitch * 2;
      const subPitch = primPitch * 0.5;

      // Filter cutoff stays warm: 130 Hz up to 260 Hz (no high-frequency harshness)
      const noiseCutoff = 130 + normThrottle * 130 + (isBoosting ? 90 : 0);

      this.engine.primaryOsc.frequency.setTargetAtTime(primPitch, now, smoothTau);
      this.engine.harmonicOsc.frequency.setTargetAtTime(harmPitch, now, smoothTau);
      this.engine.subOsc.frequency.setTargetAtTime(subPitch, now, smoothTau);
      this.engine.noiseFilter.frequency.setTargetAtTime(noiseCutoff, now, smoothTau);
      this.engine.gainNode.gain.setTargetAtTime(targetEngineVol, now, smoothTau);
    } else {
      // Landed or on foot: engine fades out peacefully
      this.engine.gainNode.gain.setTargetAtTime(0.0001, now, 0.4);
    }

    // 2. CRUISE UPDATE (Soft warp whoosh, D drone, pitch never climbs)
    if (mode === 'flight' && (isCruise || cruiseSpool > 0)) {
      let cruiseVol = 0.0001;
      let filterCutoff = 150;

      if (cruiseSpool > 0) {
        cruiseVol = 0.10 * cruiseSpool;
        filterCutoff = 150 + cruiseSpool * 120;
      } else if (isCruise) {
        // Volume and low-pass filter open smoothly with speed (never exceeds 400 Hz)
        const speedNorm = Math.min(1, speed / 12000);
        cruiseVol = 0.10 + speedNorm * 0.08;
        filterCutoff = 160 + speedNorm * 220; // 160 Hz -> 380 Hz
      }

      this.cruise.noiseFilter.frequency.setTargetAtTime(filterCutoff, now, 0.4);
      this.cruise.gainNode.gain.setTargetAtTime(cruiseVol, now, 0.4);
    } else {
      this.cruise.gainNode.gain.setTargetAtTime(0.0001, now, 0.4);
    }

    // 3. AMBIENCE UPDATE
    // A. Planetary Wind (scaled by atmosphere density and altitude)
    let atmoVol = 0.0001;
    let atmoCutoff = 220;
    if (atmoDensity > 0.05 && altitude < bodyRadius * 0.9) {
      const surfaceNearness = 1 - Math.min(1, altitude / (bodyRadius * 0.9));
      const speedFactor = mode === 'flight' ? Math.min(1, speed / 25) : 0;
      atmoVol = THREE_clamp(atmoDensity * surfaceNearness * (0.06 + speedFactor * 0.14), 0, 0.22);
      atmoCutoff = 220 + speedFactor * 320;
    }
    this.ambience.atmoFilter.frequency.setTargetAtTime(atmoCutoff, now, 0.8);
    this.ambience.atmoGain.gain.setTargetAtTime(atmoVol, now, 0.8);

    // B. Star Proximity Hum
    let starVol = 0.0001;
    if (nearestBody && nearestBody.kind === 'star' && altitude < nearestBody.radius * 6.0) {
      const starNearness = 1 - Math.min(1, altitude / (nearestBody.radius * 6.0));
      starVol = starNearness * 0.15;
    }
    this.ambience.starGain.gain.setTargetAtTime(starVol, now, 1.2);

    // C. Gas Giant Proximity Resonance
    let gasGiantVol = 0.0001;
    const isGasGiant = nearestBody && nearestBody.terrainProfile?.hasTerrain === false && nearestBody.kind !== 'star';
    if (isGasGiant && altitude < nearestBody.radius * 2.5) {
      const giantNearness = 1 - Math.min(1, altitude / (nearestBody.radius * 2.5));
      gasGiantVol = giantNearness * 0.18;
    }
    this.ambience.gasGiantGain.gain.setTargetAtTime(gasGiantVol, now, 1.2);
  }

  // ---------------------------------------------------------------------------
  // Cruise Spool (Soft, cinematic capacitor swell — NO siren)
  // ---------------------------------------------------------------------------
  playCruiseSpool(duration = 1.5) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      // Soft D drone capacitor breath (73.4 Hz and 146.8 Hz swelling gently)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(146.8, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + duration * 0.7);
      gain.gain.linearRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + duration);

      // Low-passed noise puff (opening from 100 Hz to 280 Hz)
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(100, now);
        filter.frequency.exponentialRampToValueAtTime(280, now + duration);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.001, now);
        nGain.gain.linearRampToValueAtTime(0.18, now + duration * 0.7);
        nGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        noise.connect(filter);
        filter.connect(nGain);
        nGain.connect(this.sfxGain);
        noise.start(now);
        noise.stop(now + duration);
      }
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Tactile Cockpit & UI Sounds (No harsh square waves or piercing beeps)
  // ---------------------------------------------------------------------------

  /**
   * Subtle, subdued radar avionics chirp (warm sine dual-tone at 440 -> 554 Hz)
   */
  playTargetSelect() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.4, now + 0.035);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch {}
  }

  /**
   * Tactile cockpit switch click (subtle dual-sine mechanical pulse)
   */
  playLightSwitch(on = true) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(on ? 440 : 330, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.025);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.04);
    } catch {}
  }

  /**
   * Airlock hatch: soft pneumatic breath + low relay thud (no 1.8kHz screech!)
   */
  playAirlock(isBoarding = false) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      // Soft pneumatic breath (bandpass at 650 Hz)
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(650, now);
        filter.Q.setValueAtTime(1.2, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.10, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        noise.start(now);
        noise.stop(now + 0.65);
      }

      // Soft mechanical latch relay thud (sine dropping 180 Hz -> 90 Hz)
      const latch = this.ctx.createOscillator();
      const latchGain = this.ctx.createGain();
      latch.type = 'sine';
      latch.frequency.setValueAtTime(isBoarding ? 180 : 220, now + 0.12);
      latch.frequency.exponentialRampToValueAtTime(70, now + 0.18);

      latchGain.gain.setValueAtTime(0.09, now + 0.12);
      latchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);

      latch.connect(latchGain);
      latchGain.connect(this.sfxGain);
      latch.start(now + 0.12);
      latch.stop(now + 0.21);
    } catch {}
  }

  /**
   * Jump: subtle suit movement / soft upward puff (no cartoon boing)
   */
  playJump() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(320, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        noise.start(now);
        noise.stop(now + 0.14);
      }

      const thud = this.ctx.createOscillator();
      const thudGain = this.ctx.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(75, now);
      thud.frequency.exponentialRampToValueAtTime(45, now + 0.08);

      thudGain.gain.setValueAtTime(0.08, now);
      thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

      thud.connect(thudGain);
      thudGain.connect(this.sfxGain);
      thud.start(now);
      thud.stop(now + 0.09);
    } catch {}
  }

  /**
   * Landing after jump: soft muffled ground thud
   */
  playJumpLanding() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(65, now);
      osc.frequency.exponentialRampToValueAtTime(35, now + 0.12);

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Surface & Footsteps
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
      const pitchJitter = 0.92 + Math.random() * 0.16;

      // Soft ground crunch (filtered noise at 320 Hz)
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime((isRunning ? 380 : 300) * pitchJitter, now);
        filter.Q.setValueAtTime(1.8, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(isRunning ? 0.14 : 0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        noise.start(now);
        noise.stop(now + 0.08);
      }

      // Warm low heel thud
      const thud = this.ctx.createOscillator();
      const thudGain = this.ctx.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(75 * pitchJitter, now);
      thud.frequency.exponentialRampToValueAtTime(35, now + 0.06);

      thudGain.gain.setValueAtTime(0.10, now);
      thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

      thud.connect(thudGain);
      thudGain.connect(this.sfxGain);
      thud.start(now);
      thud.stop(now + 0.07);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Impacts, Landing & Liftoff
  // ---------------------------------------------------------------------------
  playImpact(intensity = 0.5) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const power = Math.max(0.1, Math.min(1.0, intensity));

      // Deep Sub Thud (Sine dive)
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110 * power + 40, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.45);

      oscGain.gain.setValueAtTime(0.40 * power, now);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

      osc.connect(oscGain);
      oscGain.connect(this.sfxGain);
      oscGain.connect(this.convolver); // Impact washes naturally into reverb
      osc.start(now);
      osc.stop(now + 0.5);

      // Lowpass metallic impact noise (350 Hz, not harsh)
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(350, now);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.35 * power, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.sfxGain);
        noise.start(now);
        noise.stop(now + 0.35);
      }
    } catch {}
  }

  playLanding() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      // Soft hydraulic cushion + touchdown lock
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(380, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        noise.start(now);
        noise.stop(now + 0.75);
      }

      const clunk = this.ctx.createOscillator();
      const clunkGain = this.ctx.createGain();
      clunk.type = 'sine';
      clunk.frequency.setValueAtTime(80, now + 0.15);
      clunk.frequency.exponentialRampToValueAtTime(32, now + 0.45);

      clunkGain.gain.setValueAtTime(0.25, now + 0.15);
      clunkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

      clunk.connect(clunkGain);
      clunkGain.connect(this.sfxGain);
      clunk.start(now + 0.15);
      clunk.stop(now + 0.55);
    } catch {}
  }

  playTakeoff() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      if (this.noiseBuffer) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(140, now);
        filter.frequency.exponentialRampToValueAtTime(380, now + 0.7);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.01, now);
        gain.gain.linearRampToValueAtTime(0.25, now + 0.4);
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
  // Hyperspace Audio Transitions
  // ---------------------------------------------------------------------------
  playCharging(duration = 1.2) {
    this.playHyperspaceCharge(duration);
  }

  playHyperspaceCharge(duration = 1.2) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + duration);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(240, now);
      filter.frequency.exponentialRampToValueAtTime(750, now + duration);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.24, now + duration * 0.85);
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
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 1.2);

      gain.gain.setValueAtTime(0.42, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      gain.connect(this.convolver);
      osc.start(now);
      osc.stop(now + 1.45);
    } catch {}
  }

  playArrival(duration = 1.0) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + duration * 0.85);

      gain.gain.setValueAtTime(0.20, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      gain.connect(this.convolver);
      osc.start(now);
      osc.stop(now + duration);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // 5. Generative D Dorian Ambient Music Engine
  // ---------------------------------------------------------------------------
  _setupMusicEngine() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Master filter for lush, warm pads (breathes slowly with LFO)
    this.music.filter = this.ctx.createBiquadFilter();
    this.music.filter.type = 'lowpass';
    this.music.filter.frequency.setValueAtTime(580, now);
    this.music.filter.Q.setValueAtTime(1.2, now);

    // Filter routes directly to music bus AND washes into the reverb
    this.music.filter.connect(this.musicGain);
    const reverbSend = this.ctx.createGain();
    reverbSend.gain.setValueAtTime(0.50, now);
    this.music.filter.connect(reverbSend);
    reverbSend.connect(this.convolver);

    // Ultra-slow breathing LFO (0.035 Hz = ~28.5s cycle)
    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.035, now);
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(180, now); // Sweeps cutoff between 400 Hz and 760 Hz
    lfo.connect(lfoGain);
    lfoGain.connect(this.music.filter.frequency);
    lfo.start(now);
    this.music.lfo = lfo;

    // Check for custom music track in public/audio/
    this._probeCustomMusic();

    // Start modal chord progression
    this._playNextAmbientChord();

    // Start sparse high crystal chime notes through delay & reverb
    this._scheduleNextChime();
  }

  _probeCustomMusic() {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
    try {
      const audio = new Audio();
      audio.src = './audio/music.mp3';
      audio.loop = true;
      audio.volume = 0.5;

      audio.addEventListener('canplaythrough', () => {
        this.music.hasCustomTrack = true;
        this.music.customAudio = audio;
        if (this.ctx && !this.muted) {
          audio.play().catch(() => {});
        }
      }, { once: true });

      audio.load();
    } catch {}
  }

  _playNextAmbientChord() {
    if (!this.music.enabled || !this.ctx || this.music.hasCustomTrack) return;

    try {
      const now = this.ctx.currentTime;

      // Pick next chord randomly from other chords (never same chord twice in a row)
      const numChords = SPACE_CHORDS.length;
      let nextIndex = Math.floor(Math.random() * (numChords - 1));
      if (nextIndex >= this.music.currentChordIndex && this.music.currentChordIndex >= 0) {
        nextIndex = (nextIndex + 1) % numChords;
      }
      this.music.currentChordIndex = nextIndex;

      const chord = SPACE_CHORDS[nextIndex];

      // Hold each chord for 22–28 seconds with smooth 6-second crossfades
      const chordDuration = 24.0 + Math.random() * 4.0;
      const attack = 5.0;
      const release = 6.0;

      // Clean up past voices
      this.music.activeVoices = this.music.activeVoices.filter(v => v.endTime > now);

      // Play Root Bass Note (soft warm sine, raised to octave 2/3 so audible on laptops)
      const bassFreq = midiToFreq(chord.bass);
      const bassOsc = this.ctx.createOscillator();
      const bassGain = this.ctx.createGain();
      bassOsc.type = 'sine';
      bassOsc.frequency.setValueAtTime(bassFreq, now);

      bassGain.gain.setValueAtTime(0.0001, now);
      bassGain.gain.linearRampToValueAtTime(0.16, now + attack);
      bassGain.gain.setValueAtTime(0.16, now + chordDuration - release);
      bassGain.gain.linearRampToValueAtTime(0.0001, now + chordDuration);

      bassOsc.connect(bassGain);
      bassGain.connect(this.music.filter);
      bassOsc.start(now);
      bassOsc.stop(now + chordDuration);
      this.music.activeVoices.push({ osc: bassOsc, gain: bassGain, endTime: now + chordDuration });

      // Play Harmony Notes (gentle dual detuned sines for rich celestial chorus)
      for (let i = 0; i < chord.notes.length; i++) {
        const freq = midiToFreq(chord.notes[i]);

        for (const detune of [-3.5, 3.5]) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);
          osc.detune.setValueAtTime(detune, now);

          const peakVol = 0.045 / chord.notes.length;

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

      // Schedule next chord crossfade
      const nextTimeMs = (chordDuration - release * 0.8) * 1000;
      this.music.timer = setTimeout(() => this._playNextAmbientChord(), nextTimeMs);
    } catch {}
  }

  /**
   * Plays sparse high crystalline chime notes through delay and space reverb
   */
  _scheduleNextChime() {
    if (!this.music.enabled || !this.ctx || this.music.hasCustomTrack) return;

    // Randomized interval: every 10 to 20 seconds
    const intervalMs = (10.0 + Math.random() * 10.0) * 1000;
    this.music.bellTimer = setTimeout(() => {
      this._playHighChime();
      this._scheduleNextChime();
    }, intervalMs);
  }

  _playHighChime() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;
      const note = CHIME_NOTES[Math.floor(Math.random() * CHIME_NOTES.length)];
      const freq = midiToFreq(note);

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      // Soft envelope (15ms attack avoids click, 1.2s decay)
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.04, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

      osc.connect(gain);
      // Send directly into the delay and space reverb!
      gain.connect(this.delayNode);
      gain.connect(this.convolver);
      gain.connect(this.musicGain);

      osc.start(now);
      osc.stop(now + 1.25);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Master Mute & Volume
  // ---------------------------------------------------------------------------
  toggleMute() {
    this.ensureContext();
    this.muted = !this.muted;

    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      const targetGain = this.muted ? 0.0001 : 0.72;
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
    if (this.music.bellTimer) clearTimeout(this.music.bellTimer);
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

function THREE_clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
