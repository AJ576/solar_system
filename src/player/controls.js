import * as THREE from 'three';

/**
 * Spaceship flight model and chase camera.
 *
 * Speed is driven by a persistent throttle (W/S adjust it, X cuts it) rather than by
 * holding a key, and every speed change eases toward its target – boosting and letting
 * go of boost both ramp smoothly instead of snapping to a new cap.
 *
 * Two drive modes:
 *  - normal: up to `normalMaxSpeed`, Space boosts to `boostSpeed` while energy lasts.
 *  - cruise: fast travel between bodies. The speed cap scales with altitude above the
 *    nearest body, so the ship automatically slows on approach and drops out of cruise
 *    when it gets close.
 *
 * Velocity is "flight assisted": it swings toward the nose direction over a fraction of
 * a second, so steering feels like flying but momentum is still perceptible.
 */
export const DEFAULT_FLIGHT_CONFIG = Object.freeze({
  // Normal drive (u/s, 1 u = 1 km)
  normalMaxSpeed: 300,
  reverseThrottleMin: -0.2,
  accel: 160,
  decel: 240,
  brakeDecel: 450,
  throttleRate: 0.8,           // throttle units per second while W/S held
  assistRate: 2.5,             // how fast velocity aligns with the nose (1/s)

  // Boost
  boostSpeed: 900,
  boostAccel: 520,
  boostCapacity: 100,
  boostDrainRate: 20,          // 5 s of continuous boost
  boostRechargeRate: 12,

  // Cruise drive
  cruiseSpoolTime: 1.5,
  cruiseDistanceFactor: 0.55,  // cap = altitude * factor (per second)
  cruiseMaxSpeed: 40000,
  cruiseDropAltitude: 700,     // auto-disengage below this altitude while approaching
  cruiseAssistRate: 4.0,

  // Rotation
  mouseSensitivity: 0.0022,
  mouseSmoothing: 20,          // 1/s – higher = snappier
  pitchInverted: false,
  yawRate: 1.3,                // rad/s for A/D
  rollRate: 2.2,               // rad/s for Q/E
  keyRotationResponse: 8,

  // Chase camera
  cameraDistance: 7.0,
  cameraHeight: 1.9,
  cameraLag: 10,               // rotational follow rate (1/s)
  baseFOV: 62,
  boostFOV: 8,
  cruiseFOV: 10,

  shipRadius: 1.6
});

export class SpaceshipControls {
  /**
   * @param {{mesh: THREE.Object3D, setThrusterIntensity?: (t: number) => void}|THREE.Object3D} spaceship
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} [domElement]
   * @param {Object} [customConfig]
   */
  constructor(spaceship, camera, domElement = null, customConfig = {}) {
    if (!spaceship) throw new Error('SpaceshipControls: "spaceship" argument is required.');
    if (!camera) throw new Error('SpaceshipControls: "camera" argument is required.');

    this.spaceship = spaceship;
    this.ship = spaceship.mesh ? spaceship.mesh : spaceship;
    this.setThrusterIntensity = typeof spaceship.setThrusterIntensity === 'function'
      ? spaceship.setThrusterIntensity.bind(spaceship)
      : null;

    this.camera = camera;
    this.domElement = domElement || (typeof document !== 'undefined' ? document.body : null);
    this.config = { ...DEFAULT_FLIGHT_CONFIG, ...customConfig };

    // Flight state
    this.velocity = new THREE.Vector3();
    this.speed = 0;                 // commanded scalar speed along the nose
    this.throttle = 0;
    this.mode = 'normal';
    this.cruiseSpool = 0;           // 0..1 while spooling, 0 otherwise
    this.isBoosting = false;
    this.boostRemaining = this.config.boostCapacity;
    this.enabled = true;

    // Environment supplied by the game every frame
    this.environment = { altitude: Infinity, radius: 0, name: null, toBody: new THREE.Vector3() };

    // Rotation state
    this.pendingPitch = 0;
    this.pendingYaw = 0;
    this.yawVel = 0;
    this.rollVel = 0;

    // Camera state
    this.cameraQuat = new THREE.Quaternion();
    this._fovBlendBoost = 0;
    this._fovBlendCruise = 0;
    this.currentThrottleVisual = 0.05;

    this.keys = {
      forward: false, backward: false, yawLeft: false, yawRight: false,
      rollLeft: false, rollRight: false, boost: false, brake: false
    };
    this.isPointerLocked = false;
    this.isMouseDown = false;
    this.prevMouseX = null;
    this.prevMouseY = null;

    /** Optional listener: (type, detail) => void. Types: 'cruise-spool', 'cruise-engaged', 'cruise-disengaged'. */
    this.onEvent = null;

    this._vForward = new THREE.Vector3();
    this._vDesired = new THREE.Vector3();
    this._vOffset = new THREE.Vector3();
    this._vAxis = new THREE.Vector3();
    this._qDelta = new THREE.Quaternion();

    if (this.camera && typeof this.camera.fov === 'number') {
      this.camera.fov = this.config.baseFOV;
      this.camera.updateProjectionMatrix();
    }

    this._bindEvents();
    this.snapCamera();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  _bindEvents() {
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onBlur = this._onBlur.bind(this);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
      window.addEventListener('mouseup', this._onMouseUp);
      window.addEventListener('blur', this._onBlur);
    }
    if (this.domElement) {
      this.domElement.addEventListener('click', this._onClick);
      this.domElement.addEventListener('mousedown', this._onMouseDown);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('mousemove', this._onMouseMove);
      document.addEventListener('pointerlockchange', this._onPointerLockChange);
    }
  }

