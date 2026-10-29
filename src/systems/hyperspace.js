import * as THREE from 'three';
import { createPRNG } from '../utils/random.js';
import { generateSolarSystemData, buildSolarSystemMeshes, disposeSolarSystem } from './solarSystemGenerator.js';

/**
 * Hyperspace Transition States
 */
export const HyperspaceState = Object.freeze({
  IDLE: 'IDLE',
  CHARGING: 'CHARGING',
  WARPING: 'WARPING',
  ARRIVING: 'ARRIVING'
});

// Phase Durations in seconds
export const CHARGING_DURATION = 1.2;
export const WARPING_DURATION = 1.8;
export const ARRIVING_DURATION = 1.0;
export const TOTAL_TRANSITION_DURATION = CHARGING_DURATION + WARPING_DURATION + ARRIVING_DURATION;

/**
 * Procedural Web Audio Synthesizer for Hyperspace Sound Effects
 * Generates dynamic sci-fi audio cues without external assets.
 */
class HyperspaceAudio {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;
  }

  init() {
    if (this.isInitialized) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
        this.isInitialized = true;
      }
    } catch {
      // Audio not supported or blocked
    }
  }

  ensureContext() {
    if (!this.isInitialized) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx && this.ctx.state === 'running';
  }

  playCharging(duration = CHARGING_DURATION) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;

      // 1. Rising Drive Spin-Up Oscillator
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.exponentialRampToValueAtTime(750, now + duration);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(250, now);
      filter.frequency.exponentialRampToValueAtTime(3200, now + duration);
      filter.Q.setValueAtTime(3.0, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.2, now + duration * 0.85);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Gracefully ignore audio errors
    }
  }

  playWarpBoom() {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;

      // 1. Sub-bass punch
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.9);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 1.2);
    } catch {
      // Gracefully ignore audio errors
    }
  }

  playArrival(duration = ARRIVING_DURATION) {
    if (!this.ensureContext()) return;
    try {
      const now = this.ctx.currentTime;

      // Decelerating resonance hum
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + duration * 0.85);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Gracefully ignore audio errors
    }
  }

  dispose() {
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {
        // Ignore
      }
      this.ctx = null;
      this.isInitialized = false;
    }
  }
}

/**
 * HyperspaceManager
 * Orchestrates interstellar jump transitions, camera effects, star streak particles,
 * and procedural solar system reconstruction.
 */
export class HyperspaceManager {
  /**
   * @param {THREE.Scene} scene - Active Three.js scene
   * @param {THREE.PerspectiveCamera} camera - Main rendering camera
   * @param {Object} spaceshipControls - Player spaceship controls instance
   * @param {Function} onSystemChanged - Callback invoked when a new solar system is loaded
   * @param {Object} [initialSystemData=null] - Optional initial system data
   * @param {Object} [initialSystemMeshes=null] - Optional initial system meshes
   */
  constructor(scene, camera, spaceshipControls, onSystemChanged, initialSystemData = null, initialSystemMeshes = null) {
    this.scene = scene;
    this.camera = camera;
    this.spaceshipControls = spaceshipControls;
    this.onSystemChanged = onSystemChanged;

    // State Tracking
    this.state = HyperspaceState.IDLE;
    this.stateTimer = 0;
    this.currentSeed = initialSystemData?.seed || 'Sol-Prime-42';
    this.targetSeed = null;

    // System References
    this.currentSystemData = initialSystemData || null;
    this.currentSystemMeshes = initialSystemMeshes || null;
    this.hasSystemTransitionOccurred = false;

    // Camera Effect Management
    this.baseFov = camera.fov || 60;
    this.lastShakeOffset = new THREE.Vector3();

    // Audio SFX Synthesizer
    this.audio = new HyperspaceAudio();

    // Hyperspace Visuals (Star Streaks & Warp Tunnel)
    this.initVisualEffects();

    // Screen Warp Flash Overlay
    this.initFlashOverlay();
  }

  /**
   * Sets or updates current system references
   */
  setCurrentSystem(systemData, systemMeshes) {
    this.currentSystemData = systemData;
    this.currentSystemMeshes = systemMeshes;
    if (systemData && systemData.seed !== undefined && systemData.seed !== null) {
      this.currentSeed = systemData.seed;
    }
  }

  /**
   * Updates reference to spaceship controls
   */
  setSpaceshipControls(controls) {
    this.spaceshipControls = controls;
  }

  /**
   * Sets callback for system transitions
   */
  setOnSystemChanged(callback) {
    this.onSystemChanged = callback;
  }

