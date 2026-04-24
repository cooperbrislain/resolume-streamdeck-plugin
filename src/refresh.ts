/**
 * Full-refresh operations: reloading the composition, switching decks, and
 * manual cache purges. Shared by `RefreshAction`, `DeckNavigatorAction`, and
 * the connection-change event handler.
 */

import { client, clipState, composition, renderGuards } from "./state.js";
import { renderAll } from "./render/clip-cell.js";
import { updateDeckDisplays } from "./render/deck-display.js";
import * as cache from "./render/cache.js";
import { pushLayerNames } from "./ui-bridge.js";

/**
 * Re-fetch the composition from Resolume and re-render all clip buttons.
 * Called after a deck switch because Resolume's REST API returns
 * deck-relative clip data — the same URL returns different content depending
 * on which deck is currently active.
 */
export async function switchDeckAndRefresh(): Promise<void> {
  renderGuards.refreshing = true;
  await updateDeckDisplays();
  try {
    composition.current = await client.getComposition();
    client.indexComposition(composition.current);
    // Thumbnail cache is keyed by deckIndex so no clear needed.
    clipState.clear();
    await pushLayerNames();
    await renderAll();
  } catch (err) {
    console.error("[refresh] deck switch reload failed:", err);
  } finally {
    renderGuards.refreshing = false;
  }
}

/** Clear all caches and force a full re-render. */
export async function doRefresh(): Promise<void> {
  console.log("[refresh] manual cache refresh");
  cache.clear();
  client.clearAllThumbnailCache();
  clipState.clear();
  try {
    composition.current = await client.getComposition();
    client.indexComposition(composition.current);
    await renderAll();
  } catch (err) {
    console.error("[refresh] failed:", err);
  }
}
