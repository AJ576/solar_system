import * as THREE from 'three';
import { generateSolarSystemData, buildSolarSystemMeshes } from './systems/solarSystemGenerator.js';
import { updateOrbits, getPlanetPosition } from './physics/orbitalPhysics.js';
import { CelestialBodies } from './systems/celestialBodies.js';
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

    // 1. Scene, camera, renderer. 1 u = 1 km; systems span a few hundred thousand units.
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 4e6);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // 2. Background, local dust, ship
    this.environment = createEnvironment(this.scene);
    this.spaceDust = new SpaceDust(this.scene, 800, 45.0);

    this.spaceship = createSpaceship();
    this.scene.add(this.spaceship.mesh);
    this.controls = new SpaceshipControls(this.spaceship, this.camera, this.canvas);
    this.controls.onEvent = (type, detail) => this.onFlightEvent(type, detail);

    // 3. Solar system + body registry + targeting
    this.totalSimTime = 0;
    this.systemData = generateSolarSystemData('Sol-Prime-42');
    this.systemMeshes = buildSolarSystemMeshes(this.systemData, this.scene);
    updateOrbits(this.systemMeshes, this.systemData, 0, this.totalSimTime);
    this.bodies = new CelestialBodies(this.systemData, this.systemMeshes);
    this.targeting = new TargetingSystem(this.bodies);

    // 4. HUD
    this.hud = new HUD(this.hudContainer, {
      onJump: (seed) => this.hyperspace.initiateJump(seed),
      onTargetNext: () => this.notifyTarget(this.targeting.selectNext()),
      onTargetPrev: () => this.notifyTarget(this.targeting.selectPrev()),
      onTargetSelect: (id) => this.notifyTarget(this.targeting.selectById(id))
    });

    // 5. Hyperspace: swaps the system mid-warp and hands control back to us for placement
    this.hyperspace = new HyperspaceManager(
      this.scene,
      this.camera,
      this.controls,
      (newSystemData, newSystemMeshes) => this.onSystemChanged(newSystemData, newSystemMeshes),
      this.systemData,
      this.systemMeshes
    );

    this.enterSystem();
    this.initEvents();

    this._prevShipPos = new THREE.Vector3();
    this._toBody = new THREE.Vector3();
    this._camForward = new THREE.Vector3();

    setTimeout(() => this.hud.showNotification(`Welcome to ${this.systemData.name}`, 3500), 400);

    this.clock = new THREE.Clock();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  /**
   * Places the ship near one of the inner planets, looking at its lit side,
   * and targets it. The ship starts inside the planet's local frame, so it holds still.
   */
  enterSystem() {
    const planets = this.systemData.planets;
    const index = Math.min(1, planets.length - 1);
    const planet = planets[index];

    const planetPos = getPlanetPosition(planet, this.totalSimTime, new THREE.Vector3());
    const toStar = planetPos.clone().negate().normalize();
    const tangent = new THREE.Vector3(0, 1, 0).cross(toStar).normalize();
    const offsetDir = toStar.multiplyScalar(0.55).add(tangent.multiplyScalar(0.85)).normalize();
    offsetDir.y += 0.18;
    offsetDir.normalize();

    const viewDistance = planet.radius * 3.2 + 600;
    const shipPos = planetPos.clone().addScaledVector(offsetDir, viewDistance);

    this.controls.setPosition(shipPos.x, shipPos.y, shipPos.z);
    this.controls.lookAt(planetPos);
    this.controls.resetVelocity();

    this.bodies.sample(true);
    this.targeting.reset(`planet_${index}`);
    this.hud.setTargetList(this.targeting.getTargetList());
  }

  onSystemChanged(newSystemData, newSystemMeshes) {
    this.systemData = newSystemData;
    this.systemMeshes = newSystemMeshes;
    this.totalSimTime = 0;
    updateOrbits(this.systemMeshes, this.systemData, 0, 0);
    this.bodies.setSystem(newSystemData, newSystemMeshes);
    this.hyperspace.setCurrentSystem(newSystemData, newSystemMeshes);
    this.enterSystem();
    this.hud.showNotification(`Arrived at ${newSystemData.name}`, 3500);
  }

  notifyTarget(body) {
    if (body) this.hud.showNotification(`Target: ${body.name}`, 1600);
  }

  onFlightEvent(type, detail) {
    if (type === 'cruise-spool') {
      this.hud.showNotification('Cruise drive spooling…', 1400);
    } else if (type === 'cruise-engaged') {
      this.hud.showNotification('Cruise drive engaged', 1600);
    } else if (type === 'cruise-disengaged') {
      const reasons = {
        proximity: 'Cruise disengaged — approaching body',
        impact: 'Cruise disengaged — impact',
        brake: 'Cruise disengaged',
        manual: 'Cruise disengaged',
        cancelled: 'Cruise cancelled'
      };
      this.hud.showNotification(reasons[detail?.reason] || 'Cruise disengaged', 1800);
    }
  }

  initEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    });

    // R: target whatever is closest to the crosshair
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'KeyR' && !e.repeat) {
        this._camForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        this.notifyTarget(this.targeting.selectByRay(this.camera.position, this._camForward));
      }
    });
  }

  animate() {
    requestAnimationFrame(this.animate);

    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.totalSimTime += delta;
    const ship = this.controls.ship;

    // A. Move the bodies, then carry the ship along with its local reference frame
    updateOrbits(this.systemMeshes, this.systemData, delta, this.totalSimTime);
    this.bodies.sample();
    const { displacement, frameBody } = this.bodies.computeFrameCarry(ship.position);
    ship.position.add(displacement);

    // B. Feed the nearest body to the flight model (cruise speed limiting) and fly
    const nearest = this.bodies.findNearest(ship.position);
    if (nearest) {
      this._toBody.subVectors(nearest.body.position, ship.position).normalize();
      this.controls.setEnvironment({
        altitude: nearest.altitude,
        radius: nearest.body.radius,
        name: nearest.body.name,
        toBody: this._toBody
      });
    }
    this.controls.enabled = this.hyperspace.getState().state !== 'WARPING';
    this._prevShipPos.copy(ship.position);
    this.controls.update(delta);

    // C. Bodies are solid
    const hit = this.bodies.resolveCollision(this._prevShipPos, ship.position, this.controls.config.shipRadius);
    if (hit) {
      const impactSpeed = this.controls.applyImpact(hit.normal);
      if (impactSpeed > 15) {
        this.hud.flashImpact(Math.min(1, impactSpeed / 300));
      }
    }

    // D. Camera, then everything that depends on its final pose
    this.controls.updateCamera(delta);
    this.hyperspace.update(delta);
    this.spaceDust.update(ship.position, this.controls.velocity, this.controls.isBoosting, delta);
    this.environment.update(this.camera.position, delta);

    // E. HUD
    const telemetry = this.controls.getTelemetry();
    telemetry.nearest = nearest
      ? { name: nearest.body.name, radius: nearest.body.radius, altitude: nearest.altitude }
      : null;
    const targetTelemetry = this.targeting.getTelemetry(ship.position, this.controls.velocity, frameBody, delta);
    this.hud.update(telemetry, targetTelemetry, this.hyperspace.getState(), this.systemData, this.camera);

    this.renderer.render(this.scene, this.camera);
  }
}
