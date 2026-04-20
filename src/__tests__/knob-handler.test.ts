import { describe, it, expect, vi, beforeEach } from "vitest";
import { KnobHandler } from "../knob-handler.js";
import type { Viewport } from "../viewport.js";
import type { ResolumeClient } from "../resolume-client.js";

// ── stubs ─────────────────────────────────────────────────────────────────────

function makeViewport(): Pick<Viewport, "scrollClips" | "scrollLayers"> {
  return {
    scrollClips: vi.fn(),
    scrollLayers: vi.fn(),
  };
}

function makeClient(
  currentOpacity = 0.8
): Pick<ResolumeClient, "getLayerOpacity" | "setLayerOpacity"> {
  return {
    getLayerOpacity: vi.fn().mockResolvedValue(currentOpacity),
    setLayerOpacity: vi.fn().mockResolvedValue(undefined),
  };
}

function make(opacity = 0.8) {
  const viewport = makeViewport();
  const client = makeClient(opacity);
  const handler = new KnobHandler(
    viewport as unknown as Viewport,
    client as unknown as ResolumeClient
  );
  return { viewport, client, handler };
}

// ── dial 0 — scroll clips ─────────────────────────────────────────────────────

describe("onDialRotate: dial 0 (scrollClips)", () => {
  it("calls viewport.scrollClips with ticks value", async () => {
    const { viewport, handler } = make();
    await handler.onDialRotate(0, 3);
    expect(viewport.scrollClips).toHaveBeenCalledWith(3);
  });

  it("passes negative ticks for reverse scroll", async () => {
    const { viewport, handler } = make();
    await handler.onDialRotate(0, -2);
    expect(viewport.scrollClips).toHaveBeenCalledWith(-2);
  });

  it("does not touch scrollLayers", async () => {
    const { viewport, handler } = make();
    await handler.onDialRotate(0, 1);
    expect(viewport.scrollLayers).not.toHaveBeenCalled();
  });

  it("does not touch client when dial 0 rotates", async () => {
    const { client, handler } = make();
    await handler.onDialRotate(0, 1);
    expect(client.getLayerOpacity).not.toHaveBeenCalled();
    expect(client.setLayerOpacity).not.toHaveBeenCalled();
  });
});

// ── dial 1 — scroll layers ────────────────────────────────────────────────────

describe("onDialRotate: dial 1 (scrollLayers)", () => {
  it("calls viewport.scrollLayers with ticks value", async () => {
    const { viewport, handler } = make();
    await handler.onDialRotate(1, 2);
    expect(viewport.scrollLayers).toHaveBeenCalledWith(2);
  });

  it("passes negative ticks for reverse scroll", async () => {
    const { viewport, handler } = make();
    await handler.onDialRotate(1, -1);
    expect(viewport.scrollLayers).toHaveBeenCalledWith(-1);
  });

  it("does not touch scrollClips", async () => {
    const { viewport, handler } = make();
    await handler.onDialRotate(1, 1);
    expect(viewport.scrollClips).not.toHaveBeenCalled();
  });

  it("does not touch client when dial 1 rotates", async () => {
    const { client, handler } = make();
    await handler.onDialRotate(1, 1);
    expect(client.setLayerOpacity).not.toHaveBeenCalled();
  });
});

// ── dial 2 — opacity ──────────────────────────────────────────────────────────

