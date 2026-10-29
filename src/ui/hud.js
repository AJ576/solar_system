/**
 * Sci-Fi In-Game Heads-Up Display (HUD)
 * Provides glassmorphism panels, holographic reticle, real-time flight telemetry,
 * heading indicator, velocity direction marker (flight path marker),
 * selected celestial targeting brackets, hyperspace meters, notifications, and controls help.
 */

import * as THREE from 'three';

const HUD_STYLES = `
/* Sci-Fi HUD Root Overlay */
.scifi-hud-root {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
  font-family: 'Share Tech Mono', 'Courier New', monospace;
  color: #d8f4ff;
  overflow: hidden;
  z-index: 100;
  box-sizing: border-box;
}

.scifi-hud-root * {
  box-sizing: border-box;
}

/* Glassmorphism Panel Base */
.hud-panel, .hud-badge, .hud-modal-card {
  background: rgba(6, 14, 28, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 240, 255, 0.28);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6), inset 0 0 15px rgba(0, 240, 255, 0.05);
  border-radius: 4px;
}

/* ------------------------------------------------------------------------- */
/* TOP BAR                                                                   */
/* ------------------------------------------------------------------------- */
.hud-top-bar {
  position: absolute;
  top: 14px;
  left: 18px;
  right: 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  pointer-events: none;
}

.hud-top-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.hud-top-right {
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: auto;
}

.hud-badge {
  padding: 6px 14px;
  font-size: 13px;
  letter-spacing: 0.8px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.hud-label {
  color: #5c9bb5;
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 1.2px;
}

.hud-val {
  color: #00f0ff;
  font-weight: bold;
  text-shadow: 0 0 8px rgba(0, 240, 255, 0.6);
}

.hud-val-seed {
  color: #ffb703;
  text-shadow: 0 0 8px rgba(255, 183, 3, 0.5);
}

.hud-star-val {
  color: #ffa080;
  text-shadow: 0 0 8px rgba(255, 160, 128, 0.5);
}

.hud-divider {
  color: rgba(0, 240, 255, 0.2);
  margin: 0 2px;
}

/* Seed Jump Controls */
.hud-jump-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(6, 14, 28, 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 240, 255, 0.3);
  padding: 4px 6px;
  border-radius: 4px;
}

.hud-seed-input {
  background: rgba(0, 20, 40, 0.6);
  border: 1px solid rgba(0, 240, 255, 0.3);
  border-radius: 3px;
  color: #00f0ff;
  font-family: 'Share Tech Mono', monospace;
  font-size: 12px;
  padding: 5px 8px;
  width: 120px;
  outline: none;
  transition: all 0.2s ease;
  text-transform: uppercase;
}

.hud-seed-input:focus {
  border-color: #00f0ff;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.5);
  width: 150px;
}

.hud-btn {
  background: rgba(0, 60, 90, 0.4);
  border: 1px solid rgba(0, 240, 255, 0.4);
  color: #d8f4ff;
  font-family: 'Share Tech Mono', monospace;
  font-size: 12px;
  font-weight: bold;
  padding: 5px 12px;
  border-radius: 3px;
  cursor: pointer;
  letter-spacing: 0.8px;
  transition: all 0.2s ease;
  pointer-events: auto;
}

.hud-btn:hover {
  background: rgba(0, 240, 255, 0.2);
  border-color: #00f0ff;
  color: #ffffff;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.6);
}

.hud-btn:active {
  transform: translateY(1px);
}

.hud-btn-jump {
  color: #00ffa3;
  border-color: rgba(0, 255, 163, 0.5);
}

.hud-btn-jump:hover {
  background: rgba(0, 255, 163, 0.25);
  border-color: #00ffa3;
  box-shadow: 0 0 12px rgba(0, 255, 163, 0.7);
}

.hud-btn-random {
  color: #ffb703;
  border-color: rgba(255, 183, 3, 0.4);
}

.hud-btn-random:hover {
  background: rgba(255, 183, 3, 0.2);
  border-color: #ffb703;
  box-shadow: 0 0 10px rgba(255, 183, 3, 0.6);
}

.hud-btn-help {
  color: #8ed0ff;
  border-color: rgba(142, 208, 255, 0.35);
}

/* ------------------------------------------------------------------------- */
/* A. SHIP HEADING RETICLE (CENTER CROSSHAIR)                                 */
/* ------------------------------------------------------------------------- */
.hud-reticle-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 90;
}

.hud-reticle-svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 4px rgba(0, 240, 255, 0.7));
}

/* ------------------------------------------------------------------------- */
/* B. VELOCITY DIRECTION INDICATOR (FLIGHT PATH MARKER / PROGRADE)           */
/* ------------------------------------------------------------------------- */
.hud-velocity-marker {
  position: absolute;
  top: 0;
  left: 0;
  width: 32px;
  height: 32px;
  pointer-events: none;
  transform: translate(-50%, -50%);
  z-index: 92;
  filter: drop-shadow(0 0 6px rgba(0, 255, 163, 0.85));
  transition: opacity 0.15s ease;
}

.hud-velocity-marker.hidden {
  opacity: 0 !important;
  visibility: hidden;
}

.hud-velocity-svg {
  width: 100%;
  height: 100%;
}

/* ------------------------------------------------------------------------- */
/* C. SELECTED CELESTIAL TARGET WORLD MARKER                                 */
/* ------------------------------------------------------------------------- */
.hud-target-marker {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  z-index: 94;
  filter: drop-shadow(0 0 6px rgba(255, 183, 3, 0.8));
  transition: opacity 0.15s ease;
}

.hud-target-marker.hidden {
  opacity: 0 !important;
  visibility: hidden;
}

.hud-target-bracket {
  width: 38px;
  height: 38px;
}

.hud-target-tag {
  background: rgba(6, 14, 28, 0.88);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 183, 3, 0.6);
  border-radius: 3px;
  padding: 2px 7px;
  font-size: 11px;
  color: #ffb703;
  white-space: nowrap;
  letter-spacing: 0.8px;
  text-shadow: 0 0 6px rgba(255, 183, 3, 0.6);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.7);
}

/* Off-Screen Target Indicator */
.hud-target-offscreen {
  position: absolute;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(6, 14, 28, 0.9);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 183, 3, 0.5);
  border-radius: 3px;
  padding: 3px 8px;
  color: #ffb703;
  font-size: 11px;
  letter-spacing: 0.8px;
  transform: translate(-50%, -50%);
  z-index: 94;
  text-shadow: 0 0 6px rgba(255, 183, 3, 0.6);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.8);
  white-space: nowrap;
}

.hud-target-offscreen.hidden {
  display: none !important;
}

.hud-offscreen-icon {
  font-size: 12px;
  color: #ffa080;
}

/* ------------------------------------------------------------------------- */
/* BOTTOM LEFT TELEMETRY PANEL                                               */
/* ------------------------------------------------------------------------- */
.hud-telemetry-panel {
  position: absolute;
  bottom: 18px;
  left: 18px;
  width: 250px;
  padding: 14px 16px;
  pointer-events: auto;
}

.hud-panel-title {
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 1.5px;
  color: #5c9bb5;
  margin-bottom: 10px;
  border-bottom: 1px solid rgba(0, 240, 255, 0.2);
  padding-bottom: 4px;
}

.hud-telemetry-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
  font-size: 13px;
}

.hud-gauge-track {
  width: 100%;
  height: 6px;
  background: rgba(0, 240, 255, 0.12);
  border: 1px solid rgba(0, 240, 255, 0.25);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 10px;
}

.hud-gauge-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #0080ff, #00f0ff);
  box-shadow: 0 0 8px #00f0ff;
  transition: width 0.08s ease-out, background 0.3s ease;
}

.hud-gauge-fill.boosting {
  background: linear-gradient(90deg, #00ffa3, #00f0ff);
  box-shadow: 0 0 12px #00ffa3;
}

.hud-boost-fill {
  height: 100%;
  width: 100%;
  background: #00f0ff;
  box-shadow: 0 0 8px #00f0ff;
  transition: width 0.1s ease;
}

.hud-unit {
  font-size: 10px;
  color: #6da4bc;
  margin-left: 2px;
}

.hud-status-ready {
  color: #00ffa3;
  font-weight: bold;
  text-shadow: 0 0 6px rgba(0, 255, 163, 0.6);
}

.hud-status-active {
  color: #00f0ff;
  font-weight: bold;
  text-shadow: 0 0 8px rgba(0, 240, 255, 0.8);
  animation: hud-flash 0.5s infinite alternate;
}

.hud-status-recharge {
  color: #ffaa00;
  font-weight: bold;
  text-shadow: 0 0 6px rgba(255, 170, 0, 0.6);
}

/* ------------------------------------------------------------------------- */
/* BOTTOM RIGHT CELESTIAL TARGETING SCANNER                                   */
/* ------------------------------------------------------------------------- */
.hud-tracker-panel {
  position: absolute;
  bottom: 18px;
  right: 18px;
  width: 270px;
  padding: 14px 16px;
  pointer-events: auto;
}

.hud-approach-indicator {
  font-weight: bold;
  font-size: 11px;
  letter-spacing: 1px;
}

.hud-approach-active {
  color: #00ffa3;
  text-shadow: 0 0 6px rgba(0, 255, 163, 0.6);
}

.hud-approach-receding {
  color: #ffa080;
  text-shadow: 0 0 6px rgba(255, 160, 128, 0.6);
}

.hud-approach-neutral {
  color: #79a6b8;
}

.hud-cycle-row {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(0, 240, 255, 0.15);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.hud-cycle-btn {
  background: rgba(0, 40, 70, 0.6);
  border: 1px solid rgba(0, 240, 255, 0.35);
  color: #8ed0ff;
  font-family: inherit;
  font-size: 10px;
  font-weight: bold;
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
  letter-spacing: 0.6px;
  transition: all 0.2s ease;
  pointer-events: auto;
}

.hud-cycle-btn:hover {
  background: rgba(0, 240, 255, 0.25);
  border-color: #00f0ff;
  color: #ffffff;
}

.hud-key-badge-small {
  background: rgba(0, 40, 70, 0.6);
  border: 1px solid rgba(0, 240, 255, 0.4);
  color: #00f0ff;
  padding: 1px 5px;
  border-radius: 2px;
  font-weight: bold;
  font-size: 10px;
  margin-right: 4px;
}

/* ------------------------------------------------------------------------- */
/* HYPERSPACE INDICATOR & CHARGE BAR                                         */
/* ------------------------------------------------------------------------- */
.hud-hyperspace-container {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  z-index: 105;
}

.hud-hyperspace-prompt {
  font-size: 13px;
  font-weight: bold;
  letter-spacing: 1.5px;
  color: #00f0ff;
  text-shadow: 0 0 10px rgba(0, 240, 255, 0.8);
  background: rgba(6, 14, 28, 0.75);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 240, 255, 0.4);
  padding: 6px 16px;
  border-radius: 4px;
  animation: hud-pulse 2s infinite ease-in-out;
  transition: opacity 0.3s ease, transform 0.2s ease, background 0.2s ease;
  pointer-events: auto;
  cursor: pointer;
}

.hud-hyperspace-prompt:hover {
  background: rgba(0, 240, 255, 0.2);
  border-color: #00f0ff;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.6);
}

.hud-hyperspace-charging {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 240px;
  transition: opacity 0.3s ease;
}

.hud-charge-text {
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 2px;
  color: #00ffa3;
  text-shadow: 0 0 8px rgba(0, 255, 163, 0.8);
}

.hud-charge-track {
  width: 100%;
  height: 8px;
  background: rgba(0, 20, 30, 0.8);
  border: 1px solid rgba(0, 255, 163, 0.5);
  border-radius: 2px;
  overflow: hidden;
  box-shadow: 0 0 10px rgba(0, 255, 163, 0.3);
}

.hud-charge-bar {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #00d4ff, #00ffa3);
  box-shadow: 0 0 10px #00ffa3;
  transition: width 0.05s linear;
}

/* ------------------------------------------------------------------------- */
/* NOTIFICATIONS                                                             */
/* ------------------------------------------------------------------------- */
.hud-notification-banner {
  position: absolute;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(6, 14, 28, 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 240, 255, 0.5);
  padding: 10px 24px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: bold;
  letter-spacing: 2px;
  color: #00f0ff;
  text-shadow: 0 0 10px rgba(0, 240, 255, 0.8);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease, transform 0.3s ease;
  z-index: 110;
}

.hud-notification-banner.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* ------------------------------------------------------------------------- */
/* CONTROLS MODAL                                                            */
/* ------------------------------------------------------------------------- */
.hud-modal-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(2, 6, 14, 0.75);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  z-index: 120;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.25s ease, visibility 0.25s ease;
}

.hud-modal-overlay.open {
  opacity: 1;
  visibility: visible;
}

.hud-modal-card {
  width: 540px;
  max-width: 90vw;
  padding: 24px 28px;
  border: 1px solid rgba(0, 240, 255, 0.5);
  box-shadow: 0 0 30px rgba(0, 240, 255, 0.25), inset 0 0 20px rgba(0, 240, 255, 0.08);
}

.hud-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(0, 240, 255, 0.3);
  padding-bottom: 12px;
  margin-bottom: 18px;
}

.hud-modal-title {
  font-size: 16px;
  font-weight: bold;
  letter-spacing: 2px;
  color: #00f0ff;
  text-shadow: 0 0 10px rgba(0, 240, 255, 0.6);
}

.hud-modal-close {
  background: none;
  border: none;
  color: #8ed0ff;
  font-size: 22px;
  cursor: pointer;
  padding: 0 6px;
  line-height: 1;
  transition: color 0.2s ease;
}

.hud-modal-close:hover {
  color: #ff3366;
}

.hud-controls-grid {
  display: grid;
  grid-template-columns: 140px 1fr;
  row-gap: 10px;
  column-gap: 16px;
  font-size: 13px;
  align-items: center;
}

.hud-key-badge {
  background: rgba(0, 40, 70, 0.6);
  border: 1px solid rgba(0, 240, 255, 0.4);
  color: #00f0ff;
  padding: 3px 8px;
  border-radius: 3px;
  font-weight: bold;
  text-align: center;
  white-space: nowrap;
}

.hud-action-desc {
  color: #e0f7fc;
  letter-spacing: 0.5px;
}

.hud-modal-footer {
  margin-top: 20px;
  border-top: 1px solid rgba(0, 240, 255, 0.15);
  padding-top: 12px;
  font-size: 11px;
  color: #5c9bb5;
  text-align: center;
  letter-spacing: 1px;
}

/* Animations */
@keyframes hud-pulse {
  0%, 100% { opacity: 0.85; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.02); }
}

@keyframes hud-flash {
  0% { opacity: 0.6; }
  100% { opacity: 1; }
}

.hud-hidden {
  display: none !important;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .hud-top-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .hud-telemetry-panel, .hud-tracker-panel {
    width: 210px;
    padding: 10px 12px;
  }
  .hud-seed-input {
    width: 90px;
  }
}
`;

