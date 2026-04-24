/**
 * Manual cache refresh button: clears render + thumbnail caches and reloads
 * the composition from Resolume.
 */

import streamDeck, {
  action, SingletonAction,
  type WillAppearEvent, type KeyDownEvent,
} from "@elgato/streamdeck";

import { client, composition } from "../state.js";
import { doRefresh } from "../refresh.js";

@action({ UUID: "com.cooperbrislain.resolume-grid.refresh" })
export class RefreshAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (ev.payload.isInMultiAction) return;
    if (!composition.connected) client.connect();
  }

  override async onSendToPlugin(ev: { payload: unknown }): Promise<void> {
    const payload = ev.payload as { event?: string };
    if (payload?.event === "requestConnectionStatus") {
      await streamDeck.ui.sendToPropertyInspector({ connected: composition.connected })
        .catch(() => {});
    }
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await doRefresh();
  }
}
