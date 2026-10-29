import * as THREE from 'three';

/**
 * Configurable Newtonian Spaceflight Physics & Authoritative Chase Camera Controls
 *
 * Implements:
 * - Pure 6DOF Newtonian momentum preservation in vacuum.
 * - Single-axis quaternion rotation strictly preventing anholonomy (roll accumulation).
 * - Immediate, authoritative third-person chase camera synchronized directly to ship quaternion.
 * - Separate linear momentum vs. rotational reorientation.
 * - Active retro-braking vector cancellation.
 */
export const DEFAULT_FLIGHT_CONFIG = Object.freeze({
  // Linear Thrusters (units / sec² - calibrated for 1 unit = 10m canonical space hierarchy)
  forwardAccel: 120.0,         // Reaches 160 u/s cruise in ~1.3s
  reverseAccel: 65.0,
  boostAccel: 280.0,           // Explosive afterburner acceleration
  brakeStrength: 65.0,         // Active retro-braking vector cancellation (stops rapidly)

  // Speed Ceilings (units / sec)
  maxSpeed: 160.0,             // Normal cruise speed
  boostMaxSpeed: 450.0,        // Afterburner boost velocity
  reverseMaxSpeed: 60.0,       // Top reverse speed limit
  boostBleedRate: 110.0,       // Decay rate returning from boost to cruise speed

  // Vacuum Linear Momentum Preservation
  linearDamping: 1.0,          // 1.0 = Pure frictionless Newtonian coasting in space

  // Rotational Agility (radians / sec)
  yawRate: 2.2,                // ~126 deg/s: Snappy, deliberate A/D yaw
  pitchRate: 2.0,              // ~115 deg/s: Immediate pitch response
  rollRate: 2.8,               // ~160 deg/s: Crisp, predictable Q/E roll

  // Mouse Look (Zero-Lag Direct Response)
  mouseSensitivityX: 0.0030,
  mouseSensitivityY: 0.0030,
  pitchInverted: false,

  // Boost Energy Capacitor
  boostCapacity: 100.0,
  boostDrainRate: 24.0,        // ~4.2 seconds sustained afterburner burn
  boostRechargeRate: 20.0,     // Full recharge from 0 in ~5.0 seconds

  // Authoritative Chase Camera Geometry & Follow Dynamics
  // The ship's quaternion is the authoritative reference for orientation!
  cameraDistance: 6.5,         // Behind ship (+Z in body frame)
  cameraHeight: 2.0,           // Above ship (+Y in body frame)
  cameraPositionSmoothing: 0.0,// 0.0 = Rigidly locked to ship body frame (no lag or detachment)
  cameraRotationSmoothing: 0.0,// 0.0 = Instantaneous orientation synchronization (zero lag)
  baseFOV: 60.0,
});

