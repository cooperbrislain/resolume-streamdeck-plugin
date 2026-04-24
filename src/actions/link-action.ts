/**
 * Parameter (link) encoder: bind a dial to a Resolume parameter, then rotate
 * to adjust, press to reset.
 *
 * Three parameter sources are supported via the Property Inspector:
 *   1. Dashboard parameter (by id)
 *   2. Layer parameter (opacity, volume, transition_duration)
 *   3. Clip parameter (opacity, speed, volume, position) — including a
 *      "currently playing clip on this layer" mode.
 */

import streamDeck, {
  action, SingletonAction,
  type DialAction,
  type WillAppearEvent, type WillDisappearEvent,
  type DidReceiveSettingsEvent, type DialRotateEvent, type DialDownEvent,
} from "@elgato/streamdeck";

import {
  client, composition, knobHandler, linkEncoderMap,
} from "../state.js";
import { updateLinkFeedback } from "../render/link-display.js";
import { applyLinkSettings } from "../link-settings.js";
import type { LinkSettings } from "../types.js";

@action({ UUID: "com.cooperbrislain.resolume-grid.link" })
export class LinkAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    const { column } = ev.payload.coordinates;
    linkEncoderMap.set(column, ev.action as DialAction);

    const settings = ev.payload.settings as Partial<LinkSettings>;
    await applyLinkSettings(column, settings);
    await updateLinkFeedback(column);
    if (!composition.connected) client.connect();

    if (composition.connected) {
      streamDeck.ui.sendToPropertyInspector(JSON.parse(JSON.stringify({
        event:     "dashboardParams",
        params:    client.getDashboardParams(),
        connected: composition.connected,
      }))).catch(() => {});
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    const { column } = ev.payload.coordinates;
    linkEncoderMap.delete(column);
    knobHandler.assignDial(column, null);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    const { column } = ev.payload.coordinates;
    const settings = ev.payload.settings as Partial<LinkSettings>;
    await applyLinkSettings(column, settings);
    await updateLinkFeedback(column);
  }

  override async onSendToPlugin(ev: { payload: unknown }): Promise<void> {
    const payload = ev.payload as { event?: string };

    if (payload?.event === "requestConnectionStatus") {
      await streamDeck.ui.sendToPropertyInspector({
        connected: composition.connected,
        layers:    client.getLayers(),
      }).catch(() => {});
      return;
    }

    if (payload?.event === "requestDashboardParams") {
      streamDeck.ui.sendToPropertyInspector(JSON.parse(JSON.stringify({
        event:     "dashboardParams",
        params:    client.getDashboardParams(),
        connected: composition.connected,
        layers:    client.getLayers(),
      }))).catch(() => {});
    }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    await knobHandler.onDialRotate(ev.payload.coordinates.column, ev.payload.ticks);
  }

  override async onDialDown(ev: DialDownEvent): Promise<void> {
    const column = ev.payload.coordinates.column;
    await knobHandler.onDialPress(column);
    await updateLinkFeedback(column);
  }
}
