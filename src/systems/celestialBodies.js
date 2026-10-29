import * as THREE from 'three';

/**
 * Flat registry of every body in the current system (star, planets, moons) with
 * their world positions sampled once per frame.
 *
 * It provides three things the rest of the game builds on:
 *  - Local reference frames: inside a body's sphere of influence the ship is carried
 *    along with that body, so planets hold still relative to you when you are near
 *    them instead of sliding away at orbital speed.
 *  - Nearest-surface queries (altitude, cruise-drive speed limiting).
 *  - Solid surfaces: swept sphere collision so you cannot fly through anything.
 */
export class CelestialBodies {
  constructor(systemData = null, systemMeshes = null) {
    this.bodies = [];
    this._carry = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._seg = new THREE.Vector3();
    this._toCenter = new THREE.Vector3();
    if (systemData) this.setSystem(systemData, systemMeshes);
  }

  setSystem(systemData, systemMeshes) {
    this.bodies = [];
    if (!systemData || !systemMeshes) return;

    if (systemMeshes.starMesh) {
      this.bodies.push(this._makeBody({
        id: 'star',
        name: systemData.star.name,
        type: 'Star',
        kind: 'star',
        radius: systemData.star.radius,
        object: systemMeshes.starMesh,
        parent: null,
        soi: 0
      }));
    }

    const planets = systemData.planets || [];
    const entries = systemMeshes.planetEntries || [];
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      const entry = entries[i];
      if (!entry) continue;

      const planetBody = this._makeBody({
        id: `planet_${i}`,
        name: p.name,
        type: p.type,
        kind: 'planet',
        radius: p.radius,
        object: entry.group || entry.mesh,
        parent: null,
        soi: Math.min(p.radius * 6 + 4000, 20000),
        // Rings are not solid, but treat the planet's collision radius as the surface
        collisionRadius: p.radius
      });
      this.bodies.push(planetBody);

      (p.moons || []).forEach((moon, m) => {
        const moonEntry = entry.moons?.[m];
        if (!moonEntry) return;
        this.bodies.push(this._makeBody({
          id: `moon_${i}_${m}`,
          name: moon.name,
          type: 'Moon',
          kind: 'moon',
          radius: moon.radius,
          object: moonEntry.mesh,
          parent: planetBody,
          soi: moon.radius * 4 + 300
        }));
      });
    }