export class SpaceshipControls {
  /**
   * @param {THREE.Object3D|{mesh: THREE.Object3D, setThrusterIntensity?: (t: number) => void}} spaceship
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} [domElement=document.body]
   * @param {Object} [customConfig]
   */
  constructor(spaceship, camera, domElement = null, customConfig = {}) {
    if (!spaceship) {
      throw new Error('SpaceshipControls: "spaceship" argument is required.');
    }
    if (!camera) {
      throw new Error('SpaceshipControls: "camera" argument is required.');
    }

    // Support both raw THREE.Object3D and composite wrapper from createSpaceship()
    this.spaceship = spaceship;
    this.ship = spaceship.mesh ? spaceship.mesh : spaceship;
    this.setThrusterIntensity = (spaceship && typeof spaceship.setThrusterIntensity === 'function')
      ? spaceship.setThrusterIntensity.bind(spaceship)
      : null;

    this.camera = camera;
    this.domElement = domElement || (typeof document !== 'undefined' ? (document.body || document.documentElement) : null);

    // Merge configuration
    this.config = { ...DEFAULT_FLIGHT_CONFIG, ...customConfig };

    // Linear Physics State (Newtonian Velocity in World Space)
    this.velocity = new THREE.Vector3(0, 0, 0);

    // Boost Capacitor State
    this.boostCapacity = this.config.boostCapacity;
    this.boostRemaining = this.config.boostCapacity;
    this.isBoosting = false;

    // Mouse Input Accumulator
    this.rawMouseX = 0;
    this.rawMouseY = 0;

    // Camera Configuration Initialization
    if (this.camera && typeof this.camera.fov === 'number') {
      this.camera.fov = this.config.baseFOV;
      this.camera.updateProjectionMatrix();
    }

    // Input States
    this.keys = {
      forward: false,   // W
      backward: false,  // S
      yawLeft: false,   // A
      yawRight: false,  // D
      rollLeft: false,  // Q
      rollRight: false, // E
      boost: false,     // Space
      brake: false,     // Shift
    };

    this.isPointerLocked = false;
    this.isMouseDown = false;
    this.prevMouseX = null;
    this.prevMouseY = null;

    this.currentThrottle = 0.05;

    // Reusable Math Primitives (Zero Garbage Collection overhead per frame)
    this._vForward = new THREE.Vector3();
    this._vUp = new THREE.Vector3();
    this._vRight = new THREE.Vector3();
    this._vCamOffset = new THREE.Vector3();
    this._vDesiredCamPos = new THREE.Vector3();
    this._vRotAxis = new THREE.Vector3();
    this._qDelta = new THREE.Quaternion();

    // Bind event listeners
    this._bindEvents();

    // Snap initial camera to authoritative position & orientation
    this._snapCamera();
  }

  // --- Backwards Compatibility Property Proxies ---
  get maxSpeed() { return this.config.maxSpeed; }
  set maxSpeed(v) { this.config.maxSpeed = v; }

  get boostMaxSpeed() { return this.config.boostMaxSpeed; }
  set boostMaxSpeed(v) { this.config.boostMaxSpeed = v; }

  get acceleration() { return this.config.forwardAccel; }
  set acceleration(v) { this.config.forwardAccel = v; }

  get reverseAcceleration() { return this.config.reverseAccel; }
  set reverseAcceleration(v) { this.config.reverseAccel = v; }

  get dragCoeff() { return this.config.linearDamping; }
  set dragCoeff(v) { this.config.linearDamping = v; }

  get mouseSensitivity() { return this.config.mouseSensitivityX; }
  set mouseSensitivity(v) { this.config.mouseSensitivityX = v; this.config.mouseSensitivityY = v; }

  /**
   * Bind DOM event listeners.
   * @private
   */
  _bindEvents() {
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onPointerLockError = this._onPointerLockError.bind(this);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
      window.addEventListener('mouseup', this._onMouseUp);
    }

