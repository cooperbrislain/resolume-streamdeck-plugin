import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { KnobHandler } from "../knob-handler.js";
import type { ResolumeClient } from "../resolume-client.js";
import type { DashboardParam } from "../types.js";

// ── stubs ─────────────────────────────────────────────────────────────────────

class MockClient extends EventEmitter {
  setParameterById = vi.fn();
  resetParameterById = vi.fn();
}

function makeClient() {
  return new MockClient() as unknown as ResolumeClient & MockClient;
}

function makeParam(overrides: Partial<DashboardParam> = {}): DashboardParam {
  return { id: 42, name: "Link 1", min: 0, max: 1, value: 0.5, ...overrides };
}

function make(param: DashboardParam | null = makeParam()) {
  const client = makeClient();
  const handler = new KnobHandler(client as unknown as ResolumeClient);
  handler.assignDial(0, param);
  return { client, handler };
}

// ── assignDial ────────────────────────────────────────────────────────────────

describe("assignDial", () => {
  it("assigns a param to a dial", async () => {
    const { client, handler } = make(makeParam({ id: 7, value: 0.2 }));
    await handler.onDialRotate(0, 1);
    expect((client as unknown as MockClient).setParameterById).toHaveBeenCalledWith(7, expect.any(Number));
  });

  it("unassigns a dial when null is passed", async () => {
    const { client, handler } = make();
    handler.assignDial(0, null);
    await handler.onDialRotate(0, 1);
    expect((client as unknown as MockClient).setParameterById).not.toHaveBeenCalled();
  });

  it("can assign different dials independently", async () => {
    const client = makeClient();
    const handler = new KnobHandler(client as unknown as ResolumeClient);
    handler.assignDial(0, makeParam({ id: 10, value: 0.5 }));
    handler.assignDial(2, makeParam({ id: 20, value: 0.5 }));

    await handler.onDialRotate(0, 1);
    expect((client as unknown as MockClient).setParameterById).toHaveBeenCalledWith(10, expect.any(Number));

    (client as unknown as MockClient).setParameterById.mockClear();

    await handler.onDialRotate(2, 1);
    expect((client as unknown as MockClient).setParameterById).toHaveBeenCalledWith(20, expect.any(Number));
  });
});

// ── onDialRotate ──────────────────────────────────────────────────────────────

describe("onDialRotate", () => {
  it("moves value by 1/20th of range per tick", async () => {
    const { client, handler } = make(makeParam({ min: 0, max: 1, value: 0.5 }));
    await handler.onDialRotate(0, 1);
    expect((client as unknown as MockClient).setParameterById).toHaveBeenCalledWith(42, 0.55);
  });

  it("moves negative for negative ticks", async () => {
    const { client, handler } = make(makeParam({ min: 0, max: 1, value: 0.5 }));
    await handler.onDialRotate(0, -1);
    expect((client as unknown as MockClient).setParameterById).toHaveBeenCalledWith(42, 0.45);
  });

  it("scales by tick count", async () => {
    const { client, handler } = make(makeParam({ min: 0, max: 1, value: 0.5 }));
    await handler.onDialRotate(0, 3);
    expect((client as unknown as MockClient).setParameterById).toHaveBeenCalledWith(42, 0.65);
  });

  it("clamps at max", async () => {
    const { client, handler } = make(makeParam({ min: 0, max: 1, value: 0.99 }));
    await handler.onDialRotate(0, 5);
    const val = (client as unknown as MockClient).setParameterById.mock.calls[0][1] as number;
    expect(val).toBeLessThanOrEqual(1);
  });

  it("clamps at min", async () => {
    const { client, handler } = make(makeParam({ min: 0, max: 1, value: 0.01 }));
    await handler.onDialRotate(0, -5);
    const val = (client as unknown as MockClient).setParameterById.mock.calls[0][1] as number;
    expect(val).toBeGreaterThanOrEqual(0);
  });

  it("uses custom min/max range for step size", async () => {
    // range 0–100, step = 5 per tick
    const { client, handler } = make(makeParam({ min: 0, max: 100, value: 50 }));
    await handler.onDialRotate(0, 1);
    expect((client as unknown as MockClient).setParameterById).toHaveBeenCalledWith(42, 55);
  });

  it("no-op on unassigned dial", async () => {
    const { client, handler } = make(null);
    await handler.onDialRotate(0, 1);
    expect((client as unknown as MockClient).setParameterById).not.toHaveBeenCalled();
  });

  it("no-op on unrelated dial index", async () => {
    const { client, handler } = make(); // dial 0 assigned
    await handler.onDialRotate(3, 1);
    expect((client as unknown as MockClient).setParameterById).not.toHaveBeenCalled();
  });
});

// ── onDialPress ───────────────────────────────────────────────────────────────

describe("onDialPress", () => {
  it("calls resetParameterById with the assigned param id", async () => {
    const { client, handler } = make(makeParam({ id: 42 }));
    await handler.onDialPress(0);
    expect((client as unknown as MockClient).resetParameterById).toHaveBeenCalledWith(42);
  });

  it("no-op on unassigned dial", async () => {
    const { client, handler } = make(null);
    await handler.onDialPress(0);
    expect((client as unknown as MockClient).resetParameterById).not.toHaveBeenCalled();
  });

  it("no-op on unrelated dial index", async () => {
    const { client, handler } = make(); // dial 0 assigned
    await handler.onDialPress(2);
    expect((client as unknown as MockClient).resetParameterById).not.toHaveBeenCalled();
  });
});

// ── paramUpdate live sync ─────────────────────────────────────────────────────

describe("paramUpdate event sync", () => {
  it("updates cached value when client emits paramUpdate for assigned param", async () => {
    const client = makeClient();
    const handler = new KnobHandler(client as unknown as ResolumeClient);
    handler.assignDial(0, makeParam({ id: 42, min: 0, max: 1, value: 0.5 }));

    // Simulate Resolume pushing a new value
    (client as unknown as EventEmitter).emit("paramUpdate", { id: 42, value: 0.8 });

    await handler.onDialRotate(0, 1); // should start from 0.8 now
    const val = (client as unknown as MockClient).setParameterById.mock.calls[0][1] as number;
    expect(val).toBeCloseTo(0.85, 5);
  });

  it("ignores paramUpdate for a different param id", async () => {
    const client = makeClient();
    const handler = new KnobHandler(client as unknown as ResolumeClient);
    handler.assignDial(0, makeParam({ id: 42, min: 0, max: 1, value: 0.5 }));

    (client as unknown as EventEmitter).emit("paramUpdate", { id: 99, value: 0.0 });

    await handler.onDialRotate(0, 1); // should still start from 0.5
    expect((client as unknown as MockClient).setParameterById).toHaveBeenCalledWith(42, 0.55);
  });
});
