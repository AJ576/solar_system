/**
 * Celestial body targeting.
 *
 * Targets come from the CelestialBodies registry, so the selected target's position
 * is the exact same world position used for physics and rendering this frame.
 * Selection only changes on explicit input (cycle, pick by crosshair, pick from list).
 */
export class TargetingSystem {
  /**
   * @param {import('./celestialBodies.js').CelestialBodies} bodies
   */
  constructor(bodies) {
    this.bodies = bodies;
    this.selectedId = null;
  }

  /** Call after the body registry has been rebuilt for a new system. */
  reset(defaultId = null) {
    const list = this.bodies.bodies;
    if (defaultId && this.bodies.getById(defaultId)) {
      this.selectedId = defaultId;
    } else {
      this.selectedId = list.find((b) => b.kind === 'planet')?.id ?? list[0]?.id ?? null;
    }
  }

  /** Flat list for UI: moons are listed after (and indented under) their planet. */
  getTargetList() {
    return this.bodies.bodies.map((b) => ({
      id: b.id,
      name: b.name,
      type: b.type,
      depth: b.kind === 'moon' ? 1 : 0
    }));
  }

  _indexOfSelected() {
    return this.bodies.bodies.findIndex((b) => b.id === this.selectedId);
  }

  _step(dir) {
    const list = this.bodies.bodies;
    if (list.length === 0) return null;
    const idx = this._indexOfSelected();
    const next = idx === -1 ? 0 : (idx + dir + list.length) % list.length;
    this.selectedId = list[next].id;
    return list[next];
  }

  selectNext() { return this._step(1); }

  selectPrev() { return this._step(-1); }

  selectById(id) {
    const body = this.bodies.getById(id);
    if (body) this.selectedId = id;
    return body;
  }

  /** Selects the body nearest the given view ray (the crosshair). */
  selectByRay(origin, direction) {
    const body = this.bodies.pickByRay(origin, direction);
    if (body) this.selectedId = body.id;
    return body;
  }

  getSelectedTarget() {
    return this.bodies.getById(this.selectedId);
  }

  /**
   * @param {THREE.Vector3} shipPos Ship world position
   * @param {THREE.Vector3} shipVel Ship velocity relative to its local frame
   * @param {Object|null} frameBody Body whose frame the ship is in (its motion is shared)
   * @param {number} dt Frame time, used to derive the target's own velocity
   */
  getTelemetry(shipPos, shipVel, frameBody = null, dt = 0.016) {
    const target = this.getSelectedTarget();
    if (!target) return null;

    const dx = target.position.x - shipPos.x;
    const dy = target.position.y - shipPos.y;
    const dz = target.position.z - shipPos.z;
    const centerDist = Math.hypot(dx, dy, dz);
    const surfaceDist = Math.max(0, centerDist - target.radius);

    // Relative velocity = ship velocity in its frame minus target motion relative to that frame
    let rvx = shipVel ? shipVel.x : 0;
    let rvy = shipVel ? shipVel.y : 0;
    let rvz = shipVel ? shipVel.z : 0;
    if (dt > 0) {
      const tvx = (target.position.x - target.prevPosition.x) / dt;
      const tvy = (target.position.y - target.prevPosition.y) / dt;
      const tvz = (target.position.z - target.prevPosition.z) / dt;
      let fvx = 0, fvy = 0, fvz = 0;
      if (frameBody) {
        fvx = (frameBody.position.x - frameBody.prevPosition.x) / dt;
        fvy = (frameBody.position.y - frameBody.prevPosition.y) / dt;
        fvz = (frameBody.position.z - frameBody.prevPosition.z) / dt;
      }
      rvx -= tvx - fvx;
      rvy -= tvy - fvy;
      rvz -= tvz - fvz;
    }

    const closingSpeed = centerDist > 1e-3 ? (rvx * dx + rvy * dy + rvz * dz) / centerDist : 0;
    const isApproaching = closingSpeed > 0.5;
    const eta = isApproaching ? surfaceDist / closingSpeed : null;

    const list = this.bodies.bodies;
    return {
      index: this._indexOfSelected(),
      totalTargets: list.length,
      id: target.id,
      name: target.name,
      type: target.type,
      radius: target.radius,
      position: target.position,
      distance: surfaceDist,
      centerDistance: centerDist,
      closingSpeed,
      isApproaching,
      eta
    };
  }
}
