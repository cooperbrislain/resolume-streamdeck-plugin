export interface ResolumeClientOptions {
  host: string;
  port: number;
}

// ── Composition types ────────────────────────────────────────────────────────

export interface Composition {
  layers: Layer[];
  name?: string;
}

export interface Layer {
  id: number;
  name: { value: string };
  clips: Clip[];
  video?: { opacity: { value: number; id: number } };
}

export interface Clip {
  id: number;
  name: { value: string };
  connected: { value: ConnectedState };
  thumbnail?: string; // base64 PNG
}

export type ConnectedState = "Connected" | "Previewing" | "Disconnected";

// ── WebSocket event payloads ─────────────────────────────────────────────────

export interface WsEvent {
  type: string;
  path?: string;
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

// ── Viewport ─────────────────────────────────────────────────────────────────

export interface VisibleCell {
  buttonIndex: number;
  layer: number; // 1-based to match Resolume API
  clip: number;  // 1-based
}

// ── Renderer ─────────────────────────────────────────────────────────────────

export interface RenderClipOptions {
  thumb: string | null;
  clipName: string;
  isConnected: boolean;
  isEmpty: boolean;
}
