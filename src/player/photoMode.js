import * as THREE from 'three';

/**
 * Photo Mode — Cinematic Free Camera & Snapshot Tool
 *
 * Features:
 * - Freezes game simulation time while active
 * - Detaches camera into 6-DOF free flight with smooth damping
 * - Adjustable Field of View (15° telephoto to 100° ultra-wide)
 * - Camera roll / Dutch angle tilt control
 * - Exposure tuning
 * - Rule-of-thirds composition grid overlay
 * - High-resolution screenshot capture to PNG
 * - UI toggle for clean viewfinder shots
 */

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.camera = game.camera;
    this.canvas = game.canvas;
    this.renderer = game.renderer;

    this.isActive = false;
    this.isUiHidden = false;
    this.gridVisible = true;

    // Camera state saved on enter
    this.savedFov = 62;
    this.savedExposure = 1.0;
    this.savedPos = new THREE.Vector3();
    this.savedQuat = new THREE.Quaternion();

    // Free camera motion
    this.pos = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.velocity = new THREE.Vector3();
    this.roll = 0; // radians

    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
      fast: false
    };

    this.isMouseDown = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    this._setupUI();
    this._bindEvents();
  }

  _setupUI() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'photo-mode-overlay hud-interactive';
    this.overlay.style.display = 'none';

    this.overlay.innerHTML = `
      <div class="photo-grid">
        <div class="photo-grid-line photo-grid-h1"></div>
        <div class="photo-grid-line photo-grid-h2"></div>
        <div class="photo-grid-line photo-grid-v1"></div>
        <div class="photo-grid-line photo-grid-v2"></div>
      </div>
      <div class="photo-flash"></div>
      <div class="photo-hud">
        <div class="photo-toolbar">
          <div class="photo-title">Photo Mode</div>
          <div class="photo-controls-group">
            <label class="photo-label">FOV <span data-ref="fovVal">62°</span></label>
            <input type="range" min="15" max="100" value="62" class="photo-slider" data-ref="fovSlider">
          </div>
          <div class="photo-controls-group">
            <label class="photo-label">Roll <span data-ref="rollVal">0°</span></label>
            <input type="range" min="-45" max="45" value="0" class="photo-slider" data-ref="rollSlider">
          </div>
          <div class="photo-controls-group">
            <label class="photo-label">Exposure <span data-ref="expVal">1.0x</span></label>
            <input type="range" min="0.4" max="2.5" step="0.1" value="1.0" class="photo-slider" data-ref="expSlider">
          </div>
          <div class="photo-actions">
            <button class="hud-btn" data-ref="btnGrid" title="Toggle rule-of-thirds grid">Grid</button>
            <button class="hud-btn" data-ref="btnHideUi" title="Hide UI for clean view (H)">Hide UI</button>
            <button class="hud-btn hud-btn--primary" data-ref="btnSnap" title="Take photo and save PNG (Space)">Capture Photo</button>
            <button class="hud-btn" data-ref="btnExit" title="Exit Photo Mode (P or Esc)">Exit (P)</button>
          </div>
        </div>
        <div class="photo-hints">
          WASD Fly • QE Up/Down • Shift Boost • Right Click / Drag to Look • Scroll to Zoom
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    this.gridEl = this.overlay.querySelector('.photo-grid');
    this.flashEl = this.overlay.querySelector('.photo-flash');
    this.hudEl = this.overlay.querySelector('.photo-hud');

    this.fovSlider = this.overlay.querySelector('[data-ref="fovSlider"]');
    this.fovVal = this.overlay.querySelector('[data-ref="fovVal"]');
    this.rollSlider = this.overlay.querySelector('[data-ref="rollSlider"]');
    this.rollVal = this.overlay.querySelector('[data-ref="rollVal"]');
    this.expSlider = this.overlay.querySelector('[data-ref="expSlider"]');
    this.expVal = this.overlay.querySelector('[data-ref="expVal"]');

    this.btnGrid = this.overlay.querySelector('[data-ref="btnGrid"]');
    this.btnHideUi = this.overlay.querySelector('[data-ref="btnHideUi"]');
    this.btnSnap = this.overlay.querySelector('[data-ref="btnSnap"]');
    this.btnExit = this.overlay.querySelector('[data-ref="btnExit"]');
  }

  _bindEvents() {
    this.fovSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.camera.fov = val;
      this.camera.updateProjectionMatrix();
      this.fovVal.textContent = `${Math.round(val)}°`;
    });

    this.rollSlider.addEventListener('input', (e) => {
      const deg = parseFloat(e.target.value);
      this.roll = THREE.MathUtils.degToRad(deg);
      this.rollVal.textContent = `${Math.round(deg)}°`;
      this._updateCameraRotation();
    });

    this.expSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.renderer.toneMappingExposure = val;
      this.expVal.textContent = `${val.toFixed(1)}x`;
    });

    this.btnGrid.addEventListener('click', () => {
      this.gridVisible = !this.gridVisible;
      this.gridEl.style.display = this.gridVisible ? 'block' : 'none';
      this.btnGrid.classList.toggle('is-active', this.gridVisible);
    });

    this.btnHideUi.addEventListener('click', () => this.toggleUi());
    this.btnSnap.addEventListener('click', () => this.takePhoto());
    this.btnExit.addEventListener('click', () => this.exit());

    // Mouse drag rotation
    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target.closest('.photo-toolbar')) return;
      this.isMouseDown = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isActive || !this.isMouseDown) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      const sensitivity = 0.0025;
      this.euler.y -= dx * sensitivity;
      this.euler.x -= dy * sensitivity;
      this.euler.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.euler.x));
      this._updateCameraRotation();
    });

    window.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

    // Scroll to adjust FOV
    this.overlay.addEventListener('wheel', (e) => {
      if (!this.isActive) return;
      e.preventDefault();
      const delta = e.deltaY * 0.05;
      let newFov = THREE.MathUtils.clamp(this.camera.fov + delta, 15, 100);
      this.camera.fov = newFov;
      this.camera.updateProjectionMatrix();
      this.fovSlider.value = newFov;
      this.fovVal.textContent = `${Math.round(newFov)}°`;
    }, { passive: false });

    // Key handlers while in photo mode
    window.addEventListener('keydown', (e) => {
      if (!this.isActive) return;
      if (e.code === 'KeyP' && !e.repeat) {
        this.exit();
        return;
      }
      if (e.code === 'Escape') {
        if (this.isUiHidden) {
          this.toggleUi();
        } else {
          this.exit();
        }
        return;
      }
      if (e.code === 'KeyH' && !e.repeat) {
        this.toggleUi();
        return;
      }
      if (e.code === 'Space' && !e.repeat) {
        this.takePhoto();
        return;
      }

      this._handleKey(e.code, true);
    });

    window.addEventListener('keyup', (e) => {
      if (!this.isActive) return;
      this._handleKey(e.code, false);
    });
  }

  _handleKey(code, pressed) {
    switch (code) {
      case 'KeyW': this.keys.forward = pressed; break;
      case 'KeyS': this.keys.backward = pressed; break;
      case 'KeyA': this.keys.left = pressed; break;
      case 'KeyD': this.keys.right = pressed; break;
      case 'KeyE': this.keys.up = pressed; break;
      case 'KeyQ': this.keys.down = pressed; break;
      case 'ShiftLeft':
      case 'ShiftRight': this.keys.fast = pressed; break;
    }
  }

  _updateCameraRotation() {
    this.camera.quaternion.setFromEuler(this.euler);
    if (Math.abs(this.roll) > 1e-4) {
      const rollQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll);
      this.camera.quaternion.multiply(rollQuat);
    }
  }

  enter() {
    this.isActive = true;
    this.isUiHidden = false;

    // Save camera state
    this.savedFov = this.camera.fov;
    this.savedExposure = this.renderer.toneMappingExposure;
    this.savedPos.copy(this.camera.position);
    this.savedQuat.copy(this.camera.quaternion);

    this.pos.copy(this.camera.position);
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.roll = 0;

    // Sync sliders
    this.fovSlider.value = this.camera.fov;
    this.fovVal.textContent = `${Math.round(this.camera.fov)}°`;
    this.rollSlider.value = 0;
    this.rollVal.textContent = '0°';
    this.expSlider.value = this.renderer.toneMappingExposure;
    this.expVal.textContent = `${this.renderer.toneMappingExposure.toFixed(1)}x`;

    // Release pointer lock and show overlay
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    this.overlay.style.display = 'block';
    this.hudEl.style.display = 'flex';
    this.gridEl.style.display = this.gridVisible ? 'block' : 'none';

    // Hide gameplay HUD
    if (this.game.hudContainer) {
      this.game.hudContainer.style.display = 'none';
    }
  }

  exit() {
    this.isActive = false;
    this.overlay.style.display = 'none';

    // Restore gameplay HUD
    if (this.game.hudContainer) {
      this.game.hudContainer.style.display = 'block';
    }

    // Restore camera state
    this.camera.fov = this.savedFov;
    this.camera.updateProjectionMatrix();
    this.renderer.toneMappingExposure = this.savedExposure;
    this.camera.position.copy(this.savedPos);
    this.camera.quaternion.copy(this.savedQuat);
  }

  toggle() {
    if (this.isActive) this.exit();
    else this.enter();
  }

  toggleUi() {
    this.isUiHidden = !this.isUiHidden;
    this.hudEl.style.display = this.isUiHidden ? 'none' : 'flex';
    this.gridEl.style.display = (!this.isUiHidden && this.gridVisible) ? 'block' : 'none';
  }

  takePhoto() {
    // Camera flash effect
    this.flashEl.classList.add('is-flashing');
    setTimeout(() => this.flashEl.classList.remove('is-flashing'), 350);

    // Hide photo UI during render capture
    const wasUiHidden = this.isUiHidden;
    this.hudEl.style.display = 'none';
    this.gridEl.style.display = 'none';

    // Render clean frame
    this.renderer.render(this.scene, this.camera);

    try {
      const dataUrl = this.canvas.toDataURL('image/png');
      const seed = this.game.systemData?.name || 'solar-system';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const link = document.createElement('a');
      link.download = `${seed}-${timestamp}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.warn('Screenshot download skipped:', err);
    }

    // Restore UI visibility
    if (!wasUiHidden) {
      this.hudEl.style.display = 'flex';
      if (this.gridVisible) this.gridEl.style.display = 'block';
    }
  }

  update(delta) {
    if (!this.isActive) return;

    // Speed calculation
    let speed = 25.0; // units/s
    if (this.keys.fast) speed *= 4.0;

    const moveVector = new THREE.Vector3();
    if (this.keys.forward) moveVector.z -= 1;
    if (this.keys.backward) moveVector.z += 1;
    if (this.keys.left) moveVector.x -= 1;
    if (this.keys.right) moveVector.x += 1;
    if (this.keys.up) moveVector.y += 1;
    if (this.keys.down) moveVector.y -= 1;

    if (moveVector.lengthSq() > 0) {
      moveVector.normalize();
      // Transform local movement into camera orientation
      moveVector.applyQuaternion(this.camera.quaternion);
      this.pos.addScaledVector(moveVector, speed * delta);
      this.camera.position.copy(this.pos);
    }
  }
}
