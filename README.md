# Galactic Cruise

An interactive, playable 3D space exploration game built with Three.js and Vite. Explore infinitely many procedurally generated solar systems, pilot a 6DOF starfighter with Newtonian-inspired flight physics, land on dynamically streamed fractal worlds, explore alien surfaces on foot, observe Keplerian planetary orbital motion, and engage hyperspace jump drives to transition seamlessly between distant star systems.

---

## Features

- **Procedural Solar System Generation**:
  - Deterministic generation from string or numerical seeds using a Mulberry32 PRNG.
  - Star classifications: Yellow Dwarf, Blue Giant, Red Dwarf, Orange Subgiant, and White Star with corresponding radii, masses, emissive intensity, and dynamic point lighting.
  - Randomized planet counts (3 to 8 planets per system) featuring distinct terrestrial, desert, ocean, ice, and gas giant archetypes.
  - Non-overlapping elliptical orbital spacing calculated from perihelion/aphelion buffers.
  - Procedural planetary rings and multi-tiered moon satellite hierarchies.
  - 3D Keplerian elliptical orbit lines with live planetary motion.

- **Procedural Planetary Terrain & Biomes**:
  - Continuous 3D Simplex noise evaluated on a cube-sphere—no polar pinching or UV distortion seams.
  - Domain-warped continents with calibrated sea levels, continental shelves, and ridged mountain ranges along tectonic belts.
  - Distinct archetypes with tuned parameters: Ocean (Temperate, Tropical, Savanna, Alien), Desert (Rust, Dune Sea, Badlands), Ice (Glacial, Frozen Highlands, Nitrogen), Rocky (Barren, Volcanic, Iron, Toxic), and Moon (Lunar, Dusty, Icy, Sulfur).
  - Geological features: impact craters with central peaks, shield volcanoes with calderas, canyons, mesas, sand dunes, and flooded maria.
  - Dynamic liquid surfaces: translucent water oceans with polar sea ice, emissive lava oceans, and glacial sheets.
  - Quadtree chunk streaming: cube faces subdivide into level-of-detail (LOD) nodes down to ~4 m vertex spacing on foot, with Web Worker generation, skirt geometry to seal cracks, and horizon culling.
  - Swept-sphere surface collision and altitude queries keep ships and walking avatars grounded.

- **Analytical Celestial Shadows & Contact Shadows**:
  - Closed-form spherical eclipse mathematics computed per body on the CPU and applied directly in custom GLSL shader hooks—zero shadow-map render passes.
  - **Solar Eclipses**: Moons cast real-time soft shadows across planetary terrain, oceans, and atmospheres.
  - **Lunar Eclipses**: Planets and parent worlds cast deep umbral and penumbral shadows onto orbiting moons.
  - **Moon-to-Moon Eclipses**: Sibling moons occlude sunlight and shadow neighboring moons.
  - **Ring Shadows**: Rings cast dynamic striped shadow bands onto planetary surfaces and cloud decks; planets cast soft shadows onto their ring systems.
  - **Contact Shadow**: Soft, height-scaled proximity shadow underneath the ship hull for gauging landing clearance.
  - **Reflected Planetshine & Moonshine (Secondary Illumination)**: Real-time analytical planetshine and moonshine evaluated per-pixel from celestial positions, surface palette colors, phase, and solid angles. Gas giants dramatically illuminate the night sides of their orbiting moons in their primary hues, while orbiting moons cast vibrant moonlight across the night sides of their parent worlds.
  - **Surface Ambient & Night Calibration**: Surface skylight dynamically incorporates reflected planetshine and moonshine when celestial bodies hang overhead, while unlit rocky nights maintain a minimal starlight floor for crisp, dark nights.

- **Landing and Exploring on Foot**:
  - Near the surface, the flight reference frame co-rotates with the planet so the ground remains stationary while the world spins and orbits.
  - Manual landing via `G` when within 300 m and under 500 m/s; engines shut down and the craft parks solidly in the planet's rotating frame.
  - Atmospheric scattering and sky illumination tinted by atmospheric composition, warmer at twilight, and scaling with atmospheric density.
  - Switchable lights (`N`): high-intensity starfighter headlight in flight, or a 100 m personal lantern on foot.
  - First-person walking (`F`) with WASD, sprinting (`Shift`), jumping (`Space`), gravity scaled to planetary mass, and swimming in water oceans.

