/**
 * Render cache for clip button images.
 *
 * `canvas.toDataURL()` in `@napi-rs/canvas` is synchronous and blocks the
 * event loop — running it for 8+ buttons in parallel causes perceptible
 * input lag on the Stream Deck. We key rendered PNGs by the exact visual
 * state of the cell and replay the last PNG whenever that state is unchanged.
 *
 * Key format: `{deckIndex}:{layer}:{clip}:{isConnected?1:0}:{clipName}`
 *
 * Cache is invalidated on:
 *   - `thumbnailDirty` WS events
 *   - `clipConnected` / `clipDisconnected` WS events
 *   - manual refresh
 *
 * Deck switches are free: the `deckIndex` in the key means entries for the
 * previous deck naturally become unreachable, and switching back auto-restores.
 */

import { client } from "../state.js";

const cache = new Map<string, string>(); // → base64 PNG (no prefix)

export function cacheKey(
  deckIndex: number,
  layer: number,
  clip: number,
  isConnected: boolean,
  clipName: string,
): string {
  return `${deckIndex}:${layer}:${clip}:${isConnected ? 1 : 0}:${clipName}`;
}

export function get(key: string): string | undefined {
  return cache.get(key);
}

export function set(key: string, png: string): void {
  cache.set(key, png);
}

/** Remove every entry for a clip on the active deck. */
export function evictCell(layer: number, clip: number): void {
  const prefix = `${client.getActiveDeckIndex()}:${layer}:${clip}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function clear(): void {
  cache.clear();
}
