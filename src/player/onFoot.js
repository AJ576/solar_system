import * as THREE from 'three';
import { getTerrainHeight } from '../terrain/terrainGenerator.js';
import {
  PLAYER_EYE_HEIGHT,
  PLAYER_WALK_SPEED,
  PLAYER_RUN_SPEED,
  PLAYER_JUMP_SPEED,
  SURFACE_GRAVITY
} from '../utils/scale.js';

/**
 * First-person walking on a planet or moon.
 *
 * The player's position, velocity and facing live in the body's *local* (spinning) frame,
 * so standing still on the ground means staying still relative to the planet while it
 * orbits and rotates. World-space pose is derived from the body mesh every frame.
 *
 * Controls: WASD move, Shift run, Space jump, mouse look.
 */
export class OnFootController {
  constructor(camera, domElement = null) {
    this.camera = camera;
    this.domElement = domElement;
    this.active = false;

    this.body = null;
    this.position = new THREE.Vector3();  // body-local
    this.velocity = new THREE.Vector3();  // body-local
    this.forward = new THREE.Vector3(0, 0, -1); // body-local, kept tangent to the ground
    this.pitch = 0;
    this.grounded = false;
    this.swimming = false;
    this._deepWater = false;
    this.inLava = false;

    this.keys = { forward: false, back: false, left: false, right: false, run: false, jump: false };
    this.mouseSensitivity = 0.0022;
    this._pendingYaw = 0;
    this._pendingPitch = 0;
    this._dragging = false;
    this._lastX = null;
    this._lastY = null;

    this._up = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._bodyQuat = new THREE.Quaternion();
    this._camF = new THREE.Vector3();
    this._camU = new THREE.Vector3();

    // Solid obstacle: the parked ship, as boxes in ship space plus its body-local pose
    this.obstacle = null;
    this._invQ = new THREE.Quaternion();
    this._sp = new THREE.Vector3();
    this._cl = new THREE.Vector3();
    this._push = new THREE.Vector3();

    this._bindEvents();
  }

