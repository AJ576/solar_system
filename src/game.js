import * as THREE from 'three';
import { generateSolarSystemData, buildSolarSystemMeshes, disposeSolarSystem } from './systems/solarSystemGenerator.js';
import { updateOrbits, getNearestCelestialBody } from './physics/orbitalPhysics.js';
import { TargetingSystem } from './systems/targetingSystem.js';
import { createSpaceship } from './player/spaceship.js';
import { SpaceshipControls } from './player/controls.js';
import { HyperspaceManager } from './systems/hyperspace.js';
import { createEnvironment } from './visuals/environment.js';
import { SpaceDust } from './visuals/spaceDust.js';
import { HUD } from './ui/hud.js';

export class Game {
  constructor() {
    this.canvas = document.querySelector('canvas.threejs');
    this.hudContainer = document.getElementById('hud-container');

    // 1. Scene, Camera, Renderer (Calibrated for Canonical 20,000u Scale)
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.5,     // Near plane (never clips 0.5x ship, maximizes depth buffer precision)
      75000   // Far plane (renders full solar system without horizon culling)
    );

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true // Eliminates Z-fighting across massive 0.5 - 75000u depth range
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // 2. Visual Environment (3-tier deep space starfield, dark nebulae & ambient fill)
    this.environment = createEnvironment(this.scene);

    // 3. Local Space Dust & Optical Flow Streaks (Provides immediate velocity perception)
    this.spaceDust = new SpaceDust(this.scene, 800, 45.0);

    // 4. Spaceship & Responsive Newtonian Flight Controls
    this.spaceship = createSpaceship();
    this.scene.add(this.spaceship.mesh);

    this.controls = new SpaceshipControls(this.spaceship, this.camera, this.canvas);

    // 5. Initial Procedural Solar System (5-Tier Canonical Scale Hierarchy)
    this.currentSeed = 'Sol-Prime-42';
    this.systemData = generateSolarSystemData(this.currentSeed);
    this.systemMeshes = buildSolarSystemMeshes(this.systemData, this.scene);

    // 6. Predictable Celestial Body Targeting System
    this.targeting = new TargetingSystem(this.systemData, this.systemMeshes);

    // Position player ship at sensible entry point in the initial system
    this.positionPlayerInSystem();

    // 7. Hyperspace Transition Manager
    this.hyperspace = new HyperspaceManager(
      this.scene,
      this.camera,
      this.controls,
      (newSystemData, newSystemMeshes) => {
        this.systemData = newSystemData;
        this.systemMeshes = newSystemMeshes;
        this.currentSeed = newSystemData.seed;
        this.targeting.setSystem(newSystemData, newSystemMeshes);
        this.hyperspace.setCurrentSystem(newSystemData, newSystemMeshes);

        if (this.hud) {
          this.hud.showNotification(`ARRIVED AT ${newSystemData.name.toUpperCase()}`, 3500);
        }
      },
      this.systemData,
      this.systemMeshes
    );

    // 8. Sci-Fi HUD Overlay with Heading, Velocity & Target Markers
    this.hud = new HUD(
      this.hudContainer,
      (targetSeed) => {
        if (!this.hyperspace.isTransitioning()) {
          this.hyperspace.initiateJump(targetSeed);
        }
      },
      () => {
        const next = this.targeting.selectNext();
        if (next && this.hud) {
          this.hud.showNotification(`TARGET: ${next.name.toUpperCase()}`, 2000);
        }
      },
      () => {
        const prev = this.targeting.selectPrev();
        if (prev && this.hud) {
          this.hud.showNotification(`TARGET: ${prev.name.toUpperCase()}`, 2000);
        }
      }
    );

    // 9. Event Listeners
    this.initEvents();

    // 10. Simulation Clock
    this.clock = new THREE.Clock();
    this.totalSimTime = 0;

    // 10. Initial Welcome notification
    setTimeout(() => {
      if (this.hud && this.systemData) {
        this.hud.showNotification(`SYSTEM: ${this.systemData.name.toUpperCase()}`, 3500);
      }
    }, 500);

    // 11. Start Game Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  positionPlayerInSystem() {
    // Position outside stellar corona, facing inwards towards star and inner planets
    const starRadius = (this.systemData.star && this.systemData.star.radius) || 400;
    const entryDistance = Math.max(900, starRadius * 2.2 + 350);
    const startX = entryDistance * 0.85;
    const startZ = entryDistance * 0.55;
    const startY = 35;

    this.controls.setPosition(startX, startY, startZ);
    this.controls.lookAt(new THREE.Vector3(0, 0, 0));
    this.controls.resetVelocity();
  }

  initEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    });

    // Global Hyperspace trigger key
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input field
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.key === 'h' || e.key === 'H') {
        if (!this.hyperspace.isTransitioning()) {
          this.hyperspace.initiateJump();
        }
      }
    });
  }

  animate() {
    requestAnimationFrame(this.animate);

    // Clamp delta time to avoid physics tunneling during tab switches or frame spikes
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.totalSimTime += delta;

    // A. Update Orbital Mechanics (Planets, Moons & Differential Clouds via Keplerian laws)
    if (this.systemMeshes && this.systemData) {
      updateOrbits(this.systemMeshes, this.systemData, delta, this.totalSimTime);
    }

    // B. Update Spaceship Flight Controls & Follow Camera
    this.controls.update(delta);

    // C. Update Local Space Dust (Streaks past ship to communicate physical velocity)
    const shipPos = this.controls.getPosition();
    if (this.spaceDust) {
      this.spaceDust.update(shipPos, this.controls.velocity, this.controls.isBoosting, delta);
    }

    // D. Update Hyperspace Transition Manager & Visual Effects
    this.hyperspace.update(delta);

    // E. Update Environment (keeps infinite starfield centered on camera)
    if (this.environment && typeof this.environment.update === 'function') {
      this.environment.update(this.camera.position, delta);
    }

    // F. Deliberate Celestial Body Targeting Query
    const targetingTelemetry = this.targeting
      ? this.targeting.getTelemetry(shipPos, this.controls.velocity)
      : getNearestCelestialBody(shipPos, this.systemMeshes, this.systemData);

    // G. Update Sci-Fi HUD Telemetry, Direction Indicators & Radar
    const telemetry = this.controls.getTelemetry();
    const hyperspaceState = this.hyperspace.getState();
    this.hud.update(telemetry, targetingTelemetry, hyperspaceState, this.systemData, this.camera);

    // H. Render Scene
    this.renderer.render(this.scene, this.camera);
  }
}
