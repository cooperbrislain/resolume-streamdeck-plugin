/**
 * Apply `LinkSettings` (from a Parameter dial's Property Inspector) to the
 * runtime knob handler. Shared between `LinkAction` and reconnect / playing-
 * clip-change handlers that need to re-bind dials on the fly.
 */

import { client, knobHandler, linkEncoderMap } from "./state.js";
import { findPlayingClipOnLayer } from "./composition-utils.js";
import { updateLinkFeedback } from "./render/link-display.js";
import type { LinkSettings } from "./types.js";

export async function applyLinkSettings(
  column: number,
  settings: Partial<LinkSettings>,
): Promise<void> {
  const source = settings?.source ?? "composition";

  if (source === "layer") {
    // layerIndex 0 = "whichever layer is currently selected in Resolume"
    const rawIdx = settings?.layerIndex ?? 0;
    const layer  = rawIdx > 0 ? rawIdx : client.getSelectedLayerIndex() + 1;
    const param  = settings?.layerParam ?? "opacity";

    let value = 0, min = 0, max = param === "speed" ? 2 : 1;
    let id: number | undefined;
    try {
      const full = await client.getLayerParamFull(layer, param);
      ({ value, min, max, id } = full);
    } catch (err) {
      console.warn(`[link] getLayerParamFull(${layer}, ${param}) failed:`, err);
    }
    knobHandler.assignDialToLayer(column, layer, param, value, min, max, id, settings?.sensitivity);
    return;
  }

  if (source === "clip") {
    const layer = Math.max(1, settings?.layerIndex ?? 1);
    const rawClipIdx = settings?.clipIndex ?? 1;
    // clipIndex 0 = "currently playing clip on this layer"
    const clip = rawClipIdx > 0 ? rawClipIdx : findPlayingClipOnLayer(layer);
    const param = settings?.clipParam ?? "opacity";

    if (clip === 0) {
      // Nothing playing yet — leave dial unassigned until one starts.
      knobHandler.assignDial(column, null);
      return;
    }

    let value = 0, min = 0, max = param === "speed" ? 2 : 1;
    let id: number | undefined;
    try {
      const full = await client.getClipParamFull(layer, clip, param);
      ({ value, min, max, id } = full);
    } catch (err) {
      console.warn(`[link] getClipParamFull(${layer}, ${clip}, ${param}) failed:`, err);
    }
    knobHandler.assignDialToClip(column, layer, clip, param, value, min, max, id, settings?.sensitivity);
    return;
  }

  // Dashboard parameter
  const paramId = settings?.paramId ?? null;
  if (paramId === null) { knobHandler.assignDial(column, null); return; }
  const param = client.getDashboardParams().find(p => p.id === paramId) ?? null;
  knobHandler.assignDial(column, param, settings?.sensitivity);
}

/**
 * Re-apply link settings for any Parameter dial configured as
 * "currently playing clip" on the given layer. Called whenever a clip
 * connection changes so the dial tracks whichever clip is playing.
 */
export async function reapplyPlayingClipLinks(layer: number): Promise<void> {
  for (const [col, act] of linkEncoderMap.entries()) {
    const s = await act.getSettings<Partial<LinkSettings>>();
    if (s?.source !== "clip") continue;
    if ((s.clipIndex ?? 1) !== 0) continue;
    if ((s.layerIndex ?? 1) !== layer) continue;
    await applyLinkSettings(col, s);
    await updateLinkFeedback(col);
  }
}
