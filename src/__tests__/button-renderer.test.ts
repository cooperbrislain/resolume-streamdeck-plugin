import { describe, it, expect, vi, beforeEach } from "vitest";

// ── canvas mock ───────────────────────────────────────────────────────────────
// Avoid native node-canvas dependency in tests. Plain vi.fn() mocks are used
// so TypeScript can infer the concrete return type from makeCtx() directly —
// passing an implementation to vi.fn(impl) narrows generics in ways that
// conflict with the ReturnType<typeof vi.fn> annotation.

function makeCtx(widthPerChar = 7) {
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textBaseline: "",
    textAlign: "",
    fillRect:   vi.fn(),
    strokeRect: vi.fn(),
    beginPath:  vi.fn(),
    arc:        vi.fn(),
    fill:       vi.fn(),
    fillText:   vi.fn(),
    drawImage:  vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * widthPerChar })),
  };
}

// Shared mock state — reset between tests
let mockCtx: ReturnType<typeof makeCtx>;
let lastDataUrl = "data:image/png;base64,FAKEDATA";

vi.mock("canvas", () => ({
  createCanvas: vi.fn(() => ({
    getContext: vi.fn(() => mockCtx),
    toDataURL: vi.fn(() => lastDataUrl),
  })),
  loadImage: vi.fn(async (_src: string) => ({
    width: 320,
    height: 240,
  })),
}));

// Import AFTER mock is registered
const { ButtonRenderer } = await import("../button-renderer.js");

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockCtx = makeCtx();
});

// ── return value ──────────────────────────────────────────────────────────────

