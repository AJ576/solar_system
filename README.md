# Solar System Simulation

An interactive 3D solar system simulation built with Three.js, featuring realistic planet sizes, orbital distances, and moons with dynamic animations.

## Features

- **Realistic Planet Scaling**: Planets sized relative to Earth based on real astronomical data
  - Mercury: 0.38× Earth
  - Venus: 0.95× Earth
  - Earth: 1.0× (reference)
  - Mars: 0.53× Earth

- **Accurate Orbital Distances**: Orbital distances scaled from real Astronomical Units (AU)
  - Mercury: 0.39 AU
  - Venus: 0.72 AU
  - Earth: 1.0 AU
  - Mars: 1.52 AU

- **Moon Systems**:
  - Earth: 1 moon (The Moon)
  - Mars: 2 moons (Phobos and Deimos)

- **Dynamic Animations**:
  - Planetary rotation around their own axes
  - Orbital revolution around the Sun
  - Moon orbits around their parent planets
  - Adjustable time scale for speed control

- **Interactive Camera**: Fly through the solar system using FlyControls

## Controls

### Camera Movement
- **W** - Move forward
- **S** - Move backward
- **A** - Move left
- **D** - Move right
- **R** - Move up
- **F** - Move down
- **Mouse Drag** - Look around and roll

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Open your browser and navigate to the local server URL (typically `http://localhost:5173`)

## Build

```bash
npm run build
```

## Configuration

You can adjust the simulation speed by modifying the `timeScale` constant in `src/script.js`:

```javascript
const timeScale = 5; // Higher values = faster animation
```

## Technologies Used

- **Three.js** - 3D graphics library
- **Vite** - Build tool and dev server
- **FlyControls** - Three.js camera controls for free-form navigation

## Project Structure

```
solar_system/
├── src/
│   ├── script.js      # Main application logic
│   ├── style.css      # Styling
│   └── index.html     # Entry HTML
├── public/            # Static assets
├── package.json       # Dependencies
└── vite.config.js     # Vite configuration
```

## Customization

### Adding Planets
Add new planet objects to the `planetsData` array in `script.js`:

```javascript
{
    name: 'PlanetName',
    radius: 1.0,        // Relative to Earth
    distance: 50,       // Distance from Sun
    speed: 0.01,        // Orbital speed
    rotation: 0.02,     // Rotation speed
    color: 0xffffff,    // Hex color
    moons: []           // Array of moon objects
}
```

### Adding Moons
Add moon objects to a planet's `moons` array:

```javascript
{ 
    name: 'MoonName', 
    radius: 0.27, 
    distance: 2.5, 
    speed: 0.1, 
    color: 0x888888 
}
```

## License

MIT