  _bindEvents() {
    if (typeof window === 'undefined') return;
    this._onKey = (e, down) => {
      if (!this.active) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      switch (e.code) {
        case 'KeyW': this.keys.forward = down; break;
        case 'KeyS': this.keys.back = down; break;
        case 'KeyA': this.keys.left = down; break;
        case 'KeyD': this.keys.right = down; break;
        case 'ShiftLeft':
        case 'ShiftRight': this.keys.run = down; break;
        case 'Space': this.keys.jump = down; e.preventDefault(); break;
        default: break;
      }
    };
    this._onKeyDown = (e) => this._onKey(e, true);
    this._onKeyUp = (e) => this._onKey(e, false);
    this._onMouseMove = (e) => {
      if (!this.active) return;
      let dx = 0;
      let dy = 0;
      if (document.pointerLockElement) {
        dx = e.movementX || 0;
        dy = e.movementY || 0;
      } else if (this._dragging && this._lastX !== null) {
        dx = e.clientX - this._lastX;
        dy = e.clientY - this._lastY;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
      } else {
        return;
      }
      this._pendingYaw -= dx * this.mouseSensitivity;
      this._pendingPitch -= dy * this.mouseSensitivity;
    };
    this._onMouseDown = (e) => {
      if (e.button !== 0) return;
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    };
    this._onMouseUp = () => {
      this._dragging = false;
      this._lastX = null;
      this._lastY = null;
    };
    this._onBlur = () => {
      for (const k of Object.keys(this.keys)) this.keys[k] = false;
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('mousemove', this._onMouseMove);
    this.domElement?.addEventListener('mousedown', this._onMouseDown);
  }

  /** Surface gravity, stronger on bigger bodies. */
  get gravity() {
    const r = this.body?.radius || 1000;
    return SURFACE_GRAVITY * THREE.MathUtils.clamp(r / 1000, 0.25, 1.6);
  }

  /**
   * Starts walking on `body` at a body-local position, facing `localForward`.
   */
  enter(body, localPos, localForward) {
    this.body = body;
    this.position.copy(localPos);
    this.velocity.set(0, 0, 0);
    this.forward.copy(localForward);
    this.pitch = 0;
    this._pendingYaw = 0;
    this._pendingPitch = 0;
    this.active = true;
    this._snapToGround(true);
  }

  exit() {
    this.active = false;
    this._onBlur?.();
  }

  /**
   * Radius of the walkable surface under a local direction. On water worlds the player
   * swims at the surface; lava is a floor you should not stand on for long.
   */
  _groundRadius(dir) {
    const p = this.body.terrainProfile;
    const h = getTerrainHeight(dir, p.seedNum, p);
    let floor = h;
    // Deep water under this spot. Whether we are actually *in* it (vs. jumping above it)
    // is decided in update() from the player's height.
    this._deepWater = false;
    this.inLava = false;
    if (h < 0 && p.seaSurface === 'water') {
      floor = Math.max(h, -PLAYER_EYE_HEIGHT * 0.85);
      this._deepWater = h < -PLAYER_EYE_HEIGHT * 0.5;
    } else if (h < 0 && p.seaSurface === 'lava') {
      floor = 0;
      this.inLava = true;
    }
    return this.body.radius + floor;
  }

  _snapToGround(force = false) {
    const r = this.position.length();
    this._up.copy(this.position).divideScalar(r);
    const groundR = this._groundRadius(this._up);
    if (force || r < groundR) {
      this.position.copy(this._up).multiplyScalar(groundR);
      return true;
    }
    return false;
  }

  update(deltaTime = 0.016) {
    if (!this.active || !this.body) return;
    const dt = Math.min(Math.max(deltaTime, 0.001), 0.05);
    const up = this._up.copy(this.position).normalize();

    // Look: yaw turns `forward` around local up, pitch is clamped
    const yaw = this._pendingYaw;
    this._pendingYaw = 0;
    this.pitch = THREE.MathUtils.clamp(this.pitch + this._pendingPitch, -1.45, 1.45);
    this._pendingPitch = 0;
    if (yaw) this.forward.applyAxisAngle(up, yaw);

    // Keep forward tangent to the ground as we walk around the curve
    this.forward.addScaledVector(up, -this.forward.dot(up));
    if (this.forward.lengthSq() < 1e-8) this.forward.set(1, 0, 0).addScaledVector(up, -up.x);
    this.forward.normalize();
    const right = this._right.crossVectors(this.forward, up).normalize();

    // Movement intent on the tangent plane
    const k = this.keys;
    const fwd = (k.forward ? 1 : 0) - (k.back ? 1 : 0);
    const side = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    const wish = this._wish.set(0, 0, 0).addScaledVector(this.forward, fwd).addScaledVector(right, side);
    if (wish.lengthSq() > 0) wish.normalize();
    let speed = k.run ? PLAYER_RUN_SPEED : PLAYER_WALK_SPEED;
    if (this.swimming) speed *= 0.45;
    wish.multiplyScalar(speed);

    // Split velocity into vertical and horizontal parts
    let vUp = this.velocity.dot(up);
    const horizontal = this._tmp.copy(this.velocity).addScaledVector(up, -vUp);
    const control = this.grounded || this.swimming ? 12 : 1.5;
    horizontal.lerp(wish, 1 - Math.exp(-control * dt));

    if (this.swimming) {
      // Buoyancy keeps the head above water
      vUp *= Math.exp(-4 * dt);
    } else {
      vUp -= this.gravity * dt;
    }
    const wasGrounded = this.grounded;
    // Only possible while touching the ground or floating at the water surface, so
    // holding Space gives repeated hops/bobs, never a climb into the sky
    if (k.jump && this.grounded) {
      vUp = this.swimming ? PLAYER_JUMP_SPEED * 0.6 : PLAYER_JUMP_SPEED;
      this.swimming = false;
      this.grounded = false;
      this.onJump?.();
    }

    this.velocity.copy(horizontal).addScaledVector(up, vUp);
    this.position.addScaledVector(this.velocity, dt);

    // Ground contact (and gentle snapping when walking downhill)
    const r = this.position.length();
    const newUp = this._up.copy(this.position).divideScalar(r);
    const groundR = this._groundRadius(newUp);
    const snap = this.grounded && vUp <= 0 ? PLAYER_EYE_HEIGHT * 0.6 : 0;
    if (r <= groundR + snap) {
      this.position.copy(newUp).multiplyScalar(groundR);
      const vr = this.velocity.dot(newUp);
      if (vr < 0) this.velocity.addScaledVector(newUp, -vr);
      if (!wasGrounded) {
        this.onLand?.();
      }
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    // Floating at the surface of deep water (the water surface acts as our "ground")
    this.swimming = this.grounded && this._deepWater;

    this._resolveObstacle(newUp);
  }

  /**
   * Makes the parked ship solid. `boxes` are THREE.Box3 in ship space; the pose is
   * body-local (the same frame the player walks in).
   */
  setObstacle(boxes, localPos, localQuat) {
    this.obstacle = boxes ? { boxes, localPos, localQuat } : null;
  }

  /**
   * Pushes the player's body (three spheres stacked up to eye height) out of the ship's
   * boxes. Standing on top of a part counts as ground.
   */
  _resolveObstacle(up) {
    const o = this.obstacle;
    if (!o) return;
    const radius = PLAYER_EYE_HEIGHT * 0.3;
    this._invQ.copy(o.localQuat).invert();
    for (const h of [radius, PLAYER_EYE_HEIGHT * 0.55, PLAYER_EYE_HEIGHT]) {
      // Sphere center in ship space
      const sp = this._sp.copy(this.position).addScaledVector(up, h).sub(o.localPos).applyQuaternion(this._invQ);
      for (const box of o.boxes) {
        const cl = box.clampPoint(sp, this._cl);
        const push = this._push.subVectors(sp, cl);
        let d = push.length();
        if (d >= radius) continue;
        if (d < 1e-6) {
          // Center inside the box: leave through the nearest face
          const dx = Math.min(sp.x - box.min.x, box.max.x - sp.x);
          const dy = Math.min(sp.y - box.min.y, box.max.y - sp.y);
          const dz = Math.min(sp.z - box.min.z, box.max.z - sp.z);
          push.set(0, 0, 0);
          if (dx <= dy && dx <= dz) push.x = sp.x - box.min.x < box.max.x - sp.x ? -1 : 1;
          else if (dy <= dz) push.y = sp.y - box.min.y < box.max.y - sp.y ? -1 : 1;
          else push.z = sp.z - box.min.z < box.max.z - sp.z ? -1 : 1;
          d = -Math.min(dx, dy, dz);
        } else {
          push.divideScalar(d);
        }
        const depth = radius - d;
        // Back to body-local space and apply
        push.applyQuaternion(o.localQuat);
        this.position.addScaledVector(push, depth);
        sp.addScaledVector(this._push.copy(push).applyQuaternion(this._invQ), depth);
        const into = this.velocity.dot(push);
        if (into < 0) this.velocity.addScaledVector(push, -into);
        if (push.dot(up) > 0.7) this.grounded = true;
      }
    }
  }

  /** Places the camera at eye height with the current look direction. */
  updateCamera() {
    if (!this.active || !this.body) return;
    const mesh = this.body.mesh || this.body.object;
    mesh.updateWorldMatrix(true, false);

    const up = this._up.copy(this.position).normalize();
    const right = this._right.crossVectors(this.forward, up).normalize();
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const camF = this._camF.copy(this.forward).multiplyScalar(cp).addScaledVector(up, sp);
    const camU = this._camU.copy(up).multiplyScalar(cp).addScaledVector(this.forward, -sp);

    // Local camera basis: x = right, y = up, z = backward
    this._m.makeBasis(right, camU, camF.negate());
    this._q.setFromRotationMatrix(this._m);
    mesh.getWorldQuaternion(this._bodyQuat);

    this._tmp.copy(this.position).addScaledVector(up, PLAYER_EYE_HEIGHT).applyMatrix4(mesh.matrixWorld);
    this.camera.position.copy(this._tmp);
    this.camera.quaternion.copy(this._bodyQuat).multiply(this._q);
    this.camera.updateMatrixWorld(true);
  }

  /** World-space position of the player's feet. */
  getWorldPosition(target = new THREE.Vector3()) {
    const mesh = this.body.mesh || this.body.object;
    return target.copy(this.position).applyMatrix4(mesh.matrixWorld);
  }

  /** Speed relative to the ground (u/s). */
  getSpeed() {
    return this.velocity.length();
  }

  dispose() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('mousemove', this._onMouseMove);
    this.domElement?.removeEventListener('mousedown', this._onMouseDown);
  }
}
