import { beforeEach, describe, expect, it, vi } from "vitest";
import { CockpitClient } from "../src/lib/client";
import { getCredential, getLastBridgeUrl } from "../src/lib/credential-store";

const credentialGate = vi.hoisted(() => ({
  beforeWrite: async (_url: string, _token: string) => {},
}));
vi.mock("../src/lib/credential-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/credential-store")>();
  return {
    ...actual,
    setCredential: async (url: string, token: string) => {
      await credentialGate.beforeWrite(url, token);
      await actual.setCredential(url, token);
    },
  };
});

const storage = new Map<string, string>();

class FakeWebSocket {
  static readonly OPEN = 1;
  static requests: string[] = [];
  static instances: FakeWebSocket[] = [];
  static deferClose = false;
  static deferOpen = false;
  static nextSession = "stored-session";
  readonly sessionToken = FakeWebSocket.nextSession;
  static rejectAuthentication = false;
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.deferOpen) return;
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(raw: string): void {
    const request = JSON.parse(raw) as { type: string; requestId: string };
    FakeWebSocket.requests.push(request.type);
    if (request.type === "authenticate" && FakeWebSocket.rejectAuthentication) {
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify({
            version: 1,
            type: "response",
            requestId: request.requestId,
            ok: false,
            error: {
              code: "authentication_failed",
              message: "Session expired",
            },
          }),
        }),
      );
      return;
    }
    const data =
      request.type === "pair"
        ? {
            sessionToken: this.sessionToken,
            sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            snapshot: machineSnapshot,
          }
        : { snapshot: machineSnapshot };
    queueMicrotask(() =>
      this.onmessage?.({
        data: JSON.stringify({
          version: 1,
          type: "response",
          requestId: request.requestId,
          ok: true,
          data,
        }),
      }),
    );
  }

  close(): void {
    if (this.readyState !== 0 && this.readyState !== FakeWebSocket.OPEN) return;
    this.readyState = 3;
    if (!FakeWebSocket.deferClose) queueMicrotask(() => this.onclose?.());
  }
}

const machineSnapshot = {
  machineName: "Mac",
  bridgeVersion: "0.1.0",
  protocolVersion: 1,
  projects: [],
};

beforeEach(() => {
  storage.clear();
  FakeWebSocket.requests = [];
  FakeWebSocket.instances = [];
  FakeWebSocket.deferClose = false;
  FakeWebSocket.deferOpen = false;
  FakeWebSocket.nextSession = "stored-session";
  credentialGate.beforeWrite = async () => {};
  FakeWebSocket.rejectAuthentication = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeWebSocket,
  });
});

