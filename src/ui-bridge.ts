/**
 * Helpers for pushing plugin state to any open Property Inspector.
 */

import streamDeck from "@elgato/streamdeck";
import { client, composition } from "./state.js";

/** Broadcast the current connection status + layer/deck lists to the PI. */
export async function pushLayerNames(): Promise<void> {
  const layers = client.getLayers();
  const decks  = client.getDecks().map(d => ({ name: d.name }));
  await streamDeck.ui.sendToPropertyInspector({
    connected: composition.connected,
    layers,
    decks,
  }).catch(() => {});
}
