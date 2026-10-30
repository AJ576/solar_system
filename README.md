# Procedural Solar System Exploration Prototype

An interactive, playable 3D space exploration prototype built with Three.js and Vite. Explore infinitely many procedurally generated solar systems, pilot a 6DOF starfighter with Newtonian-inspired flight physics, observe Keplerian planetary orbital motion, and engage hyperspace jump drives to transition seamlessly between distant star systems.

---

## Features

- **Procedural Solar System Generation**:
  - Deterministic generation from string or numerical seeds (Mulberry32 PRNG).
  - Star classification types: Yellow Dwarf, Blue Giant, Red Dwarf, Orange Subgiant, and White Star with corresponding radii, masses, emissive intensity, and dynamic point lighting.
  - Randomized planet count (3 to 8 planets per system) featuring distinct terrestrial, desert, ocean, ice, and gas giant archetypes.
  - Non-overlapping elliptical orbital spacing calculated from perihelion/aphelion buffers.
  - Procedural planetary rings and multiple moon satellite systems.
  - Orbital line loops rendering full Keplerian elliptical trajectories in 3D.

- **Procedural Planetary Terrain**:
  - Continuous 3D Simplex noise evaluated on a cube-sphere, so there are no polar seams or pinching.
  - Domain-warped continents with a calibrated sea level (each planet floods an exact share of its surface), continental shelves, and ridged mountain ranges that run along sinuous belts.
  - Hand-tuned variants per planet type, with only small per-seed jitter so every world stays coherent: Ocean (Temperate, Tropical, Savanna, Alien), Desert (Rust, Dune Sea, Badlands), Ice (Glacial, Frozen Highlands, Nitrogen), Rocky (Barren, Volcanic, Iron, Toxic), and Moon (Lunar, Dusty, Icy, Sulfur).
  - Geological features: impact craters with central peaks, shield volcanoes with calderas, mesas, canyons and ice cracks, dune fields, and flooded maria.
  - Liquid surfaces: translucent water oceans with polar sea ice, emissive lava seas, and frozen ice sheets.
  - A temperature model (latitude and altitude) places polar caps and snowy peaks; slopes expose bare rock.
  - Streaming quadtree terrain: each cube face splits into chunks near the camera, down to ~4 m vertex spacing when you are standing on the ground. Chunks are built in Web Workers, use skirts to hide cracks between detail levels, and stop refining past the horizon.
  - Fine detail noise octaves are added only where the mesh can resolve them, and the shader adds texture that fades in at close range.
  - Terrain altitude queries and swept-sphere surface collision keep the ship out of mountains and crater floors.

- **Landing and Exploring on Foot**:
  - Near a surface the flight frame co-rotates with the planet, so the ground below holds still while the planet spins and orbits.
  - Press `G` close to the ground to land (landing is never automatic, so you can skim the surface). The ship settles level, shuts its engines down and stays parked in the planet's frame.
  - Near the surface, planets with an atmosphere add a sky light tinted by their air (warmer at twilight). It is there by day and brighter at night, scaled by how thick the atmosphere is and a per-planet factor, so some nights are bright and others stay moody. Airless worlds only get faint starlight.
  - `N` switches lights on or off at any time: the ship's headlight in flight, or a lantern that lights about 100 m around you on foot.
  - The parked ship is solid when you walk around it; you can climb onto its wings.
  - Press `F` to step out and walk in first person (WASD, Shift to run, Space to jump) with gravity scaled to the body's size. Swim on water worlds; press `F` next to the ship to board again, `W` to take off.

- **Asteroid Belts**:
  - Most systems have an asteroid belt in a gap between planet orbits: a dust band visible from anywhere, and solid rocks of many sizes streamed in around you when you fly into it.

- **Atmospheres**:
  - Ray-marched scattering shell per planet: a bright limb and haze from space, sunset-tinted terminators, and a real sky when you are near the surface.
  - Each variant has its own scattering and sunset colors and density, from thin dusty Mars-like air with blue sunsets to thick Venus-like haze.

- **Keplerian & Newtonian Orbital Mechanics**:
  - Closed-form orbital simulation based on Newton-Raphson Kepler equation solving ($M = E - e \sin E$).
  - Variable orbital eccentricity and inclination tilt for realistic planetary motion.
  - Planetary mean motion strictly following Kepler's Third Law ($n \propto \sqrt{M / a^3}$).
  - Multi-tiered moon orbit hierarchies.
  - Surface distance proximity queries for navigation telemetry.

- **Flight Model**:
  - Persistent throttle (W/S) with smooth acceleration; boost and boost release both ease rather than snap.
  - Flight-assisted velocity that swings toward the nose, so turns carry a little momentum.
  - Cruise drive for travel between bodies: its speed limit scales with altitude above the nearest body, so it slows on approach and disengages automatically when close.
  - Local reference frames: inside a body's sphere of influence the ship moves with that body, so planets hold still relative to you when you are near them.
  - Solid bodies: swept-sphere collision against the star, planets and moons (no tunnelling at cruise speed).
  - Smoothed mouse steering and a lagged chase camera with speed-based FOV.

