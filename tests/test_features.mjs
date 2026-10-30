import * as THREE from 'three';
import { QualitySettings, QUALITY_PRESETS } from '../src/systems/qualitySettings.js';
import { HUD } from '../src/ui/hud.js';
import { PhotoMode } from '../src/player/photoMode.js';
import { generateSolarSystemData, buildSolarSystemMeshes } from '../src/systems/solarSystemGenerator.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    failed++;
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
  passed++;
}

// Mock localStorage for Node test runner
const storageMap = new Map();
globalThis.localStorage = {
  getItem: (key) => storageMap.get(key) || null,
  setItem: (key, val) => storageMap.set(key, String(val)),
  removeItem: (key) => storageMap.delete(key),
  clear: () => storageMap.clear()
};

function createMockCanvasContext() {
  return {
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    drawImage: () => {},
    setTransform: () => {},
    scale: () => {},
    translate: () => {},
    rotate: () => {},
    clip: () => {},
    measureText: (txt) => ({ width: (txt || '').length * 6 }),
    fillText: () => {},
    strokeText: () => {},
    setLineDash: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => {}
  };
}

// Mock minimal DOM for Node test runner
function createMockElement(tag = 'div') {
  const listeners = {};
  const style = {};
  const children = [];
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    style,
    dataset: {},
    children,
    value: '',
    textContent: '',
    innerHTML: '',
    width: 800,
    height: 600,
    blur: () => {},
    focus: () => {},
    appendChild(child) {
      children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      return child;
    },
    querySelector(sel) {
      if (sel === 'canvas' || sel === '.hud-map-canvas') {
        const canvas = createMockElement('canvas');
        canvas.parentElement = this;
        return canvas;
      }
      const childEl = createMockElement('div');
      childEl.parentElement = this;
      return childEl;
    },
    querySelectorAll(sel) {
      if (sel === '[data-ref]') {
        const matches = [];
        const re = /data-ref=["']([^"']+)["']/g;
        let m;
        while ((m = re.exec(this.innerHTML)) !== null) {
          const ref = m[1];
          const childEl = createMockElement('div');
          childEl.dataset.ref = ref;
          childEl.parentElement = this;
          matches.push(childEl);
        }
        return matches;
      }
      return [];
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    },
    click() {
      const fns = listeners['click'] || [];
      for (const fn of fns) fn({ target: this, stopPropagation: () => {}, preventDefault: () => {} });
    },
    listeners,
    addEventListener(evt, fn) {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    removeEventListener(evt, fn) {
      if (listeners[evt]) {
        listeners[evt] = listeners[evt].filter(f => f !== fn);
      }
    },
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false
    }
  };

  if (tag.toLowerCase() === 'canvas') {
    el.getContext = createMockCanvasContext;
    el.toDataURL = () => 'data:image/png;base64,mock';
  }

  return el;
}

globalThis.document = {
  createElement: (tag) => createMockElement(tag),
  body: createMockElement('body')
};
globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  devicePixelRatio: 2.0,
  addEventListener: () => {},
  removeEventListener: () => {}
};

