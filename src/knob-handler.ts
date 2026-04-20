import { ResolumeClient } from "./resolume-client.js";
import { Viewport } from "./viewport.js";

export class KnobHandler {
  // Track the layer currently targeted by dial 2 opacity control (1-based)
  private opacityTargetLayer = 1;

  constructor(
    private readonly viewport: Viewport,
    private readonly client: ResolumeClient
  ) {}

  setOpacityTargetLayer(layer: number): void {
    this.opacityTargetLayer = layer;
  }

  async onDialRotate(dialIndex: number, ticks: number): Promise<void> {
    switch (dialIndex) {
      case 0:
        this.viewport.scrollClips(ticks);
        break;

      case 1:
        this.viewport.scrollLayers(ticks);
        break;

      case 2:
        await this.adjustOpacity(this.opacityTargetLayer, ticks * 0.05);
        break;

      case 3:
        console.log(`[KnobHandler] dial 3 rotated ${ticks} ticks (reserved)`);
        break;
    }
  }

  async onDialPress(dialIndex: number): Promise<void> {
    switch (dialIndex) {
      case 2:
        await this.resetOpacity(this.opacityTargetLayer);
        break;

      default:
        console.log(`[KnobHandler] dial ${dialIndex} pressed (no-op)`);
        break;
    }
  }

  // ── Opacity helpers ────────────────────────────────────────────────────────

  private async adjustOpacity(layer: number, delta: number): Promise<void> {
    try {
      const current = await this.client.getLayerOpacity(layer);
      await this.client.setLayerOpacity(layer, current + delta);
    } catch (err) {
      console.error(`[KnobHandler] adjustOpacity error:`, err);
    }
  }

  private async resetOpacity(layer: number): Promise<void> {
    try {
      await this.client.setLayerOpacity(layer, 1.0);
    } catch (err) {
      console.error(`[KnobHandler] resetOpacity error:`, err);
    }
  }
}