- **Interstellar Hyperspace Jump Drive**:
  - 4-phase transition: `IDLE` -> `CHARGING` (1.2s) -> `WARPING` (1.8s) -> `ARRIVING` (1.0s).
  - Warp streaks, flash overlay, camera shake and synthesized Web Audio effects.
  - The new system is swapped in behind the flash and the ship arrives next to one of its inner planets.

- **HUD**:
  - Restrained instrument-style overlay (Inter, tabular numerals, one amber accent for the target).
  - Target bracket that follows the body's on-screen size, flight-path marker, and an off-screen arrow that points toward the target.
  - Speed, throttle, drive mode, boost energy, target distance/closing speed/ETA, proximity altitude.
  - Clickable list of every body in the system (`L`), seed input for custom or random jumps, help overlay (`F1` or `?`).

---

## Controls

| Key / Input | Action |
|---|---|
| **Mouse** | Pitch & yaw (click the canvas to capture the mouse, Esc to release) |
| **W / S** | Throttle up / down (throttle stays where you leave it) |
| **X** | Cut throttle |
| **A / D** | Yaw left / right |
| **Q / E** | Roll left / right |
| **Space** | Boost (normal drive only, uses boost energy) |
| **Shift** | Brake (also pulls the throttle down) |
| **C** | Toggle cruise drive (fast travel; slows automatically near bodies) |
| **T / Shift+T** | Next / previous target |
| **R** | Target the body nearest the crosshair |
| **L** | Toggle the list of bodies |
| **H** | Hyperspace jump (to the seed in the input, or a random one) |
| **G** | Land (close to the ground and slow) |
| **F** | Step out of the ship / board it again |
| **N** | Lights on / off (headlight, or lantern on foot) |
| **W A S D**, **Shift**, **Space** | On foot: walk, run, jump |
| **F1 / ?** | Help |

---

## Quick Start & Installation

### Requirements
- Node.js 18+ (tested on Node 25)
- npm

### Development Server
```bash
npm install
npm run dev
```
Open your browser at `http://localhost:5173`.

### Production Build
```bash
npm run build
npm run preview
```

### Running Tests
```bash
node tests/test_flight_and_world.mjs
node tests/test_terrain.mjs
```
Covers generation determinism, orbital spacing, terrain profiles and LOD transitions, flight controls, cruise drive slowdown, collisions against 3D terrain, and local frames.

---

## Architecture

The codebase is orchestrated by `src/game.js`:

```
src/
├── index.html                  # HTML entry point with canvas and #hud-container
├── style.css                   # Global styles
├── script.js                   # Application bootstrap
├── game.js                     # Game loop: orbits -> frame carry -> flight -> terrain LOD -> collisions -> camera -> HUD
├── terrain/
│   ├── terrainNoise.js         # 3D Simplex noise, fBm, ridged multifractal & procedural craters
│   ├── terrainProfiles.js      # Biome configurations (Terrestrial, Desert, Ice, Rocky, Moon)
│   ├── terrainGenerator.js     # getTerrainHeight(), surface positions & analytical normals
│   ├── terrainGeometry.js      # Spherified cube-sphere mesh builder with vertex attributes
│   ├── terrainMaterials.js     # Elevation and slope-based PBR terrain shader
│   ├── terrainLOD.js           # Distance-based LOD manager with hysteresis
│   └── terrainCollision.js     # Terrain altitude queries and swept-sphere collision
├── utils/
│   └── random.js               # Deterministic PRNG & system namer
├── systems/
│   ├── solarSystemGenerator.js # Procedural generation & mesh builder
│   ├── celestialBodies.js      # Body registry: local frames, nearest body, terrain collisions, crosshair picking
│   ├── targetingSystem.js      # Target selection & telemetry (distance, closing speed, ETA)
│   └── hyperspace.js           # Hyperspace state machine & warp effects
├── physics/
│   └── orbitalPhysics.js       # Keplerian orbits and moon orbits
├── player/
│   ├── spaceship.js            # Procedural 3D spaceship
│   └── controls.js             # Flight model & chase camera
├── visuals/
│   ├── environment.js          # Starfield, nebula & ambient light
│   ├── proceduralTextures.js   # Canvas-generated planet, ring, cloud and star textures
│   └── spaceDust.js            # Local dust streaks for speed perception
└── ui/
    └── hud.js                  # HUD overlay
```

---

## Units & Scale

1 u = 100 m (the HUD shows km and m). Constants live in `src/utils/scale.js`.

