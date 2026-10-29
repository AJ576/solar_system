import * as THREE from 'three';

/**
 * Procedural 3D composite spaceship using Three.js primitives.
 * Aerodynamic sci-fi interceptor facing -Z (standard Three.js forward).
 *
 * @returns {{
 *   mesh: THREE.Group,
 *   thrusterGlows: THREE.Mesh[],
 *   thrusterLight: THREE.PointLight,
 *   setThrusterIntensity: (throttle: number) => void
 * }}
 */
export function createSpaceship() {
  const shipGroup = new THREE.Group();
  shipGroup.name = 'Spaceship';
  // 5-Tier Scale Hierarchy: 0.5x master scale establishes crisp 2.44u x 2.72u heavy interceptor footprint
  shipGroup.scale.set(0.5, 0.5, 0.5);

  // --- Materials ---
  const hullDarkMat = new THREE.MeshStandardMaterial({
    color: 0x181d26,
    metalness: 0.85,
    roughness: 0.35,
    flatShading: true,
  });

  const hullLightMat = new THREE.MeshStandardMaterial({
    color: 0xd9e2ec,
    metalness: 0.6,
    roughness: 0.28,
    flatShading: true,
  });

  const hullAccentMat = new THREE.MeshStandardMaterial({
    color: 0x9aa6b8,
    metalness: 0.8,
    roughness: 0.2,
    emissive: 0x000000,
    emissiveIntensity: 0.5,
  });

  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x0a2239,
    metalness: 0.95,
    roughness: 0.08,
    transparent: true,
    opacity: 0.72,
    envMapIntensity: 1.5,
  });

  const cockpitInteriorMat = new THREE.MeshStandardMaterial({
    color: 0x11161d,
    roughness: 0.7,
  });

  const engineBellMat = new THREE.MeshStandardMaterial({
    color: 0x222730,
    metalness: 0.9,
    roughness: 0.3,
    side: THREE.DoubleSide,
  });

  const engineInteriorMat = new THREE.MeshBasicMaterial({
    color: 0xc9d8ff,
  });

  const navLeftMat = new THREE.MeshBasicMaterial({
    color: 0xff1744, // Aviation Port Red
  });

  const navRightMat = new THREE.MeshBasicMaterial({
    color: 0x00e676, // Aviation Starboard Green
  });

  // Exhaust plume: additive, fades from the nozzle to the tip and toward its silhouette
  function createFlareMaterial(color) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 0.8 },
      },
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying float vAlong;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          vAlong = uv.y;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlong;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          #include <logdepthbuf_fragment>
          float lengthFade = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.6);
          float edgeFade = pow(abs(dot(normalize(vNormalView), normalize(vViewDir))), 1.5);
          float a = lengthFade * edgeFade * uOpacity;
          gl_FragColor = vec4(uColor * a, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  const flareOuterMat = createFlareMaterial(0x6f9dff);
  const flareInnerMat = createFlareMaterial(0xdfe9ff);

  // --- Fuselage: Center Cabin & Hull Plates ---
  // Main chassis box
  const mainBodyGeom = new THREE.BoxGeometry(1.24, 0.46, 2.1);
  const mainBody = new THREE.Mesh(mainBodyGeom, hullDarkMat);
  mainBody.position.set(0, 0.02, 0.15);
  shipGroup.add(mainBody);

  // Upper armor plate
  const upperPlateGeom = new THREE.BoxGeometry(0.85, 0.12, 1.8);
  const upperPlate = new THREE.Mesh(upperPlateGeom, hullLightMat);
  upperPlate.position.set(0, 0.28, 0.2);
  shipGroup.add(upperPlate);

  // Lower underbelly plate
  const lowerPlateGeom = new THREE.BoxGeometry(0.9, 0.15, 1.7);
  const lowerPlate = new THREE.Mesh(lowerPlateGeom, hullDarkMat);
  lowerPlate.position.set(0, -0.26, 0.2);
  shipGroup.add(lowerPlate);

  // Nose cone: faceted diamond wedge pointing forward along -Z
  const noseConeGeom = new THREE.ConeGeometry(0.55, 2.1, 4);
  noseConeGeom.rotateY(Math.PI / 4);
  noseConeGeom.rotateX(-Math.PI / 2);
  const noseMesh = new THREE.Mesh(noseConeGeom, hullDarkMat);
  noseMesh.position.set(0, 0.02, -1.9);
  shipGroup.add(noseMesh);

  // Upper nose trim
  const noseTrimGeom = new THREE.ConeGeometry(0.38, 1.5, 4);
  noseTrimGeom.rotateY(Math.PI / 4);
  noseTrimGeom.rotateX(-Math.PI / 2);
  const noseTrim = new THREE.Mesh(noseTrimGeom, hullLightMat);
  noseTrim.position.set(0, 0.12, -1.65);
  shipGroup.add(noseTrim);

  // Dorsal spine ridge
  const dorsalRidgeGeom = new THREE.BoxGeometry(0.18, 0.22, 1.5);
  const dorsalRidge = new THREE.Mesh(dorsalRidgeGeom, hullAccentMat);
  dorsalRidge.position.set(0, 0.36, 0.4);
  shipGroup.add(dorsalRidge);

  // --- Cockpit & Canopy ---
  // Cockpit glass
  const canopyGeom = new THREE.SphereGeometry(0.36, 18, 14);
  canopyGeom.scale(0.72, 0.52, 1.75);
  const canopy = new THREE.Mesh(canopyGeom, canopyMat);
  canopy.position.set(0, 0.27, -0.55);
  shipGroup.add(canopy);

  // Cockpit interior pilot console
  const seatGeom = new THREE.BoxGeometry(0.24, 0.22, 0.4);
  const seat = new THREE.Mesh(seatGeom, cockpitInteriorMat);
  seat.position.set(0, 0.18, -0.5);
  shipGroup.add(seat);

  // Canopy frame arch
  const canopyFrameGeom = new THREE.TorusGeometry(0.26, 0.025, 6, 16, Math.PI);
  const canopyFrame = new THREE.Mesh(canopyFrameGeom, hullDarkMat);
  canopyFrame.rotation.x = Math.PI / 2;
  canopyFrame.position.set(0, 0.32, -0.55);
  shipGroup.add(canopyFrame);

  // --- Side Intakes / Wing Shoulders ---
  const intakeGeom = new THREE.BoxGeometry(0.32, 0.38, 1.4);
  const leftIntake = new THREE.Mesh(intakeGeom, hullDarkMat);
  leftIntake.position.set(-0.72, 0.02, 0.1);
  shipGroup.add(leftIntake);

  const rightIntake = new THREE.Mesh(intakeGeom, hullDarkMat);
  rightIntake.position.set(0.72, 0.02, 0.1);
  shipGroup.add(rightIntake);

  // Intake front vent scoops
  const scoopGeom = new THREE.BoxGeometry(0.28, 0.3, 0.1);
  const leftScoop = new THREE.Mesh(scoopGeom, engineInteriorMat);
  leftScoop.position.set(-0.72, 0.02, -0.61);
  shipGroup.add(leftScoop);

  const rightScoop = new THREE.Mesh(scoopGeom, engineInteriorMat);
  rightScoop.position.set(0.72, 0.02, -0.61);
  shipGroup.add(rightScoop);

  // --- Swept Delta Wings ---
  const extrudeSettings = {
    depth: 0.07,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.02,
    bevelThickness: 0.02,
  };

  // Right wing shape
  const rightWingShape = new THREE.Shape();
  rightWingShape.moveTo(0.55, 0.7);
  rightWingShape.lineTo(2.55, -0.85);
  rightWingShape.lineTo(2.55, -1.35);
  rightWingShape.lineTo(0.65, -1.2);
  rightWingShape.closePath();

  const rightWingGeom = new THREE.ExtrudeGeometry(rightWingShape, extrudeSettings);
  const rightWing = new THREE.Mesh(rightWingGeom, hullLightMat);
  rightWing.rotation.x = -Math.PI / 2;
  rightWing.position.y = -0.02;
  shipGroup.add(rightWing);

  // Left wing shape (mirrored X coords for clean normals)
  const leftWingShape = new THREE.Shape();
  leftWingShape.moveTo(-0.55, 0.7);
  leftWingShape.lineTo(-0.65, -1.2);
  leftWingShape.lineTo(-2.55, -1.35);
  leftWingShape.lineTo(-2.55, -0.85);
  leftWingShape.closePath();

  const leftWingGeom = new THREE.ExtrudeGeometry(leftWingShape, extrudeSettings);
  const leftWing = new THREE.Mesh(leftWingGeom, hullLightMat);
  leftWing.rotation.x = -Math.PI / 2;
  leftWing.position.y = -0.02;
  shipGroup.add(leftWing);

  // Wing accent stripes
  const rightStripeGeom = new THREE.BoxGeometry(0.12, 0.02, 1.4);
  const rightStripe = new THREE.Mesh(rightStripeGeom, hullAccentMat);
  rightStripe.position.set(1.45, 0.04, 0.1);
  rightStripe.rotation.y = -0.3;
  shipGroup.add(rightStripe);

  const leftStripe = new THREE.Mesh(rightStripeGeom, hullAccentMat);
  leftStripe.position.set(-1.45, 0.04, 0.1);
  leftStripe.rotation.y = 0.3;
  shipGroup.add(leftStripe);

  // --- Wingtip Stabilizer Fins ---
  const finGeom = new THREE.BoxGeometry(0.06, 0.62, 0.75);
  const rightFin = new THREE.Mesh(finGeom, hullDarkMat);
  rightFin.position.set(2.56, 0.26, 1.1);
  rightFin.rotation.z = 0.18; // outward cant
  shipGroup.add(rightFin);

  const leftFin = new THREE.Mesh(finGeom, hullDarkMat);
  leftFin.position.set(-2.56, 0.26, 1.1);
  leftFin.rotation.z = -0.18; // outward cant
  shipGroup.add(leftFin);

  // Dorsal center vertical stabilizer
  const dorsalFinGeom = new THREE.BoxGeometry(0.08, 0.65, 0.95);
  const dorsalFin = new THREE.Mesh(dorsalFinGeom, hullDarkMat);
  dorsalFin.position.set(0, 0.62, 0.95);
  shipGroup.add(dorsalFin);

  // Ventral strakes
  const ventralFinGeom = new THREE.BoxGeometry(0.05, 0.32, 0.65);
  const rightVentralFin = new THREE.Mesh(ventralFinGeom, hullDarkMat);
  rightVentralFin.position.set(0.5, -0.32, 0.7);
  rightVentralFin.rotation.z = -0.22;
  shipGroup.add(rightVentralFin);

  const leftVentralFin = new THREE.Mesh(ventralFinGeom, hullDarkMat);
  leftVentralFin.position.set(-0.5, -0.32, 0.7);
  leftVentralFin.rotation.z = 0.22;
  shipGroup.add(leftVentralFin);

  // --- Wingtip Navigation Lights ---
  // Left: Port Red
  const navLeftSphereGeom = new THREE.SphereGeometry(0.065, 8, 8);
  const navLeftMesh = new THREE.Mesh(navLeftSphereGeom, navLeftMat);
  navLeftMesh.position.set(-2.62, 0.24, 0.88);
  shipGroup.add(navLeftMesh);

  const navLeftLight = new THREE.PointLight(0xff1744, 0.12, 1.2);
  navLeftLight.position.set(-2.66, 0.24, 0.88);
  shipGroup.add(navLeftLight);

  // Right: Starboard Green
  const navRightSphereGeom = new THREE.SphereGeometry(0.065, 8, 8);
  const navRightMesh = new THREE.Mesh(navRightSphereGeom, navRightMat);
  navRightMesh.position.set(2.62, 0.24, 0.88);
  shipGroup.add(navRightMesh);

  const navRightLight = new THREE.PointLight(0x00e676, 0.12, 1.2);
  navRightLight.position.set(2.66, 0.24, 0.88);
  shipGroup.add(navRightLight);

  // --- Dual Rear Engine Thrusters ---
  const engineX = 0.58;
  const engineZ = 1.05;

  // Nacelle cylinders (housing)
  const nacelleGeom = new THREE.CylinderGeometry(0.34, 0.36, 1.1, 18);
  nacelleGeom.rotateX(Math.PI / 2);

  const leftNacelle = new THREE.Mesh(nacelleGeom, hullDarkMat);
  leftNacelle.position.set(-engineX, 0.02, engineZ);
  shipGroup.add(leftNacelle);

  const rightNacelle = new THREE.Mesh(nacelleGeom, hullDarkMat);
  rightNacelle.position.set(engineX, 0.02, engineZ);
  shipGroup.add(rightNacelle);

  // Metallic engine bells (exhaust nozzles)
  const bellGeom = new THREE.CylinderGeometry(0.32, 0.42, 0.45, 18, 1, true);
  bellGeom.rotateX(Math.PI / 2);

  const leftBell = new THREE.Mesh(bellGeom, engineBellMat);
  leftBell.position.set(-engineX, 0.02, engineZ + 0.65);
  shipGroup.add(leftBell);

  const rightBell = new THREE.Mesh(bellGeom, engineBellMat);
  rightBell.position.set(engineX, 0.02, engineZ + 0.65);
  shipGroup.add(rightBell);

  // Interior glow rings
  const ringGeom = new THREE.TorusGeometry(0.24, 0.04, 8, 18);
  const leftRing = new THREE.Mesh(ringGeom, engineInteriorMat);
  leftRing.position.set(-engineX, 0.02, engineZ + 0.7);
  shipGroup.add(leftRing);

  const rightRing = new THREE.Mesh(ringGeom, engineInteriorMat);
  rightRing.position.set(engineX, 0.02, engineZ + 0.7);
  shipGroup.add(rightRing);

  // --- Thruster Plasma Flare Cones ---
  // Pivot helper: cone base sits at local (0, 0, 0), tip extends towards +Z
  function createFlareGeometry(radius, length) {
    const geom = new THREE.ConeGeometry(radius, length, 16, 1, true);
    geom.translate(0, length / 2, 0);
    geom.rotateX(Math.PI / 2);
    return geom;
  }

  const flareZ = engineZ + 0.75;
  const outerRadius = 0.36;
  const outerLength = 1.8;
  const innerRadius = 0.2;
  const innerLength = 1.3;

  // Left thruster flare group
  const leftFlareOuterGeom = createFlareGeometry(outerRadius, outerLength);
  const leftFlareOuter = new THREE.Mesh(leftFlareOuterGeom, flareOuterMat.clone());
  leftFlareOuter.position.set(-engineX, 0.02, flareZ);
  shipGroup.add(leftFlareOuter);

  const leftFlareInnerGeom = createFlareGeometry(innerRadius, innerLength);
  const leftFlareInner = new THREE.Mesh(leftFlareInnerGeom, flareInnerMat.clone());
  leftFlareInner.position.set(-engineX, 0.02, flareZ);
  shipGroup.add(leftFlareInner);

  // Right thruster flare group
  const rightFlareOuterGeom = createFlareGeometry(outerRadius, outerLength);
  const rightFlareOuter = new THREE.Mesh(rightFlareOuterGeom, flareOuterMat.clone());
  rightFlareOuter.position.set(engineX, 0.02, flareZ);
  shipGroup.add(rightFlareOuter);

  const rightFlareInnerGeom = createFlareGeometry(innerRadius, innerLength);
  const rightFlareInner = new THREE.Mesh(rightFlareInnerGeom, flareInnerMat.clone());
  rightFlareInner.position.set(engineX, 0.02, flareZ);
  shipGroup.add(rightFlareInner);

  // Thruster PointLight: dynamic cyan/blue glow centered between engines
  const thrusterLight = new THREE.PointLight(0x8fb4ff, 1.8, 6.0);
  thrusterLight.position.set(0, 0.02, engineZ + 0.9);
  shipGroup.add(thrusterLight);

  // Initial thruster state
  const thrusterGlows = [leftFlareOuter, rightFlareOuter];

  /**
   * Scales flame cones & light intensity based on throttle 0..1 (or >1 when boosting).
   * @param {number} throttle 0 (idle) to 1.0 (cruise), or 2.5 (afterburner boost)
   */
  const _boostOuter = new THREE.Color(0xa9c4ff);
  const _boostInner = new THREE.Color(0xffffff);

  function setThrusterIntensity(throttle) {
    const t = Math.max(0.04, Number(throttle) || 0);

    // Dynamic scale along thrust axis (+Z) and girth (X/Y)
    const zScale = 0.25 + t * 1.0;
    const xyScale = 0.65 + Math.min(t, 2.0) * 0.35;

    leftFlareOuter.scale.set(xyScale, xyScale, zScale);
    rightFlareOuter.scale.set(xyScale, xyScale, zScale);

    const innerZScale = 0.2 + t * 0.85;
    const innerXYScale = 0.55 + Math.min(t, 2.0) * 0.3;

    leftFlareInner.scale.set(innerXYScale, innerXYScale, innerZScale);
    rightFlareInner.scale.set(innerXYScale, innerXYScale, innerZScale);

    // Dynamic opacity & colors
    const boost = THREE.MathUtils.clamp((t - 1.2) / 1.0, 0, 1);
    const outerOpacity = Math.min(1.0, 0.2 + t * 0.35);
    const innerOpacity = Math.min(1.0, 0.3 + t * 0.4);

    for (const flare of [leftFlareOuter, rightFlareOuter]) {
      flare.material.uniforms.uOpacity.value = outerOpacity;
      flare.material.uniforms.uColor.value.setHex(0x6f9dff).lerp(_boostOuter, boost);
    }
    for (const flare of [leftFlareInner, rightFlareInner]) {
      flare.material.uniforms.uOpacity.value = innerOpacity;
      flare.material.uniforms.uColor.value.setHex(0xdfe9ff).lerp(_boostInner, boost);
    }

    thrusterLight.color.setHex(0x8fb4ff);
    thrusterLight.intensity = 0.6 + t * 1.6;
    thrusterLight.distance = (10 + t * 6) * 0.5;
  }

  // Set initial idle glow
  setThrusterIntensity(0.1);

  return {
    mesh: shipGroup,
    thrusterGlows,
    thrusterLight,
    setThrusterIntensity,
  };
}

export default createSpaceship;
