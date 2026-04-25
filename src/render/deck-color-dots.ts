import { createCanvas } from "@napi-rs/canvas";

/**
 * Hex colors approximating Resolume's six deck-tab highlight colors.
 * Indexed by `colorid` value (1–6) as returned by the Resolume REST API.
 *
 * These are visually-close approximations rather than pixel-exact matches —
 * Resolume's actual palette is not published, so tweak here if you want a
 * different look on the encoder LCD.
 */
const PALETTE: Record<number, string> = {
  1: "#e74c3c", // red
  2: "#e67e22", // orange
  3: "#f1c40f", // yellow
  4: "#2ecc71", // green
  5: "#3498db", // blue
  6: "#9b59b6", // purple
};

/** Transparent PNG used when a deck has no color set. */
const BLANK_DOT: string = (() => {
  const c = createCanvas(48, 48);
  return c.toDataURL("image/png");
})();

/** Render a single colored dot once and cache its data URL. */
function renderDot(hex: string): string {
  const size = 48;
  const c = createCanvas(size, size);
  const g = c.getContext("2d");
  // Soft outer glow so it reads on the dark LCD strip
  g.fillStyle = hex;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  g.fill();
  // Subtle white edge ring
  g.lineWidth = 2;
  g.strokeStyle = "rgba(255,255,255,0.25)";
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2);
  g.stroke();
  return c.toDataURL("image/png");
}

const DOT_CACHE: Map<number, string> = new Map(
  Object.entries(PALETTE).map(([k, hex]) => [parseInt(k, 10), renderDot(hex)]),
);

/**
 * Get a data-URL PNG for a given deck colorIndex (1–6), or a transparent
 * blank when the deck has no color set.
 */
export function deckColorIcon(colorIndex: number | undefined): string {
  if (colorIndex == null) return BLANK_DOT;
  return DOT_CACHE.get(colorIndex) ?? BLANK_DOT;
}
