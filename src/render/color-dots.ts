import { createCanvas } from "@napi-rs/canvas";

/**
 * Hex colors approximating Resolume's six tab / layer highlight colors.
 * Indexed by `colorid` value (1–6) as returned by the Resolume REST API
 * for both decks and layers.
 *
 * These are visually-close approximations rather than pixel-exact matches —
 * Resolume's actual palette is not published, so tweak here if you want a
 * different look on the encoder LCD.
 */
// Resolume's `colorid` is 1-based, where 1 means "no color set" and 2–6 are the
// five tab/layer highlight colors in the order shown in Resolume's color picker.
// Index 1 is intentionally absent from this map so unassigned items fall
// through to BLANK_DOT (a neutral gray).
const PALETTE: Record<number, string> = {
  2: "#c0392b", // red
  3: "#8bc34a", // lime green
  4: "#16a085", // teal
  5: "#2196f3", // blue
  6: "#d81b60", // magenta / pink
};

/** Neutral gray dot used when no color is assigned in Resolume. */
const BLANK_DOT: string = renderDot("#7f8c8d");

/** Render a single colored dot once and cache its data URL. */
function renderDot(hex: string): string {
  const size = 48;
  const c = createCanvas(size, size);
  const g = c.getContext("2d");
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
 * Get a data-URL PNG for a given Resolume colorIndex (1–6), or a transparent
 * blank when nothing is assigned. Used for both decks and layers.
 */
export function colorDotIcon(colorIndex: number | undefined): string {
  if (colorIndex == null) return BLANK_DOT;
  return DOT_CACHE.get(colorIndex) ?? BLANK_DOT;
}