describe("onDialRotate: dial 2 (opacity)", () => {
  it("reads current opacity then sets opacity +5% per tick", async () => {
    const { client, handler } = make(0.5);
    await handler.onDialRotate(2, 1);
    expect(client.getLayerOpacity).toHaveBeenCalledWith(1); // default target layer
    expect(client.setLayerOpacity).toHaveBeenCalledWith(1, 0.55);
  });

  it("applies negative delta for reverse rotation", async () => {
    const { client, handler } = make(0.5);
    await handler.onDialRotate(2, -1);
    expect(client.setLayerOpacity).toHaveBeenCalledWith(1, 0.45);
  });

  it("scales delta by tick count (2 ticks = +10%)", async () => {
    const { client, handler } = make(0.4);
    await handler.onDialRotate(2, 2);
    expect(client.setLayerOpacity).toHaveBeenCalledWith(1, 0.5);
  });

  it("uses the opacity target layer set by setOpacityTargetLayer", async () => {
    const { client, handler } = make(0.7);
    handler.setOpacityTargetLayer(4);
    await handler.onDialRotate(2, 1);
    expect(client.getLayerOpacity).toHaveBeenCalledWith(4);
    expect(client.setLayerOpacity).toHaveBeenCalledWith(4, expect.any(Number));
  });

  it("swallows errors from client without throwing", async () => {
    const { client, handler } = make();
    vi.mocked(client.getLayerOpacity).mockRejectedValueOnce(new Error("network"));
    await expect(handler.onDialRotate(2, 1)).resolves.toBeUndefined();
  });

  it("does not touch viewport scroll methods", async () => {
    const { viewport, handler } = make();
    await handler.onDialRotate(2, 1);
    expect(viewport.scrollClips).not.toHaveBeenCalled();
    expect(viewport.scrollLayers).not.toHaveBeenCalled();
  });
});

// ── dial 3 — reserved ────────────────────────────────────────────────────────

describe("onDialRotate: dial 3 (reserved)", () => {
  it("does not throw", async () => {
    const { handler } = make();
    await expect(handler.onDialRotate(3, 5)).resolves.toBeUndefined();
  });

  it("does not call any viewport or client methods", async () => {
    const { viewport, client, handler } = make();
    await handler.onDialRotate(3, 1);
    expect(viewport.scrollClips).not.toHaveBeenCalled();
    expect(viewport.scrollLayers).not.toHaveBeenCalled();
    expect(client.setLayerOpacity).not.toHaveBeenCalled();
    expect(client.getLayerOpacity).not.toHaveBeenCalled();
  });
});

// ── onDialPress ───────────────────────────────────────────────────────────────

describe("onDialPress: dial 2 (reset opacity)", () => {
  it("resets opacity to 1.0 on the target layer", async () => {
    const { client, handler } = make();
    await handler.onDialPress(2);
    expect(client.setLayerOpacity).toHaveBeenCalledWith(1, 1.0);
  });

  it("resets opacity on the custom target layer", async () => {
    const { client, handler } = make();
    handler.setOpacityTargetLayer(3);
    await handler.onDialPress(2);
    expect(client.setLayerOpacity).toHaveBeenCalledWith(3, 1.0);
  });

  it("swallows errors from client without throwing", async () => {
    const { client, handler } = make();
    vi.mocked(client.setLayerOpacity).mockRejectedValueOnce(new Error("fail"));
    await expect(handler.onDialPress(2)).resolves.toBeUndefined();
  });
});

describe("onDialPress: other dials (no-op)", () => {
  it.each([0, 1, 3])("dial %i press does not throw", async (dial) => {
    const { handler } = make();
    await expect(handler.onDialPress(dial)).resolves.toBeUndefined();
  });

  it.each([0, 1, 3])("dial %i press does not call setLayerOpacity", async (dial) => {
    const { client, handler } = make();
    await handler.onDialPress(dial);
    expect(client.setLayerOpacity).not.toHaveBeenCalled();
  });
});

// ── setOpacityTargetLayer ─────────────────────────────────────────────────────

describe("setOpacityTargetLayer", () => {
  it("defaults to layer 1", async () => {
    const { client, handler } = make();
    await handler.onDialPress(2);
    expect(client.setLayerOpacity).toHaveBeenCalledWith(1, 1.0);
  });

  it("can be updated multiple times", async () => {
    const { client, handler } = make();
    handler.setOpacityTargetLayer(2);
    handler.setOpacityTargetLayer(5);
    await handler.onDialPress(2);
    expect(client.setLayerOpacity).toHaveBeenCalledWith(5, 1.0);
  });
});
