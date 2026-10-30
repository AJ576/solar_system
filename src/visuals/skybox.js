import * as THREE from 'three';

/**
 * Procedural star skybox: a camera-centred sphere whose fragment shader draws
 * thousands of crisp stars in several layers, a Milky Way band with dark dust lanes,
 * and a few faint coloured nebulae. Fully resolution independent (no textures).
 *
 * Drawn first, without depth, so everything else renders over it.
 *
 * @param {number} [seed] Changes the layout of the galaxy band and nebulae
 * @returns {{ mesh: THREE.Mesh, update: (cameraPosition: THREE.Vector3) => void, dispose: () => void }}
 */
export function createSkybox(seed = 1) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSeed: { value: (seed % 1000) * 0.137 },
      // Normal of the galactic plane (the band runs around the great circle perpendicular to it)
      uGalaxyNormal: { value: new THREE.Vector3(0.35, 0.88, -0.32).normalize() }
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uSeed;
      uniform vec3 uGalaxyNormal;
      varying vec3 vDir;

      vec3 hash33(vec3 p) {
        p = fract(p * vec3(0.1031, 0.1030, 0.0973));
        p += dot(p, p.yxz + 33.33);
        return fract((p.xxy + p.yxx) * p.zyx);
      }
      float hash13(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }
      float vnoise(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
                       mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                       mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
        return s;
      }

      // Black-body-ish star tint from a 0..1 temperature
      vec3 starColor(float t) {
        return t < 0.15 ? vec3(1.0, 0.72, 0.5)
             : t < 0.35 ? vec3(1.0, 0.88, 0.72)
             : t < 0.8 ? vec3(1.0, 0.97, 0.94)
             : vec3(0.72, 0.82, 1.0);
      }

      // One layer of stars: one candidate per grid cell, kept with probability \`density\`
      vec3 starLayer(vec3 dir, float scale, float density, float size, float brightness, float boost) {
        vec3 p = dir * scale + uSeed;
        vec3 cell = floor(p);
        vec3 col = vec3(0.0);
        // Never smaller than ~1 pixel (no shimmering); keep total light constant when widened
        float px = length(fwidth(p));
        float r = max(size, px * 0.9);
        float energy = (size * size) / (r * r);
        for (int x = -1; x <= 1; x++)
        for (int y = -1; y <= 1; y++)
        for (int z = -1; z <= 1; z++) {
          vec3 c = cell + vec3(x, y, z);
          vec3 h = hash33(c);
          if (h.x > density * boost) continue;
          vec3 starPos = c + 0.5 + (h - 0.5) * 0.8;
          // Project onto the sphere of radius \`scale\` so stars are round
          vec3 sp = normalize(starPos - uSeed) * scale;
          float d = length(dir * scale - sp);
          float mag = pow(hash13(c + 7.1), 3.0);
          float core = smoothstep(r, 0.0, d) * energy;
          float glow = exp(-d * d / (r * r * 5.0)) * 0.1 * energy;
          col += starColor(hash13(c + 3.3)) * (core + glow) * brightness * (0.15 + 1.85 * mag);
        }
        return col;
      }

      void main() {
        #include <logdepthbuf_fragment>
        vec3 dir = normalize(vDir);

        // Milky Way band with mottled structure and dark dust lanes
        float g = dot(dir, uGalaxyNormal);
        float band = exp(-g * g / 0.035);
        float wide = exp(-g * g / 0.18);
        float clouds = fbm(dir * 3.0 + uSeed);
        float lanes = smoothstep(0.42, 0.62, fbm(dir * 6.0 + 11.0 + uSeed));
        float galaxy = band * (0.35 + 0.9 * clouds) * (1.0 - 0.75 * lanes * band) + wide * 0.12;
        vec3 core = vec3(0.95, 0.82, 0.68);
        vec3 arms = vec3(0.55, 0.62, 0.9);
        float towardCore = 0.5 + 0.5 * dot(dir, normalize(cross(uGalaxyNormal, vec3(0.0, 0.0, 1.0))));
        vec3 col = mix(arms, core, towardCore * towardCore) * galaxy * 0.075;

        // Faint coloured nebulae
        float neb = smoothstep(0.55, 0.85, fbm(dir * 1.6 + 40.0 + uSeed));
        float hue = fbm(dir * 0.9 + 80.0);
        col += mix(vec3(0.35, 0.12, 0.45), vec3(0.08, 0.3, 0.42), hue) * neb * 0.05;

        // Stars are denser along the band
        float boost = 1.0 + band * 3.0;
        col += starLayer(dir, 60.0, 0.03, 0.06, 1.8, 1.0);
        col += starLayer(dir, 150.0, 0.025, 0.12, 0.9, boost);
        col += starLayer(dir, 350.0, 0.01, 0.2, 0.45, boost);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10000, 64, 32), material);
  mesh.name = 'Skybox';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;

  return {
    mesh,
    update(cameraPosition) {
      mesh.position.copy(cameraPosition);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    }
  };
}
