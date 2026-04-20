import streamDeck, {
  action,
  type KeyAction,
  type DialAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type DialRotateEvent,
  type DialDownEvent,
  SingletonAction,
} from "@elgato/streamdeck";

import { ResolumeClient } from "./resolume-client.js";
import { Viewport } from "./viewport.js";
import { ButtonRenderer } from "./button-renderer.js";
import { KnobHandler } from "./knob-handler.js";
import {
  type Composition,
  type ThumbnailDirtyEvent,
  type ClipConnectionEvent,
  type ConnectedState,
} from "./types.js";

// ── Shared singletons ────────────────────────────────────────────────────────

const client = new ResolumeClient({ host: "localhost", port: 8080 });
const viewport = new Viewport(4, 2);
const renderer = new ButtonRenderer();
const knobHandler = new KnobHandler(viewport, client);

// Map buttonIndex → live action object so Resolume events can push image updates
// without holding stale context IDs.
const actionMap = new Map<number, KeyAction | DialAction>();

// Clip connection state cache: "{layer}:{clip}" → ConnectedState
const clipState = new Map<string, ConnectedState>();

let composition: Composition | null = null;
let resolumeConnected = false;

// ── Coordinate helpers ────────────────────────────────────────────────────────

/** Extract button index from a WillAppear payload, which may be multi-action. */
function buttonIndexFromWillAppear(ev: WillAppearEvent): number | null {
  // Multi-action slots have no grid coordinates
  if (ev.payload.isInMultiAction) return null;
  const { row, column } = ev.payload.coordinates;
  return row * viewport.gridWidth + column;
}

// ── Cell rendering ────────────────────────────────────────────────────────────

async function renderCell(
  buttonIndex: number,
  action: KeyAction | DialAction
): Promise<void> {
  const layer = viewport.layerForButton(buttonIndex);
  const clip = viewport.clipForButton(buttonIndex);

  if (!layer || !clip || !composition) {
    const image = await renderer.renderClip({
      thumb: null,
      clipName: "",
      isConnected: false,
      isEmpty: true,
    });
    await action.setImage(`data:image/png;base64,${image}`);
    return;
  }

  const layerData = composition.layers[layer - 1];
  const clipData = layerData?.clips[clip - 1];
  const isEmpty = !clipData;
  const clipName = clipData?.name?.value ?? "";
  const stateKey = `${layer}:${clip}`;
  const connected = clipState.get(stateKey) ?? "Disconnected";

  let thumb: string | null = null;
  if (!isEmpty) {
    try {
      thumb = await client.getThumbnail(layer, clip);
    } catch {
      // Thumbnail unavailable — render without it
    }
  }

  const image = await renderer.renderClip({
    thumb,
    clipName,
    isConnected: connected === "Connected" || connected === "Previewing",
    isEmpty,
  });

  await action.setImage(`data:image/png;base64,${image}`);
}

async function renderAllVisible(): Promise<void> {
  const cells = viewport.getVisibleCells();
  await Promise.all(
    cells.map(({ buttonIndex, layer, clip }) => {
      const act = actionMap.get(buttonIndex);
      if (!act) return Promise.resolve();
      // Pre-populate connection state from composition snapshot
      const clipData = composition?.layers[layer - 1]?.clips[clip - 1];
      if (clipData?.connected?.value) {
        clipState.set(`${layer}:${clip}`, clipData.connected.value);
      }
      return renderCell(buttonIndex, act);
    })
  );
}

async function showConnectionBanner(connected: boolean): Promise<void> {
  const act = actionMap.get(0);
  if (!act) return;
  const image = await renderer.renderClip({
    thumb: null,
    clipName: connected ? "LIVE" : "OFFLINE",
    isConnected: connected,
    isEmpty: false,
  });
  await act.setImage(`data:image/png;base64,${image}`);
}

// ── Resolume event handlers ───────────────────────────────────────────────────

client.on("connectionChange", async (connected: boolean) => {
  resolumeConnected = connected;
  console.log(`[plugin] Resolume ${connected ? "connected" : "disconnected"}`);

  if (connected) {
    try {
      composition = await client.getComposition();
      viewport.setCompositionSize(
        composition.layers.length,
        composition.layers[0]?.clips.length ?? 0
      );
      await renderAllVisible();
    } catch (err) {
      console.error("[plugin] Failed to load composition:", err);
    }
  } else {
    await showConnectionBanner(false);
  }
});

client.on("thumbnailDirty", async ({ layer, clip }: ThumbnailDirtyEvent) => {
  const cell = viewport.getVisibleCells().find(
    (c) => c.layer === layer && c.clip === clip
  );
  if (!cell) return;
  const act = actionMap.get(cell.buttonIndex);
  if (act) await renderCell(cell.buttonIndex, act);
});

client.on("clipConnected", async ({ layer, clip, connected }: ClipConnectionEvent) => {
  clipState.set(`${layer}:${clip}`, connected);
  const cell = viewport.getVisibleCells().find(
    (c) => c.layer === layer && c.clip === clip
  );
  if (!cell) return;
  const act = actionMap.get(cell.buttonIndex);
  if (act) await renderCell(cell.buttonIndex, act);
});

client.on("clipDisconnected", async ({ layer, clip, connected }: ClipConnectionEvent) => {
  clipState.set(`${layer}:${clip}`, connected);
  const cell = viewport.getVisibleCells().find(
    (c) => c.layer === layer && c.clip === clip
  );
  if (!cell) return;
  const act = actionMap.get(cell.buttonIndex);
  if (act) await renderCell(cell.buttonIndex, act);
});

viewport.on("changed", () => {
  renderAllVisible().catch((err) =>
    console.error("[plugin] renderAllVisible error:", err)
  );
});

// ── Stream Deck action ────────────────────────────────────────────────────────

@action({ UUID: "com.yourname.resolume-grid.clip" })
class ResolumeClipAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const buttonIndex = buttonIndexFromWillAppear(ev);
    if (buttonIndex === null) return; // ignore multi-action slots

    // Store the live action reference — 2.x action objects are stable while visible
    actionMap.set(buttonIndex, ev.action as KeyAction | DialAction);

    if (!resolumeConnected) {
      client.connect();
    }

    await renderCell(buttonIndex, ev.action as KeyAction | DialAction);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    // KeyAction.coordinates is undefined only for multi-action — skip those
    const coords = ev.action.coordinates;
    if (!coords) return;

    const buttonIndex = coords.row * viewport.gridWidth + coords.column;
    const layer = viewport.layerForButton(buttonIndex);
    const clip = viewport.clipForButton(buttonIndex);
    if (!layer || !clip) return;

    // Sync opacity dial target to the layer that was clicked
    knobHandler.setOpacityTargetLayer(layer);

    try {
      await client.triggerClip(layer, clip);
    } catch (err) {
      console.error(`[plugin] triggerClip(${layer},${clip}) error:`, err);
    }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    // coordinates.column is the dial index (0–3) on Stream Deck +
    const dialIndex = ev.payload.coordinates.column;
    await knobHandler.onDialRotate(dialIndex, ev.payload.ticks);
  }

  override async onDialDown(ev: DialDownEvent): Promise<void> {
    const dialIndex = ev.payload.coordinates.column;
    await knobHandler.onDialPress(dialIndex);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

streamDeck.actions.registerAction(new ResolumeClipAction());
streamDeck.connect();
