/**
 * Layer navigator encoder: rotate to browse layers, press to select.
 */

import streamDeck, {
  action, SingletonAction,
  type DialAction,
  type WillAppearEvent, type WillDisappearEvent,
  type DidReceiveSettingsEvent, type DialRotateEvent, type DialDownEvent,
} from "@elgato/streamdeck";

import {
  client, composition, cursors, layerEncoderMap, layerLabelMap,
} from "../state.js";
import { updateLayerDisplays } from "../render/layer-display.js";

@action({ UUID: "com.cooperbrislain.resolume-grid.layer" })
export class LayerNavigatorAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    const col = ev.payload.coordinates.column;
    const s   = ev.payload.settings as { label?: string };
    layerLabelMap.set(col, s?.label ?? "");
    layerEncoderMap.set(col, ev.action as DialAction);
    if (!composition.connected) client.connect();
    await updateLayerDisplays();
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    const col = ev.payload.coordinates.column;
    layerEncoderMap.delete(col);
    layerLabelMap.delete(col);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    const col = ev.payload.coordinates.column;
    const s   = ev.payload.settings as { label?: string };
    layerLabelMap.set(col, s?.label ?? "");
    await updateLayerDisplays();
  }

  override async onSendToPlugin(ev: { payload: unknown }): Promise<void> {
    const payload = ev.payload as { event?: string };
    if (payload?.event === "requestConnectionStatus") {
      await streamDeck.ui.sendToPropertyInspector({ connected: composition.connected })
        .catch(() => {});
    }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    const layers = client.getLayers();
    if (layers.length === 0) return;
    cursors.layer = Math.max(0, Math.min(layers.length - 1, cursors.layer + ev.payload.ticks));
    await updateLayerDisplays();
  }

  override async onDialDown(_ev: DialDownEvent): Promise<void> {
    const layers = client.getLayers();
    if (!layers[cursors.layer]) return;
    console.log(`[layer-nav] selecting → ${cursors.layer + 1}: ${layers[cursors.layer].name}`);
    client.selectLayer(cursors.layer);
  }
}