  _onClick() {
    if (this.domElement?.requestPointerLock && document.pointerLockElement !== this.domElement) {
      try {
        const promise = this.domElement.requestPointerLock();
        if (promise && typeof promise.catch === 'function') promise.catch(() => {});
      } catch {
        // Fall back to drag steering
      }
    }
  }

  _onPointerLockChange() {
    this.isPointerLocked = document.pointerLockElement === this.domElement;
  }

  _onBlur() {
    for (const k of Object.keys(this.keys)) this.keys[k] = false;
    this.isMouseDown = false;
  }

  _onMouseDown(e) {
    if (e.button === 0) {
      this.isMouseDown = true;
      this.prevMouseX = e.clientX;
      this.prevMouseY = e.clientY;
    }
  }

  _onMouseUp(e) {
    if (e.button === 0) {
      this.isMouseDown = false;
      this.prevMouseX = null;
      this.prevMouseY = null;
    }
  }

  _onMouseMove(e) {
    if (!this.enabled) return;
    let dx = 0;
    let dy = 0;
    if (this.isPointerLocked) {
      dx = e.movementX || 0;
      dy = e.movementY || 0;
    } else if (this.isMouseDown && this.prevMouseX !== null) {
      dx = e.clientX - this.prevMouseX;
      dy = e.clientY - this.prevMouseY;
      this.prevMouseX = e.clientX;
      this.prevMouseY = e.clientY;
    } else {
      return;
    }
    const s = this.config.mouseSensitivity;
    this.pendingYaw += -dx * s;
    this.pendingPitch += (this.config.pitchInverted ? dy : -dy) * s;
  }

