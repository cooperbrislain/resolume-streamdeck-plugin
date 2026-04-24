import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import { EventEmitter } from "events";

// ── WebSocket mock ────────────────────────────────────────────────────────────
// Must be declared BEFORE the module import below so the factory closure captures it.

const wsInstances: MockWs[] = [];

class MockWs extends EventEmitter {
  static instances = wsInstances;
  readonly url: string;
  close = vi.fn(() => {
    this.emit("close");
  });
  send = vi.fn();

  constructor(url: string) {
    super();
    this.url = url;
    wsInstances.push(this);
  }

  // Test helper: simulate a successful open
  open() {
    this.emit("open");
  }

  // Test helper: simulate server message
  message(payload: object) {
    this.emit("message", JSON.stringify(payload));
  }

  // Test helper: simulate disconnection without re-emitting close from close()
  drop() {
    this.emit("close");
  }
}

vi.mock("ws", () => ({ default: MockWs }));

// ── Import AFTER mock registration ────────────────────────────────────────────

const { ResolumeClient } = await import("../resolume-client.js");

// ── fetch mock ────────────────────────────────────────────────────────────────

function mockOkJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function mockOkBuffer(bytes: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    json: async () => { throw new Error("not JSON"); },
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  } as unknown as Response;
}

function mockError(status = 500): Response {
  return { ok: false, status } as unknown as Response;
}

// ── test setup ────────────────────────────────────────────────────────────────

let fetchMock: MockInstance;

