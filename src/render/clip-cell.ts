/**
 * Per-button clip rendering.
 *
 * `renderCell` is the atomic unit — it resolves layer/clip for a button,
 * checks the render cache, fetches a thumbnail if needed, and pushes the
 * PNG to Stream Deck. `renderAll` fans out in parallel.
 *
 * The `renderGuards.generation` counter is compared at every `await`
 * boundary: if a newer generation starts mid-flight, stale renders bail
 * out before calling `setImage`, avoiding flicker.
 */

import type { KeyAction } from "@elgato/streamdeck";
import {
  actionMap, clipState, composition, renderGuards,
  client, renderer,
} from "../state.js";
import { layerForKey, clipForKey } from "../keys.js";
import * as cache from "./cache.js";

export async function renderCell(
  key: string,
  act: KeyAction,
  gen: number,
): Promise<void> {
  const layer = layerForKey(key);
  const clip  = clipForKey(key);

  const clipData = composition.current?.layers[layer - 1]?.clips[clip - 1];
  const isEmpty  = !clipData;
  const clipName = clipData?.name?.value ?? "";

  const stateKey = `${layer}:${clip}`;
  if (clipData?.connected?.value && !clipState.has(stateKey)) {
    clipState.set(stateKey, clipData.connected.value);
  }

  const state       = clipState.get(stateKey) ?? "Disconnected";
  const isConnected = state === "Connected"
                   || state === "Previewing"
                   || state === "Connected & previewing";

  // Cache hit — skip all canvas work.
  const deckIndex = client.getActiveDeckIndex();
  const key2      = cache.cacheKey(deckIndex, layer, clip, isConnected, clipName);
  const cached    = cache.get(key2);
  if (cached) {
    if (gen !== renderGuards.generation) return;
    await act.setImage(`data:image/png;base64,${cached}`);
    return;
  }

  let thumb: string | null = null;
  if (!isEmpty) {
    try { thumb = await client.getThumbnail(layer, clip); } catch { /* no thumb */ }
  }

  if (gen !== renderGuards.generation) return;

  const png = await renderer.renderClip({ thumb, clipName, isEmpty, isConnected });

  if (gen !== renderGuards.generation) return;
  cache.set(key2, png);
  await act.setImage(`data:image/png;base64,${png}`);
}

export async function renderAll(): Promise<void> {
  const gen = ++renderGuards.generation;
  await Promise.all(
    Array.from(actionMap.entries()).map(([key, act]) => renderCell(key, act, gen))
  );
}