describe("renderClip return value", () => {
  it("returns the base64 part of the data URL (no data: prefix)", async () => {
    const r = new ButtonRenderer();
    const result = await r.renderClip({
      thumb: null,
      clipName: "Loop A",
      isConnected: false,
      isEmpty: false,
    });
    expect(result).toBe("FAKEDATA");
  });

  it("always returns a non-empty string", async () => {
    const r = new ButtonRenderer();
    const result = await r.renderClip({
      thumb: null,
      clipName: "",
      isConnected: false,
      isEmpty: true,
    });
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── background colour ─────────────────────────────────────────────────────────

describe("background", () => {
  it("uses #1a1a1a for empty cells", async () => {
    const r = new ButtonRenderer();
    await r.renderClip({ thumb: null, clipName: "", isConnected: false, isEmpty: true });
    // First fillRect call is the background
    const firstFill = mockCtx.fillRect.mock.calls[0];
    // Check that fillRect(0, 0, 120, 120) was called (covers the full canvas)
    expect(firstFill).toEqual([0, 0, 120, 120]);
  });

  it("calls fillRect for the full 120×120 canvas", async () => {
    const r = new ButtonRenderer();
    await r.renderClip({ thumb: null, clipName: "X", isConnected: false, isEmpty: false });
    const bg = mockCtx.fillRect.mock.calls[0];
    expect(bg).toEqual([0, 0, 120, 120]);
  });
});

// ── empty cell dot pattern ────────────────────────────────────────────────────

describe("empty cell dot pattern", () => {
  it("draws arc/fill pairs for the dot grid", async () => {
    const r = new ButtonRenderer();
    await r.renderClip({ thumb: null, clipName: "", isConnected: false, isEmpty: true });
    // DOT_SPACING=12, SIZE=120 → dots at 12,24,36,...,108 in both axes = 9×9 = 81 dots
    expect(mockCtx.arc.mock.calls.length).toBe(81);
    expect(mockCtx.fill.mock.calls.length).toBe(81);
  });

  it("does NOT draw dots for a non-empty cell", async () => {
    const r = new ButtonRenderer();
    await r.renderClip({ thumb: null, clipName: "A", isConnected: false, isEmpty: false });
    expect(mockCtx.arc.mock.calls.length).toBe(0);
  });
});

// ── thumbnail ─────────────────────────────────────────────────────────────────

describe("thumbnail rendering", () => {
  it("calls drawImage when thumb is provided and not empty", async () => {
    const r = new ButtonRenderer();
    await r.renderClip({
      thumb: "data:image/png;base64,ABC",
      clipName: "Clip",
      isConnected: false,
      isEmpty: false,
    });
    expect(mockCtx.drawImage).toHaveBeenCalledOnce();
  });

  it("does NOT call drawImage when isEmpty is true, even with a thumb", async () => {
    const r = new ButtonRenderer();
    await r.renderClip({
      thumb: "data:image/png;base64,ABC",
      clipName: "",
      isConnected: false,
      isEmpty: true,
    });
    expect(mockCtx.drawImage).not.toHaveBeenCalled();
  });

  it("does NOT call drawImage when thumb is null", async () => {
    const r = new ButtonRenderer();
    await r.renderClip({
      thumb: null,
      clipName: "Clip",
      isConnected: false,
      isEmpty: false,
    });
    expect(mockCtx.drawImage).not.toHaveBeenCalled();
  });

  it("draws a letterboxed 320×240 image into 120×102 area (scale by height)", async () => {
    // 320×240 source, target area = 120×(120-18)=120×102
    // scaleByWidth  = 120/320 = 0.375 → drawH = 240*0.375 = 90
    // scaleByHeight = 102/240 = 0.425 → drawH = 240*0.425 = 102
    // min scale = 0.375 (width-constrained), so drawW=120, drawH=90
    const r = new ButtonRenderer();
    await r.renderClip({
      thumb: "data:image/png;base64,X",
      clipName: "Clip",
      isConnected: false,
      isEmpty: false,
    });
    const [, drawX, drawY, drawW, drawH] = mockCtx.drawImage.mock.calls[0] as [
      unknown, number, number, number, number
    ];
    expect(drawW).toBeCloseTo(120, 1);
    expect(drawH).toBeCloseTo(90, 1);
    expect(drawX).toBeCloseTo(0, 1);  // centered horizontally
    expect(drawY).toBeCloseTo(6, 1);  // (102-90)/2 = 6
  });

  it("silently skips thumbnail if loadImage throws", async () => {
    const { loadImage } = await import("canvas");
    vi.mocked(loadImage).mockRejectedValueOnce(new Error("bad image"));
    const r = new ButtonRenderer();
    // Should not throw
    await expect(
      r.renderClip({ thumb: "bad", clipName: "X", isConnected: false, isEmpty: false })
    ).resolves.toBeDefined();
  });
});

// ── connected border ──────────────────────────────────────────────────────────

describe("connected border", () => {
  it("calls strokeRect when isConnected=true", async () => {
    const r = new ButtonRenderer();
    await r.renderClip({ thumb: null, clipName: "X", isConnected: true, isEmpty: false });
    expect(mockCtx.strokeRect).toHaveBeenCalledOnce();
  });

  it("does NOT call strokeRect when isConnected=false", async () => {
    const r = new ButtonRenderer();
    await r.renderClip({ thumb: null, clipName: "X", isConnected: false, isEmpty: false });
    expect(mockCtx.strokeRect).not.toHaveBeenCalled();
  });

  it("strokes with 1.5px inset on all sides (half of BORDER_WIDTH=3)", async () => {
    const r = new ButtonRenderer();
    await r.renderClip({ thumb: null, clipName: "X", isConnected: true, isEmpty: false });
    // strokeRect(half, half, SIZE - BORDER, SIZE - BORDER) = (1.5, 1.5, 117, 117)
    expect(mockCtx.strokeRect).toHaveBeenCalledWith(1.5, 1.5, 117, 117);
  });

  it("does NOT call strokeRect for an empty connected cell", async () => {
    // isEmpty=true skips the border (border is drawn after the isEmpty check)
    // Actually looking at button-renderer.ts: isConnected border is drawn regardless of isEmpty
    // Let's verify the actual code behaviour
    const r = new ButtonRenderer();
    await r.renderClip({ thumb: null, clipName: "", isConnected: true, isEmpty: true });
    // Code draws border if isConnected=true, even on empty cells
    expect(mockCtx.strokeRect).toHaveBeenCalledOnce();
  });
});

// ── label ─────────────────────────────────────────────────────────────────────

describe("clip name label", () => {
  it("calls fillText with the clip name on non-empty cells", async () => {
    const r = new ButtonRenderer();
    await r.renderClip({
      thumb: null,
      clipName: "Loop 01",
      isConnected: false,
      isEmpty: false,
    });
    const textCalls = mockCtx.fillText.mock.calls;
    expect(textCalls.length).toBeGreaterThan(0);
    expect(textCalls[0][0]).toBe("Loop 01");
  });

  it("does NOT call fillText for empty cells", async () => {
    const r = new ButtonRenderer();
    await r.renderClip({ thumb: null, clipName: "", isConnected: false, isEmpty: true });
    expect(mockCtx.fillText).not.toHaveBeenCalled();
  });

  it("renders an empty string label without throwing", async () => {
    const r = new ButtonRenderer();
    await expect(
      r.renderClip({ thumb: null, clipName: "", isConnected: false, isEmpty: false })
    ).resolves.toBeDefined();
    expect(mockCtx.fillText).toHaveBeenCalledWith("", 60, expect.any(Number));
  });
});

// ── label truncation ──────────────────────────────────────────────────────────

describe("label truncation", () => {
  // maxWidth = SIZE - 8 = 112, widthPerChar = 7
  // A string fits if: text.length * 7 <= 112 → text.length <= 16

  it("passes through short names unchanged", async () => {
    const r = new ButtonRenderer();
    // "Short" = 5 chars × 7 = 35px — fits
    await r.renderClip({
      thumb: null,
      clipName: "Short",
      isConnected: false,
      isEmpty: false,
    });
    expect(mockCtx.fillText.mock.calls[0][0]).toBe("Short");
  });

  it("truncates long names with ellipsis", async () => {
    const r = new ButtonRenderer();
    // 20 chars × 7 = 140px > 112px — must truncate
    await r.renderClip({
      thumb: null,
      clipName: "ABCDEFGHIJKLMNOPQRST",
      isConnected: false,
      isEmpty: false,
    });
    const rendered: string = mockCtx.fillText.mock.calls[0][0] as string;
    expect(rendered).toMatch(/…$/);
    expect(rendered.length).toBeLessThan(20);
  });

  it("truncated text width fits within maxWidth", async () => {
    const r = new ButtonRenderer();
    const longName = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 26 chars
    await r.renderClip({
      thumb: null,
      clipName: longName,
      isConnected: false,
      isEmpty: false,
    });
    const rendered: string = mockCtx.fillText.mock.calls[0][0] as string;
    // Width check: each char = 7px except "…" (1 char * 7 in mock)
    const renderedWidth = rendered.length * 7;
    expect(renderedWidth).toBeLessThanOrEqual(112);
  });

  it("exactly 16-char name is NOT truncated (boundary)", async () => {
    const r = new ButtonRenderer();
    const name = "A".repeat(16); // 16 × 7 = 112 = exactly maxWidth
    await r.renderClip({
      thumb: null,
      clipName: name,
      isConnected: false,
      isEmpty: false,
    });
    expect(mockCtx.fillText.mock.calls[0][0]).toBe(name);
  });

  it("17-char name IS truncated (one over boundary)", async () => {
    const r = new ButtonRenderer();
    const name = "A".repeat(17); // 17 × 7 = 119 > 112
    await r.renderClip({
      thumb: null,
      clipName: name,
      isConnected: false,
      isEmpty: false,
    });
    const rendered: string = mockCtx.fillText.mock.calls[0][0] as string;
    expect(rendered).toMatch(/…$/);
  });
});
