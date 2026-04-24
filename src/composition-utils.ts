/**
 * Helpers that interrogate the live composition + clip-state caches to answer
 * questions like "which clip is currently playing on layer N?" or "which clip
 * is the user focused on right now in Resolume?".
 */

import { client, clipState, composition } from "./state.js";

/**
 * Find the 1-based clip index of the currently connected/playing clip on a
 * given 1-based layer. Returns 0 if nothing is playing.
 * Prefers fully-Connected states over bare "Previewing".
 */
export function findPlayingClipOnLayer(layer: number): number {
  const clips = composition.current?.layers[layer - 1]?.clips;
  if (!clips) return 0;

  let previewingIdx = 0;
  for (let i = 0; i < clips.length; i++) {
    const state = clipState.get(`${layer}:${i + 1}`) ?? clips[i].connected?.value;
    if (state === "Connected" || state === "Connected & previewing") return i + 1;
    if (state === "Previewing" && previewingIdx === 0) previewingIdx = i + 1;
  }
  return previewingIdx;
}

/**
 * Find the currently selected clip in Resolume. Returns {layer, clip} (both
 * 1-based) or null. Falls back to the playing clip on the currently-selected
 * layer if no clip has `selected: true` in the composition.
 */
export function findSelectedClip(): { layer: number; clip: number } | null {
  const comp = composition.current;
  if (!comp) return null;

  for (let li = 0; li < comp.layers.length; li++) {
    const clips = comp.layers[li].clips ?? [];
    for (let ci = 0; ci < clips.length; ci++) {
      if (clips[ci].selected?.value === true) {
        return { layer: li + 1, clip: ci + 1 };
      }
    }
  }

  const selLayer = client.getSelectedLayerIndex() + 1;
  const playing  = findPlayingClipOnLayer(selLayer);
  return playing > 0 ? { layer: selLayer, clip: playing } : null;
}