export class HUD {
  /**
   * @param {HTMLElement} container Parent DOM element
   * @param {Function} [onJumpRequested] Callback when jump is requested
   * @param {Function} [onTargetNext] Callback to cycle next celestial target
   * @param {Function} [onTargetPrev] Callback to cycle previous celestial target
   */
  constructor(container, onJumpRequested = null, onTargetNext = null, onTargetPrev = null) {
    this.container = container || (typeof document !== 'undefined' ? document.body : null);
    this.onJumpRequested = typeof onJumpRequested === 'function' ? onJumpRequested : () => {};
    this.onTargetNext = typeof onTargetNext === 'function' ? onTargetNext : () => {};
    this.onTargetPrev = typeof onTargetPrev === 'function' ? onTargetPrev : () => {};

    this.notificationTimeout = null;
    this.isHelpOpen = false;

    // Cache state to avoid unnecessary DOM string replacements
    this.cachedState = {
      speed: null,
      throttle: null,
      boostStatus: null,
      boostPercent: null,
      targetName: null,
      targetType: null,
      targetDist: null,
      targetApproach: null,
      isCharging: null,
      chargePercent: null,
      hyperspacePromptVisible: null,
      systemName: null,
      systemSeed: null,
      starType: null,
    };

    // Reusable math primitives for screen projections
    this._tempV = new THREE.Vector3();
    this._tempV2 = new THREE.Vector3();
    this._camDir = new THREE.Vector3();

    if (this.container && typeof document !== 'undefined') {
      this._injectStyles();
      this._buildDOM();
      this._bindEvents();
    }
  }