  /**
   * Returns current transition state and progress telemetry
   * @returns {{ state: string, progress: number, overallProgress: number, currentSeed: any, targetSeed: any }}
   */
  getState() {
    let stateProgress = 0;
    let overallProgress = 0;

    if (this.state === HyperspaceState.CHARGING) {
      stateProgress = Math.min(1, Math.max(0, this.stateTimer / CHARGING_DURATION));
      overallProgress = this.stateTimer / TOTAL_TRANSITION_DURATION;
    } else if (this.state === HyperspaceState.WARPING) {
      stateProgress = Math.min(1, Math.max(0, this.stateTimer / WARPING_DURATION));
      overallProgress = (CHARGING_DURATION + this.stateTimer) / TOTAL_TRANSITION_DURATION;
    } else if (this.state === HyperspaceState.ARRIVING) {
      stateProgress = Math.min(1, Math.max(0, this.stateTimer / ARRIVING_DURATION));
      overallProgress = (CHARGING_DURATION + WARPING_DURATION + this.stateTimer) / TOTAL_TRANSITION_DURATION;
    }

    return {
      state: this.state,
      progress: stateProgress,
      overallProgress: Math.min(1, Math.max(0, overallProgress)),
      currentSeed: this.currentSeed,
      targetSeed: this.targetSeed
    };
  }

  /**
   * Returns whether a hyperspace jump sequence is active
   * @returns {boolean}
   */
  isTransitioning() {
    return this.state !== HyperspaceState.IDLE;
  }

  /**
   * Initiates a hyperspace jump to a target seed.
   * If customSeed is omitted or null, generates a random seed.
   * 
   * @param {string|number|null} [customSeed=null]
   * @returns {boolean} True if jump initiated, false if transition already in progress
   */
  initiateJump(customSeed = null) {
    if (this.isTransitioning()) {
      return false;
    }

    // Determine target seed
    if (customSeed !== null && customSeed !== undefined && customSeed !== '') {
      this.targetSeed = customSeed;
    } else {
      // Generate reproducible random seed
      const prng = createPRNG(Date.now() ^ (Math.random() * 0x100000000));
      this.targetSeed = prng.rangeInt(100000, 999999);
    }

    // Start Charging Phase
    this.state = HyperspaceState.CHARGING;
    this.stateTimer = 0;
    this.hasSystemTransitionOccurred = false;

    // Cache camera base FOV
    if (this.camera && typeof this.camera.fov === 'number') {
      this.baseFov = this.camera.fov;
    }

    // Enable visual elements
    if (this.warpGroup) {
      this.warpGroup.visible = true;
    }

    // Play spin-up audio
    this.audio.playCharging(CHARGING_DURATION);

    return true;
  }

