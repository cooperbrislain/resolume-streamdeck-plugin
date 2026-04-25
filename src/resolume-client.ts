/**
 * Resolume Arena/Avenue REST + WebSocket client.
 *
 * One client covers both transports:
 *   - REST over HTTP for composition snapshots, thumbnails, and one-shot
 *     commands (trigger clip, clear layer).
 *   - WebSocket for live parameter streams (clip connect state, thumbnail
 *     dirty events, dashboard values, deck/layer selection).
 *
 * Auto-reconnects with exponential backoff (1s → 30s cap).
 *
 * Notable design points:
 *
 * 1. **Parameter writes go through `/parameter/by-id/{id}`.** Resolume's
 *    path-based parameter URLs (e.g. `.../layers/1/video/opacity`) 404 in
 *    practice, so every set operation needs a param id. Ids are harvested
 *    from the composition snapshot in `indexComposition`.
 *
 * 2. **Thumbnail fetches are concurrency-limited.** Resolume's HTTP server
 *    queues up badly when hit with many simultaneous thumbnail requests.
 *    We cap inflight fetches to `THUMB_LIMIT`.
 *
 * 3. **Thumbnail cache is keyed per active deck.** Switching decks is free —
 *    old entries become unreachable, and switching back restores them.
 */

import { EventEmitter } from "events";
import WebSocket from "ws";
import {
  ResolumeClientOptions,
  Composition,
  DashboardParam,
  Deck,
  WsEvent,
  ThumbnailDirtyEvent,
  ClipConnectionEvent,
  ConnectedState,
  DeckChangedEvent,
  LayerSelectedEvent,
} from "./types.js";

// ── Tuning knobs ──────────────────────────────────────────────────────────────

const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS     = 30_000;
const THUMB_LIMIT          = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParamFull {
  value: number;
  min:   number;
  max:   number;
  id?:   number;
}

