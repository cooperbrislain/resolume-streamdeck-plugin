/**
 * Button-key helpers.
 *
 * A clip button's identity is "row:col" (from Stream Deck coordinates).
 * These helpers resolve what layer/clip each button currently represents,
 * based on its saved settings and live Resolume state.
 */

import { client, settingsMap, actionMap } from "./state.js";

export function buttonKey(row: number, column: number): string {
  return `${row}:${column}`;
}

/** 1-based layer number for a button key based on its layerMode. */
export function layerForKey(key: string): number {
  const [rowStr] = key.split(":");
  const row = parseInt(rowStr, 10);
  const s = settingsMap.get(key);
  switch (s?.layerMode) {
    case "fixed":    return Math.max(1, s.fixedLayer);
    case "selected": return client.getSelectedLayerIndex() + 1;
    default:         return row + 1; // "positional" — row 0 → layer 1
  }
}

/**
 * 1-based clip column for a button key within the current deck. Driven purely
 * by the button's `deckColumn` setting — physical Stream Deck position is
 * irrelevant for clip selection.
 */
export function clipForKey(key: string): number {
  const s = settingsMap.get(key);
  return (s && s.deckColumn >= 1) ? s.deckColumn : 1;
}

/** All registered button keys that map to a given (layer, clip) pair. */
export function keysForCell(layer: number, clip: number): string[] {
  return Array.from(actionMap.keys()).filter(
    key => clipForKey(key) === clip && layerForKey(key) === layer
  );
}

/** All button keys whose layerMode is "selected". */
export function selectedLayerKeys(): string[] {
  return Array.from(actionMap.keys()).filter(
    key => (settingsMap.get(key)?.layerMode ?? "positional") === "selected"
  );
}