    if (this.domElement) {
      this.domElement.addEventListener('click', this._onClick);
      this.domElement.addEventListener('mousedown', this._onMouseDown);
      this.domElement.addEventListener('mousemove', this._onMouseMove);
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('pointerlockchange', this._onPointerLockChange);
      document.addEventListener('pointerlockerror', this._onPointerLockError);
    }
  }

  _onClick(e) {
    if (this.domElement && typeof document !== 'undefined' && document.pointerLockElement !== this.domElement) {
      try {
        const promise = this.domElement.requestPointerLock();
        if (promise && typeof promise.catch === 'function') {
          promise.catch(() => {});
        }
      } catch {
        // Fall back to mouse dragging
      }
    }
  }

  _onPointerLockChange() {
    if (typeof document !== 'undefined') {
      this.isPointerLocked = (document.pointerLockElement === this.domElement);
    }
  }

  _onPointerLockError() {
    this.isPointerLocked = false;
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
    if (this.isPointerLocked) {
      const dx = e.movementX ?? e.mozMovementX ?? e.webkitMovementX ?? 0;
      const dy = e.movementY ?? e.mozMovementY ?? e.webkitMovementY ?? 0;
      this.rawMouseX += dx;
      this.rawMouseY += dy;
    } else if (this.isMouseDown) {
      if (this.prevMouseX !== null && this.prevMouseY !== null) {
        this.rawMouseX += (e.clientX - this.prevMouseX);
        this.rawMouseY += (e.clientY - this.prevMouseY);
      }
      this.prevMouseX = e.clientX;
      this.prevMouseY = e.clientY;
    }
  }

  _onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      return;
    }

    const code = e.code || '';
    const key = (e.key || '').toLowerCase();

    if (code === 'KeyW' || key === 'w') this.keys.forward = true;
    if (code === 'KeyS' || key === 's') this.keys.backward = true;
    if (code === 'KeyA' || key === 'a') this.keys.yawLeft = true;
    if (code === 'KeyD' || key === 'd') this.keys.yawRight = true;
    if (code === 'KeyQ' || key === 'q') this.keys.rollLeft = true;
    if (code === 'KeyE' || key === 'e') this.keys.rollRight = true;
    if (code === 'Space' || key === ' ') this.keys.boost = true;
    if (code === 'ShiftLeft' || code === 'ShiftRight' || key === 'shift') this.keys.brake = true;

    if (code === 'Escape' || key === 'escape') {
      if (typeof document !== 'undefined' && document.exitPointerLock) {
        document.exitPointerLock();
      }
    }
  }

  _onKeyUp(e) {
    const code = e.code || '';
    const key = (e.key || '').toLowerCase();

    if (code === 'KeyW' || key === 'w') this.keys.forward = false;
    if (code === 'KeyS' || key === 's') this.keys.backward = false;
    if (code === 'KeyA' || key === 'a') this.keys.yawLeft = false;
    if (code === 'KeyD' || key === 'd') this.keys.yawRight = false;
    if (code === 'KeyQ' || key === 'q') this.keys.rollLeft = false;
    if (code === 'KeyE' || key === 'e') this.keys.rollRight = false;
    if (code === 'Space' || key === ' ') this.keys.boost = false;
    if (code === 'ShiftLeft' || code === 'ShiftRight' || key === 'shift') this.keys.brake = false;
  }

  /**
   * Snaps camera directly to authoritative position & orientation without interpolation.
   * @private
   */
  _snapCamera() {
    if (!this.ship || !this.camera) return;

    // Body frame offset: +Y (height above ship), +Z (distance behind ship)
    this._vDesiredCamPos.set(0, this.config.cameraHeight, this.config.cameraDistance)
      .applyQuaternion(this.ship.quaternion)
      .add(this.ship.position);

    this.camera.position.copy(this._vDesiredCamPos);
    this.camera.quaternion.copy(this.ship.quaternion);
    this.camera.updateMatrixWorld(true);
  }

  /**
   * Main flight simulation & control update tick.
   * @param {number} [deltaTime=0.016] Elapsed frame time in seconds
   */
  update(deltaTime = 0.016) {
    const dt = THREE.MathUtils.clamp(deltaTime || 0.016, 0.001, 0.05);

    // -------------------------------------------------------------
    // 1. Flight Orientation & Rotational Inputs (Single Axis-Angle)
    // -------------------------------------------------------------
    // Direct raw mouse input: 1:1 instantaneous response
    const deltaPitchMouse = (this.config.pitchInverted ? this.rawMouseY : -this.rawMouseY) * this.config.mouseSensitivityY;
    const deltaYawMouse = -this.rawMouseX * this.config.mouseSensitivityX;

    // Consume raw deltas immediately
    this.rawMouseX = 0;
    this.rawMouseY = 0;

    // Keyboard Yaw (A/D): Pure yaw around local Y axis
    let deltaYawKey = 0;
    if (this.keys.yawLeft) deltaYawKey += this.config.yawRate * dt;
    if (this.keys.yawRight) deltaYawKey -= this.config.yawRate * dt;

    // Keyboard Roll (Q/E): Pure roll around local Z axis
    let deltaRollKey = 0;
    if (this.keys.rollLeft) deltaRollKey += this.config.rollRate * dt;
    if (this.keys.rollRight) deltaRollKey -= this.config.rollRate * dt;

    const cmdPitch = deltaPitchMouse;
    const cmdYaw = deltaYawMouse + deltaYawKey;
    const cmdRoll = deltaRollKey;

    // Compute single combined axis-angle rotation.
    // If cmdRoll is 0, the rotation axis has strictly ZERO component along Z,
    // which completely prevents anholonomy / geometric-phase roll accumulation!
    const rotMag = Math.hypot(cmdPitch, cmdYaw, cmdRoll);
    if (rotMag > 1e-7) {
      this._vRotAxis.set(cmdPitch / rotMag, cmdYaw / rotMag, cmdRoll / rotMag);
      this._qDelta.setFromAxisAngle(this._vRotAxis, rotMag);

      // Local body-frame rotation: Right-multiplication applies rotation in local coordinates
      this.ship.quaternion.multiply(this._qDelta);
      this.ship.quaternion.normalize();
    }

    // Refresh forward vector from updated ship orientation
    this._vForward.set(0, 0, -1).applyQuaternion(this.ship.quaternion).normalize();

    // -------------------------------------------------------------
    // 2. Boost Mechanics (Afterburner Capacitor)
    // -------------------------------------------------------------
    const wantsBoost = this.keys.boost && (this.keys.forward || this.velocity.length() > 5.0);
    this.isBoosting = wantsBoost && (this.boostRemaining > 0);

    if (this.isBoosting) {
      this.boostRemaining = Math.max(0, this.boostRemaining - (this.config.boostDrainRate * dt));
      if (this.boostRemaining <= 0) {
        this.isBoosting = false;
      }
    } else {
      this.boostRemaining = Math.min(this.config.boostCapacity, this.boostRemaining + (this.config.boostRechargeRate * dt));
    }

    // -------------------------------------------------------------
    // 3. Linear Thrust, Active Retro-Braking & Momentum Coasting
    // -------------------------------------------------------------
    const currentAccel = this.isBoosting ? this.config.boostAccel : this.config.forwardAccel;

    // W: Forward acceleration along ship -Z
    if (this.keys.forward) {
      this.velocity.addScaledVector(this._vForward, currentAccel * dt);
    }

    // S: Reverse retro-thruster acceleration
    if (this.keys.backward) {
      this.velocity.addScaledVector(this._vForward, -this.config.reverseAccel * dt);
    }

    // Shift: Active Retro-Braking (Vector cancellation arresting linear momentum)
    if (this.keys.brake) {
      const curSpeed = this.velocity.length();
      if (curSpeed > 0.001) {
        const brakeDelta = this.config.brakeStrength * dt;
        if (brakeDelta >= curSpeed) {
          this.velocity.set(0, 0, 0);
        } else {
          this.velocity.multiplyScalar((curSpeed - brakeDelta) / curSpeed);
        }
      }
    } else if (!this.keys.forward && !this.keys.backward) {
      // Pure Newtonian coasting: linearDamping = 1.0 preserves momentum indefinitely in vacuum!
      if (this.config.linearDamping < 0.9999) {
        const factor = Math.pow(this.config.linearDamping, dt * 60.0);
        this.velocity.multiplyScalar(factor);
      }
    }

    // Velocity Clamping & Boost Bleed-off
    const currentSpeed = this.velocity.length();
    if (this.isBoosting) {
      if (currentSpeed > this.config.boostMaxSpeed) {
        this.velocity.setLength(this.config.boostMaxSpeed);
      }
    } else {
      if (currentSpeed > this.config.maxSpeed) {
        const newSpeed = Math.max(this.config.maxSpeed, currentSpeed - (this.config.boostBleedRate * dt));
        this.velocity.setLength(newSpeed);
      }
    }

    // Position integration: Independent from ship rotation
    this.ship.position.addScaledVector(this.velocity, dt);

    // -------------------------------------------------------------
    // 4. Throttle & Thruster Visual Glow
    // -------------------------------------------------------------
    let targetThrottle = 0.05; // Idle
    if (this.isBoosting) {
      targetThrottle = 2.5;
    } else if (this.keys.forward) {
      targetThrottle = 1.0;
    } else if (this.keys.backward) {
      targetThrottle = 0.35;
    } else if (this.keys.brake) {
      targetThrottle = 0.2;
    }

    this.currentThrottle += (targetThrottle - this.currentThrottle) * Math.min(1.0, dt * 12.0);
    if (this.setThrusterIntensity) {
      this.setThrusterIntensity(this.currentThrottle);
    }

    // -------------------------------------------------------------
    // 5. Stable Authoritative Third-Person Chase Camera
    // -------------------------------------------------------------
    // Desired camera position anchored in ship's local body frame:
    // (0, cameraHeight, cameraDistance) rotated by ship.quaternion
    this._vDesiredCamPos.set(0, this.config.cameraHeight, this.config.cameraDistance)
      .applyQuaternion(this.ship.quaternion)
      .add(this.ship.position);

    // Camera Orientation: Authoritatively follows the ship's quaternion!
    // Immediate 1:1 orientation prevents rotational detachment or independent orbiting.
    if (this.config.cameraRotationSmoothing <= 0.0001) {
      this.camera.quaternion.copy(this.ship.quaternion);
    } else {
      const rotAlpha = 1.0 - Math.exp(-this.config.cameraRotationSmoothing * dt);
      this.camera.quaternion.slerp(this.ship.quaternion, rotAlpha);
    }

    // Camera Position: Immediately follows (or configurable subtle critically-damped position)
    if (this.config.cameraPositionSmoothing <= 0.0001) {
      this.camera.position.copy(this._vDesiredCamPos);
    } else {
      const posAlpha = 1.0 - Math.exp(-this.config.cameraPositionSmoothing * dt);
      this.camera.position.lerp(this._vDesiredCamPos, posAlpha);
    }

    this.camera.updateMatrixWorld(true);
  }

  /**
   * Returns current flight telemetry.
   */
  getTelemetry() {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion).normalize();
    return {
      speed: this.velocity.length(),
      velocity: this.velocity.clone(),
      maxSpeed: this.isBoosting ? this.config.boostMaxSpeed : this.config.maxSpeed,
      boostRemaining: this.boostRemaining,
      boost: this.boostRemaining,
      boostPercent: Math.round((this.boostRemaining / this.config.boostCapacity) * 100),
      throttle: this.currentThrottle,
      isBoosting: this.isBoosting,
      position: this.ship.position.clone(),
      direction: dir,
      quaternion: this.ship.quaternion.clone(),
    };
  }

  getPosition() {
    return this.ship.position.clone();
  }

  getDirection() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion).normalize();
  }

  setPosition(x, y, z) {
    this.ship.position.set(x, y, z);
    this.resetVelocity();
    this._snapCamera();
  }

  setSpeed(speed) {
    this._vForward.set(0, 0, -1).applyQuaternion(this.ship.quaternion).normalize();
    this.velocity.copy(this._vForward).multiplyScalar(speed);
  }

  lookAt(targetVector) {
    if (!targetVector) return;
    const target = (targetVector instanceof THREE.Vector3)
      ? targetVector
      : new THREE.Vector3(targetVector.x, targetVector.y, targetVector.z);

    // Matrix4.lookAt(eye, target, up) aligns -Z (standard Three.js forward) towards target
    const m = new THREE.Matrix4();
    m.lookAt(this.ship.position, target, new THREE.Vector3(0, 1, 0));
    this.ship.quaternion.setFromRotationMatrix(m);
    this.ship.quaternion.normalize();
    this._snapCamera();
  }

  resetVelocity() {
    this.velocity.set(0, 0, 0);
  }

  dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
      window.removeEventListener('mouseup', this._onMouseUp);
    }

    if (this.domElement) {
      this.domElement.removeEventListener('click', this._onClick);
      this.domElement.removeEventListener('mousedown', this._onMouseDown);
      this.domElement.removeEventListener('mousemove', this._onMouseMove);
    }

    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerlockchange', this._onPointerLockChange);
      document.removeEventListener('pointerlockerror', this._onPointerLockError);
    }
  }
}

export default SpaceshipControls;
