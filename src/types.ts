export interface ResolumeClientOptions {
  host: string;
  port: number;
}

// ── Composition types ────────────────────────────────────────────────────────

export interface Composition {
  layers: Layer[];
  decks?: Array<{
    id: number;
    closed: boolean;
    name: { value: string };
    selected: { id: number; value: boolean };
    colorid?: { id: number; value: string };
  }>;
  columns?: Array<{
    id: number;
    name?: { value: string };
    connected?: { value: string; id?: number };
  }>;
  name?: { value: string } | string;
  dashboard?: Record<string, {
    id: number;
    valuetype: string;
    min: number;
    max: number;
    value: number;
    view?: { suffix?: string; control_type?: string };
  }>;
}

interface Param { value: number; id?: number; min?: number; max?: number }

export interface Layer {
  id: number;
  name: { value: string };
  clips: Clip[];
  video?: { opacity?: Param };
  audio?: { volume?: Param };
  transition?: { duration?: Param };
  selected?: { value: boolean; id: number };
  colorid?: { id: number; value: string };
}

export interface Clip {
  id: number;
  name: { value: string };
  connected: { value: ConnectedState; id?: number };
  thumbnail?: { id: number; path: string; last_update?: string };
  transport?: {
    position?: Param;
    controls?: {
      speed?:    Param;
      duration?: Param;
    };
  };
  video?: { opacity?: Param };
  audio?: { volume?: Param };
  selected?: { value: boolean; id?: number };
}

export type ConnectedState = "Connected" | "Previewing" | "Disconnected" | "Empty" | "Connected & previewing";

// ── WebSocket event payloads ─────────────────────────────────────────────────

export interface WsEvent {
  type?: string;
  id?: number;
  value?: unknown;
  [key: string]: unknown;
}

export interface ThumbnailDirtyEvent {
  layer: number;
  clip: number;
}

export interface ClipConnectionEvent {
  layer: number;
  clip: number;
  connected: ConnectedState;
}

export interface DeckChangedEvent {
  deckIndex: number;
  clipOffset: number;
}

export interface LayerSelectedEvent {
  layerIndex: number;
}

// ── Per-button / per-dial settings ───────────────────────────────────────────

/**
 * Clip button settings.
 *
 * layerMode:
 *   "positional" – button's row maps to layer (row 0 → layer 1, row 1 → layer 2, …)  [default]
 *   "selected"   – tracks whichever layer is currently selected in Resolume
 *   "fixed"      – always uses the explicit `layer` number
 *
 * deckColumn:
 *   Which column (1-based) to show within the current deck.
 *   0 or absent means "use this button's physical column".
 */
export interface ActionSettings {
  layerMode:  "positional" | "selected" | "fixed";
  layer:      number; // 1-based; only used when layerMode === "fixed"
  deckColumn: number; // 1-based within deck; 0 = use button's physical column

  /**
   * deckMode:
   *   "current" – always operate on whichever deck is currently active [default]
   *   "fixed"   – target a specific deck (switches to it on press)
   */
  deckMode?: "current" | "fixed";
  deck?:     number; // 1-based deck number; only used when deckMode === "fixed"
}

export interface Deck {
  id: number;
  name: string;
  selectedParamId: number;
  closed: boolean;
  /** 1–6 if a tab color is set in Resolume; undefined for "no color". */
  colorIndex?: number;
}

export type LayerParamName = "opacity" | "speed" | "volume" | "transition_duration";
export type ClipParamName  = "opacity" | "speed" | "volume" | "position";

export interface LinkSettings {
  source: "composition" | "layer" | "clip";
  paramId: number | null;
  layerIndex: number;
  layerParam: LayerParamName;
  clipIndex: number;
  clipParam: ClipParamName;
  /**
   * Rotation sensitivity multiplier. 1.0 = default (20 ticks to sweep full range).
   * 2.0 = twice as fast, 0.5 = half as fast / twice as fine.
   */
  sensitivity?: number;
}

// ── Dashboard parameters ──────────────────────────────────────────────────────

export interface DashboardParam {
  id: number;
  name: string;
  min: number;
  max: number;
  value: number;
  [key: string]: unknown;
}

// ── Renderer ─────────────────────────────────────────────────────────────────

export interface RenderClipOptions {
  thumb: string | null;
  clipName: string;
  isConnected: boolean;
  isEmpty: boolean;
}
