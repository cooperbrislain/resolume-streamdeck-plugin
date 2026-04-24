/**
 * Plugin bootstrap.
 *
 * This file does three things:
 *   1. Keeps the Node process alive across unexpected errors.
 *   2. Wires Resolume client events to plugin-side reactions (via ./events).
 *   3. Registers all action classes and connects to Stream Deck + Resolume.
 *
 * Business logic lives in ./actions, ./render, ./events, ./refresh, etc.
 */

// ── Process-level safety net ─────────────────────────────────────────────────
// Keep the process alive even if a WebSocket library throws unexpectedly
// (e.g. ws@8 reacting to Resolume's invalid 1006 close frame).
process.on("uncaughtException", (err) => {
  console.error("[plugin] uncaught exception (process kept alive):", (err as Error).message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[plugin] unhandled rejection (process kept alive):", reason);
});

import streamDeck from "@elgato/streamdeck";

import { client } from "./state.js";

// Side-effect import: wires ResolumeClient events to plugin reactions.
import "./events.js";

import { ResolumeClipAction }    from "./actions/clip-action.js";
import { DeckNavigatorAction }   from "./actions/deck-navigator-action.js";
import { LayerNavigatorAction }  from "./actions/layer-navigator-action.js";
import { LinkAction }            from "./actions/link-action.js";
import { RefreshAction }         from "./actions/refresh-action.js";

streamDeck.actions.registerAction(new ResolumeClipAction());
streamDeck.actions.registerAction(new DeckNavigatorAction());
streamDeck.actions.registerAction(new LayerNavigatorAction());
streamDeck.actions.registerAction(new LinkAction());
streamDeck.actions.registerAction(new RefreshAction());

streamDeck.connect();
client.connect();
