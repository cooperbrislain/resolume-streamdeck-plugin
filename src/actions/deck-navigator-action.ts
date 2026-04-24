/**
 * Deck navigator encoder: rotate to browse decks, press to switch.
 */

import streamDeck, {
  action, SingletonAction,
  type DialAction,
  type WillAppearEvent, type WillDisappearEvent,
  type DidReceiveSettingsEvent, type DialRotateEvent, type DialDownEvent,
} from "@elgato/streamdeck";

import {
  client, composition, cursors, deckEncoderMap, deckLabelMap, renderGuards,
} from "../state.js";
import { updateDeckDisplays } from "../render/deck-display.js";
import { switchDeckAndRefresh } from "../refresh.js";

@action({ UUID: "com.cooperbrislain.resolume-grid.bank" })
export class DeckNavigatorAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    const col = ev.payload.coordinates.column;
    const s   = ev.payload.settings as { label?: string };
    deckLabelMap.set(col, s?.label ?? "");
    deckEncoderMap.set(col, ev.action as DialAction);
    if (!composition.connected) client.connect();
    await updateDeckDisplays();
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    const col = ev.payload.coordinates.column;
    deckEncoderMap.delete(col);
    deckLabelMap.delete(col);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    const col = ev.payload.coordinates.column;
    const s   = ev.payload.settings as { label?: string };
    deckLabelMap.set(col, s?.label ?? "");
    await updateDeckDisplays();
  }

  override async onSendToPlugin(ev: { payload: unknown }): Promise<void> {
    const payload = ev.payload as { event?: string };
    if (payload?.event === "requestConnectionStatus") {
      await streamDeck.ui.sendToPropertyInspector({ connected: composition.connected })
        .catch(() => {});
    }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    const decks = client.getDecks();
    if (decks.length === 0) return;
    cursors.deck = Math.max(0, Math.min(decks.length - 1, cursors.deck + ev.payload.ticks));
    await updateDeckDisplays(); // browse only — no switch yet
  }

  override async onDialDown(_ev: DialDownEvent): Promise<void> {
    const decks = client.getDecks();
    const deck  = decks[cursors.deck];
    if (!deck) return;
    console.log(`[deck-nav] switching → ${cursors.deck}: ${deck.name}`);
    client.setActiveDeckIndex(cursors.deck);
    renderGuards.manualSwitchPending = true; // suppress WS echo-back
    client.openDeck(deck.selectedParamId);
    await switchDeckAndRefresh();
  }
}
