/**
 * Wire up all `ResolumeClient` events to plugin-side reactions:
 *   - connection up/down → full composition (re)load + re-bind link dials
 *   - thumbnailDirty     → evict cache + re-render affected cells
 *   - clipConnected/Dis  → update state + re-render + re-bind "playing" links
 *   - deckChanged        → full deck swap (unless it's our own echo)
 *   - layerSelected      → re-render buttons in "selected" mode
 *
 * Import this module once (for its side effect) from the plugin bootstrap.
 */

import streamDeck from "@elgato/streamdeck";
import {
  actionMap, client, clipState, composition, cursors, renderGuards,
  linkEncoderMap, knobHandler,
} from "./state.js";
import { keysForCell, selectedLayerKeys } from "./keys.js";
import { renderCell, renderAll } from "./render/clip-cell.js";
import * as cache from "./render/cache.js";
import { updateDeckDisplays } from "./render/deck-display.js";
import { updateLayerDisplays } from "./render/layer-display.js";
import { updateLinkFeedback } from "./render/link-display.js";
import { applyLinkSettings, reapplyPlayingClipLinks } from "./link-settings.js";
import { switchDeckAndRefresh } from "./refresh.js";
import { pushLayerNames } from "./ui-bridge.js";
import type {
  ThumbnailDirtyEvent, ClipConnectionEvent, DeckChangedEvent,
  LayerSelectedEvent, LinkSettings,
} from "./types.js";

// Knob handler → link feedback
knobHandler.onValueChanged = (dialIndex) => { void updateLinkFeedback(dialIndex); };

client.on("connectionChange", async (connected: boolean) => {
  composition.connected = connected;
  console.log(`[events] Resolume ${connected ? "connected" : "disconnected"}`);
  streamDeck.ui.sendToPropertyInspector({ connected }).catch(() => {});

  if (!connected) {
    composition.current = null;
    await renderAll();
    return;
  }

  try {
    composition.current = await client.getComposition();
    client.indexComposition(composition.current);
    console.log(
      `[events] indexed: ${client.getLayers().length} layers, ${client.getDecks().length} decks`
    );
    cursors.deck  = client.getActiveDeckIndex();
    cursors.layer = client.getSelectedLayerIndex();
    await renderAll();
    await updateDeckDisplays();
    await updateLayerDisplays();
    await pushLayerNames();

    // Re-apply link dial settings now that we have a live connection.
    for (const [col, act] of linkEncoderMap.entries()) {
      const s = await act.getSettings<Partial<LinkSettings>>();
      await applyLinkSettings(col, s);
      await updateLinkFeedback(col);
    }
  } catch (err) {
    console.error("[events] composition load failed:", err);
  }
});

client.on("thumbnailDirty", async ({ layer, clip }: ThumbnailDirtyEvent) => {
  if (renderGuards.refreshing) return;
  client.clearThumbnail(layer, clip); // evict stale HTTP-cached thumbnail
  cache.evictCell(layer, clip);       // evict stale rendered PNG
  const gen = renderGuards.generation;
  for (const key of keysForCell(layer, clip)) {
    const act = actionMap.get(key);
    if (act) await renderCell(key, act, gen);
  }
});

async function onClipConnectionChange(
  { layer, clip, connected }: ClipConnectionEvent,
): Promise<void> {
  if (renderGuards.refreshing) return;
  clipState.set(`${layer}:${clip}`, connected);
  cache.evictCell(layer, clip); // border color changed
  const gen = renderGuards.generation;
  for (const key of keysForCell(layer, clip)) {
    const act = actionMap.get(key);
    if (act) await renderCell(key, act, gen);
  }
  await reapplyPlayingClipLinks(layer);
}

client.on("clipConnected",    onClipConnectionChange);
client.on("clipDisconnected", onClipConnectionChange);

client.on("deckChanged", async ({ deckIndex }: DeckChangedEvent) => {
  if (renderGuards.manualSwitchPending) {
    // We triggered this switch ourselves — ignore the server echo.
    console.log(`[events] ignoring echo-back deckChanged → ${deckIndex}`);
    renderGuards.manualSwitchPending = false;
    return;
  }
  console.log(`[events] external deck change → ${deckIndex}`);
  cursors.deck = deckIndex;
  client.setActiveDeckIndex(deckIndex);
  await switchDeckAndRefresh();
});

client.on("layerSelected", async ({ layerIndex }: LayerSelectedEvent) => {
  console.log(`[events] layer selected → ${layerIndex}`);
  cursors.layer = layerIndex;
  await updateLayerDisplays();
  const keys = selectedLayerKeys();
  const gen  = renderGuards.generation;
  await Promise.all(keys.map(k => {
    const act = actionMap.get(k);
    return act ? renderCell(k, act, gen) : Promise.resolve();
  }));
});
