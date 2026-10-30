import * as THREE from 'three';
import { KM_PER_UNIT } from '../utils/scale.js';

/**
 * HUD — restrained instrument-style overlay.
 *
 * Styles live in src/style.css (all classes prefixed `hud-`).
 * Per-frame positioned markers only ever get their `transform` written from JS;
 * none of them has a CSS transition on transform.
 */

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function fmtDistance(units) {
  if (units == null || !Number.isFinite(units)) return '—';
  const d = units * KM_PER_UNIT;
  const a = Math.abs(d);
  if (a < 1) return `${nf0.format(d * 1000)} m`;
  if (a >= 1e9) return `${(d / 1e9).toFixed(2)}B km`;
  if (a >= 1e6) return `${(d / 1e6).toFixed(2)}M km`;
  if (a < 10) return `${nf1.format(d)} km`;
  if (a < 1000) return `${nf0.format(d)} km`;
  // 12,400 km — round to 3 significant-ish figures for calm readouts
  const step = a >= 100000 ? 1000 : a >= 10000 ? 100 : 10;
  return `${nf0.format(Math.round(d / step) * step)} km`;
}

function fmtSpeedNumber(units) {
  if (units == null || !Number.isFinite(units)) return '0';
  const s = units * KM_PER_UNIT;
  const a = Math.abs(s);
  if (a < 10) return nf1.format(s);
  return nf0.format(s);
}

function fmtSpeed(s) {
  return `${fmtSpeedNumber(s)} km/s`;
}

