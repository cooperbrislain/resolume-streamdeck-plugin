import { describe, it, expect, vi, beforeEach } from "vitest";
import { Viewport } from "../viewport.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeVp(w = 4, h = 2) {
  return new Viewport(w, h);
}

function sized(vp: Viewport, layers: number, clips: number) {
  vp.setCompositionSize(layers, clips);
  return vp;
}

// ── construction ──────────────────────────────────────────────────────────────

describe("Viewport construction", () => {
  it("stores grid dimensions", () => {
    const vp = makeVp(4, 2);
    expect(vp.gridWidth).toBe(4);
    expect(vp.gridHeight).toBe(2);
  });

  it("starts at offset 0,0", () => {
    const vp = makeVp(4, 2);
    expect(vp.currentLayerOffset).toBe(0);
    expect(vp.currentClipOffset).toBe(0);
  });
});

// ── getVisibleCells ───────────────────────────────────────────────────────────

describe("getVisibleCells", () => {
  it("returns gridWidth × gridHeight cells", () => {
    const vp = sized(makeVp(4, 2), 8, 16);
    expect(vp.getVisibleCells()).toHaveLength(8);
  });

  it("first cell is always buttonIndex 0, layer 1, clip 1 at origin", () => {
    const vp = sized(makeVp(4, 2), 8, 16);
    const cells = vp.getVisibleCells();
    expect(cells[0]).toEqual({ buttonIndex: 0, layer: 1, clip: 1 });
  });

  it("last cell in a 4×2 grid is button 7, layer 2, clip 4", () => {
    const vp = sized(makeVp(4, 2), 8, 16);
    const cells = vp.getVisibleCells();
    expect(cells[7]).toEqual({ buttonIndex: 7, layer: 2, clip: 4 });
  });

  it("buttonIndex increments left-to-right then top-to-bottom", () => {
    const vp = sized(makeVp(3, 2), 6, 9);
    const indices = vp.getVisibleCells().map((c) => c.buttonIndex);
    expect(indices).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("reflects layerOffset after scrolling", () => {
    const vp = sized(makeVp(4, 2), 8, 16);
    vp.scrollLayers(2);
    const cells = vp.getVisibleCells();
    expect(cells[0].layer).toBe(3);
    expect(cells[4].layer).toBe(4); // second row
  });

  it("reflects clipOffset after scrolling", () => {
    const vp = sized(makeVp(4, 2), 8, 16);
    vp.scrollClips(3);
    const cells = vp.getVisibleCells();
    expect(cells[0].clip).toBe(4);
    expect(cells[3].clip).toBe(7);
  });

  it("works for a 1×1 grid (single button)", () => {
    const vp = sized(makeVp(1, 1), 4, 4);
    expect(vp.getVisibleCells()).toEqual([{ buttonIndex: 0, layer: 1, clip: 1 }]);
  });

  it("supports wide grids for future XL (8×4)", () => {
    const vp = sized(makeVp(8, 4), 16, 32);
    const cells = vp.getVisibleCells();
    expect(cells).toHaveLength(32);
    expect(cells[31]).toEqual({ buttonIndex: 31, layer: 4, clip: 8 });
  });
});

// ── scrollClips ───────────────────────────────────────────────────────────────

describe("scrollClips", () => {
  it("advances clipOffset by ticks", () => {
    const vp = sized(makeVp(4, 2), 4, 16);
    vp.scrollClips(3);
    expect(vp.currentClipOffset).toBe(3);
  });

  it("clamps to 0 on negative scroll from origin", () => {
    const vp = sized(makeVp(4, 2), 4, 16);
    vp.scrollClips(-10);
    expect(vp.currentClipOffset).toBe(0);
  });

  it("clamps at max (totalClips - gridWidth)", () => {
    const vp = sized(makeVp(4, 2), 4, 8);
    vp.scrollClips(99);
    // max offset = 8 - 4 = 4
    expect(vp.currentClipOffset).toBe(4);
  });

  it("exact max scroll lands on last window", () => {
    const vp = sized(makeVp(4, 2), 4, 8);
    vp.scrollClips(4);
    expect(vp.currentClipOffset).toBe(4);
    const cells = vp.getVisibleCells();
    expect(cells[3].clip).toBe(8); // last clip visible
  });

  it("does not scroll when composition has fewer clips than gridWidth", () => {
    const vp = sized(makeVp(4, 2), 4, 3);
    vp.scrollClips(1);
    expect(vp.currentClipOffset).toBe(0); // max = max(0, 3-4) = 0
  });

  it("emits changed when offset moves", () => {
    const vp = sized(makeVp(4, 2), 4, 16);
    const spy = vi.fn();
    vp.on("changed", spy);
    vp.scrollClips(1);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("does NOT emit changed when already at boundary", () => {
    const vp = sized(makeVp(4, 2), 4, 16);
    const spy = vi.fn();
    vp.on("changed", spy);
    vp.scrollClips(-1); // already at 0
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits changed exactly once per boundary hit, not repeatedly", () => {
    const vp = sized(makeVp(4, 2), 4, 8);
    const spy = vi.fn();
    vp.on("changed", spy);
    vp.scrollClips(99); // clamp to max 4
    vp.scrollClips(99); // already at max, no change
    vp.scrollClips(99);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ── scrollLayers ──────────────────────────────────────────────────────────────

describe("scrollLayers", () => {
  it("advances layerOffset by ticks", () => {
    const vp = sized(makeVp(4, 2), 8, 8);
    vp.scrollLayers(2);
    expect(vp.currentLayerOffset).toBe(2);
  });

  it("clamps to 0 on negative scroll from origin", () => {
    const vp = sized(makeVp(4, 2), 8, 8);
    vp.scrollLayers(-5);
    expect(vp.currentLayerOffset).toBe(0);
  });

  it("clamps at max (totalLayers - gridHeight)", () => {
    const vp = sized(makeVp(4, 2), 6, 8);
    vp.scrollLayers(99);
    // max = 6 - 2 = 4
    expect(vp.currentLayerOffset).toBe(4);
  });

  it("does not scroll when composition has fewer layers than gridHeight", () => {
    const vp = sized(makeVp(4, 2), 1, 8);
    vp.scrollLayers(1);
    expect(vp.currentLayerOffset).toBe(0);
  });

  it("emits changed when offset moves", () => {
    const vp = sized(makeVp(4, 2), 8, 8);
    const spy = vi.fn();
    vp.on("changed", spy);
    vp.scrollLayers(1);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("does NOT emit changed at boundary", () => {
    const vp = sized(makeVp(4, 2), 8, 8);
    const spy = vi.fn();
    vp.on("changed", spy);
    vp.scrollLayers(-1);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── setCompositionSize ────────────────────────────────────────────────────────

describe("setCompositionSize", () => {
  it("updates bounds used by clamping", () => {
    const vp = makeVp(4, 2);
    vp.setCompositionSize(10, 20);
    vp.scrollLayers(9);
    expect(vp.currentLayerOffset).toBe(8); // max = 10-2
  });

  it("re-clamps layerOffset when composition shrinks", () => {
    const vp = sized(makeVp(4, 2), 10, 20);
    vp.scrollLayers(8); // offset = 8
    vp.setCompositionSize(4, 20); // max now = 4-2 = 2
    expect(vp.currentLayerOffset).toBe(2);
  });

  it("re-clamps clipOffset when composition shrinks", () => {
    const vp = sized(makeVp(4, 2), 10, 20);
    vp.scrollClips(12); // offset = 12
    vp.setCompositionSize(10, 6); // max now = 6-4 = 2
    expect(vp.currentClipOffset).toBe(2);
  });

  it("allows 0,0 size (empty composition)", () => {
    const vp = sized(makeVp(4, 2), 8, 8);
    vp.scrollLayers(3);
    vp.setCompositionSize(0, 0);
    expect(vp.currentLayerOffset).toBe(0);
    expect(vp.currentClipOffset).toBe(0);
  });
});

// ── layerForButton / clipForButton ────────────────────────────────────────────

describe("layerForButton", () => {
  it("returns 1-based layer for button in first row", () => {
    const vp = sized(makeVp(4, 2), 8, 16);
    expect(vp.layerForButton(0)).toBe(1);
    expect(vp.layerForButton(3)).toBe(1);
  });

  it("returns correct layer for second row", () => {
    const vp = sized(makeVp(4, 2), 8, 16);
    expect(vp.layerForButton(4)).toBe(2);
    expect(vp.layerForButton(7)).toBe(2);
  });

  it("accounts for layerOffset", () => {
    const vp = sized(makeVp(4, 2), 8, 16);
    vp.scrollLayers(3);
    expect(vp.layerForButton(0)).toBe(4);
    expect(vp.layerForButton(4)).toBe(5);
  });

  it("returns null when layer exceeds totalLayers", () => {
    const vp = sized(makeVp(4, 3), 2, 16); // only 2 layers, grid is 3 tall
    expect(vp.layerForButton(0)).toBe(1);
    expect(vp.layerForButton(4)).toBe(2);
    expect(vp.layerForButton(8)).toBeNull(); // row 2 = layer 3, out of bounds
  });
});

describe("clipForButton", () => {
  it("returns 1-based clip for first column", () => {
    const vp = sized(makeVp(4, 2), 8, 16);
    expect(vp.clipForButton(0)).toBe(1);
    expect(vp.clipForButton(4)).toBe(1);
  });

  it("returns correct clip for each column", () => {
    const vp = sized(makeVp(4, 2), 8, 16);
    expect(vp.clipForButton(2)).toBe(3);
    expect(vp.clipForButton(6)).toBe(3); // second row same column
  });

  it("accounts for clipOffset", () => {
    const vp = sized(makeVp(4, 2), 8, 16);
    vp.scrollClips(4);
    expect(vp.clipForButton(0)).toBe(5);
    expect(vp.clipForButton(3)).toBe(8);
  });

  it("returns null when clip exceeds totalClips", () => {
    const vp = sized(makeVp(4, 2), 8, 3); // only 3 clips, grid is 4 wide
    expect(vp.clipForButton(0)).toBe(1);
    expect(vp.clipForButton(2)).toBe(3);
    expect(vp.clipForButton(3)).toBeNull(); // column 3 = clip 4, out of bounds
  });
});
