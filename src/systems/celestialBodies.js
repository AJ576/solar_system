import * as THREE from 'three';
import { getTerrainAltitude } from '../terrain/terrainCollision.js';

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
    this._invPrev = new THREE.Matrix4();
    this._frameDelta = new THREE.Matrix4();
    this._rotPos = new THREE.Vector3();
    this._qFrame = new THREE.Quaternion();
    this._qIdentity = new THREE.Quaternion();
    this._scratchPos = new THREE.Vector3();
    this._scratchScale = new THREE.Vector3();
    this._altScratch = { altitude: 0, surfaceRadius: 0, normal: new THREE.Vector3() };
    this._scratchRadial = new THREE.Vector3();
    this._scratchClosest = new THREE.Vector3();
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
        mesh: entry.mesh,
        parent: null,
        soi: Math.min(p.radius * 6 + 4000, 20000),
        // Rings are not solid, but treat the planet's collision radius as the surface
        collisionRadius: p.radius,
        terrainProfile: p.terrainProfile
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
          mesh: moonEntry.mesh,
          parent: planetBody,
          soi: moon.radius * 4 + 300,
          terrainProfile: moon.terrainProfile
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
      prevPosition: new THREE.Vector3(),
      // World matrix of the spinning surface (for co-rotating frames)
      matrix: new THREE.Matrix4(),
      prevMatrix: new THREE.Matrix4()
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
      if (b.mesh && b.mesh !== b.object) {
        b.mesh.updateWorldMatrix(true, false);
      }
      b.position.setFromMatrixPosition(b.object.matrixWorld);
      b.prevMatrix.copy(b.matrix);
      b.matrix.copy((b.mesh || b.object).matrixWorld);
      if (reset) {
        b.prevPosition.copy(b.position);
        b.prevMatrix.copy(b.matrix);
      }
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

    // Near a solid surface the frame also spins with the body, so the ground below
    // (and a landing spot) stays still instead of sliding past at rotation speed
    let rotation = null;
    let rotBody = null;
    let rotWeight = 0;
    for (const b of this.bodies) {
      if (b.kind === 'star') continue;
      const w = this.coRotationWeight(b, shipPos);
      if (w > rotWeight) { rotWeight = w; rotBody = b; }
    }
    if (rotBody) {
      // Rigid motion of the surface this frame: matrix * prevMatrix⁻¹
      this._invPrev.copy(rotBody.prevMatrix).invert();
      this._frameDelta.multiplyMatrices(rotBody.matrix, this._invPrev);
      this._rotPos.copy(shipPos).applyMatrix4(this._frameDelta).sub(shipPos);
      this._delta.subVectors(rotBody.position, rotBody.prevPosition);
      // Replace the body's pure translation with its full rigid motion, weighted
      carry.addScaledVector(this._rotPos.sub(this._delta), rotWeight);

      this._frameDelta.decompose(this._scratchPos, this._qFrame, this._scratchScale);
      rotation = this._qIdentity.identity().slerp(this._qFrame, rotWeight);
    }

    return { displacement: carry, frameBody, rotation, rotBody };
  }

  /**
   * 1 close to a body's surface, 0 from half a radius up; the ship co-rotates with
   * the body in between. Gas giants and moons included, stars excluded.
   */
  coRotationWeight(body, pos) {
    if (body.kind === 'star') return 0;
    const alt = pos.distanceTo(body.position) - body.radius;
    const inner = body.radius * 0.2;
    const outer = body.radius * 0.5;
    if (alt <= inner) return 1;
    if (alt >= outer) return 0;
    const t = 1 - (alt - inner) / (outer - inner);
    return t * t * (3 - 2 * t);
  }

  /**
   * Body whose surface is closest to `pos`.
   * Evaluates exact terrain altitude when within proximity of a rocky body.
   * @returns {{ body: Object, altitude: number }|null}
   */
  findNearest(pos) {
    if (this.bodies.length === 0) return null;

    // Phase 1: Fast spherical lower/upper bound check across all bodies
    let minUpper = Infinity;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const centerDist = pos.distanceTo(b.position);
      const approxAlt = centerDist - b.radius;
      // Deepest possible basin depth below nominal sphere radius
      const minElev = b.terrainProfile?.hasTerrain ? Math.min(0, b.terrainProfile.minElevation || 0) : 0;
      const upper = approxAlt - minElev;
      if (upper < minUpper) {
        minUpper = upper;
      }
    }

    // Phase 2: High-precision terrain altitude for any candidate whose lowest possible
    // surface distance could be less than or equal to minUpper
    let best = null;
    let bestAlt = Infinity;

    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const centerDist = pos.distanceTo(b.position);
      const approxAlt = centerDist - b.radius;
      const maxElev = b.terrainProfile?.hasTerrain ? Math.max(0, b.terrainProfile.maxElevation || 0) * 1.25 : 0;
      const lower = approxAlt - maxElev;

      let alt;
      if (b.terrainProfile?.hasTerrain && lower <= minUpper && approxAlt < b.radius * 2.5) {
        alt = getTerrainAltitude(b, pos, false, this._altScratch).altitude;
      } else {
        alt = Math.max(0, approxAlt);
      }

      if (alt < bestAlt) {
        bestAlt = alt;
        best = b;
      }
    }
    return best ? { body: best, altitude: Math.max(0, bestAlt) } : null;
  }

  /**
   * Swept-sphere collision of the ship moving from `from` to `to` against every body,
   * accounting for procedural terrain elevation where applicable.
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
      const terrain = b.terrainProfile?.hasTerrain ? b.terrainProfile : null;
      const maxElevation = terrain ? Math.max(0, terrain.maxElevation) : 0;
      const baseR = b.collisionRadius + shipRadius;
      const maxR = baseR + maxElevation;
      const center = b.position;

      const startDist = from.distanceTo(center);
      const endDist = to.distanceTo(center);
      const seg = this._seg.subVectors(to, from);
      const segLenSq = seg.lengthSq();

      // Find closest distance along path [from, to] to the body center
      let closestDist = Math.min(startDist, endDist);
      let tClosest = endDist < startDist ? 1 : 0;
      if (segLenSq > 1e-6) {
        const f = this._toCenter.subVectors(from, center);
        const t = -f.dot(seg) / segLenSq;
        if (t > 0 && t < 1) {
          tClosest = t;
          const closestPoint = this._scratchClosest.copy(from).addScaledVector(seg, t);
          closestDist = closestPoint.distanceTo(center);
        }
      }

      // Early out if entire motion segment is completely outside max bounding sphere
      if (closestDist > maxR) {
        continue;
      }

      let collided = false;
      let contactPos = null;

      if (terrain) {
        // 1. Below the terrain surface (or a sea of water / lava) at the destination
        const altQuery = getTerrainAltitude(b, to, false, this._altScratch);
        if (altQuery.altitude < shipRadius) {
          collided = true;
          contactPos = to.clone();
        } else {
          // 2. Tunnelling guard: the path dipped below the deepest point the surface can
          //    reach (basins and craters sit below the base radius, so that is not enough)
          const floorR = b.collisionRadius + Math.min(0, terrain.minElevation);
          if (closestDist < floorR) {
            collided = true;
            contactPos = from.clone().addScaledVector(seg, tClosest);
          }
        }
      } else {
        // 1. Direct penetration at the destination
        if (endDist < baseR) {
          collided = true;
          contactPos = to.clone();
        } else if (segLenSq > 1e-6) {
          // 2. Swept test so high speeds cannot tunnel through small moons
          const f = this._toCenter.subVectors(from, center);
          const bq = f.dot(seg);
          const c = f.lengthSq() - baseR * baseR;
          const disc = bq * bq - segLenSq * c;
          if (disc >= 0) {
            const tHit = (-bq - Math.sqrt(disc)) / segLenSq;
            if (tHit >= 0 && tHit <= 1) {
              collided = true;
              contactPos = from.clone().addScaledVector(seg, tHit);
            }
          }
        }
      }

      if (collided && contactPos) {
        // Outward radial direction from body center
        const radial = this._scratchRadial.subVectors(contactPos, center);
        if (radial.lengthSq() < 1e-6) {
          radial.subVectors(from, center);
        }
        if (radial.lengthSq() < 1e-6) {
          radial.set(0, 1, 0);
        }
        radial.normalize();

        let effectiveRadius = b.collisionRadius;
        let normal = radial.clone();

        if (terrain) {
          const altQuery = getTerrainAltitude(b, contactPos, true, this._altScratch);
          effectiveRadius = altQuery.surfaceRadius;
          // Slope normals only make sense for shallow contacts; deep inside, push straight out
          const shallow = contactPos.distanceTo(center) > altQuery.surfaceRadius - shipRadius * 4;
          if (shallow && altQuery.normal && altQuery.normal.lengthSq() > 1e-4) {
            if (altQuery.normal.dot(radial) > 0.1) {
              normal.copy(altQuery.normal);
            }
          }
        }

        // Push ship out to surface + shipRadius + safety margin
        to.copy(center).addScaledVector(radial, effectiveRadius + shipRadius * 1.05);
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
