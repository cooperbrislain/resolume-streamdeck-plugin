import { EventEmitter } from "events";
import { VisibleCell } from "./types.js";

export declare interface Viewport {
  on(event: "changed", listener: () => void): this;
}

export class Viewport extends EventEmitter {
  private layerOffset = 0;
  private clipOffset = 0;
  private totalLayers = 0;
  private totalClips = 0;

  constructor(
    public readonly gridWidth: number,
    public readonly gridHeight: number
  ) {
    super();
  }

  // ── Composition bounds ─────────────────────────────────────────────────────

  setCompositionSize(layers: number, clips: number): void {
    this.totalLayers = layers;
    this.totalClips = clips;
    // Re-clamp offsets in case composition shrank
    this.layerOffset = this.clampLayer(this.layerOffset);
    this.clipOffset = this.clampClip(this.clipOffset);
  }

  // ── Scrolling ──────────────────────────────────────────────────────────────

  scrollLayers(delta: number): void {
    const next = this.clampLayer(this.layerOffset + delta);
    if (next !== this.layerOffset) {
      this.layerOffset = next;
      this.emit("changed");
    }
  }

  scrollClips(delta: number): void {
    const next = this.clampClip(this.clipOffset + delta);
    if (next !== this.clipOffset) {
      this.clipOffset = next;
      this.emit("changed");
    }
  }

  // ── Visible cells ──────────────────────────────────────────────────────────

  getVisibleCells(): VisibleCell[] {
    const cells: VisibleCell[] = [];
    for (let row = 0; row < this.gridHeight; row++) {
      for (let col = 0; col < this.gridWidth; col++) {
        const layer = this.layerOffset + row + 1; // 1-based
        const clip = this.clipOffset + col + 1;   // 1-based
        cells.push({
          buttonIndex: row * this.gridWidth + col,
          layer,
          clip,
        });
      }
    }
    return cells;
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  get currentLayerOffset(): number { return this.layerOffset; }
  get currentClipOffset(): number { return this.clipOffset; }

  /** Returns the 1-based layer for a given button index, or null if out of bounds. */
  layerForButton(buttonIndex: number): number | null {
    const row = Math.floor(buttonIndex / this.gridWidth);
    const layer = this.layerOffset + row + 1;
    return layer <= this.totalLayers ? layer : null;
  }

  /** Returns the 1-based clip for a given button index, or null if out of bounds. */
  clipForButton(buttonIndex: number): number | null {
    const col = buttonIndex % this.gridWidth;
    const clip = this.clipOffset + col + 1;
    return clip <= this.totalClips ? clip : null;
  }

  // ── Clamping helpers ───────────────────────────────────────────────────────

  private clampLayer(offset: number): number {
    const max = Math.max(0, this.totalLayers - this.gridHeight);
    return Math.max(0, Math.min(offset, max));
  }

  private clampClip(offset: number): number {
    const max = Math.max(0, this.totalClips - this.gridWidth);
    return Math.max(0, Math.min(offset, max));
  }
}