  _isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  }

  _setKey(code, pressed) {
    switch (code) {
      case 'KeyW': this.keys.forward = pressed; return true;
      case 'KeyS': this.keys.backward = pressed; return true;
      case 'KeyA': this.keys.yawLeft = pressed; return true;
      case 'KeyD': this.keys.yawRight = pressed; return true;
      case 'KeyQ': this.keys.rollLeft = pressed; return true;
      case 'KeyE': this.keys.rollRight = pressed; return true;
      case 'Space': this.keys.boost = pressed; return true;
      case 'ShiftLeft':
      case 'ShiftRight': this.keys.brake = pressed; return true;
      default: return false;
    }
  }

  _onKeyDown(e) {
    if (this._isTyping(e)) return;
    if (this._setKey(e.code, true) && e.code === 'Space') e.preventDefault();
    if (e.repeat) return;

    if (e.code === 'KeyX') this.throttle = 0;
    if (e.code === 'KeyC' && this.enabled) this.toggleCruise();
  }

  _onKeyUp(e) {
    this._setKey(e.code, false);
  }

  // ---------------------------------------------------------------------------
  // Drive modes
  // ---------------------------------------------------------------------------

  _emit(type, detail) {
    if (typeof this.onEvent === 'function') this.onEvent(type, detail);
  }

  toggleCruise() {
    if (this.mode === 'cruise') {
      this.disengageCruise('manual');
    } else if (this.cruiseSpool > 0) {
      this.cruiseSpool = 0;
      this._emit('cruise-disengaged', { reason: 'cancelled' });
    } else {
      this.cruiseSpool = 0.0001;
      this.isBoosting = false;
      this._emit('cruise-spool');
    }
  }

  disengageCruise(reason = 'manual') {
    const wasActive = this.mode === 'cruise' || this.cruiseSpool > 0;
    this.mode = 'normal';
    this.cruiseSpool = 0;
    const max = this.config.normalMaxSpeed;
    if (this.speed > max) this.speed = max;
    if (this.velocity.length() > max) this.velocity.setLength(max);
    this.throttle = Math.min(this.throttle, 1);
    if (wasActive) this._emit('cruise-disengaged', { reason });
  }

  /** Current speed cap in cruise mode, from altitude above the nearest body. */
  getCruiseCap() {
    const c = this.config;
    const alt = Number.isFinite(this.environment.altitude) ? this.environment.altitude : c.cruiseMaxSpeed;
    return THREE.MathUtils.clamp(alt * c.cruiseDistanceFactor, c.normalMaxSpeed, c.cruiseMaxSpeed);
  }

  /**
   * @param {{ altitude: number, radius: number, name: string, toBody: THREE.Vector3 }} env
   *   Nearest body info; `toBody` is the unit direction from the ship to that body's center.
   */
  setEnvironment(env) {
    if (!env) return;
    this.environment.altitude = env.altitude;
    this.environment.radius = env.radius;
    this.environment.name = env.name;
    if (env.toBody) this.environment.toBody.copy(env.toBody);
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  /**
   * Advances rotation and velocity and moves the ship. Does not touch the camera –
   * call updateCamera() after collisions have been resolved.
   * @param {number} deltaTime
   */
  update(deltaTime = 0.016) {
    const dt = THREE.MathUtils.clamp(deltaTime || 0.016, 0.001, 0.05);
    const c = this.config;
    const keys = this.enabled ? this.keys : {};

    // 1. Rotation ---------------------------------------------------------
    const mouseAlpha = 1 - Math.exp(-c.mouseSmoothing * dt);
    const pitch = this.pendingPitch * mouseAlpha;
    let yaw = this.pendingYaw * mouseAlpha;
    this.pendingPitch -= pitch;
    this.pendingYaw -= yaw;

    const keyAlpha = 1 - Math.exp(-c.keyRotationResponse * dt);
    const yawInput = (keys.yawLeft ? 1 : 0) - (keys.yawRight ? 1 : 0);
    const rollInput = (keys.rollLeft ? 1 : 0) - (keys.rollRight ? 1 : 0);
    this.yawVel += (yawInput * c.yawRate - this.yawVel) * keyAlpha;
    this.rollVel += (rollInput * c.rollRate - this.rollVel) * keyAlpha;
    yaw += this.yawVel * dt;
    const roll = this.rollVel * dt;

    const rotMag = Math.hypot(pitch, yaw, roll);
    if (rotMag > 1e-8) {
      this._vAxis.set(pitch / rotMag, yaw / rotMag, roll / rotMag);
      this._qDelta.setFromAxisAngle(this._vAxis, rotMag);
      this.ship.quaternion.multiply(this._qDelta).normalize();
    }
    const forward = this._vForward.set(0, 0, -1).applyQuaternion(this.ship.quaternion);

    // 2. Throttle ---------------------------------------------------------
    const minThrottle = this.mode === 'cruise' ? 0 : c.reverseThrottleMin;
    if (keys.forward) this.throttle += c.throttleRate * dt;
    if (keys.backward) this.throttle -= c.throttleRate * dt;
    this.throttle = THREE.MathUtils.clamp(this.throttle, minThrottle, 1);

    // 3. Cruise spool / auto-disengage -----------------------------------
    if (this.cruiseSpool > 0) {
      this.cruiseSpool += dt / c.cruiseSpoolTime;
      if (this.cruiseSpool >= 1) {
        this.cruiseSpool = 0;
        this.mode = 'cruise';
        if (this.throttle < 0.25) this.throttle = 1;
        this._emit('cruise-engaged');
      }
    }
    if (this.mode === 'cruise') {
      const approaching = this.velocity.dot(this.environment.toBody) > 0;
      if (this.environment.altitude < c.cruiseDropAltitude && approaching) {
        this.disengageCruise('proximity');
      }
    }

    // 4. Boost ------------------------------------------------------------
    const wantsBoost = !!keys.boost && this.mode === 'normal' && this.cruiseSpool === 0;
    this.isBoosting = wantsBoost && this.boostRemaining > 0;
    if (this.isBoosting) {
      this.boostRemaining = Math.max(0, this.boostRemaining - c.boostDrainRate * dt);
    } else if (!keys.boost) {
      this.boostRemaining = Math.min(c.boostCapacity, this.boostRemaining + c.boostRechargeRate * dt);
    }

    // 5. Speed ------------------------------------------------------------
    let target;
    let linearRate;
    let expRate;
    if (keys.brake) {
      target = 0;
      linearRate = c.brakeDecel;
      expRate = 2.5;
    } else if (this.mode === 'cruise') {
      target = this.throttle * this.getCruiseCap();
      linearRate = target > this.speed ? c.boostAccel : c.brakeDecel;
      expRate = target > this.speed ? 0.9 : 4.0;
    } else if (this.isBoosting) {
      target = c.boostSpeed;
      linearRate = c.boostAccel;
      expRate = 1.5;
    } else {
      target = this.throttle * c.normalMaxSpeed;
      linearRate = target > this.speed ? c.accel : c.decel;
      expRate = 1.2;
    }
    const diff = target - this.speed;
    const step = Math.min(Math.abs(diff), Math.max(linearRate * dt, Math.abs(diff) * (1 - Math.exp(-expRate * dt))));
    this.speed += Math.sign(diff) * step;

    if (keys.brake) {
      // Braking also pulls the throttle down so the ship stays slow after releasing Shift
      const cap = this.mode === 'cruise' ? this.getCruiseCap() : c.normalMaxSpeed;
      this.throttle = Math.min(this.throttle, Math.max(0, this.speed / cap));
      if (this.mode === 'cruise' && this.speed <= c.normalMaxSpeed) this.disengageCruise('brake');
    }

    // 6. Velocity (flight assist) and integration -------------------------
    const assist = this.mode === 'cruise' ? c.cruiseAssistRate : c.assistRate;
    this._vDesired.copy(forward).multiplyScalar(this.speed);
    this.velocity.lerp(this._vDesired, 1 - Math.exp(-assist * dt));
    this.ship.position.addScaledVector(this.velocity, dt);

    // 7. Engine glow ------------------------------------------------------
    let thrusterTarget = Math.max(0.05, Math.abs(this.throttle));
    if (this.isBoosting) thrusterTarget = 2.5;
    else if (this.mode === 'cruise') thrusterTarget = 1.8;
    this.currentThrottleVisual += (thrusterTarget - this.currentThrottleVisual) * Math.min(1, dt * 8);
    if (this.setThrusterIntensity) this.setThrusterIntensity(this.currentThrottleVisual);

    this._lastDt = dt;
  }

  /**
   * Called after a collision pushed the ship back onto a surface.
   * @param {THREE.Vector3} normal Outward surface normal at the contact point
   * @returns {number} Impact speed along the normal (u/s)
   */
  applyImpact(normal) {
    const into = -this.velocity.dot(normal);
    if (into > 0) {
      // Remove the inward component, keep a little bounce and scrub some tangential speed
      this.velocity.addScaledVector(normal, into * 1.15);
      this.velocity.multiplyScalar(0.6);
    }
    const forward = this._vForward.set(0, 0, -1).applyQuaternion(this.ship.quaternion);
    this.speed = Math.max(0, this.velocity.dot(forward));
    if (this.mode === 'cruise' || this.cruiseSpool > 0) this.disengageCruise('impact');
    this.throttle = Math.min(this.throttle, this.speed / this.config.normalMaxSpeed);
    this.isBoosting = false;
    return Math.max(0, into);
  }

  /** Positions the chase camera. Call once per frame after physics and collisions. */
  updateCamera(deltaTime = 0.016) {
    const dt = THREE.MathUtils.clamp(deltaTime || 0.016, 0.001, 0.05);
    const c = this.config;

    this.cameraQuat.slerp(this.ship.quaternion, 1 - Math.exp(-c.cameraLag * dt));

    const speedFrac = Math.min(1, this.velocity.length() / c.boostSpeed);
    this._vOffset.set(0, c.cameraHeight, c.cameraDistance + speedFrac * 1.2)
      .applyQuaternion(this.cameraQuat)
      .add(this.ship.position);
    this.camera.position.copy(this._vOffset);
    this.camera.quaternion.copy(this.cameraQuat);

    const fovAlpha = 1 - Math.exp(-3 * dt);
    this._fovBlendBoost += ((this.isBoosting ? 1 : 0) - this._fovBlendBoost) * fovAlpha;
    this._fovBlendCruise += ((this.mode === 'cruise' ? 1 : 0) - this._fovBlendCruise) * fovAlpha;
    const fov = c.baseFOV + this._fovBlendBoost * c.boostFOV + this._fovBlendCruise * c.cruiseFOV;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld(true);
  }

  /** Snaps the camera directly behind the ship with no smoothing. */
  snapCamera() {
    this.cameraQuat.copy(this.ship.quaternion);
    this._vOffset.set(0, this.config.cameraHeight, this.config.cameraDistance)
      .applyQuaternion(this.cameraQuat)
      .add(this.ship.position);
    this.camera.position.copy(this._vOffset);
    this.camera.quaternion.copy(this.cameraQuat);
    this.camera.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------------------
  // Queries / setters
  // ---------------------------------------------------------------------------

  getTelemetry() {
    const c = this.config;
    let maxSpeed = c.normalMaxSpeed;
    if (this.mode === 'cruise') maxSpeed = this.getCruiseCap();
    else if (this.isBoosting) maxSpeed = c.boostSpeed;

    return {
      speed: this.velocity.length(),
      velocity: this.velocity,
      throttle: this.throttle,
      maxSpeed,
      mode: this.mode,
      cruiseSpool: this.cruiseSpool,
      isBoosting: this.isBoosting,
      boostPercent: (this.boostRemaining / c.boostCapacity) * 100,
      pointerLocked: this.isPointerLocked
    };
  }

  getPosition() {
    return this.ship.position.clone();
  }

  getDirection() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion);
  }

  setPosition(x, y, z) {
    this.ship.position.set(x, y, z);
    this.resetVelocity();
    this.snapCamera();
  }

  lookAt(targetVector) {
    if (!targetVector) return;
    const m = new THREE.Matrix4().lookAt(this.ship.position, targetVector, new THREE.Vector3(0, 1, 0));
    // Matrix4.lookAt points +Z away from the target; the ship's nose is -Z, so this is correct
    this.ship.quaternion.setFromRotationMatrix(m).normalize();
    this.snapCamera();
  }

  setSpeed(speed) {
    this.speed = speed;
    this._vForward.set(0, 0, -1).applyQuaternion(this.ship.quaternion);
    this.velocity.copy(this._vForward).multiplyScalar(speed);
    this.throttle = THREE.MathUtils.clamp(speed / this.config.normalMaxSpeed, 0, 1);
  }

  resetVelocity() {
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.throttle = 0;
    this.isBoosting = false;
    this.mode = 'normal';
    this.cruiseSpool = 0;
    this.pendingPitch = 0;
    this.pendingYaw = 0;
    this.yawVel = 0;
    this.rollVel = 0;
  }

  dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
      window.removeEventListener('mouseup', this._onMouseUp);
      window.removeEventListener('blur', this._onBlur);
    }
    if (this.domElement) {
      this.domElement.removeEventListener('click', this._onClick);
      this.domElement.removeEventListener('mousedown', this._onMouseDown);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('mousemove', this._onMouseMove);
      document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    }
  }
}

export default SpaceshipControls;
