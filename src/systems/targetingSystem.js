import * as THREE from 'three';

/**
 * Predictable, Deliberate Celestial Body Targeting System
 *
 * Maintains a stable indexed catalog of targetable celestial bodies (Star, Planets, Moons).
 * Target selection never switches automatically; it is explicitly controlled via cycling
 * (Next: 'T', Previous: 'Shift+T') or programmatic selection.
 */
export class TargetingSystem {
  /**
   * @param {Object} [systemData] Procedural solar system configuration data
   * @param {Object} [systemMeshes] Mesh hierarchy in scene
   */
  constructor(systemData = null, systemMeshes = null) {
    this.targets = [];
    this.selectedIndex = 0;
    this.systemData = null;
    this.systemMeshes = null;

    if (systemData) {
      this.setSystem(systemData, systemMeshes);
    }
  }

  /**
   * Populates the target list from system data & meshes.
   *
   * @param {Object} systemData
   * @param {Object} systemMeshes
   */
  setSystem(systemData, systemMeshes) {
    this.systemData = systemData;
    this.systemMeshes = systemMeshes;
    this.targets = [];

    if (!systemData) return;

    // 1. Central Star
    if (systemData.star) {
      const starRadius = systemData.star.radius || 350;
      this.targets.push({
        id: 'star',
        name: systemData.star.name || 'Central Star',
        type: 'Star',
        radius: starRadius,
        getMesh: () => this.systemMeshes?.starMesh || this.systemMeshes?.star || null,
        defaultPosition: new THREE.Vector3(0, 0, 0),
      });
    }

    // 2. Planets & Moons in natural orbital sequence
    const planets = systemData.planets || [];
    const entries = this.systemMeshes?.planetEntries || this.systemMeshes?.planets || [];

    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      const entry = entries[i];

      this.targets.push({
        id: `planet_${i}`,
        name: p.name || `Planet ${i + 1}`,
        type: p.type || 'Planet',
        radius: p.radius || 30,
        getMesh: () => {
          const ent = this.systemMeshes?.planetEntries?.[i] || this.systemMeshes?.planets?.[i];
          return ent?.isMesh ? ent : (ent?.mesh || ent?.planetMesh || null);
        },
        defaultPosition: new THREE.Vector3(p.semiMajorAxis || 1500, 0, 0),
      });

      // Moons belonging to this planet
      if (p.moons && Array.isArray(p.moons)) {
        for (let m = 0; m < p.moons.length; m++) {
          const moon = p.moons[m];
          this.targets.push({
            id: `moon_${i}_${m}`,
            name: moon.name || `${p.name} Moon ${m + 1}`,
            type: 'Moon',
            radius: moon.radius || 10,
            getMesh: () => {
              const ent = this.systemMeshes?.planetEntries?.[i] || this.systemMeshes?.planets?.[i];
              const moonEntries = ent?.moons || ent?.moonMeshes || [];
              const mEnt = moonEntries[m];
              return mEnt?.isMesh ? mEnt : (mEnt?.mesh || mEnt?.moonMesh || null);
            },
            defaultPosition: new THREE.Vector3(0, 0, 0),
          });
        }
      }
    }

    // Default to the first planet (index 1) if available, otherwise the star (0)
    if (this.targets.length > 1) {
      this.selectedIndex = 1;
    } else {
      this.selectedIndex = 0;
    }
  }

  /**
   * Cycles to the next celestial body.
   * @returns {Object|null}
   */
  selectNext() {
    if (this.targets.length === 0) return null;
    this.selectedIndex = (this.selectedIndex + 1) % this.targets.length;
    return this.getSelectedTarget();
  }

  /**
   * Cycles to the previous celestial body.
   * @returns {Object|null}
   */
  selectPrev() {
    if (this.targets.length === 0) return null;
    this.selectedIndex = (this.selectedIndex - 1 + this.targets.length) % this.targets.length;
    return this.getSelectedTarget();
  }

  /**
   * Selects a target by its unique ID.
   * @param {string} id
   * @returns {Object|null}
   */
  selectById(id) {
    const idx = this.targets.findIndex(t => t.id === id);
    if (idx !== -1) {
      this.selectedIndex = idx;
    }
    return this.getSelectedTarget();
  }

  /**
   * Returns currently selected target definition.
   * @returns {Object|null}
   */
  getSelectedTarget() {
    if (this.targets.length === 0) return null;
    return this.targets[this.selectedIndex] || null;
  }

  /**
   * Computes the current world-space position of a target body.
   * @param {Object} target
   * @returns {THREE.Vector3}
   */
  getTargetPosition(target) {
    if (!target) return new THREE.Vector3(0, 0, 0);

    const mesh = typeof target.getMesh === 'function' ? target.getMesh() : null;
    if (mesh && typeof mesh.getWorldPosition === 'function') {
      mesh.updateWorldMatrix?.(true, false);
      const pos = new THREE.Vector3();
      mesh.getWorldPosition(pos);
      return pos;
    }

    if (target.defaultPosition) {
      return target.defaultPosition.clone();
    }

    return new THREE.Vector3(0, 0, 0);
  }

  /**
   * Evaluates targeting telemetry relative to ship's position and velocity.
   *
   * @param {THREE.Vector3} shipPos Ship's current world position
   * @param {THREE.Vector3} [shipVel] Ship's current physical velocity
   * @returns {Object|null}
   */
  getTelemetry(shipPos, shipVel = null) {
    if (this.targets.length === 0) return null;
    const target = this.targets[this.selectedIndex];
    if (!target) return null;

    const targetPos = this.getTargetPosition(target);
    const px = shipPos ? shipPos.x : 0;
    const py = shipPos ? shipPos.y : 0;
    const pz = shipPos ? shipPos.z : 0;

    const dx = targetPos.x - px;
    const dy = targetPos.y - py;
    const dz = targetPos.z - pz;
    const centerDist = Math.hypot(dx, dy, dz);
    const surfaceDist = Math.max(0, centerDist - target.radius);

    // Closure rate (positive = closing / approaching, negative = receding)
    let closingSpeed = 0;
    let isApproaching = false;
    if (shipVel && centerDist > 0.001) {
      // Relative velocity projection along Line of Sight (LoS)
      closingSpeed = (shipVel.x * dx + shipVel.y * dy + shipVel.z * dz) / centerDist;
      isApproaching = closingSpeed > 0.5;
    }

    return {
      index: this.selectedIndex,
      totalTargets: this.targets.length,
      id: target.id,
      name: target.name,
      type: target.type,
      radius: target.radius,
      position: targetPos,
      distance: surfaceDist,
      centerDistance: centerDist,
      closingSpeed,
      isApproaching,
    };
  }
}
