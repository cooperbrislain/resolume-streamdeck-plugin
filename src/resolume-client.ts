import { EventEmitter } from "events";
import WebSocket from "ws";
import {
  ResolumeClientOptions,
  Composition,
  WsEvent,
  ThumbnailDirtyEvent,
  ClipConnectionEvent,
  ConnectedState,
} from "./types.js";

// Thumbnail cache: "{layer}:{clip}" → base64 PNG
type ThumbnailCache = Map<string, string>;

export declare interface ResolumeClient {
  on(event: "clipConnected", listener: (e: ClipConnectionEvent) => void): this;
  on(event: "clipDisconnected", listener: (e: ClipConnectionEvent) => void): this;
  on(event: "thumbnailDirty", listener: (e: ThumbnailDirtyEvent) => void): this;
  on(event: "connectionChange", listener: (connected: boolean) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export class ResolumeClient extends EventEmitter {
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30_000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private destroyed = false;
  private readonly thumbnailCache: ThumbnailCache = new Map();

  constructor({ host, port }: ResolumeClientOptions) {
    super();
    this.baseUrl = `http://${host}:${port}/api/v1`;
    this.wsUrl = `ws://${host}:${port}/api/v1/websocket`;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  connect(): void {
    if (this.destroyed) return;
    this.openWebSocket();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  async getComposition(): Promise<Composition> {
    const res = await fetch(`${this.baseUrl}/composition`);
    if (!res.ok) throw new Error(`getComposition failed: ${res.status}`);
    return res.json() as Promise<Composition>;
  }

  async getThumbnail(layer: number, clip: number): Promise<string> {
    const key = `${layer}:${clip}`;
    const cached = this.thumbnailCache.get(key);
    if (cached) return cached;

    const res = await fetch(
      `${this.baseUrl}/composition/layers/${layer}/clips/${clip}/thumbnail`
    );
    if (!res.ok) throw new Error(`getThumbnail failed: ${res.status}`);

    const buffer = await res.arrayBuffer();
    const b64 = Buffer.from(buffer).toString("base64");
    const dataUrl = `data:image/png;base64,${b64}`;
    this.thumbnailCache.set(key, dataUrl);
    return dataUrl;
  }

  async triggerClip(layer: number, clip: number): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/composition/layers/${layer}/clips/${clip}/connect`,
      { method: "POST" }
    );
    if (!res.ok) throw new Error(`triggerClip failed: ${res.status}`);
  }

  async setLayerOpacity(layer: number, opacity: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, opacity));
    const res = await fetch(
      `${this.baseUrl}/composition/layers/${layer}/video/opacity`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: clamped }),
      }
    );
    if (!res.ok) throw new Error(`setLayerOpacity failed: ${res.status}`);
  }

  async getLayerOpacity(layer: number): Promise<number> {
    const res = await fetch(
      `${this.baseUrl}/composition/layers/${layer}/video/opacity`
    );
    if (!res.ok) throw new Error(`getLayerOpacity failed: ${res.status}`);
    const json = (await res.json()) as { value: number };
    return json.value;
  }

  // ── WebSocket internals ────────────────────────────────────────────────────

  private openWebSocket(): void {
    if (this.destroyed) return;

    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectDelay = 1000;
      this.emit("connectionChange", true);
    });

    ws.on("message", (data) => {
      try {
        const event: WsEvent = JSON.parse(data.toString());
        this.handleWsEvent(event);
      } catch {
        // malformed message — ignore
      }
    });

    ws.on("close", () => {
      this.emit("connectionChange", false);
      this.scheduleReconnect();
    });

    ws.on("error", () => {
      // error always precedes close; close handler drives reconnect
    });
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openWebSocket();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private handleWsEvent(event: WsEvent): void {
    const path = event.path ?? "";

    // Thumbnail dirty: path like /composition/layers/3/clips/1/thumbnail
    const thumbMatch = path.match(
      /^\/composition\/layers\/(\d+)\/clips\/(\d+)\/thumbnail$/
    );
    if (thumbMatch) {
      const layer = parseInt(thumbMatch[1], 10);
      const clip = parseInt(thumbMatch[2], 10);
      this.thumbnailCache.delete(`${layer}:${clip}`);
      this.emit("thumbnailDirty", { layer, clip } satisfies ThumbnailDirtyEvent);
      return;
    }

    // Clip connected state: path like /composition/layers/3/clips/1/connected
    const connectedMatch = path.match(
      /^\/composition\/layers\/(\d+)\/clips\/(\d+)\/connected$/
    );
    if (connectedMatch) {
      const layer = parseInt(connectedMatch[1], 10);
      const clip = parseInt(connectedMatch[2], 10);
      const state = (event as { value?: ConnectedState }).value ?? "Disconnected";
      const evt: ClipConnectionEvent = { layer, clip, connected: state };
      if (state === "Connected" || state === "Previewing") {
        this.emit("clipConnected", evt);
      } else {
        this.emit("clipDisconnected", evt);
      }
    }
  }
}
