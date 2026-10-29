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

- **Keplerian & Newtonian Orbital Mechanics**:
  - Closed-form orbital simulation based on Newton-Raphson Kepler equation solving ($M = E - e \sin E$).
  - Variable orbital eccentricity and inclination tilt for realistic planetary motion.
  - Planetary mean motion strictly following Kepler's Third Law ($n \propto \sqrt{M / a^3}$).
  - Multi-tiered moon orbit hierarchies.
  - Surface distance proximity queries for navigation telemetry.

- **6DOF Spaceship & Flight Physics**:
  - Procedural 3D composite starfighter model featuring an aerodynamic faceted hull, tinted canopy, swept delta wings with canted stabilizer fins, aviation navigation lights, and dual plasma exhaust bells with dynamic throttle flares.
  - Responsive flight model with inertial space gliding and frame-rate-independent damping.
  - Afterburner boost drive with energy consumption and dynamic replenishment.
  - Emergency airbrakes for rapid stopping.
  - Smooth third-person trailing chase camera with velocity-based dynamic FOV and banking.

- **Interstellar Hyperspace Jump Drive**:
  - Complete 4-phase transition state machine: `IDLE` -> `CHARGING` (1.2s) -> `WARPING` (1.8s) -> `ARRIVING` (1.0s).
  - 1,000-streak warp tunnel effect with screen-space warp flash overlay and camera vibration.
  - Synthesized Web Audio API sound effects for drive spin-up, warp boom, and arrival.
  - Atomic world swap with zero-leak resource disposal and safe outer-system player repositioning.

- **Sci-Fi HUD & Telemetry Overlay**:
  - High-tech glassmorphism interface with monospace typography.
  - Real-time speedometer gauge, throttle percentage, and boost reservoir bar.
  - Holographic center reticle with horizon notches and elevation ladders.
  - Celestial body proximity scanner with approach/recede distance indicators.
  - Seed input bar for jumping to custom or random solar systems anytime.
  - Toggleable keybindings modal (`F1` or `?`).

---

## Controls

| Key / Input | Action | Description |
|---|---|---|
| **W** | Accelerate forward | Linear thrust along nose direction ($120\text{ u/s}^2$ up to $160\text{ u/s}$) |
| **S** | Reverse thrust | Decelerates or reverses ship up to $60\text{ u/s}$ |
| **A / D** | Yaw turn left / right | Pure uncoupled yaw rotation around ship's local vertical axis (zero roll drift) |
| **Q / E** | Roll left / right | Bank wings along ship's longitudinal axis ($2.8\text{ rad/s}$) |
| **Mouse** | 1:1 Direct Pitch & Yaw | Razor-sharp steering with zero rotational lag (Click canvas to toggle pointer lock) |
| **Space** | Afterburner Boost | Explosive thrust surge ($280\text{ u/s}^2$ up to $450\text{ u/s}$) |
| **Shift** | Active Retro-Braking | Reverse RCS thrusters cancel velocity vector ($65\text{ u/s}^2$) to dead stop |
| **T / Shift+T** | Target Next / Prev Body | Cycles deliberate targeting through Star, Planets, and Moons |
| **H** | Hyperspace Jump | Spools warp drive and transitions into a new procedural solar system |
| **F1 / ?** | Toggle Controls Help | Opens in-game telemetry & controls manual overlay |
| **Escape** | Release pointer lock | Unlocks mouse cursor from the canvas |

---

## Flight HUD & Direction Indicators

The cockpit HUD provides three distinct, non-overlapping visual flight indicators:

1. **Ship Heading Reticle (Center Cyan Crosshair)**:
   - Permanently locked to the ship's nose forward vector ($50\%, 50\%$).
   - Shows where the starfighter is pointing and where forward thrusters will apply acceleration.
2. **Velocity Direction Indicator (Green/Cyan Flight Path Marker)**:
   - An aerospace standard flight path marker ($\text{---}\circ\text{---}$) projected dynamically onto the screen from physical velocity $\vec{V}$.
   - Shows the exact direction the vessel is traveling through space.
   - When coasting or drifting sideways, smoothly separates from the heading reticle to visualize Newtonian momentum.
3. **Selected Celestial Target Marker (Amber Diamond Bracket & Tag)**:
   - World-space projected targeting bracket over the currently selected celestial body.
   - Displays real-time name and surface distance (`[ 1,450 u ]`).
   - Remains 100% stable until explicitly changed using `T` / `Shift+T`.
   - When target is off-screen or behind the camera, a perimeter edge pointer displays directional bearing.

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

### Running Subsystem Verification Tests
```bash
node tests/verify_game.mjs
```

---

## Architecture & Subagent Responsibilities

The codebase follows a modular architecture orchestrated by `src/game.js`:

```
src/
├── index.html                  # HTML entry point with canvas and #hud-container
├── style.css                   # Global styles & sci-fi UI theme
├── script.js                   # Application bootstrap
├── game.js                     # Main orchestrator & game loop coordinator
├── utils/
│   └── random.js               # Deterministic Mulberry32 PRNG & system namer
├── systems/
│   ├── solarSystemGenerator.js # [Agent 1] Procedural generation & mesh builder
│   └── hyperspace.js           # [Agent 4] Hyperspace state machine & warp effects
├── physics/
│   └── orbitalPhysics.js       # [Agent 2] Keplerian physics & proximity query
├── player/
│   ├── spaceship.js            # [Agent 3] Procedural 3D composite spaceship
│   └── controls.js             # [Agent 3] 6DOF flight physics & chase camera
├── visuals/
│   └── environment.js          # [Agent 5] Multi-layer starfield, nebula & lighting
└── ui/
    └── hud.js                  # [Agent 5] In-game telemetry, reticle, and radar
```

---

## Units & Scaling (5-Tier Astronomical Scale Hierarchy)

The world unit scale has been overhauled from toy dimensions to a monumental 5-tier astronomical hierarchy. All celestial bodies now dwarf the spacecraft, providing an authentic sense of cosmic majesty:

- **Spaceship**: Canonical length $2.44 u$, wingspan $2.72 u$, height $0.68 u$ (scaled $0.5\times$ from master model, representing a nimble $\sim 25\text{m}$ interceptor).
- **Moons**: Radius $R = 6 - 32 u$ (2.5× to 13× the ship's length).
- **Terrestrial / Rocky Planets**: Radius $R = 28 - 60 u$ (11× to 25× the ship's length, visual surface horizon visible when approaching).
- **Gas Giants**: Radius $R = 130 - 210 u$ (53× to 86× the ship's length, with rings extending up to $500 u$).
- **Stars (Solar Cores)**: Radius $R = 260 - 720 u$ (100× to 300× the ship's length, radiating dynamic PointLight up to $40,000 u$).
- **Orbital Radii**: Semi-major axes $a = 1,100 - 10,000 u$ with non-overlapping perihelion/aphelion buffers.
- **Rendering Depth**: Camera near $0.5 u$, far $75,000 u$ with WebGL `logarithmicDepthBuffer: true` to prevent z-fighting across sub-meter to mega-meter ranges.
- **Flight Speeds & Dynamics**:
  - Acceleration: $120 u/s^2$
  - Cruising Velocity: $0 - 160 u/s$
  - Afterburner Boost Velocity: up to $450 u/s$
  - Active Retro-Braking: $65 u/s^2$ opposing velocity vector
  - Vacuum Gliding: Zero linear drag (`linearDamping = 1.0`), pure momentum conservation when coasting
  - Delta-time clamped to $\le 0.05s$ to guarantee closed-form numerical orbital stability.

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
