import * as THREE from 'three';
import { getSolidSurfaceHeight, getSurfaceNormal } from './terrainGenerator.js';

const _invMatrix = new THREE.Matrix4();
const _localShip = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _centerToShip = new THREE.Vector3();
const _localNormal = new THREE.Vector3();
const _worldNormal = new THREE.Vector3();
const _outwardRadial = new THREE.Vector3();
const _collisionRadial = new THREE.Vector3();
const _altScratch = { altitude: 0, surfaceRadius: 0, normal: new THREE.Vector3() };

/**
 * Computes exact surface altitude of a world position above a celestial body,
 * taking procedural terrain elevation and body rotation into account.
 *
 * @param {Object} body Celestial body entry from CelestialBodies
 * @param {THREE.Vector3} worldPos World position (e.g. ship position)
 * @param {boolean} [computeNormal=true] Whether to compute surface normal (expensive finite difference)
 * @param {Object} [target=null] Optional target object to mutate to prevent GC allocations
 * @returns {{ altitude: number, surfaceRadius: number, normal: THREE.Vector3 }}
 */
export function getTerrainAltitude(body, worldPos, computeNormal = true, target = null) {
  const result = target || { altitude: 0, surfaceRadius: 0, normal: new THREE.Vector3() };

  if (!body.terrainProfile || !body.terrainProfile.hasTerrain) {
    const dist = worldPos.distanceTo(body.position);
    result.altitude = Math.max(0, dist - body.radius);
    result.surfaceRadius = body.radius;
    if (computeNormal) {
      if (dist > 1e-4) {
        result.normal.subVectors(worldPos, body.position).normalize();
      } else {
        result.normal.set(0, 1, 0);
      }
    }
    return result;
  }

  // Transform world position to body's local rotation frame using the spinning mesh
  const mesh = body.mesh || body.object;
  _invMatrix.copy(mesh.matrixWorld).invert();
  _localShip.copy(worldPos).applyMatrix4(_invMatrix);

  const localDist = _localShip.length();
  if (localDist < 1e-5) {
    _localDir.set(0, 1, 0);
  } else {
    _localDir.copy(_localShip).divideScalar(localDist);
  }

  // Seas of water or lava count as solid ground for the ship
  const height = getSolidSurfaceHeight(_localDir, body.terrainProfile.seedNum, body.terrainProfile);
  const surfaceRadius = body.radius + height;
  const altitude = Math.max(0, localDist - surfaceRadius);

  result.altitude = altitude;
  result.surfaceRadius = surfaceRadius;

  if (computeNormal) {
    // Surface normal in local space from terrain generator
    getSurfaceNormal(
      _localDir,
      body.radius,
      body.terrainProfile.seedNum,
      body.terrainProfile,
      _localNormal
    );
    if (_localNormal.dot(_localDir) < 0) {
      _localNormal.negate();
    }
    _worldNormal.copy(_localNormal).transformDirection(mesh.matrixWorld);

    // Outward radial direction from body center in world coordinates
    _outwardRadial.subVectors(worldPos, body.position);
    if (_outwardRadial.lengthSq() > 1e-6) {
      _outwardRadial.normalize();
      // Guarantee outward orientation: if slope is extreme or flipped, blend with or fallback to radial
      if (_worldNormal.dot(_outwardRadial) < 0.2) {
        _worldNormal.copy(_outwardRadial);
      }
    } else {
      _outwardRadial.set(0, 1, 0);
      _worldNormal.copy(_outwardRadial);
    }
    result.normal.copy(_worldNormal);
  }

  return result;
}

/**
 * Swept-sphere collision check against terrain surface.
 *
 * @param {Object} body Celestial body entry
 * @param {THREE.Vector3} from Start position of frame movement
 * @param {THREE.Vector3} to End position of frame movement (modified in place on collision)
 * @param {number} shipRadius
 * @returns {{ body: Object, normal: THREE.Vector3 }|null}
 */
export function resolveTerrainCollision(body, from, to, shipRadius) {
  const profile = body.terrainProfile;
  const maxR = body.radius + (profile?.maxElevation || 0) + shipRadius;

  // Early out if completely clear of maximum terrain elevation
  const distTo = to.distanceTo(body.position);
  const distFrom = from.distanceTo(body.position);
  if (distTo > maxR + shipRadius * 4 && distFrom > maxR + shipRadius * 4) {
    return null;
  }

  // Check altitude first without surface normal to avoid 3 unneeded noise evaluations
  getTerrainAltitude(body, to, false, _altScratch);

  // Check penetration below terrain surface + shipRadius
  if (_altScratch.altitude < shipRadius) {
    getTerrainAltitude(body, to, true, _altScratch);
    const requiredRadius = _altScratch.surfaceRadius + shipRadius * 1.05;
    _collisionRadial.subVectors(to, body.position);
    if (_collisionRadial.lengthSq() < 1e-6) _collisionRadial.subVectors(from, body.position);
    if (_collisionRadial.lengthSq() < 1e-6) _collisionRadial.set(0, 1, 0);
    _collisionRadial.normalize();

    // Push ship outward along radial direction
    to.copy(body.position).addScaledVector(_collisionRadial, requiredRadius);
    return {
      body,
      normal: _altScratch.normal.clone()
    };
  }

  return null;
}