- **Cinematic Photo Mode**:
  - Free-flight 6DOF camera decoupled from the ship and player avatar (`P` or HUD camera icon).
  - Full movement controls (WASD, Space/C vertical, Q/E Dutch roll, Shift speed boost).
  - Adjustable field of view (`[` / `]` or mouse wheel) and exposure levels (`-` / `=`).
  - Pauses orbital motion and flight physics for pristine framing with the HUD automatically hidden.
  - One-click high-resolution PNG snapshot capture (`Enter`).

- **Dynamic Graphics Quality & Performance Presets**:
  - Three tuned quality presets (`Low`, `Medium`, `High`), defaulting to `Medium` and persistent across sessions via `localStorage`.
  - Dynamically adjusts renderer pixel ratio (1.0x / 1.5x / 2.0x).
  - Scales atmospheric ray-marching scattering steps (6 / 10 / 16 steps).
  - Scales space dust particle density (250 / 600 / 1000 particles).
  - Balances terrain quadtree LOD subdivision aggression for smooth performance on both laptops and dedicated GPUs.

- **Flight Model & Interstellar Travel**:
  - Persistent throttle with smooth acceleration curves; momentum-preserving flight assist.
  - Space boost capacitor for rapid interception.
  - Cruise drive for interplanetary transit; automatically scales velocity with altitude and safely disengages near celestial bodies.
  - Asteroid belts: dense toroidal dust band visible across the system, with instanced 3D rocks dynamically streamed in around your ship.
  - 4-phase hyperspace jump drive (`IDLE` -> `CHARGING` -> `WARPING` -> `ARRIVING`) with screen shake, streak effects, and arrival flash.

- **Audio & System Settings**:
  - Procedural sound synthesis using the Web Audio API—no external audio files required.
  - Dynamic engine rumbles, thruster hiss, cruise spooling, warp transitions, ambient wind, and collision thuds.
  - Comprehensive Settings modal (`O` or `⚙` icon) housing audio toggles, graphics presets, and custom seed coordinates.
  - HUD quick-jump button (`H`) for instant random hyperspace jumps.

---

## Controls

### Flight Controls

| Key / Input | Action |
|---|---|
| **Mouse** | Pitch & yaw steering (click canvas to lock mouse, <kbd>Esc</kbd> to unlock) |
| **W / S** | Increase / decrease throttle (persistent throttle level) |
| **X** | Cut throttle to zero |
| **A / D** | Yaw left / right |
| **Q / E** | Roll left / right |
| **Space** | Boost afterburner (consumes boost energy) |
| **Shift** | Reverse brake / decelerate |
| **C** | Toggle cruise drive (fast interplanetary transit; auto-slows near bodies) |
| **G** | Land ship (when within 300 m of surface and below 500 m/s) |
| **F** | Step out of ship onto surface / board parked ship |
| **N** | Toggle headlights (flight) or lantern (on foot) |

### Navigation & Targeting

| Key / Input | Action |
|---|---|
| **T / Shift+T** | Select next / previous celestial target |
| **R** | Target celestial body closest to the crosshair |
| **L** | Open / close target list of all bodies in the system |
| **H** | Hyperspace jump to a random system |

### On Foot

| Key / Input | Action |
|---|---|
| **W A S D** | Walk forward / backward / strafe |
| **Shift** | Sprint |
| **Space** | Jump / swim up |
| **F** | Board nearby parked ship |
| **N** | Toggle personal exploration lantern |

### Cinematic Photo Mode

| Key / Input | Action |
|---|---|
| **P** | Enter / exit Photo Mode |
| **W A S D** | Move camera forward / back / left / right |
| **Space / C** | Move camera vertically up / down |
| **Q / E** | Dutch angle roll / tilt |
| **Shift** | High-speed camera movement |
| **[ / ]** (or **Scroll**) | Narrow / widen FOV (zoom in / out) |
| **- / =** | Adjust exposure down / up |
| **Enter** | Take high-resolution screenshot snapshot |
| **Esc** | Exit Photo Mode |

### System & Settings

| Key / Input | Action |
|---|---|
| **O** | Open / close System Settings modal (Audio, Graphics, Custom Seed) |
| **U** | Quick toggle mute / unmute audio |
| **F1** or **?** | Toggle Controls Help overlay |
| **Esc** | Close open modals or release pointer lock |

---

## Quick Start & Installation