  /**
   * Initializes 3D Star Streaks and Warp Tunnel Cylinder
   * @private
   */
  initVisualEffects() {
    this.warpGroup = new THREE.Group();
    this.warpGroup.name = 'HyperspaceVisuals';
    this.warpGroup.visible = false;

    // 1. Star Streak Lines (1000 segments = 2000 vertices)
    this.streakCount = 1000;
    const vertexCount = this.streakCount * 2;
    this.streakPositions = new Float32Array(vertexCount * 3);
    this.streakColors = new Float32Array(vertexCount * 3);

    this.streakData = [];
    const colorPalette = [
      new THREE.Color(0xdfe6f2), // Cool white
      new THREE.Color(0xffffff), // Radiant White
      new THREE.Color(0xb9c6dc), // Pale steel
      new THREE.Color(0xf2e4cf)  // Warm white
    ];

    for (let i = 0; i < this.streakCount; i++) {
      // Tunnel distribution: stars concentrated in a cylinder around line of travel
      const radius = 5 + Math.pow(Math.random(), 1.5) * 65;
      const angle = Math.random() * Math.PI * 2;
      const z = -Math.random() * 500;
      const speed = 450 + Math.random() * 350;
      const lengthMult = 0.8 + Math.random() * 0.6;

      const baseColor = colorPalette[Math.floor(Math.random() * colorPalette.length)];

      this.streakData.push({
        radius,
        angle,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z,
        speed,
        lengthMult,
        baseColor
      });

      // Tail vertex (lower brightness)
      const tailIdx = i * 2 * 3;
      this.streakColors[tailIdx] = baseColor.r * 0.35;
      this.streakColors[tailIdx + 1] = baseColor.g * 0.35;
      this.streakColors[tailIdx + 2] = baseColor.b * 0.35;

      // Head vertex (full brightness)
      const headIdx = (i * 2 + 1) * 3;
      this.streakColors[headIdx] = baseColor.r;
      this.streakColors[headIdx + 1] = baseColor.g;
      this.streakColors[headIdx + 2] = baseColor.b;
    }

    this.streakGeometry = new THREE.BufferGeometry();
    this.streakGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.streakPositions, 3)
    );
    this.streakGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.streakColors, 3)
    );

    this.streakMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.streakLines = new THREE.LineSegments(this.streakGeometry, this.streakMaterial);
    this.streakLines.frustumCulled = false;
    this.warpGroup.add(this.streakLines);

    // 2. Sci-Fi Warp Cylinder Tunnel Mesh
    const tunnelGeo = new THREE.CylinderGeometry(55, 55, 700, 24, 1, true);
    tunnelGeo.rotateX(Math.PI / 2);
    this.tunnelMaterial = new THREE.MeshBasicMaterial({
      color: 0x9fb0c8,
      wireframe: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false
    });
    this.tunnelMesh = new THREE.Mesh(tunnelGeo, this.tunnelMaterial);
    this.tunnelMesh.frustumCulled = false;
    this.warpGroup.add(this.tunnelMesh);

    // Add warp container to scene
    if (this.scene) {
      this.scene.add(this.warpGroup);
    }
  }

  /**
   * Initializes Fullscreen Radial Flash Element
   * @private
   */
  initFlashOverlay() {
    if (typeof document === 'undefined') return;

    let overlay = document.getElementById('hyperspace-flash-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'hyperspace-flash-overlay';
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '9999';
      overlay.style.opacity = '0';
      overlay.style.background = 'radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 1) 0%, rgba(232, 236, 244, 0.85) 30%, rgba(40, 46, 60, 0.7) 70%, rgba(4, 5, 8, 0.95) 100%)';
      overlay.style.transition = 'opacity 0.06s linear';
      overlay.style.display = 'none';

      const hudContainer = document.getElementById('hud-container');
      if (hudContainer) {
        hudContainer.appendChild(overlay);
      } else if (document.body) {
        document.body.appendChild(overlay);
      }
    }
    this.flashOverlay = overlay;
  }

  /**
   * Advances state timer, animates visual/camera effects,
   * and executes procedural system reconstruction at the optimal moment.
   * 
   * @param {number} deltaTime
   */
  update(deltaTime) {
    // 1. The flight controls re-place the camera every frame, so last frame's shake is already gone
    this.lastShakeOffset.set(0, 0, 0);

    // 2. Idle State Check
    if (this.state === HyperspaceState.IDLE) {
      if (this.warpGroup && this.warpGroup.visible) {
        this.warpGroup.visible = false;
      }
      if (this.flashOverlay && this.flashOverlay.style.display !== 'none') {
        this.flashOverlay.style.opacity = '0';
        this.flashOverlay.style.display = 'none';
      }
      return;
    }

    const dt = Math.max(0, Math.min(deltaTime || 0.016, 0.1));
    this.stateTimer += dt;

    // Keep warp effects aligned with camera orientation and location
    if (this.warpGroup && this.camera) {
      if (this.camera.position && this.warpGroup.position?.copy) {
        this.warpGroup.position.copy(this.camera.position);
      }
      if (this.camera.quaternion && this.warpGroup.quaternion?.copy) {
        this.warpGroup.quaternion.copy(this.camera.quaternion);
      }
    }

    let shakeAmp = 0;
    let flashOpacity = 0;

    // --- PHASE 1: CHARGING (Drive spin-up, 1.2s) ---
    if (this.state === HyperspaceState.CHARGING) {
      const p = Math.min(1, this.stateTimer / CHARGING_DURATION);

      // Camera FOV compresses slightly and vibrates
      if (this.camera && typeof this.camera.fov === 'number') {
        const fovVibe = Math.sin(this.stateTimer * 45) * p * 0.7;
        this.camera.fov = this.baseFov - (p * 5.5) + fovVibe;
        if (typeof this.camera.updateProjectionMatrix === 'function') {
          this.camera.updateProjectionMatrix();
        }
      }

      // Camera shake builds up quadratically
      shakeAmp = p * p * 0.28;

      // Streaks start to appear and lightly buzz
      this.updateStreaks(dt, 0.2, 2.5);
      this.streakMaterial.opacity = p * 0.35;
      this.tunnelMaterial.opacity = p * 0.03;

      // Flash overlay builds faint anticipation in the last 25% of charging
      if (p > 0.75) {
        flashOpacity = ((p - 0.75) / 0.25) * 0.25;
      }

      if (this.stateTimer >= CHARGING_DURATION) {
        this.state = HyperspaceState.WARPING;
        this.stateTimer = 0;
        this.audio.playWarpBoom();
      }
    }

    // --- PHASE 2: WARPING (Hyperspace jump tunnel, 1.8s) ---
    else if (this.state === HyperspaceState.WARPING) {
      const p = Math.min(1, this.stateTimer / WARPING_DURATION);

      // Trigger world reconstruction behind the warp flash (around 0.25s into warp)
      if (!this.hasSystemTransitionOccurred && this.stateTimer >= 0.25) {
        this.performSystemTransition();
        this.hasSystemTransitionOccurred = true;
      }

      // Camera FOV stretches wide during hyperdrive tunnel
      if (this.camera && typeof this.camera.fov === 'number') {
        const warpFovBonus = Math.sin(p * Math.PI) * 18;
        this.camera.fov = this.baseFov + warpFovBonus;
        if (typeof this.camera.updateProjectionMatrix === 'function') {
          this.camera.updateProjectionMatrix();
        }
      }

      // Moderate high-speed rumble shake
      shakeAmp = 0.08 + Math.sin(p * Math.PI) * 0.12;

      // Fullscreen flash: blinding burst during system swap that settles to cruising glow
      if (this.stateTimer < 0.25) {
        flashOpacity = 0.3 + (this.stateTimer / 0.25) * 0.7; // 0.3 -> 1.0
      } else if (this.stateTimer < 0.6) {
        const t = (this.stateTimer - 0.25) / 0.35;
        flashOpacity = 1.0 - t * 0.65; // 1.0 -> 0.35
      } else {
        flashOpacity = 0.35;
      }

      // Star streak stretch and warp velocity
      const stretch = 30 + Math.sin(p * Math.PI) * 55;
      const speedMult = 2.0 + Math.sin(p * Math.PI) * 2.8;
      this.updateStreaks(dt, speedMult, stretch);

      this.streakMaterial.opacity = 1.0;
      this.tunnelMaterial.opacity = 0.12 * Math.sin(p * Math.PI);
      this.tunnelMesh.rotation.z += dt * 1.5;

      if (this.stateTimer >= WARPING_DURATION) {
        // Fallback check: guarantee system swap has occurred even on frame drops
        if (!this.hasSystemTransitionOccurred) {
          this.performSystemTransition();
          this.hasSystemTransitionOccurred = true;
        }
        this.state = HyperspaceState.ARRIVING;
        this.stateTimer = 0;
        this.audio.playArrival(ARRIVING_DURATION);
      }
    }

    // --- PHASE 3: ARRIVING (Deceleration into new system, 1.0s) ---
    else if (this.state === HyperspaceState.ARRIVING) {
      const p = Math.min(1, this.stateTimer / ARRIVING_DURATION);

      // Smooth camera FOV restoration
      if (this.camera && typeof this.camera.fov === 'number') {
        this.camera.fov = this.baseFov + (1 - p) * 4.5;
        if (typeof this.camera.updateProjectionMatrix === 'function') {
          this.camera.updateProjectionMatrix();
        }
      }

      // Decelerating shake settles to 0
      shakeAmp = (1 - p) * 0.12;

      // Flash smoothly dissolves away to reveal new solar system
      flashOpacity = (1 - p) * 0.45;

      // Streaks decelerate and dissolve
      const stretch = (1 - p) * 20 + 1.2;
      const speedMult = (1 - p) * 1.4;
      this.updateStreaks(dt, speedMult, stretch);

      this.streakMaterial.opacity = (1 - p) * 0.75;
      this.tunnelMaterial.opacity = (1 - p) * 0.04;
      this.tunnelMesh.rotation.z += dt * 0.5 * (1 - p);

      if (this.stateTimer >= ARRIVING_DURATION) {
        this.state = HyperspaceState.IDLE;
        this.stateTimer = 0;
        if (this.camera && typeof this.camera.fov === 'number') {
          this.camera.fov = this.baseFov;
          if (typeof this.camera.updateProjectionMatrix === 'function') {
            this.camera.updateProjectionMatrix();
          }
        }

        if (this.warpGroup) {
          this.warpGroup.visible = false;
        }
        flashOpacity = 0;
      }
    }

    // 3. Apply Camera Shake
    if (shakeAmp > 0 && this.camera?.position?.add) {
      this.lastShakeOffset.set(
        (Math.random() - 0.5) * 2 * shakeAmp,
        (Math.random() - 0.5) * 2 * shakeAmp,
        (Math.random() - 0.5) * 2 * shakeAmp
      );
      this.camera.position.add(this.lastShakeOffset);
    }

    // 4. Update Screen Flash Overlay
    if (this.flashOverlay) {
      if (flashOpacity > 0.005) {
        this.flashOverlay.style.display = 'block';
        this.flashOverlay.style.opacity = flashOpacity.toFixed(3);
      } else {
        this.flashOverlay.style.opacity = '0';
        this.flashOverlay.style.display = 'none';
      }
    }
  }

  /**
   * Updates positions of 1000 star streak lines in camera space
   * @private
   */
  updateStreaks(deltaTime, speedMultiplier, streakLength) {
    const pos = this.streakPositions;

    for (let i = 0; i < this.streakCount; i++) {
      const s = this.streakData[i];

      // Move star towards camera along +Z
      s.z += s.speed * speedMultiplier * deltaTime;

      // When streak passes behind camera, recycle back to front
      if (s.z > 30) {
        s.z = -480 - Math.random() * 40;
        s.angle += 0.08;
        s.x = Math.cos(s.angle) * s.radius;
        s.y = Math.sin(s.angle) * s.radius;
      }

      const length = streakLength * s.lengthMult;
      const tailZ = s.z - length;
      const headZ = s.z;

      // Tail vertex (trailing along -Z)
      const tailIdx = i * 2 * 3;
      pos[tailIdx] = s.x;
      pos[tailIdx + 1] = s.y;
      pos[tailIdx + 2] = tailZ;

      // Head vertex (leading)
      const headIdx = (i * 2 + 1) * 3;
      pos[headIdx] = s.x;
      pos[headIdx + 1] = s.y;
      pos[headIdx + 2] = headZ;
    }

    this.streakGeometry.attributes.position.needsUpdate = true;
  }

  /**
   * Executes solar system disposal, generation, mesh construction,
   * and invokes the change callback (which places the player).
   * @private
   */
  performSystemTransition() {
    try {
      // 1. Dispose previous system meshes cleanly
      if (!this.currentSystemMeshes && this.scene && Array.isArray(this.scene.children)) {
        const existingGroup = this.scene.children.find(c => c && c.name && c.name.startsWith('SolarSystem_'));
        const existingLight = this.scene.children.find(c => c && c.name && c.name.startsWith('StarLight_'));
        if (existingGroup || existingLight) {
          this.currentSystemMeshes = {
            group: existingGroup,
            starLight: existingLight,
            planetEntries: []
          };
        }
      }

      if (this.currentSystemMeshes) {
        disposeSolarSystem(this.currentSystemMeshes, this.scene);
        this.currentSystemMeshes = null;
      }

      // 2. Generate new procedural solar system data
      const newSystemData = generateSolarSystemData(this.targetSeed);

      // 3. Build new system meshes and add to scene
      const newSystemMeshes = buildSolarSystemMeshes(newSystemData, this.scene);

      // 4. Store references and hand placement of the player to the callback
      this.currentSystemData = newSystemData;
      this.currentSystemMeshes = newSystemMeshes;
      this.currentSeed = this.targetSeed;

      if (typeof this.onSystemChanged === 'function') {
        this.onSystemChanged(newSystemData, newSystemMeshes);
      }
    } catch (err) {
      console.error('[HyperspaceManager] Failed to transition solar system:', err);
    }
  }

  /**
   * Disposes all Three.js geometries, materials, audio context, and DOM elements
   */
  dispose() {
    // Restore camera
    if (this.camera) {
      if (this.lastShakeOffset.lengthSq() > 0) {
        this.camera.position.sub(this.lastShakeOffset);
        this.lastShakeOffset.set(0, 0, 0);
      }
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }

    // Clean up Three.js visuals
    if (this.warpGroup) {
      if (this.scene) {
        this.scene.remove(this.warpGroup);
      }
      if (this.streakGeometry) this.streakGeometry.dispose();
      if (this.streakMaterial) this.streakMaterial.dispose();
      if (this.tunnelMesh) {
        if (this.tunnelMesh.geometry) this.tunnelMesh.geometry.dispose();
        if (this.tunnelMaterial) this.tunnelMaterial.dispose();
      }
      this.warpGroup = null;
    }

    // Clean up DOM flash overlay
    if (this.flashOverlay && this.flashOverlay.parentElement) {
      this.flashOverlay.parentElement.removeChild(this.flashOverlay);
      this.flashOverlay = null;
    }

    // Dispose Audio
    if (this.audio) {
      this.audio.dispose();
    }
  }
}

export default HyperspaceManager;
