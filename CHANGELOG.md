# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] — 2026-04-23

Initial public release.

### Added
- **Resolume Clip** action: live per-key thumbnails, playing/selected state
  overlays, and clip triggering at a configurable `(deck, layer, column)`.
- **Deck Navigator** encoder: rotate to browse decks, press to switch active
  deck.
- **Layer Navigator** encoder: rotate to browse layers, press to select.
- **Parameter** encoder: drive any dashboard, layer, or clip parameter with a
  live indicator bar and configurable sensitivity.
- **Refresh Clips** key: clears the render/thumbnail cache and reloads
  everything from Resolume.
- **Quick Bind** button in the Clip property inspector: snap a key to the
  clip currently selected in Resolume.
- **Follow-the-deck** mode per Clip key, or pin to a specific deck.
- Automatic WebSocket reconnect with exponential backoff (1s → 30s cap).
- Render cache keyed by cell state to avoid redundant canvas compositing.
- Shared property-inspector boilerplate (`shared/pi-core.js` + `shared/pi.css`)
  so each action's PI script only declares its own form hooks.

### Internal
- Modular source layout under `src/`: `state`, `render/`, `actions/`,
  `events`, `refresh`, `link-settings`, `ui-bridge`.
- 66 Vitest unit tests covering the Resolume client, button renderer, and
  knob handler.

[Unreleased]: https://github.com/cooperbrislain/resolume-streamdeck-plugin/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/cooperbrislain/resolume-streamdeck-plugin/releases/tag/v0.3.0