### Requirements
- Node.js 18+ (tested on Node 20 / 22 / 25)
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
Run the complete automated test suite (62+ unit and integration tests):
```bash
npm test
```
The test suite validates:
- Terrain determinism, biome profiles, cube-sphere geometry, and LOD streaming (`tests/test_terrain.mjs`).
- Scale, Keplerian orbits, flight physics, cruise slowdown, and collisions (`tests/test_flight_and_world.mjs`).
- Analytical eclipse calculations, occluder culling, and ship contact shadow (`tests/test_shadows.mjs`).
- Quality presets, settings modal, audio toggles, seeded jumps, and photo mode (`tests/test_features.mjs`).

---

## Architecture

The application is orchestrated by `src/game.js`:

```
src/
├── index.html                  # HTML entry point with canvas and HUD container
├── style.css                   # Global styles & HUD theme definitions
├── script.js                   # Application bootstrap
├── game.js                     # Central game loop: orbits -> carry -> flight -> terrain LOD -> shadows -> HUD
├── audio/
│   └── audioManager.js         # Web Audio API procedural sound synthesizer
├── physics/
│   └── orbitalPhysics.js       # Keplerian elliptical orbital motion solver
├── player/
│   ├── controls.js             # 6DOF Newtonian-assisted flight controls & chase camera
│   ├── onFoot.js               # First-person surface walking, jumping & swimming controller
│   ├── photoMode.js            # Decoupled free camera with FOV, roll, exposure & capture
│   └── spaceship.js            # Procedural starfighter geometry & thruster effects
├── systems/
│   ├── asteroidBelt.js         # Spatial-hashed asteroid field & dust band streaming
│   ├── celestialBodies.js      # Celestial body registry, local frames & collision detection
│   ├── hyperspace.js           # Hyperspace warp state machine & visual effects
│   ├── qualitySettings.js      # Graphics quality presets (Low/Medium/High) & live scaling
│   ├── solarSystemGenerator.js # Procedural solar system generator & mesh builder
│   └── targetingSystem.js      # Target bracket telemetry (distance, closing velocity, ETA)
├── terrain/
│   ├── terrainCollision.js     # Surface altitude queries & swept-sphere collision response
│   ├── terrainGenerator.js     # 3D Simplex height evaluation & analytical surface normals
│   ├── terrainGeometry.js      # Spherified cube-sphere mesh builder with vertex attributes
│   ├── terrainLOD.js           # Quadtree LOD chunk manager with horizon culling
│   ├── terrainMaterials.js     # Slope & elevation PBR terrain shader
│   ├── terrainNoise.js         # Simplex noise, fractal fBm & procedural impact craters
│   ├── terrainProfiles.js      # Biome configurations (Ocean, Desert, Ice, Rocky, Moon)
│   └── terrainWorker.js        # Web Worker background chunk generation
├── ui/
│   └── hud.js                  # Reticle, telemetry, target list, settings modal & help overlay
├── utils/
│   ├── random.js               # Mulberry32 deterministic PRNG & system namer
│   └── scale.js                # Universal cosmic scale constants
└── visuals/
    ├── atmosphere.js           # Ray-marched atmospheric scattering shader
    ├── environment.js          # Procedural starry skybox & ambient light
    ├── proceduralTextures.js   # Procedural canvas textures for planets, rings, and stars
    ├── shadows.js              # Analytical celestial eclipse maths & shader uniform injection
    ├── shipShadow.js           # Soft contact shadow mesh beneath the ship hull
    ├── skybox.js               # Multi-layered cosmic background shader
    └── spaceDust.js            # High-speed space dust particle stream
```

---

## Units & Scale

All internal coordinates operate at **1 unit = 100 meters** (the HUD automatically converts and displays values in kilometers and meters). Scale definitions live in `src/utils/scale.js`:

- **Player**: ~0.018 u (1.8 m) tall, walks at ~3 m/s.
- **Spaceship**: ~0.27 u (27 m) long.
- **Moons**: Radius ~150–500 u (15–50 km).
- **Rocky / Desert / Ice / Ocean Planets**: Radius 500–1,250 u (50–125 km).
- **Gas Giants**: Radius 2,600–4,200 u (260–420 km), with planetary rings spanning out to 2.4× radius.
- **Stars**: Radius 4,500–14,000 u (450–1,400 km).
- **Orbits**: First planet located at ~3.5 star radii + 8,000 u; interplanetary spacing ranges from 18,000 to 36,000 u. Systems span roughly 100,000 to 300,000 u across.
- **Speeds**: Sublight flight up to 20 u/s (2 km/s); afterburner boost up to 70 u/s (7 km/s); cruise drive up to 40,000 u/s (4,000 km/s).
- **Camera Depth**: Logarithmic depth buffer rendering objects from near 0.004 u (40 cm) to far 4,000,000 u (400,000 km).
