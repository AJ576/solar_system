import * as THREE from 'three';
import { getTerrainAltitude } from '../terrain/terrainCollision.js';

/**
 * Procedural Dynamic Contact Shadow for the Spaceship.
 *
 * Renders an elliptical, soft-edged contact shadow on the ground beneath the ship.
 * Provides essential altitude, velocity, and spatial orientation cues when landing,
 * and anchors the parked ship when landed or walking on foot.
 */
export class ShipContactShadow {
  constructor(scene) {
    this.scene = scene;

    // Plane rotated to lie flat in XZ with +Y normal
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);

    this.uniforms = {
      uOpacity: { value: 0.0 }
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform float uOpacity;
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          // Elliptical footprint matching spaceship proportions (~2:1 length-to-width)
          float d2 = p.x * p.x + (p.y * 0.72) * (p.y * 0.72);
          if (d2 >= 1.0) discard;
          float d = sqrt(d2);
          float alpha = (1.0 - smoothstep(0.0, 1.0, d)) * (1.0 - d2);
          gl_FragColor = vec4(0.02, 0.02, 0.03, alpha * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -4.0
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'ShipContactShadow';
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.scene.add(this.mesh);

    // Scratch variables to avoid runtime GC allocations
    this._shipWorldPos = new THREE.Vector3();
    this._bodyPos = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._localPos = new THREE.Vector3();
    this._localDir = new THREE.Vector3();
    this._groundPos = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._invMatrix = new THREE.Matrix4();
    this._shipForward = new THREE.Vector3();
    this._forwardTangent = new THREE.Vector3();
    this._backTangent = new THREE.Vector3();
    this._rightTangent = new THREE.Vector3();
    this._basisMatrix = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._sunDir = new THREE.Vector3();
    this._sunOffset = new THREE.Vector3();
    this._altScratch = { altitude: 0, surfaceRadius: 0, normal: new THREE.Vector3() };
  }

  /**
   * Updates shadow position, size, orientation, and opacity.
   * @param {THREE.Object3D} ship - Spaceship mesh/object
   * @param {Object} nearest - Result from bodies.findNearest()
   * @param {THREE.Vector3} [starPos] - Star position in world space
   * @param {boolean} [isParked=false] - Whether ship is parked/landed
   */
  update(ship, nearest, starPos = null, isParked = false) {
    if (!ship || !nearest || !nearest.body) {
      this.mesh.visible = false;
      return;
    }

    const body = nearest.body;
    const maxAlt = 4.0; // Shadow visible within 400 m of surface

    // If clearly too high, hide shadow early
    if (!isParked && nearest.altitude > maxAlt) {
      this.mesh.visible = false;
      return;
    }

    ship.getWorldPosition(this._shipWorldPos);
    const altInfo = getTerrainAltitude(body, this._shipWorldPos, true, this._altScratch);
    const altitude = isParked ? 0.0 : altInfo.altitude;

    if (!isParked && altitude > maxAlt) {
      this.mesh.visible = false;
      return;
    }

    this._bodyPos.copy(body.position);
    this._dir.subVectors(this._shipWorldPos, this._bodyPos);
    const distToCenter = this._dir.length();
    if (distToCenter < 1e-4) {
      this.mesh.visible = false;
      return;
    }
    this._dir.divideScalar(distToCenter);

    // World position on the terrain directly below ship
    this._groundPos.copy(this._bodyPos).addScaledVector(this._dir, altInfo.surfaceRadius);
    this._normal.copy(altInfo.normal);

    // Sun directional offset (shadow shifts along anti-sun direction when sun is above horizon)
    if (starPos && altitude > 0.01) {
      this._sunDir.subVectors(starPos, this._groundPos).normalize();
      const sunElevation = this._sunDir.dot(this._normal);
      if (sunElevation > 0.05) {
        // Tangent component of sun direction on ground plane
        this._sunOffset.copy(this._sunDir).addScaledVector(this._normal, -sunElevation);
        const tangentLen = this._sunOffset.length();
        if (tangentLen > 1e-4) {
          this._sunOffset.divideScalar(tangentLen);
          const shiftDist = (altitude * 0.25 * (1.0 - Math.min(1.0, sunElevation)));
          this._groundPos.addScaledVector(this._sunOffset, -shiftDist);
        }
      }
    }

    // Lift slightly above surface to eliminate z-fighting
    this.mesh.position.copy(this._groundPos).addScaledVector(this._normal, 0.003);

    // Orientation: align shadow length with ship's forward heading projected onto ground plane
    ship.getWorldDirection(this._shipForward);
    const forwardDotNorm = this._shipForward.dot(this._normal);
    this._forwardTangent.copy(this._shipForward).addScaledVector(this._normal, -forwardDotNorm);
    if (this._forwardTangent.lengthSq() < 1e-5) {
      this._forwardTangent.set(0, 0, -1).applyQuaternion(this.mesh.quaternion);
      this._forwardTangent.addScaledVector(this._normal, -this._forwardTangent.dot(this._normal));
    }
    this._forwardTangent.normalize();

    this._rightTangent.crossVectors(this._normal, this._forwardTangent).normalize();
    // Basis: X = right, Y = normal, Z = -forward (since PlaneGeometry rotated -90 deg X faces +Z forward)
    this._backTangent.copy(this._forwardTangent).negate();
    this._basisMatrix.makeBasis(this._rightTangent, this._normal, this._backTangent);
    this.mesh.quaternion.setFromRotationMatrix(this._basisMatrix);

    // Scale: contracts tightly at touchdown, softly expands as altitude increases
    const width = 0.22 * (1.0 + altitude * 0.45);
    const length = 0.38 * (1.0 + altitude * 0.45);
    this.mesh.scale.set(width, 1.0, length);

    // Opacity: crisp 0.78 at touchdown, gently fading out with altitude
    const t = Math.min(1.0, altitude / maxAlt);
    const opacity = isParked ? 0.78 : (0.78 * Math.pow(1.0 - t, 1.6));
    this.uniforms.uOpacity.value = opacity;

    this.mesh.visible = opacity > 0.01;
  }

  dispose() {
    if (this.mesh) {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      if (this.mesh.geometry) this.mesh.geometry.dispose();
      if (this.mesh.material) this.mesh.material.dispose();
    }
  }
}
