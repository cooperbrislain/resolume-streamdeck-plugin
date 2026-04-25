# Resolume Grid — Stream Deck Plugin

Live clip thumbnails, deck navigation, and parameter control for
[Resolume Arena/Avenue](https://resolume.com/) on the Elgato Stream Deck+ and
Stream Deck XL.

Every key shows a live thumbnail of the clip it's bound to. Encoders navigate
decks and layers, or link to any parameter in the composition with full-range
feedback on the LCD strip.

![Stream Deck+ showing a 2×4 clip grid with thumbnails, the encoder strip
labelling clip Scrub, clip Speed, the active layer, and the current
bank.](imgs/screenshots/deck-overview.png)

## Features

- **Live clip thumbnails** — each key renders the current Resolume thumbnail
  for its `(deck, layer, column)` cell, with an overlay for the playing state
  and a highlight for the selected clip.
- **Follow-the-deck or pin-a-deck** — a key can either track the active deck
  in Resolume or stay pinned to a specific deck.
- **Quick Bind** — click "Bind to selected" in the Property Inspector to snap
  a key to whichever clip is currently selected in Resolume.
- **Encoder navigation** — dedicated Deck Navigator and Layer Navigator
  encoders: rotate to browse, press to activate.
- **Parameter links** — a Parameter encoder can drive any dashboard parameter,
  a layer-level parameter (opacity, volume, transition duration…), or a
  clip-level parameter (opacity, speed, scrub position, volume), with a
  sensitivity knob and live indicator bar.
- **Resilient connection** — automatically reconnects to the Resolume web
  server with exponential backoff; status is surfaced in every Property
  Inspector.

## Requirements

- [Resolume Arena or Avenue 7+](https://resolume.com/download/) with the
  **Webserver** enabled (Preferences → Webserver → Enabled, port `8080`).
- Stream Deck software 6.4+.
- Node.js 20 (bundled with the Stream Deck plugin runtime — only needed
  separately for development).
- Stream Deck+ (encoders) or Stream Deck XL/MK.2 (keys). The clip/refresh
  actions work on any Stream Deck; the navigator and parameter actions
  require an encoder.

## Installing (end users)

1. Download the latest `.streamDeckPlugin` bundle from the
   [Releases](https://github.com/cooperbrislain/resolume-streamdeck-plugin/releases)
   page.
2. Double-click the file to install it in the Stream Deck app.
3. In Resolume, open **Preferences → Webserver** and enable it on the default
   port `8080`.
4. Drop any of the **Resolume Grid** actions onto a key or encoder.

## Actions

| Action             | Surface  | Purpose                                                                     |
| ------------------ | -------- | --------------------------------------------------------------------------- |
| **Resolume Clip**  | Key      | Shows a live thumbnail and triggers a clip at `(deck, layer, column)`.      |
| **Deck Navigator** | Encoder  | Rotate to browse decks, press to switch.                                    |
| **Layer Navigator**| Encoder  | Rotate to browse layers, press to select.                                   |
| **Parameter**      | Encoder  | Drives a dashboard / layer / clip parameter with a live indicator bar.      |
| **Refresh Clips**  | Key      | Clears the thumbnail/render cache and reloads everything from Resolume.    |

### Resolume Clip

Each Clip key is configured with a **layer** (either "currently selected in
Resolume" or a fixed layer number), a **deck** (either "current deck" or a
pinned deck), and a **column** (1-based) within that deck. Use the
**Bind to selected** button to snap the key to the clip currently selected in
Resolume — handy when laying out a grid by hand.

![Resolume Clip property inspector showing layer, deck, deck column, the
Bind to selected button, and the Resolume connection
status.](imgs/screenshots/clip.png)

### Parameter

The Parameter encoder can target one of three sources:

- **Dashboard** — any parameter exposed in the Resolume Dashboard.
- **Layer** — opacity, transition duration, or volume on a fixed or
  currently-selected layer.
- **Clip** — opacity, speed, scrub position, or volume on a specific clip, on
  a specific layer, or "whatever's currently playing on this layer."

**Sensitivity** scales how much one encoder step moves the value — lower for
fine control, higher to sweep the full range quickly.

![Parameter property inspector with the Clip source selected, "Currently
playing clip on this layer" enabled, Speed parameter, and sensitivity
0.4×.](imgs/screenshots/clip-parameter.png)

## Development

```bash
git clone https://github.com/cooperbrislain/resolume-streamdeck-plugin.git
cd resolume-streamdeck-plugin
npm install
npm run build
npm test
```

The plugin loads from `com.cooperbrislain.resolume-grid.sdPlugin/`. To
iterate locally, symlink the `.sdPlugin` folder into the Stream Deck plugins
directory and restart the Stream Deck app:

- **macOS**: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`
- **Windows**: `%APPDATA%\Elgato\StreamDeck\Plugins\`

```bash
npm run watch      # rebuild TypeScript on change
npm run test:watch # re-run tests on change
```

### Project layout

```
com.cooperbrislain.resolume-grid.sdPlugin/
├── manifest.json              # Stream Deck plugin manifest
├── dist/                      # Compiled TypeScript output (plugin entry)
├── src/
│   ├── plugin.ts              # Thin bootstrap — registers actions, connects
│   ├── state.ts               # Shared singletons and mutable state
│   ├── resolume-client.ts     # REST + WebSocket client for Resolume
│   ├── button-renderer.ts     # Canvas-based thumbnail compositor
│   ├── knob-handler.ts        # Encoder → parameter value mapping
│   ├── actions/               # One file per Stream Deck action
│   ├── render/                # Per-action display updates + cache
│   ├── events.ts              # Wires client events to render/UI updates
│   ├── refresh.ts             # Full/partial re-render orchestration
│   ├── link-settings.ts       # Parameter encoder binding logic
│   ├── ui-bridge.ts           # Broadcasts composition info to PIs
│   └── __tests__/             # Vitest unit tests
└── property-inspector/
    ├── shared/
    │   ├── pi.css             # Shared PI stylesheet
    │   └── pi-core.js         # Shared PI boilerplate (createConnectFn)
    └── *.html / *.js          # One pair per action
```

### Packaging a release

Use Elgato's CLI to produce a distributable `.streamDeckPlugin`:

```bash
npx @elgato/cli pack com.cooperbrislain.resolume-grid.sdPlugin
```

## Acknowledgements

- Resolume's REST/WebSocket API — see
  [the API docs](https://resolume.com/support/en/resolume-arena-api).
- Elgato's [Stream Deck SDK v2](https://github.com/elgatosf/streamdeck) and
  plugin runtime.

## AI disclosure

Substantial portions of this codebase were drafted with
[Claude Code](https://claude.com/claude-code) under my direction. Every change
was reviewed, tested, and integrated by a human (me); the plugin is shipped and
maintained by me, not by the model.

## Trademarks

Resolume® is a registered trademark of Resolume B.V. Stream Deck® and Elgato®
are trademarks of Corsair Memory, Inc. This plugin is an independent, unofficial
integration and is not affiliated with, endorsed by, or sponsored by Resolume
B.V. or Corsair Memory, Inc.

## License

[MIT](LICENSE)
