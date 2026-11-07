/**
 * FpsMeter — lightweight performance overlay.
 *
 * Runs its own requestAnimationFrame loop so it measures the real display
 * cadence regardless of game mode. Shows current FPS, average frame time,
 * the "1% low" FPS (worst frames over the last ~2s) and a frame-time graph.
 *
 * Enabled state is persisted in localStorage.
 */

const STORAGE_KEY = 'solar.showFps';
const HISTORY = 120;          // frames kept for the graph / stats
const TEXT_INTERVAL = 250;    // ms between text refreshes
const GRAPH_MAX_MS = 50;      // graph top = 50ms (20 FPS)

export class FpsMeter {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'hud-fps';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="hud-fps__row">
        <span class="hud-fps__value num" data-fps>--</span><span class="hud-fps__unit">FPS</span>
      </div>
      <div class="hud-fps__meta num" data-meta>-- ms · 1% low --</div>
      <canvas class="hud-fps__graph" width="${HISTORY}" height="28"></canvas>
    `;
    container.appendChild(this.el);

    this.fpsEl = this.el.querySelector('[data-fps]');
    this.metaEl = this.el.querySelector('[data-meta]');
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');

    this.times = new Float32Array(HISTORY);
    this.index = 0;
    this.count = 0;
    this.last = 0;
    this.lastText = 0;
    this.frames = 0;
    this.rafId = 0;
    this._tick = this._tick.bind(this);

    let saved = false;
    try { saved = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* storage unavailable */ }
    this.enabled = false;
    this.setEnabled(saved);
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setEnabled(on) {
    on = !!on;
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    if (on === this.enabled) return;
    this.enabled = on;
    this.el.style.display = on ? 'block' : 'none';
    if (on) {
      this.count = 0;
      this.index = 0;
      this.frames = 0;
      this.last = performance.now();
      this.lastText = this.last;
      this.rafId = requestAnimationFrame(this._tick);
    } else {
      cancelAnimationFrame(this.rafId);
    }
  }

  _tick(now) {
    if (!this.enabled) return;
    this.rafId = requestAnimationFrame(this._tick);

    const dt = now - this.last;
    this.last = now;
    // Skip huge gaps (tab hidden / debugger) so they don't poison the stats
    if (dt <= 0 || dt > 1000) return;

    this.times[this.index] = dt;
    this.index = (this.index + 1) % HISTORY;
    if (this.count < HISTORY) this.count++;
    this.frames++;

    const sinceText = now - this.lastText;
    if (sinceText >= TEXT_INTERVAL) {
      this._updateText(this.frames * 1000 / sinceText);
      this.frames = 0;
      this.lastText = now;
    }
    this._drawGraph();
  }

  _updateText(fps) {
    const n = this.count;
    let sum = 0;
    const sorted = Array.from(this.times.subarray(0, n)).sort((a, b) => b - a);
    for (let i = 0; i < n; i++) sum += sorted[i];
    const avgMs = sum / n;
    // 1% low: average of the slowest 1% of frames (at least one frame)
    const k = Math.max(1, Math.floor(n * 0.01));
    let worst = 0;
    for (let i = 0; i < k; i++) worst += sorted[i];
    const low = 1000 / (worst / k);

    this.fpsEl.textContent = Math.round(fps);
    this.metaEl.textContent = `${avgMs.toFixed(1)} ms · 1% low ${Math.round(low)}`;
    this.el.dataset.level = fps >= 50 ? 'good' : fps >= 30 ? 'ok' : 'bad';
  }

  _drawGraph() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // 60 FPS / 30 FPS reference lines
    ctx.fillStyle = 'rgba(238,240,244,0.14)';
    for (const ms of [1000 / 60, 1000 / 30]) {
      const y = Math.round(h - (ms / GRAPH_MAX_MS) * h) + 0.5;
      ctx.fillRect(0, y, w, 1);
    }

    const n = this.count;
    const start = (this.index - n + HISTORY) % HISTORY;
    for (let i = 0; i < n; i++) {
      const ms = this.times[(start + i) % HISTORY];
      const bh = Math.max(1, Math.min(h, (ms / GRAPH_MAX_MS) * h));
      ctx.fillStyle = ms <= 20 ? '#7fd49a' : ms <= 34 ? '#e8b872' : '#ef7b67';
      ctx.fillRect(w - n + i, h - bh, 1, bh);
    }
  }
}
