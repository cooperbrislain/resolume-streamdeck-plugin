import { createCanvas, loadImage, CanvasRenderingContext2D } from "canvas";
import { RenderClipOptions } from "./types.js";

const SIZE = 120;
const BORDER_WIDTH = 3;
const LABEL_HEIGHT = 18;
const LABEL_FONT = "bold 10px sans-serif";
const DOT_SPACING = 12;
const DOT_RADIUS = 1.5;

export class ButtonRenderer {
  async renderClip(options: RenderClipOptions): Promise<string> {
    const { thumb, clipName, isConnected, isEmpty } = options;

    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d");

    this.drawBackground(ctx, isEmpty);

    if (!isEmpty && thumb) {
      await this.drawThumbnail(ctx, thumb);
    } else if (isEmpty) {
      this.drawDotPattern(ctx);
    }

    if (isConnected) {
      this.drawConnectedBorder(ctx);
    }

    if (!isEmpty) {
      this.drawLabel(ctx, clipName);
    }

    return canvas.toDataURL("image/png").split(",")[1];
  }

  // ── Rendering layers ───────────────────────────────────────────────────────

  private drawBackground(ctx: CanvasRenderingContext2D, isEmpty: boolean): void {
    ctx.fillStyle = isEmpty ? "#1a1a1a" : "#000000";
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  private drawDotPattern(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#333333";
    for (let y = DOT_SPACING; y < SIZE; y += DOT_SPACING) {
      for (let x = DOT_SPACING; x < SIZE; x += DOT_SPACING) {
        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private async drawThumbnail(
    ctx: CanvasRenderingContext2D,
    thumb: string
  ): Promise<void> {
    try {
      const img = await loadImage(thumb);
      const srcW = img.width;
      const srcH = img.height;
      const targetH = SIZE - LABEL_HEIGHT;

      // Letterbox: scale to fill width, center vertically
      const scaleByWidth = SIZE / srcW;
      const scaleByHeight = targetH / srcH;
      const scale = Math.min(scaleByWidth, scaleByHeight);

      const drawW = srcW * scale;
      const drawH = srcH * scale;
      const drawX = (SIZE - drawW) / 2;
      const drawY = (targetH - drawH) / 2;

      ctx.drawImage(img, drawX, drawY, drawW, drawH);
    } catch {
      // Thumbnail failed to load; leave black background
    }
  }

  private drawConnectedBorder(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = "#00cc44";
    ctx.lineWidth = BORDER_WIDTH;
    const half = BORDER_WIDTH / 2;
    ctx.strokeRect(half, half, SIZE - BORDER_WIDTH, SIZE - BORDER_WIDTH);
  }

  private drawLabel(ctx: CanvasRenderingContext2D, name: string): void {
    const y = SIZE - LABEL_HEIGHT;

    // Semi-transparent backing strip
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, y, SIZE, LABEL_HEIGHT);

    ctx.fillStyle = "#ffffff";
    ctx.font = LABEL_FONT;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    const truncated = this.truncate(ctx, name, SIZE - 8);
    ctx.fillText(truncated, SIZE / 2, y + LABEL_HEIGHT / 2);
  }

  private truncate(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    const ellipsis = "…";
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = text.slice(0, mid) + ellipsis;
      if (ctx.measureText(candidate).width <= maxWidth) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return text.slice(0, lo) + ellipsis;
  }
}