    this.sample(true);
  }

  _makeBody(def) {
    return {
      collisionRadius: def.radius,
      ...def,
      position: new THREE.Vector3(),
      prevPosition: new THREE.Vector3()
    };
  }

  /**
   * Reads every body's world position. Call once per frame after updateOrbits().
   * @param {boolean} [reset=false] When true, previous positions are set equal to
   *   current ones (use after a teleport or system change so no frame delta is applied).
   */
  sample(reset = false) {
    for (const b of this.bodies) {
      b.prevPosition.copy(b.position);
      b.object.updateWorldMatrix(true, false);
      b.position.setFromMatrixPosition(b.object.matrixWorld);
      if (reset) b.prevPosition.copy(b.position);
    }
  }

  getById(id) {
    return this.bodies.find((b) => b.id === id) || null;
  }

  /**
   * How much of a body's motion the ship should inherit at `shipPos`:
   * 1 deep inside the sphere of influence, 0 outside it, smooth in between.
   */
  _frameWeight(body, shipPos) {
    if (!body.soi) return 0;
    const d = shipPos.distanceTo(body.position);
    const inner = body.soi * 0.7;
    if (d <= inner) return 1;
    if (d >= body.soi) return 0;
    const t = 1 - (d - inner) / (body.soi - inner);
    return t * t * (3 - 2 * t);
  }

  /**
   * World-space displacement this frame of the local reference frame at `shipPos`.
   * Moons override their parent planet when the ship is close to them.
   *
   * @returns {{ displacement: THREE.Vector3, frameBody: Object|null }}
   */
  computeFrameCarry(shipPos) {
    const carry = this._carry.set(0, 0, 0);
    let frameBody = null;
    let bestWeight = 0;

    for (const b of this.bodies) {
      if (b.kind !== 'planet') continue;
      const w = this._frameWeight(b, shipPos);
      if (w <= 0) continue;
      this._delta.subVectors(b.position, b.prevPosition);
      carry.lerp(this._delta, w);
      if (w > bestWeight) { bestWeight = w; frameBody = b; }
    }
    for (const b of this.bodies) {
      if (b.kind !== 'moon') continue;
      const w = this._frameWeight(b, shipPos);
      if (w <= 0) continue;
      this._delta.subVectors(b.position, b.prevPosition);
      carry.lerp(this._delta, w);
      if (w >= 0.5) frameBody = b;
    }

    return { displacement: carry, frameBody };
  }

  /**
   * Body whose surface is closest to `pos`.
   * @returns {{ body: Object, altitude: number }|null}
   */
  findNearest(pos) {
    let best = null;
    let bestAlt = Infinity;
    for (const b of this.bodies) {
      const alt = pos.distanceTo(b.position) - b.radius;
      if (alt < bestAlt) {
        bestAlt = alt;
        best = b;
      }
    }
    return best ? { body: best, altitude: Math.max(0, bestAlt) } : null;
  }

  /**
   * Swept-sphere collision of the ship moving from `from` to `to` against every body.
   * On contact, `to` is moved back onto the surface (plus the ship radius).
   *
   * @param {THREE.Vector3} from Ship position before this frame's movement
   * @param {THREE.Vector3} to Ship position after movement (modified in place on hit)
   * @param {number} shipRadius
   * @returns {{ body: Object, normal: THREE.Vector3 }|null}
   */
  resolveCollision(from, to, shipRadius) {
    let hit = null;
    for (const b of this.bodies) {
      const R = b.collisionRadius + shipRadius;
      const center = b.position;

      // Already inside (or ended inside): push straight out
      const endDist = to.distanceTo(center);
      let contact = null;
      if (endDist < R) {
        contact = to.clone();
      } else {
        // Segment–sphere test so high speeds can't tunnel through small moons
        const seg = this._seg.subVectors(to, from);
        const segLenSq = seg.lengthSq();
        if (segLenSq > 1e-6) {
          const f = this._toCenter.subVectors(from, center);
          const bq = f.dot(seg);
          const c = f.lengthSq() - R * R;
          const disc = bq * bq - segLenSq * c;
          if (c > 0 && bq < 0 && disc >= 0) {
            const tHit = (-bq - Math.sqrt(disc)) / segLenSq;
            if (tHit >= 0 && tHit <= 1) {
              contact = from.clone().addScaledVector(seg, tHit);
            }
          }
        }
      }

      if (contact) {
        const normal = contact.sub(center);
        if (normal.lengthSq() < 1e-9) normal.set(0, 1, 0);
        normal.normalize();
        to.copy(center).addScaledVector(normal, R + 0.05);
        hit = { body: b, normal };
      }
    }
    return hit;
  }

  /**
   * Picks the body closest in angle to a view ray, e.g. the one under the crosshair.
   * Large or nearby bodies get a bit of extra tolerance via their angular radius.
   */
  pickByRay(origin, direction, excludeId = null) {
    let best = null;
    let bestScore = Infinity;
    const to = new THREE.Vector3();
    for (const b of this.bodies) {
      if (b.id === excludeId) continue;
      to.subVectors(b.position, origin);
      const dist = to.length();
      if (dist < 1e-3) continue;
      const angle = to.divideScalar(dist).angleTo(direction);
      const angularRadius = Math.asin(Math.min(1, b.radius / dist));
      const score = Math.max(0, angle - angularRadius);
      if (angle < Math.PI / 3 && score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }
}