  _injectStyles() {
    if (typeof document === 'undefined') return;
    const styleId = 'scifi-hud-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = HUD_STYLES;
      document.head.appendChild(style);
      this.styleElement = style;
    }
  }

  _buildDOM() {
    const root = document.createElement('div');
    root.className = 'scifi-hud-root';
    root.innerHTML = `
      <!-- Top Bar -->
      <header class="hud-top-bar">
        <div class="hud-top-left">
          <div class="hud-badge hud-system-badge">
            <span class="hud-label">SYSTEM:</span>
            <span class="hud-val hud-el-sys-name">ALPHA CENTAURI</span>
            <span class="hud-divider">|</span>
            <span class="hud-label">SEED:</span>
            <span class="hud-val-seed hud-el-sys-seed">#SOL-001</span>
          </div>
          <div class="hud-badge hud-star-badge">
            <span class="hud-label">STAR:</span>
            <span class="hud-star-val hud-el-star-type">G2V YELLOW DWARF</span>
          </div>
        </div>

        <div class="hud-top-right">
          <div class="hud-jump-controls">
            <input type="text" class="hud-seed-input hud-el-seed-input" placeholder="SEED..." maxlength="24" spellcheck="false" autocomplete="off" />
            <button class="hud-btn hud-btn-jump hud-el-btn-jump" title="Engage Hyperspace Jump to Seed">JUMP [H]</button>
            <button class="hud-btn hud-btn-random hud-el-btn-random" title="Random Procedural Star System">RANDOM</button>
          </div>
          <button class="hud-btn hud-btn-help hud-el-btn-help" title="Toggle Controls Manual (F1 / ?)">[F1 / ?] CONTROLS</button>
        </div>
      </header>

      <!-- A. Ship Heading Indicator (Center Nose Crosshair) -->
      <div class="hud-reticle-container">
        <svg class="hud-reticle-svg" viewBox="0 0 100 100">
          <!-- Center targeting pip -->
          <circle cx="50" cy="50" r="1.5" fill="#00f0ff" />
          <!-- Inner reticle ring with gap notches -->
          <circle cx="50" cy="50" r="14" fill="none" stroke="#00f0ff" stroke-width="0.75" stroke-dasharray="8 3" opacity="0.7" />
          <!-- Horizon & Pitch markers -->
          <line x1="24" y1="50" x2="34" y2="50" stroke="#00f0ff" stroke-width="1.2" opacity="0.8" />
          <line x1="34" y1="46" x2="34" y2="54" stroke="#00f0ff" stroke-width="0.8" opacity="0.8" />
          <line x1="66" y1="50" x2="76" y2="50" stroke="#00f0ff" stroke-width="1.2" opacity="0.8" />
          <line x1="66" y1="46" x2="66" y2="54" stroke="#00f0ff" stroke-width="0.8" opacity="0.8" />
        </svg>
      </div>

      <!-- B. Velocity Direction Indicator (Flight Path Marker / Prograde Vector) -->
      <div class="hud-velocity-marker hud-el-vel-marker hidden" title="Velocity Direction / Flight Path Marker">
        <svg class="hud-velocity-svg" viewBox="-16 -16 32 32">
          <circle cx="0" cy="0" r="4.5" fill="none" stroke="#00ffa3" stroke-width="1.4" />
          <line x1="-12" y1="0" x2="-4.5" y2="0" stroke="#00ffa3" stroke-width="1.4" />
          <line x1="4.5" y1="0" x2="12" y2="0" stroke="#00ffa3" stroke-width="1.4" />
          <line x1="0" y1="-4.5" x2="0" y2="-11" stroke="#00ffa3" stroke-width="1.4" />
        </svg>
      </div>

      <!-- C. Selected Celestial Target World Marker -->
      <div class="hud-target-marker hud-el-target-marker hidden">
        <svg class="hud-target-bracket" viewBox="-18 -18 36 36">
          <polygon points="0,-14 14,0 0,14 -14,0" fill="rgba(255,183,3,0.08)" stroke="#ffb703" stroke-width="1.5" stroke-dasharray="9 4" />
          <circle cx="0" cy="0" r="1.5" fill="#ffb703" />
        </svg>
        <div class="hud-target-tag hud-el-target-tag">TARGET [0 u]</div>
      </div>

      <!-- Off-Screen Target Edge Indicator -->
      <div class="hud-target-offscreen hud-el-target-offscreen hidden">
        <span class="hud-offscreen-icon hud-el-offscreen-icon">◀</span>
        <span class="hud-el-offscreen-text">TARGET [1,200u]</span>
      </div>

      <!-- Bottom Left Telemetry Panel -->
      <aside class="hud-panel hud-telemetry-panel">
        <div class="hud-panel-title">// FLIGHT TELEMETRY</div>
        <div class="hud-telemetry-row">
          <span class="hud-label">VELOCITY:</span>
          <div><span class="hud-val hud-el-speed">0.0</span><span class="hud-unit">u/s</span></div>
        </div>
        <div class="hud-gauge-track">
          <div class="hud-gauge-fill hud-el-speed-gauge"></div>
        </div>
        <div class="hud-telemetry-row">
          <span class="hud-label">THROTTLE:</span>
          <span class="hud-val hud-el-throttle">0%</span>
        </div>
        <div class="hud-telemetry-row">
          <span class="hud-label">BOOST:</span>
          <span class="hud-el-boost-status hud-status-ready">READY</span>
        </div>
        <div class="hud-gauge-track">
          <div class="hud-boost-fill hud-el-boost-gauge"></div>
        </div>
      </aside>

      <!-- Bottom Right Celestial Targeting Scanner -->
      <aside class="hud-panel hud-tracker-panel">
        <div class="hud-panel-title">// TARGETING SCANNER</div>
        <div class="hud-telemetry-row">
          <span class="hud-label">TARGET:</span>
          <span class="hud-val hud-el-target-name">SOL</span>
        </div>
        <div class="hud-telemetry-row">
          <span class="hud-label">CLASS:</span>
          <span class="hud-val hud-el-target-type">STAR</span>
        </div>
        <div class="hud-telemetry-row">
          <span class="hud-label">DISTANCE:</span>
          <div><span class="hud-val hud-el-target-dist">120.0</span><span class="hud-unit">u</span></div>
        </div>
        <div class="hud-telemetry-row">
          <span class="hud-label">TRAJECTORY:</span>
          <span class="hud-approach-indicator hud-el-target-approach hud-approach-neutral">HOLDING</span>
        </div>
        <div class="hud-cycle-row">
          <button class="hud-cycle-btn hud-el-btn-cycle-prev" title="Previous Celestial Target [Shift+T]">◀ PREV</button>
          <span><span class="hud-key-badge-small">[T]</span>CYCLE</span>
          <button class="hud-cycle-btn hud-el-btn-cycle-next" title="Next Celestial Target [T]">NEXT ▶</button>
        </div>
      </aside>

      <!-- Hyperspace Prompt & Charging Indicator -->
      <div class="hud-hyperspace-container">
        <div class="hud-hyperspace-prompt hud-el-hyper-prompt">
          PRESS <kbd>[H]</kbd> TO ENGAGE HYPERSPACE
        </div>
        <div class="hud-hyperspace-charging hud-el-hyper-charging hud-hidden">
          <div class="hud-charge-text hud-el-charge-text">SPOOLING WARP DRIVE...</div>
          <div class="hud-charge-track">
            <div class="hud-charge-bar hud-el-charge-bar"></div>
          </div>
        </div>
      </div>

      <!-- Notifications -->
      <div class="hud-notification-banner hud-el-notification">SYSTEM LOADED</div>

      <!-- Controls Help Modal -->
      <div class="hud-modal-overlay hud-el-modal">
        <div class="hud-modal-card">
          <div class="hud-modal-header">
            <span class="hud-modal-title">STARFIGHTER FLIGHT CONTROLS</span>
            <button class="hud-modal-close hud-el-modal-close">&times;</button>
          </div>
          <div class="hud-controls-grid">
            <span class="hud-key-badge">W / S</span>
            <span class="hud-action-desc">Thrust Forward / Reverse (Linear Acceleration)</span>

            <span class="hud-key-badge">A / D</span>
            <span class="hud-action-desc">Yaw Left / Right (Steer Nose)</span>

            <span class="hud-key-badge">Q / E</span>
            <span class="hud-action-desc">Roll Left / Right (Bank Wings)</span>

            <span class="hud-key-badge">SPACE</span>
            <span class="hud-action-desc">Afterburner Boost (Explosive Velocity Surge)</span>

            <span class="hud-key-badge">SHIFT</span>
            <span class="hud-action-desc">Active Retro-Braking (Vector Cancellation to Dead Stop)</span>

            <span class="hud-key-badge">MOUSE</span>
            <span class="hud-action-desc">1:1 Direct Pitch & Yaw (Click to lock/unlock pointer)</span>

            <span class="hud-key-badge">T / SHIFT+T</span>
            <span class="hud-action-desc">Cycle Next / Previous Celestial Body Target</span>

            <span class="hud-key-badge">H</span>
            <span class="hud-action-desc">Engage Hyperspace Jump to New System</span>

            <span class="hud-key-badge">F1 / ?</span>
            <span class="hud-action-desc">Toggle Controls Manual Modal</span>
          </div>
          <div class="hud-modal-footer">
            Press [ESC] or [F1] to return to flight cockpit
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(root);
    this.root = root;

    // Cache element references for 60fps performance
    this.el = {
      sysName: root.querySelector('.hud-el-sys-name'),
      sysSeed: root.querySelector('.hud-el-sys-seed'),
      starType: root.querySelector('.hud-el-star-type'),
      seedInput: root.querySelector('.hud-el-seed-input'),
      btnJump: root.querySelector('.hud-el-btn-jump'),
      btnRandom: root.querySelector('.hud-el-btn-random'),
      btnHelp: root.querySelector('.hud-el-btn-help'),
      velMarker: root.querySelector('.hud-el-vel-marker'),
      targetMarker: root.querySelector('.hud-el-target-marker'),
      targetTag: root.querySelector('.hud-el-target-tag'),
      targetOffscreen: root.querySelector('.hud-el-target-offscreen'),
      offscreenIcon: root.querySelector('.hud-el-offscreen-icon'),
      offscreenText: root.querySelector('.hud-el-offscreen-text'),
      btnCyclePrev: root.querySelector('.hud-el-btn-cycle-prev'),
      btnCycleNext: root.querySelector('.hud-el-btn-cycle-next'),
      speed: root.querySelector('.hud-el-speed'),
      speedGauge: root.querySelector('.hud-el-speed-gauge'),
      throttle: root.querySelector('.hud-el-throttle'),
      boostStatus: root.querySelector('.hud-el-boost-status'),
      boostGauge: root.querySelector('.hud-el-boost-gauge'),
      targetName: root.querySelector('.hud-el-target-name'),
      targetType: root.querySelector('.hud-el-target-type'),
      targetDist: root.querySelector('.hud-el-target-dist'),
      targetApproach: root.querySelector('.hud-el-target-approach'),
      hyperPrompt: root.querySelector('.hud-el-hyper-prompt'),
      hyperCharging: root.querySelector('.hud-el-hyper-charging'),
      chargeText: root.querySelector('.hud-el-charge-text'),
      chargeBar: root.querySelector('.hud-el-charge-bar'),
      notification: root.querySelector('.hud-el-notification'),
      modal: root.querySelector('.hud-el-modal'),
      modalClose: root.querySelector('.hud-el-modal-close'),
    };
  }

  _bindEvents() {
    // Jump button
    this._onJumpClick = () => {
      const seed = this.el.seedInput.value.trim() || this._generateRandomSeed();
      this.el.seedInput.value = seed;
      this.onJumpRequested(seed);
    };
    this.el.btnJump.addEventListener('click', this._onJumpClick);

    // Random system button
    this._onRandomClick = () => {
      const seed = this._generateRandomSeed();
      this.el.seedInput.value = seed;
      this.onJumpRequested(seed);
    };
    this.el.btnRandom.addEventListener('click', this._onRandomClick);

    // Prompt banner clicks
    this._onPromptClick = () => {
      this._onJumpClick();
    };
    this.el.hyperPrompt.addEventListener('click', this._onPromptClick);

    // Targeting cycle buttons
    if (this.el.btnCycleNext) {
      this.el.btnCycleNext.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onTargetNext();
      });
    }
    if (this.el.btnCyclePrev) {
      this.el.btnCyclePrev.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onTargetPrev();
      });
    }

    // Seed input Enter key
    this._onInputKeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._onJumpClick();
        this.el.seedInput.blur();
      }
    };
    this.el.seedInput.addEventListener('keydown', this._onInputKeydown);

    // Toggle help
    this._toggleHelp = () => {
      this.isHelpOpen = !this.isHelpOpen;
      if (this.isHelpOpen) {
        this.el.modal.classList.add('open');
      } else {
        this.el.modal.classList.remove('open');
      }
    };
    this.el.btnHelp.addEventListener('click', this._toggleHelp);
    this.el.modalClose.addEventListener('click', this._toggleHelp);

    this._onModalClick = (e) => {
      if (e.target === this.el.modal) {
        this._toggleHelp();
      }
    };
    this.el.modal.addEventListener('click', this._onModalClick);

    // Global keyboard hotkeys
    this._onWindowKeydown = (e) => {
      const isInputFocused =
        document.activeElement === this.el.seedInput ||
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA';

      // F1 or ? toggles help
      if (e.key === 'F1' || (!isInputFocused && (e.key === '?' || (e.key === '/' && e.shiftKey)))) {
        e.preventDefault();
        this._toggleHelp();
        return;
      }

      // Escape closes help or blurs input
      if (e.key === 'Escape') {
        if (this.isHelpOpen) {
          e.preventDefault();
          this._toggleHelp();
        } else if (isInputFocused) {
          document.activeElement.blur();
        }
        return;
      }

      // Target cycling: T or Shift+T
      if ((e.key === 't' || e.key === 'T') && !isInputFocused && !this.isHelpOpen) {
        e.preventDefault();
        if (e.shiftKey) {
          this.onTargetPrev();
        } else {
          this.onTargetNext();
        }
        return;
      }

      // H triggers hyperspace jump
      if ((e.key === 'h' || e.key === 'H') && !isInputFocused && !this.isHelpOpen) {
        e.preventDefault();
        const seed = this.el.seedInput.value.trim() || this._generateRandomSeed();
        this.onJumpRequested(seed);
      }
    };
    window.addEventListener('keydown', this._onWindowKeydown);
  }

  _generateRandomSeed() {
    const prefixes = [
      'ALPHA', 'CENTAURI', 'VEGA', 'ORION', 'KEPLER', 'CYGNUS',
      'SOLIS', 'DRACO', 'PEGASUS', 'ANDROMEDA', 'GLIESE', 'SIRIUS'
    ];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const num = Math.floor(Math.random() * 900) + 100;
    return `${prefix}-${num}`;
  }

  showNotification(message, duration = 3000) {
    if (!this.el) return;
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
    }

    this.el.notification.textContent = message;
    this.el.notification.classList.add('visible');

    this.notificationTimeout = setTimeout(() => {
      if (this.el && this.el.notification) {
        this.el.notification.classList.remove('visible');
      }
      this.notificationTimeout = null;
    }, duration);
  }

  /**
   * Helper to clamp and position offscreen target edge pointer.
   * @private
   */
  _positionOffscreenIndicator(screenX, screenY, targetingData) {
    if (!this.el.targetOffscreen) return;

    if (typeof window === 'undefined') return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const margin = 50;

    // Center-relative coordinates
    const cx = w * 0.5;
    const cy = h * 0.5;
    let dx = screenX - cx;
    let dy = screenY - cy;

    const angle = Math.atan2(dy, dx);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Compute ray intersection with screen border box
    const halfW = (w - margin * 2) * 0.5;
    const halfH = (h - margin * 2) * 0.5;

    let edgeX = 0;
    let edgeY = 0;

    if (Math.abs(cos * halfH) > Math.abs(sin * halfW)) {
      edgeX = cos > 0 ? halfW : -halfW;
      edgeY = (edgeX / cos) * sin;
    } else {
      edgeY = sin > 0 ? halfH : -halfH;
      edgeX = (edgeY / sin) * cos;
    }

    const posX = cx + edgeX;
    const posY = cy + edgeY;

    // Direction arrow glyph based on quadrant
    let glyph = '◀';
    if (Math.abs(dx) > Math.abs(dy)) {
      glyph = dx > 0 ? '▶' : '◀';
    } else {
      glyph = dy > 0 ? '▼' : '▲';
    }

    this.el.targetOffscreen.style.transform = `translate(${posX.toFixed(1)}px, ${posY.toFixed(1)}px)`;
    this.el.targetOffscreen.classList.remove('hidden');

    if (this.el.offscreenIcon) this.el.offscreenIcon.textContent = glyph;
    if (this.el.offscreenText) {
      const distStr = targetingData.distance < 1000 ? `${targetingData.distance.toFixed(0)}u` : `${(targetingData.distance / 1000).toFixed(1)}ku`;
      this.el.offscreenText.textContent = `${targetingData.name} [${distStr}]`;
    }
  }

  /**
   * Updates HUD readouts with flight telemetry, indicators, and targeting.
   * Call every animation frame.
   *
   * @param {Object} [telemetry] Flight telemetry
   * @param {Object} [targetingTelemetry] Targeted celestial body telemetry
   * @param {Object} [hyperspaceState] Hyperspace drive state
   * @param {Object} [systemData] Procedural solar system configuration
   * @param {THREE.PerspectiveCamera} [camera] Active 3D camera for projections
   */
  update(telemetry = {}, targetingTelemetry = null, hyperspaceState = {}, systemData = null, camera = null) {
    if (!this.el) return;

    // -------------------------------------------------------------
    // 1. Flight Telemetry Readouts
    // -------------------------------------------------------------
    const speedRaw = telemetry?.speed ?? (typeof telemetry?.velocity === 'number' ? telemetry.velocity : (telemetry?.velocity?.length ? telemetry.velocity.length() : 0));
    const speed = Math.max(0, speedRaw);
    const maxSpeed = telemetry?.maxSpeed || 160;
    const speedPercent = Math.min(100, (speed / maxSpeed) * 100);

    const speedStr = speed.toFixed(1);
    if (this.cachedState.speed !== speedStr) {
      this.el.speed.textContent = speedStr;
      this.el.speedGauge.style.width = `${speedPercent}%`;
      this.cachedState.speed = speedStr;
    }

    const throttleRaw = telemetry?.throttle ?? 0;
    const throttlePercent = Math.round(throttleRaw <= 1 && throttleRaw >= 0 ? throttleRaw * 100 : throttleRaw);
    if (this.cachedState.throttle !== throttlePercent) {
      this.el.throttle.textContent = `${throttlePercent}%`;
      this.cachedState.throttle = throttlePercent;
    }

    const isBoosting = !!(telemetry?.isBoosting || telemetry?.boosting);
    const boostPercentRaw = telemetry?.boostPercent ?? telemetry?.boost ?? telemetry?.boostEnergy ?? 1;
    const boostPercent = Math.max(0, Math.min(100, boostPercentRaw <= 1 ? boostPercentRaw * 100 : boostPercentRaw));

    if (this.cachedState.boostPercent !== boostPercent || this.cachedState.isBoosting !== isBoosting) {
      this.el.boostGauge.style.width = `${boostPercent}%`;
      if (isBoosting) {
        this.el.speedGauge.classList.add('boosting');
        this.el.boostStatus.textContent = 'ACTIVE';
        this.el.boostStatus.className = 'hud-el-boost-status hud-status-active';
      } else if (boostPercent >= 98) {
        this.el.speedGauge.classList.remove('boosting');
        this.el.boostStatus.textContent = 'READY';
        this.el.boostStatus.className = 'hud-el-boost-status hud-status-ready';
      } else {
        this.el.speedGauge.classList.remove('boosting');
        this.el.boostStatus.textContent = `RECHARGE (${Math.round(boostPercent)}%)`;
        this.el.boostStatus.className = 'hud-el-boost-status hud-status-recharge';
      }
      this.cachedState.boostPercent = boostPercent;
      this.cachedState.isBoosting = isBoosting;
    }

    // -------------------------------------------------------------
    // 2. Velocity Direction Indicator (Flight Path Marker / Prograde)
    // -------------------------------------------------------------
    if (camera && this.el.velMarker && typeof window !== 'undefined') {
      const vel = telemetry?.velocity;
      const curSpeed = telemetry?.speed ?? (vel ? vel.length() : 0);

      // Only display velocity marker if the ship has meaningful physical motion (>1.2 u/s)
      if (vel && curSpeed > 1.2) {
        // Project a forward-reaching world vector along velocity direction
        this._tempV.copy(vel).normalize().multiplyScalar(1000.0).add(camera.position);

        this._camDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
        const toPoint = this._tempV2.copy(this._tempV).sub(camera.position);

        // Check if velocity vector is in front of the camera
        const inFront = toPoint.dot(this._camDir) > 0.001;

        if (inFront) {
          this._tempV.project(camera);
          const halfW = window.innerWidth * 0.5;
          const halfH = window.innerHeight * 0.5;
          const sx = (this._tempV.x * halfW) + halfW;
          const sy = -(this._tempV.y * halfH) + halfH;

          if (sx >= -20 && sx <= window.innerWidth + 20 && sy >= -20 && sy <= window.innerHeight + 20) {
            this.el.velMarker.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
            this.el.velMarker.classList.remove('hidden');
          } else {
            this.el.velMarker.classList.add('hidden');
          }
        } else {
          // Retrograde motion (moving away behind camera)
          this.el.velMarker.classList.add('hidden');
        }
      } else {
        this.el.velMarker.classList.add('hidden');
      }
    }

    // -------------------------------------------------------------
    // 3. Selected Celestial Target World Marker
    // -------------------------------------------------------------
    if (camera && targetingTelemetry && targetingTelemetry.position && this.el.targetMarker && typeof window !== 'undefined') {
      const targetPos = targetingTelemetry.position;
      this._camDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
      const toTarget = this._tempV2.copy(targetPos).sub(camera.position);
      const inFront = toTarget.dot(this._camDir) > 0.001;

      if (inFront) {
        this._tempV.copy(targetPos).project(camera);
        const halfW = window.innerWidth * 0.5;
        const halfH = window.innerHeight * 0.5;
        const sx = (this._tempV.x * halfW) + halfW;
        const sy = -(this._tempV.y * halfH) + halfH;

        const pad = 36;
        const onScreen = (sx >= pad && sx <= window.innerWidth - pad && sy >= pad && sy <= window.innerHeight - pad);

        if (onScreen) {
          this.el.targetMarker.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
          this.el.targetMarker.classList.remove('hidden');

          if (this.el.targetTag) {
            const distStr = targetingTelemetry.distance < 1000 ? `${targetingTelemetry.distance.toFixed(0)}u` : `${(targetingTelemetry.distance / 1000).toFixed(1)}ku`;
            this.el.targetTag.textContent = `${targetingTelemetry.name.toUpperCase()} [${distStr}]`;
          }

          if (this.el.targetOffscreen) {
            this.el.targetOffscreen.classList.add('hidden');
          }
        } else {
          // In front of camera but outside screen rectangle
          this.el.targetMarker.classList.add('hidden');
          this._positionOffscreenIndicator(sx, sy, targetingTelemetry);
        }
      } else {
        // Target is behind camera: project inverted vector to determine off-screen edge angle
        this.el.targetMarker.classList.add('hidden');
        this._tempV.copy(targetPos).sub(camera.position).negate();
        this._tempV.copy(camera.position).add(this._tempV).project(camera);
        const halfW = window.innerWidth * 0.5;
        const halfH = window.innerHeight * 0.5;
        const sx = (-this._tempV.x * halfW) + halfW;
        const sy = (this._tempV.y * halfH) + halfH;
        this._positionOffscreenIndicator(sx, sy, targetingTelemetry);
      }
    } else {
      if (this.el.targetMarker) this.el.targetMarker.classList.add('hidden');
      if (this.el.targetOffscreen) this.el.targetOffscreen.classList.add('hidden');
    }

    // -------------------------------------------------------------
    // 4. Celestial Tracker Scanner Panel
    // -------------------------------------------------------------
    if (targetingTelemetry) {
      const name = targetingTelemetry.name || 'UNKNOWN BODY';
      const type = (targetingTelemetry.type || 'PLANET').toUpperCase();
      const dist = typeof targetingTelemetry.distance === 'number' ? targetingTelemetry.distance.toFixed(1) : String(targetingTelemetry.distance || '--');

      if (this.cachedState.targetName !== name) {
        this.el.targetName.textContent = name;
        this.cachedState.targetName = name;
      }
      if (this.cachedState.targetType !== type) {
        this.el.targetType.textContent = type;
        this.cachedState.targetType = type;
      }
      if (this.cachedState.targetDist !== dist) {
        this.el.targetDist.textContent = dist;
        this.cachedState.targetDist = dist;
      }

      // Approach Indicator
      let approach = 'HOLDING';
      let approachClass = 'hud-approach-neutral';
      if (targetingTelemetry.isApproaching === true) {
        const speedStr = Math.abs(targetingTelemetry.closingSpeed || 0).toFixed(1);
        approach = `▲ CLOSING (${speedStr} u/s)`;
        approachClass = 'hud-approach-active';
      } else if (targetingTelemetry.isApproaching === false && Math.abs(targetingTelemetry.closingSpeed || 0) > 0.5) {
        const speedStr = Math.abs(targetingTelemetry.closingSpeed || 0).toFixed(1);
        approach = `▼ RECEDING (${speedStr} u/s)`;
        approachClass = 'hud-approach-receding';
      } else if (typeof targetingTelemetry.closingSpeed === 'number') {
        approach = `HOLDING (0.0 u/s)`;
      }

      if (this.cachedState.targetApproach !== approach) {
        this.el.targetApproach.textContent = approach;
        this.el.targetApproach.className = `hud-approach-indicator hud-el-target-approach ${approachClass}`;
        this.cachedState.targetApproach = approach;
      }
    } else {
      if (this.cachedState.targetName !== 'NO TARGET') {
        this.el.targetName.textContent = 'NO TARGET';
        this.el.targetType.textContent = 'DEEP SPACE';
        this.el.targetDist.textContent = '--';
        this.el.targetApproach.textContent = 'STANDBY';
        this.el.targetApproach.className = 'hud-approach-indicator hud-el-target-approach hud-approach-neutral';
        this.cachedState.targetName = 'NO TARGET';
        this.cachedState.targetType = 'DEEP SPACE';
        this.cachedState.targetDist = '--';
        this.cachedState.targetApproach = 'STANDBY';
      }
    }

    // -------------------------------------------------------------
    // 5. Hyperspace Status & Progress Bar
    // -------------------------------------------------------------
    const isCharging = !!(hyperspaceState?.isCharging || hyperspaceState?.charging || hyperspaceState?.isJumping || hyperspaceState?.jumping);
    const chargeProgressRaw = hyperspaceState?.progress ?? hyperspaceState?.chargePercent ?? 0;
    const chargePercent = Math.min(100, Math.max(0, Math.round(chargeProgressRaw <= 1 ? chargeProgressRaw * 100 : chargeProgressRaw)));

    if (this.cachedState.isCharging !== isCharging || this.cachedState.chargePercent !== chargePercent) {
      if (isCharging) {
        this.el.hyperPrompt.classList.add('hud-hidden');
        this.el.hyperCharging.classList.remove('hud-hidden');
        this.el.chargeBar.style.width = `${chargePercent}%`;

        if (hyperspaceState?.isJumping || chargePercent >= 100) {
          this.el.chargeText.textContent = 'WARPING INTO HYPERSPACE...';
        } else {
          this.el.chargeText.textContent = `SPOOLING WARP DRIVE (${chargePercent}%)...`;
        }
      } else {
        const canJump = hyperspaceState?.ready !== false && hyperspaceState?.canJump !== false;
        if (canJump) {
          this.el.hyperPrompt.classList.remove('hud-hidden');
        } else {
          this.el.hyperPrompt.classList.add('hud-hidden');
        }
        this.el.hyperCharging.classList.add('hud-hidden');
        this.el.chargeBar.style.width = '0%';
      }
      this.cachedState.isCharging = isCharging;
      this.cachedState.chargePercent = chargePercent;
    }

    // -------------------------------------------------------------
    // 6. System Header Badges
    // -------------------------------------------------------------
    if (systemData) {
      const sysName = (systemData.name || 'UNKNOWN SYSTEM').toUpperCase();
      const sysSeed = String(systemData.seed || '#---').toUpperCase();
      const starType = (systemData.star?.type || 'STAR').toUpperCase();

      if (this.cachedState.systemName !== sysName) {
        this.el.sysName.textContent = sysName;
        this.cachedState.systemName = sysName;
      }
      if (this.cachedState.systemSeed !== sysSeed) {
        this.el.sysSeed.textContent = sysSeed.startsWith('#') ? sysSeed : `#${sysSeed}`;
        this.cachedState.systemSeed = sysSeed;
      }
      if (this.cachedState.starType !== starType) {
        this.el.starType.textContent = starType;
        this.cachedState.starType = starType;
      }
    }
  }

  dispose() {
    if (typeof window !== 'undefined' && this._onWindowKeydown) {
      window.removeEventListener('keydown', this._onWindowKeydown);
    }
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
      this.notificationTimeout = null;
    }
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    if (this.styleElement && this.styleElement.parentNode) {
      this.styleElement.parentNode.removeChild(this.styleElement);
    }
  }
}

export default HUD;