function fmtEta(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0 || sec > 3600) return null;
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function generateRandomSeed() {
  const prefixes = [
    'ALPHA', 'CENTAURI', 'VEGA', 'ORION', 'KEPLER', 'CYGNUS',
    'SOLIS', 'DRACO', 'PEGASUS', 'ANDROMEDA', 'GLIESE', 'SIRIUS',
  ];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${prefix}-${num}`;
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

const SVG_RETICLE = `
<svg viewBox="-14 -14 28 28" fill="none" stroke="#eef0f4" stroke-width="1.25" stroke-linecap="round">
  <circle r="1.1" fill="#eef0f4" stroke="none"/>
  <path d="M-11 0H-6M6 0H11M0 6V9"/>
</svg>`;

const SVG_FPM = `
<svg viewBox="-13 -13 26 26" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
  <circle r="5"/>
  <path d="M-5 0H-11M5 0H11M0 -5V-10"/>
</svg>`;

const SVG_ARROW = `
<svg viewBox="-11 -11 22 22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <path d="M-3 -7L5 0L-3 7"/>
</svg>`;

const HELP_GROUPS = [
  {
    title: 'Flight',
    rows: [
      [['Mouse'], 'Pitch and yaw — click to capture, Esc to release'],
      [['A', 'D'], 'Yaw'],
      [['Q', 'E'], 'Roll'],
      [['W', 'S'], 'Throttle up / down'],
      [['X'], 'Cut throttle'],
      [['Space'], 'Boost'],
      [['Shift'], 'Brake'],
      [['C'], 'Toggle cruise drive — fast travel, slows automatically near bodies'],
    ],
  },
  {
    title: 'Surface',
    rows: [
      [['G'], 'Land — within 300 m of the ground and below 500 m/s'],
      [['W'], 'Take off when landed'],
      [['F'], 'Step out of the ship / board it again'],
      [['W', 'A', 'S', 'D'], 'Walk'],
      [['Shift'], 'Run'],
      [['Space'], 'Jump / swim up'],
      [['N'], 'Lights on / off (ship headlight, or your lantern on foot)'],
    ],
  },
  {
    title: 'Navigation',
    rows: [
      [['T', 'Shift+T'], 'Next / previous target'],
      [['R'], 'Target the body nearest the crosshair'],
      [['L'], 'Target list'],
      [['H'], 'Hyperspace jump (uses the seed field, or a random seed)'],
      [['M'], 'Mute / unmute audio & ambient music'],
      [['F1', '?'], 'Show / hide this help'],
    ],
  },
];

function helpHtml() {
  return HELP_GROUPS.map((g) => `
    <div class="hud-help__group">
      <div class="label">${g.title}</div>
      ${g.rows.map(([keys, desc]) => `
        <div class="hud-help__row">
          <div class="hud-help__keys">${keys.map((k) => `<kbd>${k}</kbd>`).join('<span>/</span>')}</div>
          <div>${desc}</div>
        </div>`).join('')}
    </div>`).join('');
}

const TEMPLATE = `
  <div class="hud-scrim hud-scrim--top"></div>
  <div class="hud-scrim hud-scrim--bottom"></div>
  <div class="hud-impact" data-ref="impact"></div>

  <div class="hud-reticle">${SVG_RETICLE}</div>

  <div class="hud-mk hud-fpm" data-ref="fpm">${SVG_FPM}</div>
  <div class="hud-mk hud-tgt" data-ref="tgtBox">
    <span class="hud-tgt__c hud-tgt__c--tl"></span>
    <span class="hud-tgt__c hud-tgt__c--tr"></span>
    <span class="hud-tgt__c hud-tgt__c--bl"></span>
    <span class="hud-tgt__c hud-tgt__c--br"></span>
    <span class="hud-tgt__ring"></span>
    <span class="hud-tgt__dot"></span>
  </div>
  <div class="hud-mk hud-tgt-label" data-ref="tgtLabel">
    <div class="hud-tgt-label__name" data-ref="tgtLabelName"></div>
    <div class="hud-tgt-label__meta num" data-ref="tgtLabelMeta"></div>
  </div>
  <div class="hud-mk hud-off__arrow" data-ref="offArrow">${SVG_ARROW}</div>
  <div class="hud-mk hud-off__label num" data-ref="offLabel"><b data-ref="offLabelName"></b> <span data-ref="offLabelDist"></span></div>

  <div class="hud-sys">
    <div class="hud-sys__name" data-ref="sysName">—</div>
    <div class="hud-sys__meta" data-ref="sysMeta"></div>
    <div class="hud-sys__seed num" data-ref="sysSeed"></div>
  </div>

  <div class="hud-nav hud-interactive" data-ref="nav">
    <input class="hud-input" data-ref="seedInput" type="text" placeholder="Seed" spellcheck="false" autocomplete="off" maxlength="40" aria-label="System seed" />
    <button class="hud-btn hud-btn--primary" data-ref="btnJump" title="Jump to seed (H)">Jump</button>
    <button class="hud-btn" data-ref="btnRandom" title="Jump to a random system">Random</button>
    <button class="hud-btn hud-btn--icon" data-ref="btnAudio" title="Mute / unmute audio (M)" aria-label="Toggle Audio">🔊</button>
    <button class="hud-btn hud-btn--icon" data-ref="btnHelp" title="Controls (F1)" aria-label="Controls">?</button>
  </div>

  <div class="hud-toasts" data-ref="toasts"></div>

  <div class="hud-hyper" data-ref="hyper">
    <div class="hud-hyper__title" data-ref="hyperTitle"></div>
    <div class="hud-hyper__sub num" data-ref="hyperSub"></div>
    <div class="hud-bar"><div class="hud-bar__fill" data-ref="hyperFill"></div></div>
  </div>

  <div class="hud-prox" data-ref="prox">
    <span class="label">Altitude</span>
    <span class="hud-prox__val num" data-ref="proxVal"></span>
    <span class="hud-prox__body" data-ref="proxBody"></span>
  </div>

  <div class="hud-flight">
    <div class="label">Speed</div>
    <div class="hud-speed">
      <span class="hud-speed__val num" data-ref="speedVal">0</span>
      <span class="hud-speed__unit">km/s</span>
    </div>
    <div class="hud-throttle">
      <div class="hud-row" style="margin-bottom:8px">
        <span class="label">Throttle</span>
        <span class="hud-row__val num" data-ref="throttleVal">0%</span>
      </div>
      <div class="hud-bar">
        <div class="hud-bar__fill" data-ref="throttleFill"></div>
        <div class="hud-bar__tick" data-ref="speedTick"></div>
      </div>
    </div>
    <div class="hud-flight__rows">
      <div class="hud-row">
        <span class="label">Drive</span>
        <span class="hud-row__val hud-mode num" data-ref="mode">
          <span data-ref="modeText">Normal</span><span class="hud-mini-bar is-hidden" data-ref="spoolBar"><i data-ref="spoolFill"></i></span>
        </span>
      </div>
      <div class="hud-row">
        <span class="label">Limit</span>
        <span class="hud-row__val num" data-ref="maxSpeed">—</span>
      </div>
      <div class="hud-row hud-boost" data-ref="boost">
        <span class="label">Boost</span>
        <span class="hud-row__val num">
          <span data-ref="boostText">Ready</span><span class="hud-mini-bar"><i data-ref="boostFill"></i></span>
        </span>
      </div>
    </div>
  </div>

  <div class="hud-target" data-ref="targetPanel">
    <div class="hud-target__head">
      <span class="label">Target</span>
      <span class="label num" data-ref="tgtIndex"></span>
    </div>
    <div data-ref="tgtBody">
      <div class="hud-target__name" data-ref="tgtName"></div>
      <div class="hud-target__type" data-ref="tgtType"></div>
      <div class="hud-target__rows">
        <div class="hud-row"><span class="label">Distance</span><span class="hud-row__val num" data-ref="tgtDist"></span></div>
        <div class="hud-row"><span class="label" data-ref="tgtClosingLabel">Closing</span><span class="hud-row__val num" data-ref="tgtClosing"></span></div>
        <div class="hud-row" data-ref="tgtEtaRow"><span class="label">ETA</span><span class="hud-row__val num" data-ref="tgtEta"></span></div>
      </div>
    </div>
    <div class="hud-target__empty" data-ref="tgtEmpty">No target — press T</div>
    <div class="hud-target__actions">
      <button class="hud-btn hud-btn--icon" data-ref="btnPrev" title="Previous target (Shift+T)" aria-label="Previous target">‹</button>
      <button class="hud-btn hud-btn--icon" data-ref="btnNext" title="Next target (T)" aria-label="Next target">›</button>
      <button class="hud-btn" data-ref="btnList" title="Target list (L)">All bodies</button>
    </div>
  </div>

  <div class="hud-list hud-interactive" data-ref="list">
    <div class="hud-list__head">
      <span class="label">Bodies</span>
      <span class="label num" data-ref="listCount"></span>
    </div>
    <div class="hud-list__body" data-ref="listBody"></div>
  </div>

  <div class="hud-prompt" data-ref="prompt"></div>

  <div class="hud-hint" data-ref="hint">Click to steer with mouse</div>

  <div class="hud-help" data-ref="help">
    <div class="hud-help__card" role="dialog" aria-label="Controls">
      <div class="hud-help__head">
        <span class="hud-help__title">Galactic Cruise — Controls</span>
        <button class="hud-btn" data-ref="btnHelpClose">Close <kbd>Esc</kbd></button>
      </div>
      ${helpHtml()}
      <div class="hud-help__foot">Press <kbd>F1</kbd> or <kbd>?</kbd> to open this again. Close it and click the view to start flying.</div>
    </div>
  </div>
`;

// Marker geometry
const MIN_TARGET_R = 14;       // px, radius of the small ring
const BRACKET_THRESHOLD = 10;  // px, body screen radius above which we draw brackets
const BRACKET_PAD = 6;         // px of breathing room around the body
const EDGE_INSET_X = 56;
const EDGE_INSET_Y = 64;

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export class HUD {
  constructor(container, callbacks = {}) {
    this.container = container || document.body;
    this.callbacks = callbacks || {};

    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = TEMPLATE;
    this.container.appendChild(this.root);

    this.el = {};
    this.root.querySelectorAll('[data-ref]').forEach((n) => {
      this.el[n.dataset.ref] = n;
    });

    // State
    this._cache = new Map();
    this._helpOpen = false;
    this._listOpen = false;
    this._targetList = [];
    this._listItems = new Map();
    this._selectedId = undefined;
    this._impactLevel = 0;
    this._impactTime = 0;
    this._lastPointerLocked = undefined;
    this._toastTimers = new Set();

    // Scratch
    this._v = new THREE.Vector3();
    this._cam = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._ndc = new THREE.Vector3();

    this._bindEvents();
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  _bindEvents() {
    const e = this.el;

    const stop = (ev) => ev.stopPropagation();
    this._stopTargets = [e.nav, e.targetPanel, e.list, e.help];
    for (const n of this._stopTargets) {
      n.addEventListener('mousedown', stop);
      n.addEventListener('pointerdown', stop);
      n.addEventListener('click', stop);
    }

    e.btnJump.addEventListener('click', () => this._triggerJump(false));
    e.btnRandom.addEventListener('click', () => this._triggerJump(true));
    e.btnAudio?.addEventListener('click', () => {
      if (typeof this.callbacks.onToggleAudio === 'function') {
        const muted = this.callbacks.onToggleAudio();
        this.setAudioMuted(muted);
      }
    });
    e.btnHelp.addEventListener('click', () => this._setHelp(!this._helpOpen));
    e.btnHelpClose.addEventListener('click', () => this._setHelp(false));
    e.help.addEventListener('click', (ev) => {
      if (ev.target === e.help) this._setHelp(false);
    });
    e.btnPrev.addEventListener('click', () => this.callbacks.onTargetPrev?.());
    e.btnNext.addEventListener('click', () => this.callbacks.onTargetNext?.());
    e.btnList.addEventListener('click', () => this._setList(!this._listOpen));

    e.listBody.addEventListener('click', (ev) => {
      const item = ev.target.closest('[data-id]');
      if (!item) return;
      const id = this._listIdFromAttr(item.dataset.id);
      this.callbacks.onTargetSelect?.(id);
    });

    // Keys typed into the seed field must not reach flight controls.
    e.seedInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this._triggerJump(false);
        e.seedInput.blur();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        e.seedInput.blur();
      }
    });

    this._onKeyDown = (ev) => this._handleKey(ev);
    window.addEventListener('keydown', this._onKeyDown);
  }

  _isTyping() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = a.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable;
  }

  _handleKey(ev) {
    if (ev.key === 'Escape') {
      if (this._isTyping()) {
        document.activeElement.blur();
        ev.preventDefault();
        return;
      }
      if (this._helpOpen || this._listOpen) {
        this._setHelp(false);
        this._setList(false);
        ev.preventDefault();
      }
      return;
    }
    if (this._isTyping()) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

    if (ev.code === 'F1' || ev.key === 'F1' || ev.key === '?') {
      ev.preventDefault();
      if (!ev.repeat) this._setHelp(!this._helpOpen);
      return;
    }

    switch (ev.code) {
      case 'KeyT':
        ev.preventDefault();
        if (ev.repeat) return;
        if (ev.shiftKey) this.callbacks.onTargetPrev?.();
        else this.callbacks.onTargetNext?.();
        break;
      case 'KeyH':
        ev.preventDefault();
        if (!ev.repeat) this._triggerJump(false);
        break;
      case 'KeyL':
        ev.preventDefault();
        if (!ev.repeat) this._setList(!this._listOpen);
        break;
      default:
        break;
    }
  }

  _triggerJump(forceRandom) {
    const typed = this.el.seedInput.value.trim();
    const seed = !forceRandom && typed ? typed.toUpperCase() : generateRandomSeed();
    // Clear so the next H press doesn't re-jump to the same seed.
    this.el.seedInput.value = '';
    this.el.seedInput.blur();
    this.callbacks.onJump?.(seed);
  }

  _setHelp(open) {
    this._helpOpen = !!open;
    this.el.help.classList.toggle('is-open', this._helpOpen);
    if (this._helpOpen && document.pointerLockElement) document.exitPointerLock?.();
  }

  _setList(open) {
    this._listOpen = !!open;
    this.el.list.classList.toggle('is-open', this._listOpen);
    this.el.btnList.classList.toggle('is-active', this._listOpen);
    if (this._listOpen) this._scrollSelectedIntoView();
  }

  // -------------------------------------------------------------------------
  // DOM write helpers (skip unchanged values)
  // -------------------------------------------------------------------------

  _text(key, value) {
    if (this._cache.get(key) === value) return;
    this._cache.set(key, value);
    this.el[key].textContent = value;
  }

  _cls(key, cls, on) {
    const k = `${key}.${cls}`;
    if (this._cache.get(k) === on) return;
    this._cache.set(k, on);
    this.el[key].classList.toggle(cls, on);
  }

  _style(key, prop, value) {
    const k = `${key}:${prop}`;
    if (this._cache.get(k) === value) return;
    this._cache.set(k, value);
    this.el[key].style[prop] = value;
  }

  _pct(key, frac) {
    this._style(key, 'width', `${(clamp(frac || 0, 0, 1) * 100).toFixed(1)}%`);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  update(telemetry, targeting, hyperspaceState, systemData, camera) {
    if (!this.root) return;
    const t = telemetry || {};
    const hs = hyperspaceState || {};
    const W = window.innerWidth;
    const H = window.innerHeight;

    const hyperState = hs.state || 'IDLE';
    const inJump = hyperState === 'WARPING' || hyperState === 'ARRIVING';

    this._updateSystem(systemData);
    this._updateFlight(t);
    this._updateProximity(inJump ? null : t.nearest);
    this._updateTargetPanel(targeting);
    this._updateHyper(hs, hyperState);
    this._cls('hint', 'is-on', t.pointerLocked === false && !this._helpOpen && !inJump);
    this._updateMarkers(t, targeting, camera, W, H, inJump);
    this._updateImpact();
  }

  /**
   * Short action prompt above the altitude readout (e.g. "G  Land"); null hides it.
   */
  setPrompt(text, warn = false) {
    const key = `${text}|${warn}`;
    if (this._promptKey === key) return;
    this._promptKey = key;
    const el = this.el.prompt;
    el.textContent = '';
    if (text) {
      // "G  Land    W  Take off" → key caps followed by labels
      const parts = text.split(/\s{2,}/);
      for (let i = 0; i < parts.length; i++) {
        const span = document.createElement(i % 2 === 0 && parts[i].length <= 2 ? 'kbd' : 'span');
        span.textContent = parts[i];
        el.appendChild(span);
      }
    }
    el.classList.toggle('is-on', !!text);
    el.classList.toggle('is-warn', !!warn);
  }

  /** Opens the controls overlay (shown on first start). */
  showHelp() {
    this._setHelp(true);
  }

  /** flight | landing | landed | foot — on foot the flight instruments are hidden. */
  setMode(mode) {
    if (this._mode === mode) return;
    this._mode = mode;
    this.root.classList.toggle('is-foot', mode === 'foot');
    this.root.classList.toggle('is-landed', mode === 'landed' || mode === 'landing');
  }

  setTargetList(list) {
    this._targetList = Array.isArray(list) ? list : [];
    this._listItems.clear();
    const body = this.el.listBody;
    body.textContent = '';
    const frag = document.createDocumentFragment();
    for (const item of this._targetList) {
      const btn = document.createElement('button');
      btn.className = `hud-list__item${item.depth ? ' is-depth-1' : ''}`;
      btn.dataset.id = String(item.id);
      btn.innerHTML = `<span>${escapeHtml(item.name ?? '')}</span><span class="hud-list__type">${escapeHtml(item.type ?? '')}</span>`;
      frag.appendChild(btn);
      this._listItems.set(String(item.id), btn);
    }
    body.appendChild(frag);
    this._text('listCount', String(this._targetList.length));
    const sel = this._selectedId;
    this._selectedId = undefined;
    this._markSelected(sel);
  }

  showNotification(message, durationMs = 3000) {
    if (!this.root) return;
    const toasts = this.el.toasts;
    while (toasts.children.length >= 3) toasts.firstChild.remove();
    const n = document.createElement('div');
    n.className = 'hud-toast';
    n.textContent = String(message ?? '');
    toasts.appendChild(n);
    requestAnimationFrame(() => n.classList.add('is-on'));
    const hide = setTimeout(() => {
      this._toastTimers.delete(hide);
      n.classList.remove('is-on');
      const rm = setTimeout(() => {
        this._toastTimers.delete(rm);
        n.remove();
      }, 160);
      this._toastTimers.add(rm);
    }, Math.max(500, durationMs));
    this._toastTimers.add(hide);
  }

  flashImpact(strength = 1) {
    const s = clamp(Number(strength) || 0, 0, 1);
    const now = performance.now();
    const current = this._currentImpact(now);
    this._impactLevel = Math.max(current, 0.25 + 0.75 * s);
    this._impactTime = now;
    if (this.el) this.el.impact.style.opacity = this._impactLevel.toFixed(3);
  }

  setAudioMuted(muted) {
    if (this.el && this.el.btnAudio) {
      this.el.btnAudio.textContent = muted ? '🔇' : '🔊';
      this.el.btnAudio.title = muted ? 'Unmute Audio (M)' : 'Mute Audio (M)';
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    for (const id of this._toastTimers) clearTimeout(id);
    this._toastTimers.clear();
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
    this.el = null;
    this._cache.clear();
    this._listItems.clear();
  }

  // -------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------

  _updateSystem(sd) {
    if (!sd) return;
    this._text('sysName', String(sd.name || 'Unknown system'));
    const parts = [];
    const star = sd.star;
    if (star) {
      if (star.type) parts.push(`${star.type} star`);
      if (star.name && star.name !== sd.name) parts.push(star.name);
    }
    const n = Array.isArray(sd.planets) ? sd.planets.length : 0;
    parts.push(`${n} ${n === 1 ? 'planet' : 'planets'}`);
    this._text('sysMeta', parts.join(' · '));
    this._text('sysSeed', sd.seed != null ? `Seed ${String(sd.seed).toUpperCase()}` : '');
  }

  _updateFlight(t) {
    const speed = Number(t.speed) || 0;
    this._text('speedVal', fmtSpeedNumber(speed));

    const throttle = clamp(Number(t.throttle) || 0, 0, 1);
    this._text('throttleVal', `${Math.round(throttle * 100)}%`);
    this._pct('throttleFill', throttle);

    const maxSpeed = Number(t.maxSpeed) || 0;
    const frac = maxSpeed > 0 ? clamp(speed / maxSpeed, 0, 1) : 0;
    this._style('speedTick', 'left', `${(frac * 100).toFixed(1)}%`);
    this._text('maxSpeed', maxSpeed > 0 ? fmtSpeed(maxSpeed) : '—');

    const spool = clamp(Number(t.cruiseSpool) || 0, 0, 1);
    const cruise = t.mode === 'cruise';
    const spooling = spool > 0 && spool < 1;
    let modeText = 'Normal';
    if (spooling) modeText = `Spooling ${Math.round(spool * 100)}%`;
    else if (cruise) modeText = 'Cruise';
    this._text('modeText', modeText);
    this._cls('mode', 'is-cruise', cruise || spooling);
    this._cls('spoolBar', 'is-hidden', !spooling);
    if (spooling) this._pct('spoolFill', spool);

    const bp = clamp(Number(t.boostPercent) || 0, 0, 100);
    let boostText;
    if (t.isBoosting) boostText = 'Active';
    else if (bp >= 99.5) boostText = 'Ready';
    else boostText = `${Math.round(bp)}%`;
    this._text('boostText', boostText);
    this._cls('boost', 'is-active', !!t.isBoosting);
    this._pct('boostFill', bp / 100);
  }

  _updateProximity(nearest) {
    const r = nearest ? Number(nearest.radius) : 0;
    const alt = nearest ? Number(nearest.altitude) : Infinity;
    const show = !!nearest && r > 0 && Number.isFinite(alt) && alt < r * 1.5;
    this._cls('prox', 'is-on', show);
    if (!show) return;
    this._text('proxVal', fmtDistance(Math.max(0, alt)));
    this._text('proxBody', nearest.name ? `above ${nearest.name}` : '');
    this._cls('prox', 'is-warn', alt < r * 0.15);
  }

  _updateTargetPanel(tg) {
    const has = !!tg;
    this._cls('tgtBody', 'is-hidden', !has);
    this._cls('tgtEmpty', 'is-hidden', has);
    this._markSelected(has ? tg.id : null);
    if (!has) {
      this._text('tgtIndex', '');
      return;
    }
    const total = Number(tg.totalTargets) || 0;
    const idx = Number.isFinite(tg.index) ? tg.index + 1 : 0;
    this._text('tgtIndex', total ? `${idx} / ${total}` : '');
    this._text('tgtName', String(tg.name ?? ''));
    this._text('tgtType', String(tg.type ?? ''));
    this._text('tgtDist', fmtDistance(tg.distance));

    const cs = Number(tg.closingSpeed) || 0;
    const receding = cs < -0.05;
    this._text('tgtClosingLabel', receding ? 'Receding' : 'Closing');
    this._text('tgtClosing', fmtSpeed(Math.abs(cs)));

    const eta = tg.isApproaching ? fmtEta(tg.eta) : null;
    this._cls('tgtEtaRow', 'is-hidden', !eta);
    if (eta) this._text('tgtEta', eta);
  }

  _markSelected(id) {
    const key = id == null ? null : String(id);
    if (this._selectedId === key) return;
    const prev = this._selectedId != null ? this._listItems.get(this._selectedId) : null;
    if (prev) prev.classList.remove('is-selected');
    this._selectedId = key;
    const next = key != null ? this._listItems.get(key) : null;
    if (next) {
      next.classList.add('is-selected');
      if (this._listOpen) this._scrollSelectedIntoView();
    }
  }

  _scrollSelectedIntoView() {
    const n = this._selectedId != null ? this._listItems.get(this._selectedId) : null;
    if (n) n.scrollIntoView({ block: 'nearest' });
  }

  _listIdFromAttr(attr) {
    for (const item of this._targetList) {
      if (String(item.id) === attr) return item.id;
    }
    return attr;
  }

  _updateHyper(hs, state) {
    const on = state !== 'IDLE';
    this._cls('hyper', 'is-on', on);
    if (!on) return;
    let title = 'Hyperspace';
    if (state === 'CHARGING') title = 'Charging hyperdrive';
    else if (state === 'WARPING') title = 'In hyperspace';
    else if (state === 'ARRIVING') title = 'Arriving';
    this._text('hyperTitle', title);
    const seed = hs.targetSeed != null ? String(hs.targetSeed).toUpperCase() : '';
    const pct = Math.round(clamp(Number(hs.overallProgress) || 0, 0, 1) * 100);
    this._text('hyperSub', seed ? `${seed} · ${pct}%` : `${pct}%`);
    this._pct('hyperFill', (Number(hs.overallProgress) || 0));
  }

  _updateImpact() {
    if (this._impactLevel <= 0) return;
    const v = this._currentImpact(performance.now());
    if (v <= 0.005) {
      this._impactLevel = 0;
      this.el.impact.style.opacity = '0';
      return;
    }
    this.el.impact.style.opacity = v.toFixed(3);
  }

  _currentImpact(now) {
    if (this._impactLevel <= 0) return 0;
    const dt = (now - this._impactTime) / 1000;
    return this._impactLevel * Math.exp(-dt / 0.22);
  }

  // -------------------------------------------------------------------------
  // World-space markers
  // -------------------------------------------------------------------------

  _show(key, on) {
    this._cls(key, 'is-on', on);
  }

  _hideMarkers() {
    this._show('fpm', false);
    this._show('tgtBox', false);
    this._show('tgtLabel', false);
    this._show('offArrow', false);
    this._show('offLabel', false);
  }

  /** Projects a world point; returns false if behind the camera. Writes px into this._ndc.x/y. */
  _project(world, camera, W, H) {
    this._cam.copy(world).applyMatrix4(camera.matrixWorldInverse);
    if (this._cam.z >= -1e-6) return false;
    this._ndc.copy(this._cam).applyMatrix4(camera.projectionMatrix);
    this._ndc.x = (this._ndc.x + 1) * 0.5 * W;
    this._ndc.y = (1 - this._ndc.y) * 0.5 * H;
    return true;
  }

  _updateMarkers(t, tg, camera, W, H, suppress) {
    if (!camera || suppress || !camera.matrixWorldInverse) {
      this._hideMarkers();
      return;
    }

    // Make sure the matrices reflect this frame's camera pose (render may not have run yet).
    camera.updateMatrixWorld();
    this._camPos.setFromMatrixPosition(camera.matrixWorld);

    // ---- Flight-path marker ------------------------------------------------
    const vel = t.velocity;
    const speed = Number.isFinite(t.speed) ? t.speed : vel ? vel.length() : 0;
    let fpmOn = false;
    if (vel && speed >= 1 && vel.lengthSq() > 1e-12) {
      this._v.copy(vel).normalize().multiplyScalar(1000).add(this._camPos);
      if (this._project(this._v, camera, W, H)) {
        const x = this._ndc.x;
        const y = this._ndc.y;
        if (x > -20 && x < W + 20 && y > -20 && y < H + 20) {
          fpmOn = true;
          this.el.fpm.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
        }
      }
    }
    this._show('fpm', fpmOn);

    // ---- Target ------------------------------------------------------------
    const pos = tg && tg.position;
    if (!pos) {
      this._show('tgtBox', false);
      this._show('tgtLabel', false);
      this._show('offArrow', false);
      this._show('offLabel', false);
      return;
    }

    // Camera-space position (camera looks down -Z).
    const cs = this._cam.copy(pos).applyMatrix4(camera.matrixWorldInverse);
    const cx = cs.x;
    const cy = cs.y;
    const cz = cs.z;
    const centerDist = Math.sqrt(cx * cx + cy * cy + cz * cz);

    let onScreen = false;
    let sx = 0;
    let sy = 0;
    if (cz < -1e-6) {
      this._ndc.copy(cs).applyMatrix4(camera.projectionMatrix);
      sx = (this._ndc.x + 1) * 0.5 * W;
      sy = (1 - this._ndc.y) * 0.5 * H;
      onScreen = sx >= 0 && sx <= W && sy >= 0 && sy <= H;
    }

    const distText = fmtDistance(tg.distance);
    const eta = tg.isApproaching ? fmtEta(tg.eta) : null;

    if (onScreen) {
      this._show('offArrow', false);
      this._show('offLabel', false);

      // Projected angular radius of the body.
      const fov = Number.isFinite(camera.fov) ? camera.fov : 60;
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(fov) * 0.5);
      const radius = Number(tg.radius) || 0;
      const ratio = centerDist > 1e-6 ? radius / centerDist : 1;
      const maxR = Math.min(W, H) * 0.42;
      let bodyR;
      if (ratio >= 0.999) bodyR = maxR;
      else bodyR = (Math.tan(Math.asin(ratio)) / tanHalf) * (H * 0.5);

      const small = bodyR < BRACKET_THRESHOLD;
      const r = small ? MIN_TARGET_R : clamp(bodyR + BRACKET_PAD, MIN_TARGET_R, maxR);
      const rr = Math.round(r);
      this._cls('tgtBox', 'is-small', small);
      if (this._cache.get('tgtR') !== rr) {
        this._cache.set('tgtR', rr);
        const box = this.el.tgtBox;
        box.style.width = `${rr * 2}px`;
        box.style.height = `${rr * 2}px`;
        box.style.setProperty('--arm', `${Math.round(clamp(rr * 0.3, 6, 18))}px`);
      }
      // Top-left of the box sits at (sx - r, sy - r) so the box is centered on the body.
      this.el.tgtBox.style.transform = `translate3d(${(sx - rr).toFixed(1)}px, ${(sy - rr).toFixed(1)}px, 0)`;
      this._show('tgtBox', true);

      // Label beside the bracket; flip to the left when near the right edge.
      this._text('tgtLabelName', String(tg.name ?? ''));
      this._text('tgtLabelMeta', eta ? `${distText} · ${eta}` : distText);
      const gap = 12;
      const labelW = 190;
      const flipLeft = sx + rr + gap + labelW > W - 16;
      this._cls('tgtLabel', 'is-left', flipLeft);
      let lx = flipLeft ? sx - rr - gap : sx + rr + gap;
      lx = flipLeft ? clamp(lx, labelW + 16, W - 16) : clamp(lx, 16, W - labelW - 16);
      const ly = clamp(sy, 40, H - 40);
      this.el.tgtLabel.style.transform = flipLeft
        ? `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) translate(-100%, -50%)`
        : `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) translate(0, -50%)`;
      this._show('tgtLabel', true);
      return;
    }

    // ---- Off-screen / behind indicator -----------------------------------
    this._show('tgtBox', false);
    this._show('tgtLabel', false);

    // Screen-space direction from the camera-space vector (screen y is down).
    // This is valid for points in front AND behind the camera: for a point behind,
    // the camera-space x/y already tell which way to turn (no negation needed —
    // the flip only arises when using perspective-divided NDC, which we avoid here).
    let dx = cx;
    let dy = -cy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) {
      dx = 0;
      dy = 1; // dead astern: point down
    } else {
      dx /= len;
      dy /= len;
    }

    // Arrow rides an ellipse around the crosshair rather than the screen edge, so it
    // never lands on the corner panels and stays in the pilot's field of view.
    const hw = Math.max(20, Math.min(W * 0.5 - EDGE_INSET_X, W * 0.3));
    const hh = Math.max(20, Math.min(H * 0.5 - EDGE_INSET_Y, H * 0.32));
    const k = 1 / Math.hypot(dx / hw, dy / hh);
    const px = W * 0.5 + dx * k;
    const py = H * 0.5 + dy * k;
    const ang = Math.atan2(dy, dx);

    this.el.offArrow.style.transform =
      `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%) rotate(${ang.toFixed(4)}rad)`;
    this._show('offArrow', true);

    this._text('offLabelName', String(tg.name ?? ''));
    this._text('offLabelDist', distText);
    // Label sits inward from the arrow, centered on that point.
    const inward = 30 + Math.abs(dx) * 50; // more room horizontally for wide text
    const lx = px - dx * inward;
    const ly = py - dy * 26;
    this.el.offLabel.style.transform =
      `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) translate(-50%, -50%)`;
    this._show('offLabel', true);
  }
}

export default HUD;
