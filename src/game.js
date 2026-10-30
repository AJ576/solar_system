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
import { getTerrainAltitude } from './terrain/terrainCollision.js';
import { getSolidSurfaceHeight, getSurfaceNormal } from './terrain/terrainGenerator.js';
import { OnFootController } from './player/onFoot.js';

// G lands the ship below this altitude and speed
const ASSIST_ALTITUDE = 3;
const ASSIST_SPEED = 5;
// How close (u) you need to be to the ship to board it
const BOARDING_DISTANCE = 0.4;

export class Game {
  constructor() {
    this.canvas = document.querySelector('canvas.threejs');
    this.hudContainer = document.getElementById('hud-container');

    // 1. Scene, camera, renderer. 1 u = 100 m; systems span a few hundred thousand units.
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.004, 4e6);

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
    this.spaceDust = new SpaceDust(this.scene, 800, 4.5, 15);

    this.spaceship = createSpaceship();
    this.scene.add(this.spaceship.mesh);
    this.controls = new SpaceshipControls(this.spaceship, this.camera, this.canvas);
    this.controls.onEvent = (type, detail) => this.onFlightEvent(type, detail);
    this.onFoot = new OnFootController(this.camera, this.canvas);

    // flight | landing (settling onto the ground) | landed | foot
    this.mode = 'flight';
    this.parked = null;   // { body, localPos, localQuat } while landed or on foot
    this.landing = null;  // settle animation state
    this.shipRestHeight = this._measureShipRestHeight();
    this.shipBoxes = this._measureShipBoxes();
    this._inBelt = false;

    // Lights (N): ship headlight in flight, a lantern that lights ~100 m around you on foot
    this.lightsEnabled = false;
    this._darkHintShown = false;
    this.lantern = new THREE.PointLight(0xffe2bc, 0, 2.0, 0.6);
    this.lantern.name = 'PlayerLantern';
    this.scene.add(this.lantern);
    // Sky light near a surface: tinted by the atmosphere, brighter on denser ones
    this.skyLight = new THREE.AmbientLight(0x8a96b8, 0);
    this.skyLight.name = 'SkyLight';
    this.scene.add(this.skyLight);
    this._skyColor = new THREE.Color();
    this._sunsetColor = new THREE.Color();

    // 3. Solar system + body registry + targeting
    this.totalSimTime = 0;
    this.systemData = generateSolarSystemData('Sol-Prime-42');
    this.systemMeshes = buildSolarSystemMeshes(this.systemData, this.scene);
    updateOrbits(this.systemMeshes, this.systemData, 0, this.totalSimTime);
    this.bodies = new CelestialBodies(this.systemData, this.systemMeshes);
    this.targeting = new TargetingSystem(this.bodies);

