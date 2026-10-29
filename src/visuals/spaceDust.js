import * as THREE from 'three';

/**
 * Local Space Dust / Velocity Streaks System
 * Renders a localized volume of particles around the player's craft that streak
 * along the velocity vector, providing immediate, high-fidelity optical flow velocity cues.
 */
export class SpaceDust {
  constructor(scene, count = 800, volumeRadius = 45.0) {
    this.scene = scene;
    this.count = count;
    this.volumeRadius = volumeRadius;

    // Local coordinates stored in world space around current anchor
    this.particlePositions = new Float32Array(count * 3);
    // Line segments: 2 vertices per line (Head and Tail) = count * 2 * 3 floats
    this.linePositions = new Float32Array(count * 6);
    this.lineColors = new Float32Array(count * 6);

    const baseColor = new THREE.Color(0x70d8ff); // Electric Cyan
    const boostColor = new THREE.Color(0xffffff); // Brilliant White

    // Initialize random positions within the bounding volume
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * volumeRadius * 2.0;
      const y = (Math.random() - 0.5) * volumeRadius * 2.0;
      const z = (Math.random() - 0.5) * volumeRadius * 2.0;

      this.particlePositions[i * 3] = x;
      this.particlePositions[i * 3 + 1] = y;
      this.particlePositions[i * 3 + 2] = z;

      // Line Head (V0)
      this.linePositions[i * 6] = x;
      this.linePositions[i * 6 + 1] = y;
      this.linePositions[i * 6 + 2] = z;

      // Line Tail (V1)
      this.linePositions[i * 6 + 3] = x;
      this.linePositions[i * 6 + 4] = y;
      this.linePositions[i * 6 + 5] = z;

      // Head Color (slightly brighter)
      this.lineColors[i * 6] = baseColor.r;
      this.lineColors[i * 6 + 1] = baseColor.g;
      this.lineColors[i * 6 + 2] = baseColor.b;

      // Tail Color (soft fade)
      this.lineColors[i * 6 + 3] = baseColor.r * 0.25;
      this.lineColors[i * 6 + 4] = baseColor.g * 0.25;
      this.lineColors[i * 6 + 5] = baseColor.b * 0.25;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.lineColors, 3));

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.name = 'SpaceDustStreaks';
    this.lines.frustumCulled = false;

    if (this.scene) {
      this.scene.add(this.lines);
    }

    this._tempV = new THREE.Vector3();
    this._streakV = new THREE.Vector3();
  }

  /**
   * Updates dust positions and streak lengths based on player position and velocity.
   * @param {THREE.Vector3} shipPosition - World position of the player's craft
   * @param {THREE.Vector3} shipVelocity - Current velocity vector of the player's craft
   * @param {boolean} isBoosting - Whether afterburner boost is engaged
   * @param {number} delta - Frame delta time
   */
  update(shipPosition, shipVelocity, isBoosting = false, delta = 0.016) {
    if (!shipPosition || !this.lines) return;

    const speed = shipVelocity ? shipVelocity.length() : 0;
    const sx = shipPosition.x;
    const sy = shipPosition.y;
    const sz = shipPosition.z;

    const rad = this.volumeRadius;
    const diameter = rad * 2.0;

    // Calculate streak elongation factor
    // At rest: very short dot (~0.05u). At 150u/s: ~1.2u. At 450u/s boost: ~4.5u.
    const streakLengthFactor = isBoosting ? 0.016 : 0.009;
    const vx = shipVelocity ? shipVelocity.x * streakLengthFactor : 0;
    const vy = shipVelocity ? shipVelocity.y * streakLengthFactor : 0;
    const vz = shipVelocity ? shipVelocity.z * streakLengthFactor : 0;

    // Boost opacity and color intensity
    this.material.opacity = isBoosting ? 0.95 : THREE.MathUtils.lerp(0.35, 0.75, Math.min(1.0, speed / 150.0));

    const pos = this.linePositions;
    const pPos = this.particlePositions;

    for (let i = 0; i < this.count; i++) {
      const idx3 = i * 3;
      const idx6 = i * 6;

      let px = pPos[idx3];
      let py = pPos[idx3 + 1];
      let pz = pPos[idx3 + 2];

      // Wrap particles inside bounding volume centered on ship
      let dx = px - sx;
      let dy = py - sy;
      let dz = pz - sz;

      if (dx > rad) px -= diameter;
      else if (dx < -rad) px += diameter;

      if (dy > rad) py -= diameter;
      else if (dy < -rad) py += diameter;

      if (dz > rad) pz -= diameter;
      else if (dz < -rad) pz += diameter;

      // Store updated particle position
      pPos[idx3] = px;
      pPos[idx3 + 1] = py;
      pPos[idx3 + 2] = pz;

      // Line Head (at particle position)
      pos[idx6] = px;
      pos[idx6 + 1] = py;
      pos[idx6 + 2] = pz;

      // Line Tail (lagging behind along -velocity)
      pos[idx6 + 3] = px - vx;
      pos[idx6 + 4] = py - vy;
      pos[idx6 + 5] = pz - vz;
    }

    this.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    if (this.scene && this.lines) {
      this.scene.remove(this.lines);
    }
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
  }
}

export default SpaceDust;