describe("CockpitClient credentials", () => {
  it("pairs once, remembers the bridge, and authenticates a later client from storage", async () => {
    const callbacks = {
      onStatus: () => {},
      onEvent: () => {},
      onError: () => {},
    };
    const first = new CockpitClient(callbacks);
    await first.connect("ws://machine.test:4782", "pair-token");
    expect(await getCredential("ws://machine.test:4782")).toBe(
      "stored-session",
    );
    expect(await getLastBridgeUrl()).toBe("ws://machine.test:4782");
    first.disconnect();

    const second = new CockpitClient(callbacks);
    await second.connect("ws://machine.test:4782");
    expect(FakeWebSocket.requests).toEqual(["pair", "authenticate"]);
    second.disconnect();
  });

  it("ignores a replaced socket's late close while the new machine is connected", async () => {
    const statuses: string[] = [];
    const events: unknown[] = [];
    const errors: string[] = [];
    const client = new CockpitClient({
      onStatus: (status) => statuses.push(status),
      onEvent: (event) => events.push(event),
      onError: (error) => errors.push(error),
    });
    try {
      await client.connect("ws://first.test:4782", "first-pair");
      const first = FakeWebSocket.instances[0]!;
      FakeWebSocket.deferClose = true;
      await client.connect("ws://second.test:4782", "second-pair");
      const second = FakeWebSocket.instances[1]!;
      const send = second.send.bind(second);
      let queuedRequest = "";
      second.send = (raw) => {
        queuedRequest = raw;
      };
      const pendingSnapshot = client.request({ type: "getSnapshot" });
      first.onclose?.();
      first.onerror?.();
      first.onmessage?.({
        data: JSON.stringify({
          version: 1,
          type: "snapshot",
          snapshot: machineSnapshot,
        }),
      });
      expect(events).toEqual([]);
      expect(errors).toEqual([]);
      expect(statuses.at(-1)).toBe("connected");
      send(queuedRequest);
      await expect(pendingSnapshot).resolves.toMatchObject({
        snapshot: machineSnapshot,
      });
    } finally {
      client.disconnect();
    }
  });

  it("settles an obsolete CONNECTING handshake that only closes", async () => {
    const statuses: string[] = [];
    const client = new CockpitClient({
      onStatus: (status) => statuses.push(status),
      onEvent: () => {},
      onError: () => {},
    });
    try {
      FakeWebSocket.deferOpen = true;
      const obsolete = client.connect("ws://old.test:4782", "old-pair").then(
        () => "unexpected success",
        () => "replaced",
      );
      FakeWebSocket.deferOpen = false;
      await client.connect("ws://new.test:4782", "new-pair");
      await expect(obsolete).resolves.toBe("replaced");
      expect(statuses.at(-1)).toBe("connected");
    } finally {
      client.disconnect();
    }
  });

  it("orders delayed same-machine credential writes so re-pair keeps the newest session", async () => {
    let releaseOld: (() => void) | undefined;
    credentialGate.beforeWrite = async (_url, token) => {
      if (token === "old-session")
        await new Promise<void>((resolve) => {
          releaseOld = resolve;
        });
    };
    const client = new CockpitClient({
      onStatus: () => {},
      onEvent: () => {},
      onError: () => {},
    });
    try {
      FakeWebSocket.nextSession = "old-session";
      const obsolete = client
        .connect("ws://machine.test:4782", "old-pair")
        .catch(() => undefined);
      await vi.waitFor(() => expect(releaseOld).toBeDefined());
      FakeWebSocket.nextSession = "new-session";
      const current = client.connect("ws://machine.test:4782", "new-pair");
      await vi.waitFor(() =>
        expect(
          FakeWebSocket.requests.filter((request) => request === "pair"),
        ).toHaveLength(2),
      );
      // Allow the newer handshake's storage work to finish before releasing
      // the older platform write. Without serialization, old wins last.
      await new Promise((resolve) => setTimeout(resolve, 20));
      releaseOld?.();
      await Promise.all([obsolete, current]);
      expect(await getCredential("ws://machine.test:4782")).toBe("new-session");
    } finally {
      releaseOld?.();
      client.disconnect();
    }
  });

  it("forgets the stored bridge and credential explicitly", async () => {
    const client = new CockpitClient({
      onStatus: () => {},
      onEvent: () => {},
      onError: () => {},
    });
    await client.connect("ws://machine.test:4782", "pair-token");
    await client.forget();
    expect(await getCredential("ws://machine.test:4782")).toBeNull();
    expect(await getLastBridgeUrl()).toBeNull();
  });

  it("forgets even when an obsolete pairing storage write finishes late", async () => {
    let releaseWrite: (() => void) | undefined;
    credentialGate.beforeWrite = async () => {
      await new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
    };
    const client = new CockpitClient({
      onStatus: () => {},
      onEvent: () => {},
      onError: () => {},
    });
    try {
      const pairing = client
        .connect("ws://machine.test:4782", "pair-token")
        .catch(() => undefined);
      await vi.waitFor(() => expect(releaseWrite).toBeDefined());
      const forgetting = client.forget();
      releaseWrite?.();
      await Promise.all([pairing, forgetting]);
      expect(await getCredential("ws://machine.test:4782")).toBeNull();
      expect(await getLastBridgeUrl()).toBeNull();
    } finally {
      releaseWrite?.();
      client.disconnect();
    }
  });

  it("removes an expired stored credential and requires pairing again", async () => {
    const callbacks = {
      onStatus: () => {},
      onEvent: () => {},
      onError: () => {},
    };
    const first = new CockpitClient(callbacks);
    await first.connect("ws://machine.test:4782", "pair-token");
    first.disconnect();

    FakeWebSocket.rejectAuthentication = true;
    const second = new CockpitClient(callbacks);
    await expect(
      second.connect("ws://machine.test:4782"),
    ).rejects.toMatchObject({ code: "authentication_failed" });
    expect(await getCredential("ws://machine.test:4782")).toBeNull();
    expect(await getLastBridgeUrl()).toBe("ws://machine.test:4782");
  });
});
