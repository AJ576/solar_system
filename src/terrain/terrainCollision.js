import * as THREE from 'three';
import { getSolidSurfaceHeight, getSurfaceNormal } from './terrainGenerator.js';

const _invMatrix = new THREE.Matrix4();
const _localShip = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _centerToShip = new THREE.Vector3();

/**
 * Computes exact surface altitude of a world position above a celestial body,
 * taking procedural terrain elevation and body rotation into account.
 *
 * @param {Object} body Celestial body entry from CelestialBodies
 * @param {THREE.Vector3} worldPos World position (e.g. ship position)
 * @returns {{ altitude: number, surfaceRadius: number, normal: THREE.Vector3 }}
 */
export function getTerrainAltitude(body, worldPos) {
  if (!body.terrainProfile || !body.terrainProfile.hasTerrain) {
    const dist = worldPos.distanceTo(body.position);
    return {
      altitude: Math.max(0, dist - body.radius),
      surfaceRadius: body.radius,
      normal: dist > 1e-4 ? _centerToShip.subVectors(worldPos, body.position).normalize() : new THREE.Vector3(0, 1, 0)
    };
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

  // Surface normal in local space from terrain generator
  const localNormal = getSurfaceNormal(
    _localDir,
    body.radius,
    body.terrainProfile.seedNum,
    body.terrainProfile,
    new THREE.Vector3()
  );
  if (localNormal.dot(_localDir) < 0) {
    localNormal.negate();
  }
  const worldNormal = localNormal.transformDirection(mesh.matrixWorld);

  // Outward radial direction from body center in world coordinates
  const outwardRadial = new THREE.Vector3().subVectors(worldPos, body.position);
  if (outwardRadial.lengthSq() > 1e-6) {
    outwardRadial.normalize();
    // Guarantee outward orientation: if slope is extreme or flipped, blend with or fallback to radial
    if (worldNormal.dot(outwardRadial) < 0.2) {
      worldNormal.copy(outwardRadial);
    }
  } else {
    outwardRadial.set(0, 1, 0);
    worldNormal.copy(outwardRadial);
  }

  return {
    altitude,
    surfaceRadius,
    normal: worldNormal
  };
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

  const { altitude, surfaceRadius, normal } = getTerrainAltitude(body, to);

  // Check penetration below terrain surface + shipRadius
  if (altitude < shipRadius) {
    const requiredRadius = surfaceRadius + shipRadius * 1.05;
    const radial = new THREE.Vector3().subVectors(to, body.position);
    if (radial.lengthSq() < 1e-6) radial.subVectors(from, body.position);
    if (radial.lengthSq() < 1e-6) radial.set(0, 1, 0);
    radial.normalize();

    // Push ship outward along radial direction
    to.copy(body.position).addScaledVector(radial, requiredRadius);
    return {
      body,
      normal
    };
  }

  return null;
}
