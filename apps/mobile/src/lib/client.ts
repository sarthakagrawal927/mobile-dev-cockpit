import {
  PROTOCOL_VERSION,
  createRequestId,
  type ClientRequest,
  type ServerEvent,
  type ServerMessage,
  type ServerResponse,
} from "@mobile-dev-cockpit/protocol";
import {
  deleteCredential,
  deleteLastBridgeUrl,
  getCredential,
  setCredential,
  setLastBridgeUrl,
} from "./credential-store";

type RequestPayload = ClientRequest extends infer Request
  ? Request extends ClientRequest
    ? Omit<Request, "version" | "requestId">
    : never
  : never;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;

export interface ClientCallbacks {
  onStatus: (
    status: "connecting" | "connected" | "reconnecting" | "disconnected",
  ) => void;
  onEvent: (event: ServerEvent) => void;
  onError: (message: string) => void;
}

class BridgeRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\/$/, "");
  const parsed = new URL(trimmed);
  if (!["ws:", "wss:"].includes(parsed.protocol))
    throw new Error("Bridge URL must start with ws:// or wss://");
  return parsed.toString().replace(/\/$/, "");
}

export class CockpitClient {
  private socket?: WebSocket;
  private url?: string;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private shouldReconnect = false;
  private credentialWrites: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly callbacks: ClientCallbacks) {}

  async connect(inputUrl: string, pairingToken?: string): Promise<unknown> {
    const url = normalizeUrl(inputUrl);
    this.disconnect(false);
    this.url = url;
    this.shouldReconnect = true;
    const storedToken = pairingToken ? null : await getCredential(url);
    if (!pairingToken && !storedToken)
      throw new Error("Enter the current pairing token for this machine");
    const response = await this.openAndAuthenticate(
      url,
      storedToken,
      pairingToken,
    );
    await setLastBridgeUrl(url);
    this.reconnectAttempt = 0;
    this.callbacks.onStatus("connected");
    return response;
  }

  request<T = unknown>(payload: RequestPayload): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("Bridge is not connected"));
    const requestId = createRequestId();
    const message = {
      version: PROTOCOL_VERSION,
      requestId,
      ...payload,
    } as ClientRequest;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Bridge request timed out"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.socket?.send(JSON.stringify(message));
    });
  }

  disconnect(reconnect = false): void {
    this.shouldReconnect = reconnect;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.rejectPending("Connection closed");
    if (!reconnect) this.callbacks.onStatus("disconnected");
  }

  async forget(): Promise<void> {
    const url = this.url;
    this.disconnect(false);
    if (url) await this.writeCredential(() => deleteCredential(url));
    await deleteLastBridgeUrl();
    this.url = undefined;
  }

  private openAndAuthenticate(
    url: string,
    sessionToken: string | null,
    pairingToken?: string,
  ): Promise<unknown> {
    this.callbacks.onStatus(
      this.reconnectAttempt === 0 ? "connecting" : "reconnecting",
    );
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let authenticated = false;
      socket.onopen = async () => {
        if (this.socket !== socket) {
          reject(new Error("Connection was replaced"));
          socket.close();
          return;
        }
        try {
          const data = pairingToken
            ? await this.request<{ sessionToken: string; snapshot: unknown }>({
                type: "pair",
                pairingToken,
                clientName: "Mobile Dev Cockpit",
              })
            : await this.request<{ snapshot: unknown }>({
                type: "authenticate",
                sessionToken: sessionToken ?? "",
              });
          if (this.socket !== socket)
            throw new Error("Connection was replaced");
          if (
            pairingToken &&
            "sessionToken" in data &&
            typeof data.sessionToken === "string"
          ) {
            const token = data.sessionToken;
            await this.writeCredential(async () => {
              if (this.socket !== socket)
                throw new Error("Connection was replaced");
              await setCredential(url, token);
            });
          }
          if (this.socket !== socket)
            throw new Error("Connection was replaced");
          authenticated = true;
          resolve(data);
        } catch (error) {
          if (
            this.socket === socket &&
            error instanceof BridgeRequestError &&
            ["authentication_failed", "pairing_rejected"].includes(error.code)
          ) {
            this.shouldReconnect = false;
            if (error.code === "authentication_failed")
              await this.writeCredential(async () => {
                if (this.socket === socket) await deleteCredential(url);
              });
          }
          reject(error);
          socket.close();
        }
      };
      socket.onmessage = (message) => {
        if (this.socket === socket) this.onMessage(message.data);
      };
      socket.onerror = () => {
        if (this.socket === socket)
          this.callbacks.onError("Bridge connection failed");
      };
      socket.onclose = () => {
        if (!authenticated)
          reject(new Error("Bridge closed before authentication"));
        if (this.socket !== socket) return;
        this.socket = undefined;
        this.rejectPending("Bridge connection closed");
        if (this.shouldReconnect) this.scheduleReconnect();
        else this.callbacks.onStatus("disconnected");
      };
    });
  }

  // Platform storage writes cannot be cancelled. Finish an older write before
  // the active connection replaces it (or Forget removes it).
  private writeCredential(write: () => Promise<void>): Promise<void> {
    const pending = this.credentialWrites.then(write);
    this.credentialWrites = pending.catch(() => {});
    return pending;
  }

  private onMessage(raw: unknown): void {
    try {
      const message = JSON.parse(String(raw)) as ServerMessage;
      if (message.version !== PROTOCOL_VERSION)
        throw new Error("Bridge protocol version does not match this app");
      if (message.type === "response") this.onResponse(message);
      else this.callbacks.onEvent(message);
    } catch (error) {
      this.callbacks.onError(
        error instanceof Error
          ? error.message
          : "Bridge sent an invalid message",
      );
    }
  }

  private onResponse(response: ServerResponse): void {
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    clearTimeout(pending.timer);
    if (response.ok) pending.resolve(response.data);
    else
      pending.reject(
        new BridgeRequestError(
          response.error?.code ?? "bridge_error",
          response.error?.message ?? "Bridge request failed",
        ),
      );
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.callbacks.onStatus("reconnecting");
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt, 15_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      if (!this.url || !this.shouldReconnect) return;
      const token = await getCredential(this.url);
      if (!token) {
        this.shouldReconnect = false;
        this.callbacks.onError("Saved session is unavailable; pair again");
        this.callbacks.onStatus("disconnected");
        return;
      }
      try {
        const data = (await this.openAndAuthenticate(this.url, token)) as {
          snapshot?: unknown;
        };
        if (data.snapshot)
          this.callbacks.onEvent({
            version: PROTOCOL_VERSION,
            type: "snapshot",
            snapshot: data.snapshot as never,
          });
        this.reconnectAttempt = 0;
        this.callbacks.onStatus("connected");
      } catch {
        if (this.shouldReconnect && !this.reconnectTimer)
          this.scheduleReconnect();
      }
    }, delay);
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}
