/**
 * Shared mutable state and singletons used by actions, rendering, and events.
 *
 * This module is intentionally simple: a bag of exported objects and getters.
 * Everything in here is process-wide — there is only ever one plugin host.
 */

import type { KeyAction, DialAction } from "@elgato/streamdeck";
import { ResolumeClient } from "./resolume-client.js";
import { ButtonRenderer } from "./button-renderer.js";
import { KnobHandler } from "./knob-handler.js";
import type { Composition, ConnectedState } from "./types.js";

// ── Singletons ────────────────────────────────────────────────────────────────

export const client      = new ResolumeClient({ host: "localhost", port: 8080 });
export const renderer    = new ButtonRenderer();
export const knobHandler = new KnobHandler(client);

// ── Clip button settings ──────────────────────────────────────────────────────

export interface ClipButtonSettings {
  layerMode:  "positional" | "selected" | "fixed";
  fixedLayer: number; // 1-based
  deckColumn: number; // 1-based, or 0 for "use button column"
  deckMode:   "current" | "fixed";
  fixedDeck:  number; // 1-based; only used when deckMode === "fixed"
}

/** "row:col" → KeyAction */
export const actionMap   = new Map<string, KeyAction>();
export const settingsMap = new Map<string, ClipButtonSettings>();

/** "layer:clip" → latest connection state (from WS events). */
export const clipState = new Map<string, ConnectedState>();

// ── Encoders ──────────────────────────────────────────────────────────────────

export const deckEncoderMap  = new Map<number, DialAction>();
export const layerEncoderMap = new Map<number, DialAction>();
export const linkEncoderMap  = new Map<number, DialAction>();

/** Optional custom encoder labels, set via the PI. */
export const deckLabelMap  = new Map<number, string>();
export const layerLabelMap = new Map<number, string>();

// ── Cursors (for dial browsing without committing) ────────────────────────────

export const cursors = {
  deck:  0,
  layer: 0,
};

// ── Connection / composition ──────────────────────────────────────────────────

export const composition = {
  current: null as Composition | null,
  connected: false,
};

// ── Render-concurrency guards ─────────────────────────────────────────────────

export const renderGuards = {
  /** Incremented on every full re-render; stale async renders bail out early. */
  generation: 0,

  /** True while a full deck-switch refresh is in progress. */
  refreshing: false,

  /**
   * True after the user manually presses the deck dial — used to suppress the
   * echo-back `deckChanged` event that Resolume sends in response.
   */
  manualSwitchPending: false,
};
