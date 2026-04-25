import { createCanvas } from "@napi-rs/canvas";

/**
 * Renders a knob/dial icon whose indicator and arc reflect the current value
 * within its range. Used as the encoder icon for the Parameter action.
 *
 * The knob sweeps 270° clockwise from ~7 o'clock (0%) through 12 o'clock (50%)
 * to ~5 o'clock (100%). Results are cached per integer percentage so the
 * encoder can repaint at every paramUpdate without re-rendering.
 */

const SIZE   = 72;
const CACHE: Map<number, string> = new Map();

const ARC_START   = 0.75 * Math.PI;   // 7 o'clock
const ARC_SWEEP   = 1.5  * Math.PI;   // 270° total
const TRACK_COLOR = "rgba(255, 255, 255, 0.20)";
const FILL_COLOR  = "#ffffff";

/** Transparent PNG used when a Parameter dial is unassigned. */
const BLANK_ICON: string = (() => {
  const c = createCanvas(SIZE, SIZE);
  return c.toDataURL("image/png");
})();

function renderKnob(pct: number): string {
  const c = createCanvas(SIZE, SIZE);
  const g = c.getContext("2d");
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r  = SIZE / 2 - 8;

  // Dim full-track background arc
  g.lineWidth   = 5;
  g.lineCap     = "round";
  g.strokeStyle = TRACK_COLOR;
  g.beginPath();
  g.arc(cx, cy, r, ARC_START, ARC_START + ARC_SWEEP);
  g.stroke();

  // Bright value arc
  if (pct > 0) {
    g.strokeStyle = FILL_COLOR;
    g.beginPath();
    g.arc(cx, cy, r, ARC_START, ARC_START + (pct / 100) * ARC_SWEEP);
    g.stroke();
  }

  // Indicator tick at the current angle
  const angle = ARC_START + (pct / 100) * ARC_SWEEP;
  const r1    = r - 8;
  const r2    = r + 4;
  g.lineWidth   = 4;
  g.strokeStyle = FILL_COLOR;
  g.beginPath();
  g.moveTo(cx + r1 * Math.cos(angle), cy + r1 * Math.sin(angle));
  g.lineTo(cx + r2 * Math.cos(angle), cy + r2 * Math.sin(angle));
  g.stroke();

  // Center pivot dot
  g.fillStyle = FILL_COLOR;
  g.beginPath();
  g.arc(cx, cy, 4, 0, Math.PI * 2);
  g.fill();

  return c.toDataURL("image/png");
}

/**
 * Get a knob-icon data URL for the given percentage (0–100).
 * Pass `null` to get a transparent blank for unassigned dials.
 */
export function knobIcon(percentage: number | null): string {
  if (percentage == null) return BLANK_ICON;
  const key = Math.max(0, Math.min(100, Math.round(percentage)));
  let cached = CACHE.get(key);
  if (cached) return cached;
  cached = renderKnob(key);
  CACHE.set(key, cached);
  return cached;
}