export declare interface ResolumeClient {
  on(event: "clipConnected",    listener: (e: ClipConnectionEvent) => void): this;
  on(event: "clipDisconnected", listener: (e: ClipConnectionEvent) => void): this;
  on(event: "thumbnailDirty",   listener: (e: ThumbnailDirtyEvent) => void): this;
  on(event: "connectionChange", listener: (connected: boolean) => void): this;
  on(event: "paramUpdate",      listener: (e: { id: number; value: number }) => void): this;
  on(event: "deckChanged",      listener: (e: DeckChangedEvent) => void): this;
  on(event: "layerSelected",    listener: (e: LayerSelectedEvent) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export class ResolumeClient extends EventEmitter {
  private readonly baseUrl: string;
  private readonly wsUrl:   string;

  // ── Connection state ────────────────────────────────────────────────────────
  private ws:               WebSocket | null   = null;
  private reconnectDelay    = RECONNECT_INITIAL_MS;
  private reconnectTimer:   NodeJS.Timeout | null = null;
  private destroyed         = false;

  // ── Composition indexes (populated by indexComposition) ─────────────────────
  private connectedParamIds      = new Map<number, { layer: number; clip: number }>();
  private thumbnailParamIds      = new Map<number, { layer: number; clip: number }>();
  private deckSelectedParamIds   = new Map<number, number>(); // paramId → 0-based deck index
  private layerSelectedParamIds  = new Map<number, number>(); // paramId → 0-based layer index
  private layerSelectParamByIdx: number[] = [];               // layer index → selected param id
  private dashboardParams        = new Map<number, DashboardParam>();
  private clipParamIds           = new Map<string, Partial<Record<string, number>>>(); // "layer:clip" → {param → id}
  private layerParamIds          = new Map<number, Partial<Record<string, number>>>(); // layer → {param → id}

  private decks:                  Deck[] = [];
  private layerInfo:              Array<{ name: string }> = [];
  private activeDeckIndex         = 0;
  private lastSelectedLayerIndex  = 0;

  // ── Thumbnail cache + concurrency limiter ───────────────────────────────────
  /** "{deckIndex}:{layer}:{clip}" → base64 data URL. Keyed per deck so
   *  switching back to a visited deck is instant. */
  private readonly thumbnailCache = new Map<string, string>();
  private thumbInFlight           = 0;
  private thumbWaiters:           Array<() => void> = [];

  constructor({ host, port }: ResolumeClientOptions) {
    super();
    this.baseUrl = `http://${host}:${port}/api/v1`;
    this.wsUrl   = `ws://${host}:${port}/api/v1`;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  connect(): void {
    if (this.destroyed) return;
    if (this.ws !== null) return;
    this.openWebSocket();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
  }

  // ── Composition / decks / layers ────────────────────────────────────────────

  async getComposition(): Promise<Composition> {
    const res = await fetch(`${this.baseUrl}/composition`);
    if (!res.ok) throw new Error(`getComposition failed: ${res.status}`);
    return res.json() as Promise<Composition>;
  }

  /** Scan the composition for param ids, dashboard params, decks, layers. */
  indexComposition(composition: Composition): void {
    this.connectedParamIds.clear();
    this.thumbnailParamIds.clear();
    this.deckSelectedParamIds.clear();
    this.layerSelectedParamIds.clear();
    this.dashboardParams.clear();
    this.clipParamIds.clear();
    this.layerParamIds.clear();
    this.layerSelectParamByIdx = [];

    this.indexDecks(composition);
    this.indexLayers(composition);
    this.indexDashboard(composition);
  }

  getDecks():      Deck[]                  { return this.decks; }
  getLayers():     Array<{ name: string }> { return this.layerInfo; }
  getDashboardParams(): DashboardParam[]   { return Array.from(this.dashboardParams.values()); }

  /** 0-based index of the active deck. */
  getActiveDeckIndex(): number { return this.activeDeckIndex; }

  /** Force-set the active deck index (for immediate UI response on dial press). */
  setActiveDeckIndex(idx: number): void {
    this.activeDeckIndex = Math.max(0, Math.min(this.decks.length - 1, idx));
  }

  /** 0-based index of the last-selected layer in Resolume. */
  getSelectedLayerIndex(): number { return this.lastSelectedLayerIndex; }

  // ── Commands ────────────────────────────────────────────────────────────────

  async triggerClip(layer: number, clip: number): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/composition/layers/${layer}/clips/${clip}/connect`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error(`triggerClip failed: ${res.status}`);
  }

  async clearLayer(layer: number): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/composition/layers/${layer}/clear`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error(`clearLayer failed: ${res.status}`);
  }

  /** Switch to a deck by its `selected` param id (from the composition). */
  openDeck(selectedParamId: number): void {
    this.sendWs({ action: "trigger", parameter: `/parameter/by-id/${selectedParamId}` });
  }

  /** Select a layer in Resolume by 0-based index. */
  selectLayer(layerIndex: number): void {
    const paramId = this.layerSelectParamByIdx[layerIndex];
    if (paramId != null) {
      this.sendWs({ action: "trigger", parameter: `/parameter/by-id/${paramId}` });
    }
  }

  // ── Parameter read / write ──────────────────────────────────────────────────

  async getLayerParamFull(layer: number, param: string): Promise<ParamFull> {
    const id = this.layerParamIds.get(layer)?.[param];
    if (id !== undefined) {
      const full = await this.fetchParamFull(`${this.baseUrl}/parameter/by-id/${id}`);
      return { ...full, id };
    }
    // Path-based fallback — almost always 404s, but kept for defence in depth.
    const result = await this.fetchParamFull(this.layerParamPath(layer, param));
    if (result.id !== undefined) {
      this.cacheLayerParamId(layer, param, result.id);
    }
    return result;
  }

  async getClipParamFull(layer: number, clip: number, param: string): Promise<ParamFull> {
    const id = this.clipParamIds.get(`${layer}:${clip}`)?.[param];
    if (id !== undefined) {
      const full = await this.fetchParamFull(`${this.baseUrl}/parameter/by-id/${id}`);
      return { ...full, id };
    }
    const result = await this.fetchParamFull(this.clipParamPath(layer, clip, param));
    if (result.id !== undefined) {
      this.cacheClipParamId(layer, clip, param, result.id);
    }
    return result;
  }

  async setLayerParam(layer: number, param: string, value: number): Promise<void> {
    const id = this.layerParamIds.get(layer)?.[param];
    if (id === undefined) {
      throw new Error(`setLayerParam(${layer}, ${param}): no param id indexed — composition not loaded?`);
    }
    await this.writeParamById(id, value);
  }

  async setClipParam(layer: number, clip: number, param: string, value: number): Promise<void> {
    const id = this.clipParamIds.get(`${layer}:${clip}`)?.[param];
    if (id === undefined) {
      throw new Error(`setClipParam(${layer}, ${clip}, ${param}): no param id indexed — composition not loaded?`);
    }
    await this.writeParamById(id, value);
  }

  /** Instant parameter set over WS (no await). Caller is responsible for ordering. */
  setParameterById(paramId: number, value: number): void {
    this.sendWs({ action: "set", parameter: `/parameter/by-id/${paramId}`, value });
  }

  /** Reset a parameter to its default over WS. */
  resetParameterById(paramId: number): void {
    this.sendWs({ action: "reset", parameter: `/parameter/by-id/${paramId}` });
  }

  // ── Thumbnails ──────────────────────────────────────────────────────────────

  async getThumbnail(layer: number, clip: number): Promise<string> {
    const key    = `${this.activeDeckIndex}:${layer}:${clip}`;
    const cached = this.thumbnailCache.get(key);
    if (cached) return cached;

    await this.acquireThumb();
    try {
      const res = await fetch(
        `${this.baseUrl}/composition/layers/${layer}/clips/${clip}/thumbnail`,
      );
      if (!res.ok) throw new Error(`getThumbnail failed: ${res.status}`);
      const buffer  = await res.arrayBuffer();
      const b64     = Buffer.from(buffer).toString("base64");
      const dataUrl = `data:image/png;base64,${b64}`;
      this.thumbnailCache.set(key, dataUrl);
      return dataUrl;
    } finally {
      this.releaseThumb();
    }
  }

  /** Invalidate the cached thumbnail for a specific clip on the active deck. */
  clearThumbnail(layer: number, clip: number): void {
    this.thumbnailCache.delete(`${this.activeDeckIndex}:${layer}:${clip}`);
  }

  /** Wipe the entire thumbnail cache (used by manual refresh). */
  clearAllThumbnailCache(): void {
    this.thumbnailCache.clear();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  // ── Composition indexing ────────────────────────────────────────────────────

  private indexDecks(composition: Composition): void {
    this.activeDeckIndex = 0;
    this.decks = (composition.decks ?? []).map((d, i) => {
      if (d.selected?.id) {
        this.deckSelectedParamIds.set(d.selected.id, i);
        this.subscribe(d.selected.id);
        if (truthy(d.selected.value)) {
          this.activeDeckIndex = i;
          console.log(`[client] initial active deck: ${i} ("${d.name?.value}")`);
        }
      }
      const parsedColor = d.colorid?.value ? parseInt(d.colorid.value, 10) : NaN;
      return {
        id:              d.id,
        name:            d.name?.value ?? "Deck",
        selectedParamId: d.selected?.id,
        closed:          d.closed ?? false,
        colorIndex:      Number.isFinite(parsedColor) && parsedColor >= 1 && parsedColor <= 6
                            ? parsedColor : undefined,
      };
    });
  }

  private indexLayers(composition: Composition): void {
    this.layerInfo = composition.layers.map((layer, li) => {
      if (layer.selected?.id) {
        this.layerSelectedParamIds.set(layer.selected.id, li);
        this.layerSelectParamByIdx[li] = layer.selected.id;
        this.subscribe(layer.selected.id);
        if (truthy(layer.selected.value)) {
          this.lastSelectedLayerIndex = li;
        }
      }

      const layerParams: Partial<Record<string, number>> = {};
      if (layer.video?.opacity?.id)       layerParams.opacity             = layer.video.opacity.id;
      if (layer.audio?.volume?.id)        layerParams.volume              = layer.audio.volume.id;
      if (layer.transition?.duration?.id) layerParams.transition_duration = layer.transition.duration.id;
      if (Object.keys(layerParams).length > 0) {
        this.layerParamIds.set(li + 1, layerParams);
      }

      layer.clips.forEach((clip, ci) => {
        const pos = { layer: li + 1, clip: ci + 1 };
        if (clip.connected?.id) {
          this.connectedParamIds.set(clip.connected.id, pos);
          this.subscribe(clip.connected.id);
        }
        if (clip.thumbnail?.id) {
          this.thumbnailParamIds.set(clip.thumbnail.id, pos);
          this.subscribe(clip.thumbnail.id);
        }

        // Speed lives under transport.controls, not transport directly.
        const clipParams: Partial<Record<string, number>> = {};
        if (clip.transport?.controls?.speed?.id) clipParams.speed    = clip.transport.controls.speed.id;
        if (clip.transport?.position?.id)        clipParams.position = clip.transport.position.id;
        if (clip.video?.opacity?.id)             clipParams.opacity  = clip.video.opacity.id;
        if (clip.audio?.volume?.id)              clipParams.volume   = clip.audio.volume.id;
        if (Object.keys(clipParams).length > 0) {
          this.clipParamIds.set(`${li + 1}:${ci + 1}`, clipParams);
        }
      });

      return { name: layer.name?.value || `Layer ${li + 1}` };
    });
  }

  private indexDashboard(composition: Composition): void {
    for (const [name, raw] of Object.entries(composition.dashboard ?? {})) {
      const param: DashboardParam = {
        id: raw.id, name, min: raw.min, max: raw.max, value: raw.value,
      };
      this.dashboardParams.set(raw.id, param);
      this.subscribe(raw.id);
    }
  }

  private cacheLayerParamId(layer: number, param: string, id: number): void {
    const existing = this.layerParamIds.get(layer) ?? {};
    existing[param] = id;
    this.layerParamIds.set(layer, existing);
  }

  private cacheClipParamId(layer: number, clip: number, param: string, id: number): void {
    const key = `${layer}:${clip}`;
    const existing = this.clipParamIds.get(key) ?? {};
    existing[param] = id;
    this.clipParamIds.set(key, existing);
  }

  // ── Parameter URL paths (for GET fallback; Resolume only reliably serves
  //    writes via /parameter/by-id/{id}, but reads mostly work path-based) ────

  private layerParamPath(layer: number, param: string): string {
    switch (param) {
      case "volume":              return `${this.baseUrl}/composition/layers/${layer}/audio/volume`;
      case "transition_duration": return `${this.baseUrl}/composition/layers/${layer}/transition/duration`;
      default:                    return `${this.baseUrl}/composition/layers/${layer}/video/opacity`;
    }
  }

  private clipParamPath(layer: number, clip: number, param: string): string {
    const base = `${this.baseUrl}/composition/layers/${layer}/clips/${clip}`;
    switch (param) {
      case "speed":    return `${base}/transport/controls/speed`;
      case "position": return `${base}/transport/position`;
      case "volume":   return `${base}/audio/volume`;
      default:         return `${base}/video/opacity`;
    }
  }

  private async fetchParamFull(url: string): Promise<ParamFull> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    const j = await res.json() as { value?: number; min?: number; max?: number; id?: number };
    return { value: j.value ?? 0, min: j.min ?? 0, max: j.max ?? 1, id: j.id };
  }

  /** Write a parameter by id — prefers WS, falls back to REST PUT. */
  private async writeParamById(id: number, value: number): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.setParameterById(id, value);
      return;
    }
    const url = `${this.baseUrl}/parameter/by-id/${id}`;
    const res = await fetch(url, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ value }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`PUT ${url} → ${res.status} ${body}`);
    }
  }

  // ── Thumbnail concurrency limiter ───────────────────────────────────────────

  private acquireThumb(): Promise<void> {
    if (this.thumbInFlight < THUMB_LIMIT) {
      this.thumbInFlight++;
      return Promise.resolve();
    }
    return new Promise(resolve => this.thumbWaiters.push(resolve));
  }

  private releaseThumb(): void {
    const next = this.thumbWaiters.shift();
    if (next) next();
    else this.thumbInFlight--;
  }

  // ── WebSocket plumbing ──────────────────────────────────────────────────────

  private sendWs(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private subscribe(paramId: number): void {
    this.sendWs({ action: "subscribe", parameter: `/parameter/by-id/${paramId}` });
  }

  private openWebSocket(): void {
    if (this.destroyed) return;

    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectDelay = RECONNECT_INITIAL_MS;
      this.emit("connectionChange", true);
    });

    ws.on("message", (data) => {
      try {
        const event: WsEvent = JSON.parse(data.toString());
        this.handleWsEvent(event);
      } catch { /* malformed — ignore */ }
    });

    ws.on("close", () => {
      this.connectedParamIds.clear();
      this.thumbnailParamIds.clear();
      this.dashboardParams.clear();
      this.emit("connectionChange", false);
      this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      // Resolume occasionally sends status 1006 close frames that ws@8 treats
      // as a protocol violation. Log and let "close" drive reconnection.
      console.error("[client] WebSocket error (will reconnect):", (err as Error).message);
    });

    // Belt-and-suspenders: absorb frame-level exceptions so they can't escape
    // and kill the process.
    (ws as unknown as { _receiver?: NodeJS.EventEmitter })?._receiver?.on?.("error", (err: Error) => {
      console.error("[client] WS receiver error:", err.message);
      ws.terminate();
    });
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openWebSocket();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private handleWsEvent(event: WsEvent): void {
    if (event.type !== "parameter_update" || typeof event.id !== "number") return;

    const id    = event.id;
    const value = event.value;

    if (this.handleClipConnection(id, value)) return;
    if (this.handleThumbnailDirty(id))        return;
    if (this.handleDeckSelection(id, value))  return;
    if (this.handleLayerSelection(id, value)) return;
    this.handleDashboardUpdate(id, value);
  }

  private handleClipConnection(id: number, value: unknown): boolean {
    const cell = this.connectedParamIds.get(id);
    if (!cell) return false;
    const state = (value as ConnectedState) ?? "Disconnected";
    const evt: ClipConnectionEvent = { ...cell, connected: state };
    const isOn = state === "Connected"
              || state === "Previewing"
              || state === "Connected & previewing";
    this.emit(isOn ? "clipConnected" : "clipDisconnected", evt);
    return true;
  }

  private handleThumbnailDirty(id: number): boolean {
    const cell = this.thumbnailParamIds.get(id);
    if (!cell) return false;
    // Invalidate immediately to avoid a race where the old PNG is served before
    // the plugin handler runs.
    this.thumbnailCache.delete(`${this.activeDeckIndex}:${cell.layer}:${cell.clip}`);
    this.emit("thumbnailDirty", cell satisfies ThumbnailDirtyEvent);
    return true;
  }

  private handleDeckSelection(id: number, value: unknown): boolean {
    const deckIdx = this.deckSelectedParamIds.get(id);
    if (deckIdx === undefined) return false;
    if (truthy(value)) {
      console.log(`[client] deck selected → ${deckIdx}`);
      this.activeDeckIndex = deckIdx;
      this.emit("deckChanged", { deckIndex: deckIdx, clipOffset: 0 } satisfies DeckChangedEvent);
    }
    return true;
  }

  private handleLayerSelection(id: number, value: unknown): boolean {
    const layerIdx = this.layerSelectedParamIds.get(id);
    if (layerIdx === undefined) return false;
    if (truthy(value)) {
      console.log(`[client] layer selected → ${layerIdx}`);
      this.lastSelectedLayerIndex = layerIdx;
      this.emit("layerSelected", { layerIndex: layerIdx } satisfies LayerSelectedEvent);
    }
    return true;
  }

  private handleDashboardUpdate(id: number, value: unknown): void {
    const dashParam = this.dashboardParams.get(id);
    if (dashParam && typeof value === "number") {
      dashParam.value = value;
      this.emit("paramUpdate", { id, value });
    }
  }
}

// ── Util ──────────────────────────────────────────────────────────────────────

/** Resolume sends selection flags as boolean true, "true", or 1. */
function truthy(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
}