beforeEach(() => {
  wsInstances.length = 0;
  fetchMock = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── WebSocket lifecycle ───────────────────────────────────────────────────────

describe("WebSocket connection", () => {
  it("connects to the correct WebSocket URL", () => {
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    client.connect();
    expect(wsInstances[0].url).toBe("ws://localhost:8080/api/v1");
  });

  it("emits connectionChange(true) on open", () => {
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    const spy = vi.fn();
    client.on("connectionChange", spy);
    client.connect();
    wsInstances[0].open();
    expect(spy).toHaveBeenCalledWith(true);
  });

  it("emits connectionChange(false) on close", () => {
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    const spy = vi.fn();
    client.on("connectionChange", spy);
    client.connect();
    wsInstances[0].open();
    wsInstances[0].drop();
    expect(spy).toHaveBeenLastCalledWith(false);
  });

  it("does not open a socket after destroy()", () => {
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    client.destroy();
    client.connect();
    expect(wsInstances).toHaveLength(0);
  });

  it("destroy() clears the reconnect timer so no further sockets open", () => {
    vi.useFakeTimers();
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    client.connect();
    wsInstances[0].drop(); // triggers reconnect timer
    client.destroy();
    vi.advanceTimersByTime(60_000);
    expect(wsInstances).toHaveLength(1); // only the original socket
  });
});

// ── Reconnect / exponential backoff ──────────────────────────────────────────

describe("reconnect backoff", () => {
  it("reconnects after 1 s on first disconnect", () => {
    vi.useFakeTimers();
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    client.connect();
    wsInstances[0].open();
    wsInstances[0].drop();

    expect(wsInstances).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(wsInstances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(wsInstances).toHaveLength(2);
  });

  it("doubles delay on each subsequent disconnect", () => {
    vi.useFakeTimers();
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    client.connect();

    const expectedDelays = [1000, 2000, 4000, 8000];
    for (let i = 0; i < expectedDelays.length; i++) {
      wsInstances[i].open();
      wsInstances[i].drop();
      vi.advanceTimersByTime(expectedDelays[i]);
      expect(wsInstances).toHaveLength(i + 2);
    }
  });

  it("caps backoff at 30 s", () => {
    vi.useFakeTimers();
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    client.connect();

    // Burn through delays: 1s,2s,4s,8s,16s,32s→capped at 30s
    const delays = [1000, 2000, 4000, 8000, 16000, 30000 /*capped*/];
    for (let i = 0; i < delays.length; i++) {
      wsInstances[i].drop();
      vi.advanceTimersByTime(delays[i]);
    }
    // At this point delays should be capped, confirm no socket after 29 s
    const countBefore = wsInstances.length;
    wsInstances[wsInstances.length - 1].drop();
    vi.advanceTimersByTime(29_999);
    expect(wsInstances.length).toBe(countBefore); // not yet
    vi.advanceTimersByTime(1);
    expect(wsInstances.length).toBe(countBefore + 1); // now
  });

  it("resets delay to 1 s after a successful open", () => {
    vi.useFakeTimers();
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    client.connect();

    // Burn a few cycles to inflate the delay
    wsInstances[0].drop();
    vi.advanceTimersByTime(1000);
    wsInstances[1].drop();
    vi.advanceTimersByTime(2000);

    // Now successfully connect and immediately drop
    wsInstances[2].open(); // resets delay to 1000
    wsInstances[2].drop();

    // Should reconnect after 1 s, not 4 s
    vi.advanceTimersByTime(999);
    expect(wsInstances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(wsInstances).toHaveLength(4);
  });
});

// ── WebSocket event parsing ───────────────────────────────────────────────────

// Helper: build a minimal mock composition with known param IDs.
function makeComposition(
  layers: Array<Array<{ connectedId: number; thumbnailId: number }>>
) {
  return {
    layers: layers.map((clips) => ({
      id: 0,
      name: { value: "Layer" },
      clips: clips.map(({ connectedId, thumbnailId }) => ({
        id: 0,
        name: { value: "Clip" },
        connected: { value: "Disconnected" as const, id: connectedId },
        thumbnail: { id: thumbnailId, path: "/api/v1/composition/thumbnail/dummy" },
      })),
    })),
  };
}

describe("WebSocket event: thumbnailDirty", () => {
  function connectedClient() {
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    client.connect();
    wsInstances[0].open();
    return client;
  }

  it("emits thumbnailDirty with correct layer+clip", () => {
    const client = connectedClient();
    // layer 3, clip 7 → thumbnailId=1001
    const comp = makeComposition([
      Array.from({ length: 7 }, (_, i) =>
        i === 6
          ? { connectedId: 2000, thumbnailId: 1001 }
          : { connectedId: 9000 + i, thumbnailId: 9100 + i }
      ),
      [],
      Array.from({ length: 7 }, (_, i) =>
        i === 6
          ? { connectedId: 3000, thumbnailId: 1001 }
          : { connectedId: 8000 + i, thumbnailId: 8100 + i }
      ),
    ]);
    // Use layer index 2 (3rd layer, 1-based = 3), clip index 6 (7th, 1-based = 7)
    const simpleComp = makeComposition([
      [{ connectedId: 9001, thumbnailId: 9101 }],
      [{ connectedId: 9002, thumbnailId: 9102 }],
      [
        { connectedId: 9003, thumbnailId: 9103 },
        { connectedId: 9004, thumbnailId: 9104 },
        { connectedId: 9005, thumbnailId: 9105 },
        { connectedId: 9006, thumbnailId: 9106 },
        { connectedId: 9007, thumbnailId: 9107 },
        { connectedId: 9008, thumbnailId: 9108 },
        { connectedId: 9009, thumbnailId: 1001 }, // layer 3, clip 7
      ],
    ]);
    client.indexComposition(simpleComp);

    const spy = vi.fn();
    client.on("thumbnailDirty", spy);
    wsInstances[0].message({ type: "parameter_update", id: 1001, value: "new" });
    expect(spy).toHaveBeenCalledWith({ layer: 3, clip: 7 });
  });

  it("does not emit thumbnailDirty for unregistered param IDs", () => {
    const client = connectedClient();
    const comp = makeComposition([[{ connectedId: 100, thumbnailId: 200 }]]);
    client.indexComposition(comp);

    const spy = vi.fn();
    client.on("thumbnailDirty", spy);
    wsInstances[0].message({ type: "parameter_update", id: 999, value: "new" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("ignores malformed JSON without throwing", () => {
    connectedClient();
    expect(() => {
      wsInstances[0].emit("message", "not json{{");
    }).not.toThrow();
  });
});

describe("WebSocket event: clipConnected", () => {
  function connectedClient() {
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    client.connect();
    wsInstances[0].open();
    // layer 1 clip 1 → connectedId=101, thumbnailId=201
    // layer 2 clip 5 → connectedId=205, thumbnailId=305
    // layer 4 clip 2 → connectedId=402, thumbnailId=502
    const comp = makeComposition([
      [{ connectedId: 101, thumbnailId: 201 }],
      [
        { connectedId: 9001, thumbnailId: 9001 },
        { connectedId: 9002, thumbnailId: 9002 },
        { connectedId: 9003, thumbnailId: 9003 },
        { connectedId: 9004, thumbnailId: 9004 },
        { connectedId: 205, thumbnailId: 305 },
      ],
      [{ connectedId: 9010, thumbnailId: 9010 }],
      [
        { connectedId: 9011, thumbnailId: 9011 },
        { connectedId: 402, thumbnailId: 502 },
      ],
    ]);
    client.indexComposition(comp);
    return client;
  }

  it("emits clipConnected when state is Connected", () => {
    const client = connectedClient();
    const spy = vi.fn();
    client.on("clipConnected", spy);
    wsInstances[0].message({ type: "parameter_update", id: 205, value: "Connected" });
    expect(spy).toHaveBeenCalledWith({ layer: 2, clip: 5, connected: "Connected" });
  });

  it("emits clipConnected when state is Previewing", () => {
    const client = connectedClient();
    const spy = vi.fn();
    client.on("clipConnected", spy);
    wsInstances[0].message({ type: "parameter_update", id: 101, value: "Previewing" });
    expect(spy).toHaveBeenCalledWith({ layer: 1, clip: 1, connected: "Previewing" });
  });

  it("emits clipConnected when state is Connected & previewing", () => {
    const client = connectedClient();
    const spy = vi.fn();
    client.on("clipConnected", spy);
    wsInstances[0].message({ type: "parameter_update", id: 101, value: "Connected & previewing" });
    expect(spy).toHaveBeenCalledWith({ layer: 1, clip: 1, connected: "Connected & previewing" });
  });

  it("emits clipDisconnected when state is Disconnected", () => {
    const client = connectedClient();
    const spy = vi.fn();
    client.on("clipDisconnected", spy);
    wsInstances[0].message({ type: "parameter_update", id: 402, value: "Disconnected" });
    expect(spy).toHaveBeenCalledWith({ layer: 4, clip: 2, connected: "Disconnected" });
  });

  it("defaults to Disconnected when value is missing", () => {
    const client = connectedClient();
    const spy = vi.fn();
    client.on("clipDisconnected", spy);
    wsInstances[0].message({ type: "parameter_update", id: 101 });
    expect(spy).toHaveBeenCalledWith({ layer: 1, clip: 1, connected: "Disconnected" });
  });
});

// ── Thumbnail cache ───────────────────────────────────────────────────────────

describe("thumbnail cache", () => {
  it("fetches thumbnail and returns data URL on first call", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fetchMock.mockResolvedValueOnce(mockOkBuffer(bytes));

    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    const result = await client.getThumbnail(1, 1);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("returns cached result without calling fetch again", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    fetchMock.mockResolvedValueOnce(mockOkBuffer(bytes));

    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    const first = await client.getThumbnail(2, 3);
    const second = await client.getThumbnail(2, 3);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(first).toBe(second);
  });

  it("cache is keyed per layer+clip — different cells are fetched separately", async () => {
    const bytes = new Uint8Array([1]);
    fetchMock.mockResolvedValue(mockOkBuffer(bytes));

    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    await client.getThumbnail(1, 1);
    await client.getThumbnail(1, 2);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates cache on thumbnailDirty WS event", async () => {
    const bytes = new Uint8Array([5, 6, 7]);
    fetchMock.mockResolvedValue(mockOkBuffer(bytes));

    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    client.connect();
    wsInstances[0].open();

    const comp = makeComposition([[{ connectedId: 100, thumbnailId: 700 }]]);
    client.indexComposition(comp);

    await client.getThumbnail(1, 1); // populates cache
    wsInstances[0].message({ type: "parameter_update", id: 700, value: "new" });
    await client.getThumbnail(1, 1); // should re-fetch

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("thumbnailDirty only invalidates the matching cell, not others", async () => {
    const bytes = new Uint8Array([1]);
    fetchMock.mockResolvedValue(mockOkBuffer(bytes));

    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    client.connect();
    wsInstances[0].open();

    const comp = makeComposition([[
      { connectedId: 100, thumbnailId: 701 }, // clip 1
      { connectedId: 101, thumbnailId: 702 }, // clip 2
    ]]);
    client.indexComposition(comp);

    await client.getThumbnail(1, 1); // cached
    await client.getThumbnail(1, 2); // cached
    wsInstances[0].message({ type: "parameter_update", id: 701, value: "new" });

    await client.getThumbnail(1, 1); // re-fetched
    await client.getThumbnail(1, 2); // still cached

    expect(fetchMock).toHaveBeenCalledTimes(3); // initial 1,1 + initial 1,2 + re-fetch 1,1
  });
});

// ── REST methods ──────────────────────────────────────────────────────────────

describe("getComposition", () => {
  it("calls the correct URL and returns parsed JSON", async () => {
    const comp = { layers: [] };
    fetchMock.mockResolvedValueOnce(mockOkJson(comp));

    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    const result = await client.getComposition();

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/composition");
    expect(result).toEqual(comp);
  });

  it("throws on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(mockError(503));
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    await expect(client.getComposition()).rejects.toThrow("503");
  });
});

describe("triggerClip", () => {
  it("POSTs to the correct URL", async () => {
    fetchMock.mockResolvedValueOnce(mockOkJson({}));
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    await client.triggerClip(2, 5);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/composition/layers/2/clips/5/connect",
      { method: "POST" }
    );
  });

  it("throws on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(mockError(404));
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    await expect(client.triggerClip(1, 1)).rejects.toThrow("404");
  });
});

describe("setLayerParam", () => {
  it("throws if composition hasn't been indexed yet", async () => {
    const client = new ResolumeClient({ host: "localhost", port: 8080 });
    await expect(client.setLayerParam(1, "opacity", 0.5)).rejects.toThrow(
      /no param id indexed/,
    );
  });
});
