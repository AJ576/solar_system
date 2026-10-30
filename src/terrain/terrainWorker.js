import { buildChunkData } from './terrainGeometry.js';

/**
 * Builds terrain chunks off the main thread. Receives buildChunkData parameters plus an
 * `id`, replies with the typed arrays transferred back.
 */
self.onmessage = (e) => {
  const { id, params } = e.data;
  const data = buildChunkData(params);
  const transfer = [data.positions.buffer, data.normals.buffer, data.colors.buffer, data.indices.buffer];
  if (data.liquid) {
    transfer.push(data.liquid.positions.buffer, data.liquid.normals.buffer, data.liquid.indices.buffer);
  }
  self.postMessage({ id, data }, transfer);
};
