import { inject } from '@vercel/analytics';
import { Game } from './game.js';

inject();

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Shows the "Galactic Cruise" loader while the first system is generated (that work is
 * synchronous, so the loader is painted first), lets terrain stream in for a moment,
 * then fades it out and opens the controls screen.
 */
window.addEventListener('DOMContentLoaded', async () => {
  const loader = document.getElementById('loader');
  const status = document.getElementById('loader-status');
  const setStatus = (text) => { if (status) status.textContent = text; };

  await nextFrame();
  await nextFrame();
  setStatus('Generating star system…');
  await nextFrame();

  window.gameInstance = new Game();

  setStatus('Streaming planet surfaces…');
  await wait(900);

  loader?.classList.add('is-done');
  await wait(600);
  loader?.remove();
  window.gameInstance.hud.showHelp();
});