console.log('\n[1. Graphics Quality Presets & Dynamic Scaling]');
{
  assert(QUALITY_PRESETS.Low && QUALITY_PRESETS.Medium && QUALITY_PRESETS.High, 'Quality presets Low, Medium, and High exist');
  assert(QUALITY_PRESETS.Low.atmoSteps === 6, 'Low preset sets 6 atmosphere raymarch steps');
  assert(QUALITY_PRESETS.Medium.atmoSteps === 10, 'Medium preset sets 10 atmosphere raymarch steps');
  assert(QUALITY_PRESETS.High.atmoSteps === 16, 'High preset sets 16 atmosphere raymarch steps');

  assert(QUALITY_PRESETS.Low.pixelRatioMax === 1.0, 'Low preset caps pixel ratio to 1.0');
  assert(QUALITY_PRESETS.Medium.pixelRatioMax === 1.5, 'Medium preset sets 1.5 pixel ratio');
  assert(QUALITY_PRESETS.High.pixelRatioMax === 2.0, 'High preset sets 2.0 pixel ratio');

  assert(QUALITY_PRESETS.Low.dustCount === 250, 'Low preset sets 250 space dust particles');
  assert(QUALITY_PRESETS.Medium.dustCount === 600, 'Medium preset sets 600 space dust particles');
  assert(QUALITY_PRESETS.High.dustCount === 1000, 'High preset sets 1000 space dust particles');

  assert(QUALITY_PRESETS.Low.splitFactor < QUALITY_PRESETS.Medium.splitFactor, 'Low preset has conservative terrain splitFactor');
  assert(QUALITY_PRESETS.Medium.splitFactor < QUALITY_PRESETS.High.splitFactor, 'High preset has aggressive terrain splitFactor');

  // Cycle quality
  const qs = new QualitySettings();
  assert(qs.current === 'Medium', 'Default quality preset is Medium');
  
  let next = qs.cycleQuality();
  assert(next === 'High' && qs.current === 'High', 'Cycling from Medium moves to High');
  
  next = qs.cycleQuality();
  assert(next === 'Low' && qs.current === 'Low', 'Cycling from High moves to Low');

  next = qs.cycleQuality();
  assert(next === 'Medium' && qs.current === 'Medium', 'Cycling from Low moves back to Medium');

  // Persistence check
  qs.setQuality('High');
  assert(storageMap.get('sol_graphics_quality') === 'High', 'Quality choice saved to localStorage');
  const qs2 = new QualitySettings();
  assert(qs2.current === 'High', 'Quality choice reloaded from localStorage');

  // Apply to game components
  let setPixelRatioCalledWith = null;
  let dustSetCountCalledWith = null;
  const mockAtmosphereMat = {
    uniforms: {
      uSteps: { value: 10 }
    }
  };
  const mockTerrainLOD = {
    splitFactor: 2.0
  };

  const mockGame = {
    renderer: {
      setPixelRatio: (val) => { setPixelRatioCalledWith = val; },
      setSize: () => {}
    },
    spaceDust: {
      setCount: (cnt) => { dustSetCountCalledWith = cnt; }
    },
    systemMeshes: {
      planetEntries: [
        {
          atmoMesh: { material: mockAtmosphereMat },
          terrainLOD: mockTerrainLOD,
          moons: [
            {
              terrainLOD: { splitFactor: 2.0 }
            }
          ]
        }
      ]
    }
  };

  qs.setQuality('Low', mockGame);
  assert(setPixelRatioCalledWith === 1.0, 'applyToGame updates renderer pixelRatio to 1.0');
  assert(dustSetCountCalledWith === 250, 'applyToGame updates space dust count to 250');
  assert(mockAtmosphereMat.uniforms.uSteps.value === 6, 'applyToGame updates atmosphere shader uniform uSteps to 6');
  assert(mockTerrainLOD.splitFactor === 1.4, 'applyToGame updates terrain LOD splitFactor to 1.4');

  qs.setQuality('High', mockGame);
  assert(setPixelRatioCalledWith === 2.0, 'applyToGame updates renderer pixelRatio to 2.0');
  assert(dustSetCountCalledWith === 1000, 'applyToGame updates space dust count to 1000');
  assert(mockAtmosphereMat.uniforms.uSteps.value === 16, 'applyToGame updates atmosphere shader uniform uSteps to 16');
  assert(mockTerrainLOD.splitFactor === 2.6, 'applyToGame updates terrain LOD splitFactor to 2.6');
}