- **Player**: ~0.018 u (1.8 m) tall, walks at 3 m/s.
- **Spaceship**: ~0.27 u (27 m) long.
- **Moons**: radius ~150–500 u.
- **Rocky / desert / ice / ocean planets**: radius 500–1,250 u.
- **Gas giants**: radius 2,600–4,200 u, optional rings out to 2.4× radius.
- **Stars**: radius 4,500–14,000 u.
- **Orbits**: first planet at ~3.5 star radii + 8,000 u, then 18,000–36,000 u apart (systems span roughly 100,000–300,000 u). Inner planets take ~25–35 minutes per orbit.
- **Speeds**: normal drive up to 20 u/s, boost 70 u/s (12 s, recharges in 4 s), cruise drive up to 40,000 u/s (capped by altitude, drops out 60 u above the ground).
- **Rendering**: camera near 0.004 u, far 4,000,000 u, with `logarithmicDepthBuffer`.

---

## Recommended Asset Upgrades & Technical Specifications

While the prototype renders full procedural canvas textures (gas giant belts, terrestrial biomes, clouds, lunar craters, Cassini rings, star photosphere) and uses Web Audio synthesis without downloading external files, the following asset specifications are prepared for drop-in replacement:

1. **Player Spaceship Mesh (`src/player/spaceship.js`)**:
   - **Format**: GLTF / GLB binary (`.glb`) with Draco compression.
   - **Geometry**: 15,000 – 35,000 triangles, clean quad-dominant topology, single mesh hierarchy with pivot point at center of mass.
   - **PBR Texture Maps (2048×2048, PNG or KTX2/Basis Universal)**:
     - Albedo / Base Color (`_albedo.png`, sRGB).
     - Metallic-Roughness (`_metalRough.png`, Linear, Roughness in Green channel, Metalness in Blue channel).
     - Normal Map (`_normal.png`, DirectX/OpenGL tangent-space normal).
     - Emissive Map (`_emissive.png`, cockpit displays, navigation lights, engine ring glow).
     - Ambient Occlusion (`_ao.png`, Red channel).
   - **Sub-Nodes**: Empty transforms `thruster_port_left`, `thruster_port_right`, `cockpit_eye` for automatic VFX and camera alignment.

2. **Planet PBR Material Texture Sets (`src/systems/solarSystemGenerator.js`)**:
   - **Format**: Equirectangular projection (2:1 aspect ratio), 4096×2048 (terrestrial) and 8192×4096 (gas giants), 8-bit PNG or WebP/KTX2.
   - **Terrestrial / Oceanic / Desert / Ice Archetypes**:
     - Surface Albedo (`diffuse.webp`) with realistic polar ice, biome gradients, and river deltas.
     - 16-bit Height / Displacement Map (`height.png`) for crater, mountain range, and oceanic trench relief.
     - Normal Map (`normal.webp`, 4096×2048) tangent space.
     - Roughness / Specular Ocean Mask (`specular.webp`, black oceans = 100% smooth specular, matte continents).
     - Cloud Layer Map (`clouds_diffuse.webp` + `clouds_alpha.webp`, 4096×2048) with cyclone vortices and atmospheric bands.
     - Night City Lights Map (`emissive_night.webp`, optional for inhabited seeds).
   - **Gas Giant Archetypes**:
     - 8K Banded Texture (`gas_bands.webp`) with Jupiter-like Great Red Spots and turbulent zonal flows.
     - Ring Alpha & Color Map (2048×128 1D gradient strip) defining outer/inner rings, Encke gap, and Cassini division.

3. **Star Environment & Skybox (`src/visuals/environment.js`)**:
   - **Milky Way Galactic Skybox**: 8K cubemap (6 faces × 2048×2048 or 8192×4096 equirectangular panoramic HDR/EXR) with uncompressed high dynamic range for ACES Filmic tone mapping.
   - **Star Corona Shader**: Raymarched volumetric GLSL shader simulating limb darkening, solar granulation, prominence eruptions, and chromatic diffraction spikes.

4. **Audio Assets (`src/systems/hyperspace.js`)**:
   - **Format**: Stereo OGG Vorbis / 48kHz, 24-bit.
   - **SFX List**:
     - `engine_sublight_loop.ogg`: Seamless low-frequency rumble ($40-80\text{ Hz}$) dynamically pitch-shifted with throttle.
     - `afterburner_boost_loop.ogg`: High-energy plasma hiss with resonant low end.
     - `retro_brake.ogg`: Pressurized RCS thruster hiss.
     - `warp_spool.ogg`: Ascending resonant frequency riser (1.2s duration).
     - `warp_boom.ogg`: Deep cinematic sub-bass concussive impact ($20-50\text{ Hz}$) on arrival.
     - `warp_cruise_tunnel.ogg`: Continuous phase-distorted dimensional whoosh.
