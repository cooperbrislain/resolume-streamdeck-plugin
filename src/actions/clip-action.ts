/**
 * Clip grid button. Each physical button on the Stream Deck is bound to a
 * specific (layer, deckColumn) pair. Press to connect/disconnect that clip.
 *
 * Settings (stored per button):
 *   - layerMode:  "positional" | "selected" | "fixed"
 *   - layer:      explicit 1-based layer (fixed mode)
 *   - deckColumn: 1-based clip column within the deck
 *   - deckMode:   "current" | "fixed"
 *   - deck:       explicit 1-based deck number (fixed mode)
 */

import streamDeck, {
  action, SingletonAction,
  type KeyAction, type DialAction,
  type WillAppearEvent, type WillDisappearEvent,
  type DidReceiveSettingsEvent, type KeyDownEvent,
} from "@elgato/streamdeck";

import {
  actionMap, settingsMap, clipState, client, renderGuards, composition,
} from "../state.js";
import { buttonKey, layerForKey, clipForKey } from "../keys.js";
import { renderCell } from "../render/clip-cell.js";
import { switchDeckAndRefresh, doRefresh } from "../refresh.js";
import { findSelectedClip } from "../composition-utils.js";
import type { ActionSettings } from "../types.js";

function readSettings(raw: Partial<ActionSettings> | undefined) {
  return {
    layerMode:  raw?.layerMode  ?? "selected",
    fixedLayer: Math.max(1, raw?.layer ?? 1),
    deckColumn: Math.max(0, raw?.deckColumn ?? 0),
    deckMode:   raw?.deckMode   ?? "current",
    fixedDeck:  Math.max(1, raw?.deck ?? 1),
  } as const;
}

@action({ UUID: "com.cooperbrislain.resolume-grid.clip" })
export class ResolumeClipAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    const { row, column } = ev.payload.coordinates;
    const key = buttonKey(row, column);

    settingsMap.set(key, readSettings(ev.payload.settings as Partial<ActionSettings>));
    actionMap.set(key, ev.action as KeyAction);

    if (!composition.connected) client.connect();
    await renderCell(key, ev.action as KeyAction, renderGuards.generation);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    const { row, column } = ev.payload.coordinates;
    const key = buttonKey(row, column);
    actionMap.delete(key);
    settingsMap.delete(key);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    const { row, column } = ev.payload.coordinates;
    const key = buttonKey(row, column);

    settingsMap.set(key, readSettings(ev.payload.settings as Partial<ActionSettings>));
    const act = actionMap.get(key);
    if (act) await renderCell(key, act, renderGuards.generation);
  }

  override async onSendToPlugin(
    ev: { payload: unknown; action: KeyAction | DialAction },
  ): Promise<void> {
    const payload = ev.payload as { event?: string };

    if (payload?.event === "requestConnectionStatus" || payload?.event === "requestLayerNames") {
      const layers = client.getLayers();
      const decks  = client.getDecks().map(d => ({ name: d.name }));
      await streamDeck.ui.sendToPropertyInspector({
        connected: composition.connected, layers, decks,
      }).catch((e) => console.error("[clip] sendToPropertyInspector failed:", e));
      return;
    }

    if (payload?.event === "refreshCache") {
      await doRefresh();
      return;
    }

    if (payload?.event === "bindToSelected") {
      await this.handleBindToSelected(ev.action as KeyAction);
      return;
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const coords = ev.action.coordinates;
    if (!coords) return;
    const key = buttonKey(coords.row, coords.column);
    const s   = settingsMap.get(key);

    // If pinned to a specific deck that isn't active, switch first.
    if (s?.deckMode === "fixed") {
      const targetDeckIdx = s.fixedDeck - 1;
      if (targetDeckIdx !== client.getActiveDeckIndex()) {
        const deck = client.getDecks()[targetDeckIdx];
        if (deck?.selectedParamId) {
          console.log(`[clip] pinned to deck ${s.fixedDeck} — switching from ${client.getActiveDeckIndex()}`);
          client.setActiveDeckIndex(targetDeckIdx);
          renderGuards.manualSwitchPending = true;
          client.openDeck(deck.selectedParamId);
          await switchDeckAndRefresh();
        } else {
          console.warn(`[clip] cannot switch to deck ${s.fixedDeck}: no selectedParamId`);
        }
      }
    }

    const layer = layerForKey(key);
    const clip  = clipForKey(key);
    const state = clipState.get(`${layer}:${clip}`) ?? "Disconnected";
    const isPlaying = state === "Connected"
                   || state === "Previewing"
                   || state === "Connected & previewing";

    try {
      if (isPlaying) await client.clearLayer(layer);
      else           await client.triggerClip(layer, clip);
    } catch (err) {
      console.error(`[clip] keyDown(${layer},${clip}) error:`, err);
    }
  }

  /**
   * "Bind to selected" PI button: snapshot the currently selected clip in
   * Resolume and write it as fixed layer + deckColumn on this key.
   */
  private async handleBindToSelected(act: KeyAction): Promise<void> {
    // Pull a fresh composition so `selected` flags are current.
    try {
      composition.current = await client.getComposition();
      client.indexComposition(composition.current);
    } catch (err) {
      console.warn("[clip] bindToSelected: refresh failed:", err);
    }

    const sel = findSelectedClip();
    if (!sel) {
      console.warn("[clip] bindToSelected: no selected clip found");
      await streamDeck.ui.sendToPropertyInspector({
        event: "bindToSelectedResult", ok: false,
      }).catch(() => {});
      return;
    }

    const activeDeck = client.getActiveDeckIndex() + 1;
    const prev = await act.getSettings<Partial<ActionSettings>>();
    const next: ActionSettings = {
      layerMode:  "fixed",
      layer:      sel.layer,
      deckColumn: sel.clip,
      deckMode:   "fixed",
      deck:       activeDeck,
    };
    await act.setSettings({ ...prev, ...next });
    console.log(`[clip] bindToSelected → deck ${activeDeck}, layer ${sel.layer}, clip ${sel.clip}`);
    await streamDeck.ui.sendToPropertyInspector({
      event: "bindToSelectedResult",
      ok:    true,
      layer: sel.layer,
      clip:  sel.clip,
      deck:  activeDeck,
    }).catch(() => {});
  }
}
