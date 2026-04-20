import streamDeck, {
  action,
  KeyDownEvent,
  WillAppearEvent,
  DialRotateEvent,
  DialDownEvent,
  SingletonAction,
} from "@elgato/streamdeck";

import { ResolumeClient } from "./resolume-client.js";
import { Viewport } from "./viewport.js";
import { ButtonRenderer } from "./button-renderer.js";
import { KnobHandler } from "./knob-handler.js";
import {
  Composition,
  ThumbnailDirtyEvent,
  ClipConnectionEvent,
  ConnectedState,
} from "./types.js";

// ── Shared singletons ────────────────────────────────────────────────────────

const client = new ResolumeClient({ host: "localhost", port: 8080 });
const viewport = new Viewport(4, 2);
const renderer = new ButtonRenderer();
const knobHandler = new KnobHandler(viewport, client);

// Track which action contexts map to which button indices so we can update
// the right button when Resolume sends events.
const contextMap = new Map<number, string>(); // buttonIndex → context id

// Clip state cache: "{layer}:{clip}" → connected state
const clipState = new Map<string, ConnectedState>();

let composition: Composition | null = null;
let isConnected = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function renderCell(
  buttonIndex: number,
  context: string
): Promise<void> {
  const layer = viewport.layerForButton(buttonIndex);
  const clip = viewport.clipForButton(buttonIndex);

  if (!layer || !clip || !composition) {
    await setButtonImage(context, await renderer.renderClip({
      thumb: null,
      clipName: "",
      isConnected: false,
      isEmpty: true,
    }));
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
      // Thumbnail unavailable — render without
    }
  }

  const image = await renderer.renderClip({
    thumb,
    clipName,
    isConnected: connected === "Connected" || connected === "Previewing",
    isEmpty,
  });

  await setButtonImage(context, image);
}

async function renderAllVisible(): Promise<void> {
  const cells = viewport.getVisibleCells();
  await Promise.all(
    cells.map(({ buttonIndex, layer, clip }) => {
      const ctx = contextMap.get(buttonIndex);
      if (!ctx) return Promise.resolve();
      // Pre-populate clip state from composition data
      const layerData = composition?.layers[layer - 1];
      const clipData = layerData?.clips[clip - 1];
      if (clipData?.connected?.value) {
        clipState.set(`${layer}:${clip}`, clipData.connected.value);
      }
      return renderCell(buttonIndex, ctx);
    })
  );
}

async function setButtonImage(context: string, base64Png: string): Promise<void> {
  await streamDeck.ui.current?.setImage(
    `data:image/png;base64,${base64Png}`,
    { target: 0 }
  );
  // Fallback: use the action API directly via context
  streamDeck.actions.getActionById(context)?.setImage(
    `data:image/png;base64,${base64Png}`
  );
}

async function showConnectionStatus(connected: boolean): Promise<void> {
  const ctx = contextMap.get(0);
  if (!ctx) return;
  const image = await renderer.renderClip({
    thumb: null,
    clipName: connected ? "LIVE" : "OFFLINE",
    isConnected: connected,
    isEmpty: false,
  });
  streamDeck.actions.getActionById(ctx)?.setImage(
    `data:image/png;base64,${image}`
  );
}

// ── Resolume event handlers ───────────────────────────────────────────────────

client.on("connectionChange", async (connected: boolean) => {
  isConnected = connected;
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
    await showConnectionStatus(false);
  }
});

client.on("thumbnailDirty", async ({ layer, clip }: ThumbnailDirtyEvent) => {
  const cells = viewport.getVisibleCells();
  const cell = cells.find((c) => c.layer === layer && c.clip === clip);
  if (!cell) return;
  const ctx = contextMap.get(cell.buttonIndex);
  if (ctx) await renderCell(cell.buttonIndex, ctx);
});

client.on("clipConnected", async ({ layer, clip, connected }: ClipConnectionEvent) => {
  clipState.set(`${layer}:${clip}`, connected);
  const cells = viewport.getVisibleCells();
  const cell = cells.find((c) => c.layer === layer && c.clip === clip);
  if (!cell) return;
  const ctx = contextMap.get(cell.buttonIndex);
  if (ctx) await renderCell(cell.buttonIndex, ctx);
});

client.on("clipDisconnected", async ({ layer, clip, connected }: ClipConnectionEvent) => {
  clipState.set(`${layer}:${clip}`, connected);
  const cells = viewport.getVisibleCells();
  const cell = cells.find((c) => c.layer === layer && c.clip === clip);
  if (!cell) return;
  const ctx = contextMap.get(cell.buttonIndex);
  if (ctx) await renderCell(cell.buttonIndex, ctx);
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
    // Determine button index from the action's coordinates
    const { coordinates } = ev.action.getSettings<{ coordinates?: { row: number; column: number } }>();
    // Stream Deck provides coordinates via payload
    const row = (ev.payload as { coordinates?: { row: number; column: number } }).coordinates?.row ?? 0;
    const col = (ev.payload as { coordinates?: { row: number; column: number } }).coordinates?.column ?? 0;
    const buttonIndex = row * viewport.gridWidth + col;

    contextMap.set(buttonIndex, ev.action.id);

    if (!isConnected) {
      client.connect();
    }

    await renderCell(buttonIndex, ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const row = (ev.payload as { coordinates?: { row: number; column: number } }).coordinates?.row ?? 0;
    const col = (ev.payload as { coordinates?: { row: number; column: number } }).coordinates?.column ?? 0;
    const buttonIndex = row * viewport.gridWidth + col;

    const layer = viewport.layerForButton(buttonIndex);
    const clip = viewport.clipForButton(buttonIndex);
    if (!layer || !clip) return;

    // Update opacity dial target to clicked layer
    knobHandler.setOpacityTargetLayer(layer);

    try {
      await client.triggerClip(layer, clip);
    } catch (err) {
      console.error(`[plugin] triggerClip(${layer},${clip}) error:`, err);
    }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    const { index, ticks } = ev.payload as { index: number; ticks: number };
    await knobHandler.onDialRotate(index, ticks);
  }

  override async onDialDown(ev: DialDownEvent): Promise<void> {
    const { index } = ev.payload as { index: number };
    await knobHandler.onDialPress(index);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

streamDeck.actions.registerAction(new ResolumeClipAction());
streamDeck.connect();