    // 4. HUD
    this.hud = new HUD(this.hudContainer, {
      onJump: (seed) => {
        if (this.mode !== 'flight') {
          this.hud.showNotification('Take off before jumping', 1800);
          return;
        }
        this.hyperspace.initiateJump(seed);
      },
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
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._q1 = new THREE.Quaternion();
    this._m1 = new THREE.Matrix4();

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

    const viewDistance = planet.radius * 2.2;
    const shipPos = planetPos.clone().addScaledVector(offsetDir, viewDistance);

    this.controls.setPosition(shipPos.x, shipPos.y, shipPos.z);
    this.controls.lookAt(planetPos);
    this.controls.resetVelocity();

    this.bodies.sample(true);
    this.targeting.reset(`planet_${index}`);
    this.hud.setTargetList(this.targeting.getTargetList());

    // Initialize terrain LOD for the initial viewpoint
    this.updateTerrainLODs();
  }

  updateTerrainLODs() {
    const entries = this.systemMeshes?.planetEntries;
    if (!entries) return;
    const camPos = this.camera.position;
    this.systemMeshes.asteroidBelt?.update(camPos);
    for (let i = 0; i < entries.length; i++) {
      const pe = entries[i];
      if (pe.terrainLOD) pe.terrainLOD.update(camPos);
      const moons = pe.moons || [];
      for (let m = 0; m < moons.length; m++) {
        if (moons[m].terrainLOD) moons[m].terrainLOD.update(camPos);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Landing and walking
  // ---------------------------------------------------------------------------

  /** Distance from the ship origin down to the bottom of its hull. */
  _measureShipRestHeight() {
    const ship = this.controls.ship;
    const q = ship.quaternion.clone();
    const p = ship.position.clone();
    ship.quaternion.identity();
    ship.position.set(0, 0, 0);
    ship.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(ship);
    ship.quaternion.copy(q);
    ship.position.copy(p);
    ship.updateMatrixWorld(true);
    return Math.max(0.02, -box.min.y) + 0.004;
  }

  /** Solid parts of the ship as boxes in ship space (glow cones and lights excluded). */
  _measureShipBoxes() {
    const ship = this.controls.ship;
    const q = ship.quaternion.clone();
    const p = ship.position.clone();
    ship.quaternion.identity();
    ship.position.set(0, 0, 0);
    ship.updateMatrixWorld(true);
    const boxes = [];
    ship.traverse((o) => {
      if (!o.isMesh || o.material?.isShaderMaterial) return;
      const box = new THREE.Box3().setFromObject(o);
      if (!box.isEmpty()) boxes.push(box);
    });
    ship.quaternion.copy(q);
    ship.position.copy(p);
    ship.updateMatrixWorld(true);
    return boxes;
  }

  /**
   * How close to a body's surface `pos` is (1 near the ground, 0 from 0.6 R up), and how
   * high its sun is there (-1 midnight .. 1 noon).
   */
  _surfaceLightState(pos, body) {
    if (!body || body.kind === 'star') return { near: 0, sun: 1 };
    const alt = pos.distanceTo(body.position) - body.radius;
    const near = 1 - THREE.MathUtils.smoothstep(alt, body.radius * 0.15, body.radius * 0.6);
    const up = this._v3.subVectors(pos, body.position).normalize();
    const toSun = this._toBody.copy(this.systemMeshes.starMesh.getWorldPosition(this._camForward)).sub(pos).normalize();
    return { near, sun: up.dot(toSun) };
  }

  /**
   * Ambient sky light near a surface. Bodies with an atmosphere get a tinted glow at all
   * times (scattered light by day, airglow and twilight by night), scaled by how thick the
   * air is and a per-planet factor, so some worlds have bright nights and others stay
   * moody. Airless bodies only get faint starlight at night.
   */
  _updateSkyLight(nearest) {
    const body = nearest?.body;
    const { near, sun } = this._surfaceLightState(this.camera.position, body);
    if (near <= 0) {
      this.skyLight.intensity = 0;
      return 0;
    }
    const night = 1 - THREE.MathUtils.smoothstep(sun, -0.15, 0.2);
    const atmo = body.terrainProfile?.atmosphere;
    if (atmo) {
      const density = THREE.MathUtils.clamp(atmo.density, 0.3, 1.6);
      // Deterministic per-planet variation in how bright the sky glow is
      const variation = 0.7 + 0.6 * ((((body.terrainProfile.seedNum >>> 0) * 2654435761) >>> 0) / 4294967296);
      const twilight = 1 - THREE.MathUtils.smoothstep(Math.abs(sun), 0.0, 0.35);
      this._skyColor.setHex(atmo.color).lerp(this._sunsetColor.setHex(atmo.sunsetColor ?? atmo.color), twilight * 0.7);
      const strength = Math.min(1.1, density * variation);
      this.skyLight.color.copy(this._skyColor);
      this.skyLight.intensity = near * strength * (0.3 + 0.45 * night);
    } else {
      this.skyLight.color.setHex(0x8a96b8);
      this.skyLight.intensity = near * night * 0.8;
    }
    return near * night;
  }

  _updateLights(nearest) {
    const darkness = this._updateSkyLight(nearest);
    if (darkness > 0.8 && !this.lightsEnabled && !this._darkHintShown) {
      this._darkHintShown = true;
      this.hud.showNotification('Getting dark: press N for lights', 2600);
    }
    const on = this.lightsEnabled ? 1 : 0;
    this.spaceship.setHeadlights(this.mode === 'foot' ? 0 : on);
    if (this.mode === 'foot' && on) {
      // Held a little above head height so it lights the ground evenly all around
      const up = this._v3.copy(this.camera.position).sub(nearest ? nearest.body.position : this.camera.position).normalize();
      this.lantern.position.copy(this.camera.position).addScaledVector(up, 0.006);
      this.lantern.intensity = 0.35;
    } else {
      this.lantern.intensity = 0;
    }
  }

  _bodyMesh(body) {
    const mesh = body.mesh || body.object;
    mesh.updateWorldMatrix(true, false);
    return mesh;
  }

  /** Places the ship from its body-local parked transform. */
  _applyParkedTransform(localPos, localQuat, body) {
    const mesh = this._bodyMesh(body);
    const ship = this.controls.ship;
    ship.position.copy(localPos).applyMatrix4(mesh.matrixWorld);
    mesh.getWorldQuaternion(this._q1);
    ship.quaternion.copy(this._q1).multiply(localQuat);
    ship.updateMatrixWorld(true);
  }

  /** Begins settling the ship onto the surface below it. */
  startLanding(body) {
    const profile = body.terrainProfile;
    const mesh = this._bodyMesh(body);
    const ship = this.controls.ship;

    this._m1.copy(mesh.matrixWorld).invert();
    const localPos = ship.position.clone().applyMatrix4(this._m1);
    mesh.getWorldQuaternion(this._q1);
    const invBodyQuat = this._q1.clone().invert();
    const localQuat = invBodyQuat.clone().multiply(ship.quaternion);

    const dir = localPos.clone().normalize();
    const h = getSolidSurfaceHeight(dir, profile.seedNum, profile);
    const toPos = dir.clone().multiplyScalar(body.radius + h + this.shipRestHeight);

    // Sit level-ish: halfway between the slope and straight up, keeping the heading
    const normal = getSurfaceNormal(dir, body.radius, profile.seedNum, profile, new THREE.Vector3());
    if (normal.dot(dir) < 0) normal.negate();
    const up = normal.lerp(dir, 0.5).normalize();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(localQuat);
    forward.addScaledVector(up, -forward.dot(up));
    if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0).addScaledVector(up, -up.x);
    forward.normalize();
    const back = forward.clone().negate();
    const right = new THREE.Vector3().crossVectors(up, back).normalize();
    const toQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back));

    const height = localPos.length() - toPos.length();
    this.landing = {
      body,
      fromPos: localPos,
      fromQuat: localQuat,
      toPos,
      toQuat,
      t: 0,
      duration: 0.8 + Math.max(0, height) * 0.5
    };
    this.controls.resetVelocity();
    this.controls.enabled = false;
    this.spaceship.setThrusterIntensity(0);
    this.mode = 'landing';
  }

  _updateLanding(dt) {
    const l = this.landing;
    l.t = Math.min(1, l.t + dt / l.duration);
    const s = l.t * l.t * (3 - 2 * l.t);
    const pos = this._v1.copy(l.fromPos).lerp(l.toPos, s);
    const quat = this._q1.copy(l.fromQuat).slerp(l.toQuat, s);
    // _applyParkedTransform overwrites _q1, so pass a copy
    this._applyParkedTransform(pos, quat.clone(), l.body);
    if (l.t >= 1) {
      this.parked = { body: l.body, localPos: l.toPos.clone(), localQuat: l.toQuat.clone() };
      this.landing = null;
      this.mode = 'landed';
      this.hud.showNotification(`Landed on ${this.parked.body.name}`, 2200);
    }
  }

  takeOff() {
    const { body, localPos } = this.parked;
    const mesh = this._bodyMesh(body);
    const up = this._v1.copy(localPos).normalize().transformDirection(mesh.matrixWorld);
    const ship = this.controls.ship;
    ship.position.addScaledVector(up, 0.3);
    this.controls.resetVelocity();
    this.controls.velocity.copy(up).multiplyScalar(4);
    this.controls.enabled = true;
    this.controls.snapCamera();
    this.parked = null;
    this.mode = 'flight';
    this.hud.showNotification('Lift off', 1200);
  }

  stepOut() {
    const { body, localPos, localQuat } = this.parked;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(localQuat);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(localQuat);
    const spawn = localPos.clone().addScaledVector(right, 0.22).addScaledVector(forward, 0.05);
    this.onFoot.enter(body, spawn, forward);
    this.onFoot.setObstacle(this.shipBoxes, localPos, localQuat);
    this.controls._onBlur();
    this.mode = 'foot';
    this.hud.showNotification('WASD to walk, Shift to run, Space to jump', 3000);
  }

  board() {
    this.onFoot.exit();
    this.onFoot.setObstacle(null);
    this.controls._onBlur();
    this.controls.snapCamera();
    this.mode = 'landed';
  }

  _distanceToParkedShip() {
    if (!this.parked) return Infinity;
    return this.onFoot.position.distanceTo(this.parked.localPos);
  }

  /** Nearest body with a solid surface we could land on, if close and slow enough. */
  _landingCandidate(nearest) {
    if (!nearest || !nearest.body.terrainProfile?.hasTerrain) return null;
    if (nearest.altitude > ASSIST_ALTITUDE) return null;
    if (this.controls.velocity.length() > ASSIST_SPEED) return null;
    return nearest.body;
  }

  _onModeKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.repeat) return;
    if (e.code === 'KeyN') {
      this.lightsEnabled = !this.lightsEnabled;
      this.hud.showNotification(this.lightsEnabled ? 'Lights on' : 'Lights off', 1200);
    } else if (e.code === 'KeyG' && this.mode === 'flight') {
      const body = this._landingCandidate(this.bodies.findNearest(this.controls.ship.position));
      if (body) this.startLanding(body);
      else this.hud.showNotification('Get within 300 m of the ground and below 500 m/s to land', 2000);
    } else if (e.code === 'KeyF') {
      if (this.mode === 'landed') this.stepOut();
      else if (this.mode === 'foot') {
        if (this._distanceToParkedShip() < BOARDING_DISTANCE) this.board();
        else this.hud.showNotification('Walk back to your ship to board', 1600);
      }
    }
  }

  _updatePrompt(nearest) {
    let prompt = null;
    let warn = false;
    if (this.mode === 'flight' && this._landingCandidate(nearest)) {
      prompt = 'G  Land';
    } else if (this.mode === 'landed') {
      prompt = 'F  Step out    W  Take off';
    } else if (this.mode === 'foot') {
      if (this.onFoot.inLava) {
        prompt = 'Standing on lava crust';
        warn = true;
      } else if (this._distanceToParkedShip() < BOARDING_DISTANCE) {
        prompt = 'F  Board ship';
      }
    }
    this.hud.setPrompt(prompt, warn);
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

    window.addEventListener('keydown', (e) => this._onModeKey(e));

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

    // A. Move the bodies
    updateOrbits(this.systemMeshes, this.systemData, delta, this.totalSimTime);
    this.bodies.sample();

    let frameBody = null;
    let nearest = null;

    if (this.mode === 'flight') {
      // Carry the ship along with its local reference frame (spinning with the surface when low)
      const carry = this.bodies.computeFrameCarry(ship.position);
      frameBody = carry.frameBody;
      ship.position.add(carry.displacement);
      if (carry.rotation) this.controls.applyFrameRotation(carry.rotation);

      // B. Feed the nearest body to the flight model (cruise speed limiting) and fly
      nearest = this.bodies.findNearest(ship.position);
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

      // C. Bodies and asteroids are solid (landing is only ever on request, with G)
      const hit = this.bodies.resolveCollision(this._prevShipPos, ship.position, this.controls.config.shipRadius);
      if (hit) {
        const impactSpeed = this.controls.applyImpact(hit.normal);
        if (impactSpeed > 3) this.hud.flashImpact(Math.min(1, impactSpeed / 60));
      }
      const belt = this.systemMeshes.asteroidBelt;
      if (belt && this.mode === 'flight') {
        const rockHit = belt.resolveCollision(ship.position, this.controls.config.shipRadius);
        if (rockHit) {
          const impactSpeed = this.controls.applyImpact(rockHit.normal);
          if (impactSpeed > 3) this.hud.flashImpact(Math.min(1, impactSpeed / 60));
        }
        const inBelt = belt.contains(ship.position);
        if (inBelt !== this._inBelt) {
          this._inBelt = inBelt;
          this.hud.showNotification(inBelt ? 'Entering asteroid belt' : 'Leaving asteroid belt', 1800);
        }
      }
    } else if (this.mode === 'landing') {
      this._updateLanding(delta);
    } else if (this.mode === 'landed') {
      this._applyParkedTransform(this.parked.localPos, this.parked.localQuat, this.parked.body);
      if (this.controls.keys.forward) this.takeOff();
    } else if (this.mode === 'foot') {
      this._applyParkedTransform(this.parked.localPos, this.parked.localQuat, this.parked.body);
      this.onFoot.update(delta);
    }
    if (!nearest) nearest = this.bodies.findNearest(this.mode === 'foot' ? this.onFoot.getWorldPosition(this._v2) : ship.position);

    // D. Camera, then everything that depends on its final pose
    if (this.mode === 'foot') {
      this.onFoot.updateCamera();
    } else {
      this.controls.updateCamera(delta);
      if (nearest && nearest.body) this._clampCameraAboveSurface(nearest.body);
    }
    this.updateTerrainLODs();
    this._updateLights(nearest);
    this.hyperspace.update(delta);
    this.spaceDust.lines.visible = this.mode === 'flight';
    this.spaceDust.update(ship.position, this.controls.velocity, this.controls.isBoosting, delta);
    this.environment.update(this.camera.position, delta);

    // E. HUD
    const telemetry = this.controls.getTelemetry();
    if (this.mode === 'foot') {
      telemetry.speed = this.onFoot.getSpeed();
      telemetry.throttle = 0;
      telemetry.pointerLocked = typeof document !== 'undefined' && !!document.pointerLockElement;
    } else if (this.mode !== 'flight') {
      telemetry.speed = 0;
    }
    telemetry.nearest = nearest && this.mode !== 'foot'
      ? { name: nearest.body.name, radius: nearest.body.radius, altitude: nearest.altitude }
      : null;
    const targetTelemetry = this.targeting.getTelemetry(
      this.mode === 'foot' ? this.camera.position : ship.position,
      this.controls.velocity, frameBody, delta
    );
    this.hud.setMode(this.mode);
    this._updatePrompt(nearest);
    this.hud.update(telemetry, targetTelemetry, this.hyperspace.getState(), this.systemData, this.camera);

    this.renderer.render(this.scene, this.camera);
  }

  _clampCameraAboveSurface(body) {
    const camPos = this.camera.position;
    const center = body.position;
    const minClearance = 0.01;
    if (body.terrainProfile?.hasTerrain) {
      const altQuery = getTerrainAltitude(body, camPos);
      if (altQuery.altitude < minClearance) {
        const radial = new THREE.Vector3().subVectors(camPos, center);
        if (radial.lengthSq() < 1e-6) radial.set(0, 1, 0);
        radial.normalize();
        camPos.copy(center).addScaledVector(radial, altQuery.surfaceRadius + minClearance);
        this.camera.updateMatrixWorld(true);
      }
    } else {
      const dist = camPos.distanceTo(center);
      const reqDist = body.radius + minClearance;
      if (dist < reqDist) {
        const radial = new THREE.Vector3().subVectors(camPos, center);
        if (radial.lengthSq() < 1e-6) radial.set(0, 1, 0);
        radial.normalize();
        camPos.copy(center).addScaledVector(radial, reqDist);
        this.camera.updateMatrixWorld(true);
      }
    }
  }
}