console.log('\n[2. HUD Navigation & Settings Modal]');
{
  let jumpSeedCalled = null;
  let audioMuted = false;
  let selectedQuality = null;

  const container = createMockElement('div');
  const hud = new HUD(container, {
    onJump: (seed) => { jumpSeedCalled = seed; },
    onToggleAudio: () => {
      audioMuted = !audioMuted;
      return audioMuted;
    },
    onSetQuality: (q) => { selectedQuality = q; }
  });

  assert(hud._settingsOpen === false, 'Settings modal starts closed');
  assert(hud.el.settingsModal !== undefined, 'Settings modal DOM element exists');
  assert(hud.el.btnSettings !== undefined, 'Settings gear button exists in HUD nav');
  assert(hud.el.btnJump !== undefined, 'Outside Jump button exists in HUD nav');

  // Outside Jump button initiates random jump
  jumpSeedCalled = null;
  hud.el.btnJump.click();
  assert(typeof jumpSeedCalled === 'string' && jumpSeedCalled.length > 0, 'Outside Jump button performs random jump');

  // Open settings
  hud.toggleSettings();
  assert(hud._settingsOpen === true, 'toggleSettings() opens settings modal');
  assert(hud.el.settingsModal.style.display === 'flex', 'Settings modal display is flex when open');

  // Quality button selection in settings modal
  hud.el.btnQualityLow.click();
  assert(selectedQuality === 'Low', 'Clicking Low quality button in settings fires onSetQuality("Low")');

  hud.el.btnQualityHigh.click();
  assert(selectedQuality === 'High', 'Clicking High quality button in settings fires onSetQuality("High")');

  hud.setQualityLabel('High');
  assert(hud.el.qualityDesc.textContent.includes('Full resolution'), 'setQualityLabel updates settings description');

  // Audio toggle in settings modal
  assert(audioMuted === false, 'Audio starts unmuted');
  hud.el.btnAudioToggle.click();
  assert(audioMuted === true, 'Clicking audio toggle in settings modal toggles audio state to muted');
  assert(hud.el.settingsAudioLabel.textContent === 'Unmute Audio', 'Audio toggle button updates label to "Unmute Audio"');

  // Seeded jump button in settings modal
  jumpSeedCalled = null;
  hud.el.seedInput.value = 'KEPLER-452B';
  hud.el.btnSeededJump.click();
  assert(jumpSeedCalled === 'KEPLER-452B', 'Clicking Jump to Seed in settings initiates jump with custom seed');
  assert(hud._settingsOpen === false, 'Clicking Jump to Seed closes the settings modal');

  // Close settings via close button
  hud.toggleSettings();
  assert(hud._settingsOpen === true, 'Settings modal opened again');
  hud.el.btnSettingsClose.click();
  assert(hud._settingsOpen === false, 'Clicking settings close button closes modal');

  // Close settings via Done button
  hud.toggleSettings();
  assert(hud._settingsOpen === true, 'Settings modal opened for Done test');
  hud.el.btnSettingsDone.click();
  assert(hud._settingsOpen === false, 'Clicking settings Done button closes modal');

  // Toggle settings via keyboard shortcut 'O'
  assert(hud.root.innerHTML.includes('data-ref="btnSettings" title="Settings (O)"'), 'Settings button title includes (O) shortcut');
  assert(hud.root.innerHTML.includes('class="hud-btn hud-btn--icon" data-ref="btnSettings"'), 'Settings button uses icon class hud-btn--icon');
  hud._handleKey({ code: 'KeyO', preventDefault: () => {} });
  assert(hud._settingsOpen === true, 'Pressing O opens settings modal');
  hud._handleKey({ code: 'KeyO', preventDefault: () => {} });
  assert(hud._settingsOpen === false, 'Pressing O again closes settings modal');
}

console.log('\n[3. Photo Mode Cinematic Controls]');
{
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 1000);
  camera.position.set(10, 20, 30);
  camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);

  const mockGame = {
    camera,
    canvas: createMockElement('canvas'),
    renderer: {
      toneMappingExposure: 1.2,
      render: () => {}
    },
    hudContainer: createMockElement('div'),
    systemData: { name: 'Photo-System' }
  };

  const photo = new PhotoMode(mockGame);
  assert(photo.isActive === false, 'Photo mode starts inactive');

  // Enter photo mode
  photo.enter();
  assert(photo.isActive === true, 'Photo mode active after enter()');
  assert(photo.savedFov === 62, 'Photo mode saves camera initial FOV');
  assert(photo.savedExposure === 1.2, 'Photo mode saves camera initial exposure');
  assert(photo.savedPos.distanceTo(new THREE.Vector3(10, 20, 30)) < 1e-5, 'Photo mode saves initial camera position');
  assert(mockGame.hudContainer.style.display === 'none', 'Photo mode hides gameplay HUD');

  // Flight simulation in photo mode
  photo.keys.forward = true;
  photo.update(0.1); // 100ms step
  assert(camera.position.distanceTo(new THREE.Vector3(10, 20, 30)) > 0.1, 'Camera moves forward along view vector');
  photo.keys.forward = false;

  // FOV and Roll adjustment
  camera.fov = 35; // Telephoto shot
  photo.roll = 0.2; // 11.5° Dutch angle tilt
  photo._updateCameraRotation();
  assert(camera.fov === 35, 'FOV adjusted to 35°');

  // Exit photo mode restores original camera pose and gameplay HUD
  photo.exit();
  assert(photo.isActive === false, 'Photo mode inactive after exit()');
  assert(camera.fov === 62, 'Camera FOV restored to original 62°');
  assert(mockGame.renderer.toneMappingExposure === 1.2, 'Renderer exposure restored');
  assert(camera.position.distanceTo(new THREE.Vector3(10, 20, 30)) < 1e-5, 'Camera position restored to pre-photo position');
  assert(mockGame.hudContainer.style.display === 'block', 'Gameplay HUD restored on exit');
}

console.log(`\nAll ${passed} feature tests passed successfully!`);
