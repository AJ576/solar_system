import * as THREE from 'three';
import { createShadowUniforms, CELESTIAL_SHADOW_PARS_FRAGMENT } from './shadows.js';

/**
 * Ray-marched atmosphere shell.
 *
 * For every pixel of the shell the view ray is intersected with the atmosphere and
 * planet spheres and the in-scattered light is integrated along it, so the same mesh gives:
 *   - a bright limb and a thin haze over the day side seen from space,
 *   - warm (or alien) twilight colors along the terminator,
 *   - a sky when the camera is inside the atmosphere, near the surface.
 *
 * Output is premultiplied: color is added light, alpha is how much of the background
 * the air hides (so stars fade out behind a daytime sky).
 *
 * @param {Object} options
 * @param {number} options.planetRadius Solid surface radius
 * @param {Object} options.config { color, sunsetColor, density, height, falloff }
 * @param {THREE.Object3D} [options.sun] Object whose world position is the light source
 * @returns {THREE.Mesh}
 */
export function createAtmosphere({ planetRadius, config, sun = null }) {
  const atmoRadius = planetRadius * (1 + (config.height ?? 0.06));

  const shadowUniforms = createShadowUniforms();
  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uPlanetRadius: { value: planetRadius },
    uAtmoRadius: { value: atmoRadius },
    uColor: { value: new THREE.Color(config.color) },
    uSunsetColor: { value: new THREE.Color(config.sunsetColor ?? 0xff7a40) },
    uDensity: { value: config.density ?? 1.0 },
    uFalloff: { value: config.falloff ?? 3.5 },
    uSteps: { value: 10 },
    ...shadowUniforms
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uCenter;
      uniform float uPlanetRadius;
      uniform float uAtmoRadius;
      uniform vec3 uColor;
      uniform vec3 uSunsetColor;
      uniform float uDensity;
      uniform float uFalloff;
      uniform int uSteps;
      varying vec3 vWorldPos;

      ${CELESTIAL_SHADOW_PARS_FRAGMENT}

      // Ray / sphere (centered at origin) intersection distances, (-1,-1) on miss
      vec2 raySphere(vec3 ro, vec3 rd, float r) {
        float b = dot(ro, rd);
        float c = dot(ro, ro) - r * r;
        float h = b * b - c;
        if (h < 0.0) return vec2(-1.0);
        h = sqrt(h);
        return vec2(-b - h, -b + h);
      }

      void main() {
        #include <logdepthbuf_fragment>

        vec3 ro = cameraPosition - uCenter;
        vec3 rd = normalize(vWorldPos - cameraPosition);

        // From outside only the near side of the shell is shaded (the far side would double count)
        bool outside = dot(ro, ro) > uAtmoRadius * uAtmoRadius;
        if (outside && !gl_FrontFacing) discard;

        vec2 tA = raySphere(ro, rd, uAtmoRadius);
        if (tA.y <= 0.0) discard;
        float t0 = max(tA.x, 0.0);
        float t1 = tA.y;
        vec2 tP = raySphere(ro, rd, uPlanetRadius);
        if (tP.x > 0.0) t1 = min(t1, tP.x);
        if (t1 <= t0) discard;

        float thickness = uAtmoRadius - uPlanetRadius;
        int steps = clamp(uSteps, 4, 16);
        float ds = (t1 - t0) / float(steps);

        float optical = 0.0;
        float dayAccum = 0.0;
        vec3 light = vec3(0.0);
        for (int i = 0; i < 16; i++) {
          if (i >= steps) break;
          vec3 p = ro + rd * (t0 + (float(i) + 0.5) * ds);
          float r = length(p);
          float h = clamp((r - uPlanetRadius) / thickness, 0.0, 1.0);
          float dens = exp(-h * uFalloff) * (1.0 - h);
          float stepDepth = dens * ds / thickness * uDensity;
          optical += stepDepth;

          vec3 sunDir = normalize(uSunPosition - (p + uCenter));
          float cosSun = dot(p / r, sunDir);
          // Soft terminator, and redder light where the sun is low
          float day = smoothstep(-0.2, 0.15, cosSun);
          float twilight = 1.0 - smoothstep(-0.05, 0.4, cosSun);
          vec3 col = mix(uColor, uSunsetColor, twilight * 0.9);

          light += col * day * stepDepth * exp(-optical * 0.6);
          dayAccum += day * stepDepth;
        }

        // Rayleigh-ish phase plus a forward-scattering glow around the sun
        vec3 sunDirCam = normalize(uSunPosition - cameraPosition);
        float mu = dot(rd, sunDirCam);
        float phase = 0.75 * (1.0 + mu * mu) + 0.6 * pow(max(mu, 0.0), 12.0);

        // Eclipse shadow calculated once per pixel at the atmosphere ray segment midpoint
        vec3 midPos = ro + rd * (0.5 * (t0 + t1)) + uCenter;
        float atmoShadow = calculateEclipseShadow(midPos);

        // Planetshine scattering on night-side atmosphere
        float pScatter = clamp((dot(rd, uPlanetshineDir) + 0.3) / 1.3, 0.0, 1.0);
        vec3 pLight = uPlanetshineColor * (pScatter * optical * 0.5);

        vec3 color = (light * phase * 1.6 + pLight) * atmoShadow;
        float dayFrac = optical > 0.0 ? (dayAccum / optical) * atmoShadow : 0.0;
        float alpha = (1.0 - exp(-optical * 1.2)) * mix(0.25, 0.9, dayFrac);

        gl_FragColor = vec4(color, alpha);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor
  });

  material.userData = material.userData || {};
  material.userData.shadowUniforms = shadowUniforms;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(atmoRadius, 96, 64), material);
  mesh.name = 'Atmosphere';
  // Draw after the surface, ocean and clouds
  mesh.renderOrder = 2;
  mesh.onBeforeRender = () => {
    mesh.getWorldPosition(uniforms.uCenter.value);
    uniforms.uPlanetCenter.value.copy(uniforms.uCenter.value);
    if (sun) sun.getWorldPosition(uniforms.uSunPosition.value);
  };
  return mesh;
}
