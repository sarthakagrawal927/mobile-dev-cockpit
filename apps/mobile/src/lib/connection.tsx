import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type PropsWithChildren,
} from "react";
import type {
  ApprovalRequest,
  ClientRequest,
  LogEntry,
  MachineSnapshot,
  ProjectSummary,
  ReviewResult,
  ServerEvent,
} from "@mobile-dev-cockpit/protocol";
import { CockpitClient } from "./client";
import { getLastBridgeUrl } from "./credential-store";

type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface ConnectionState {
  status: ConnectionStatus;
  snapshot?: MachineSnapshot;
  logs: LogEntry[];
  review?: ReviewResult;
  approval?: ApprovalRequest;
  error?: string;
}

type Action =
  | { type: "status"; status: ConnectionStatus }
  | { type: "snapshot"; snapshot: MachineSnapshot }
  | { type: "event"; event: ServerEvent }
  | { type: "review"; review: ReviewResult }
  | { type: "error"; message?: string }
  | { type: "reset" };

function updateProject(
  snapshot: MachineSnapshot,
  projectId: string,
  update: (project: ProjectSummary) => ProjectSummary,
): MachineSnapshot {
  return {
    ...snapshot,
    projects: snapshot.projects.map((project) =>
      project.id === projectId ? update(project) : project,
    ),
  };
}

function snapshotLogs(snapshot: MachineSnapshot): LogEntry[] {
  return snapshot.projects
    .flatMap((project) => Object.values(project.processes))
    .flatMap((process) => process?.recentLogs ?? [])
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-1_000);
}

export function connectionReducer(
  state: ConnectionState,
  action: Action,
): ConnectionState {
  switch (action.type) {
    case "status":
      return { ...state, status: action.status };
    case "snapshot":
      return {
        ...state,
        snapshot: action.snapshot,
        logs: snapshotLogs(action.snapshot),
        error: undefined,
      };
    case "error":
      return { ...state, error: action.message };
    case "review":
      return { ...state, review: action.review };
    case "reset":
      return { status: "disconnected", logs: [] };
    case "event": {
      const event = action.event;
      if (event.type === "snapshot") {
        return {
          ...state,
          snapshot: event.snapshot,
          logs: snapshotLogs(event.snapshot),
          error: undefined,
        };
      }
      if (event.type === "log")
        return { ...state, logs: [...state.logs, event.entry].slice(-1_000) };
      if (event.type === "approval")
        return { ...state, approval: event.approval };
      if (event.type === "process" && state.snapshot) {
        return {
          ...state,
          snapshot: updateProject(
            state.snapshot,
            event.projectId,
            (project) => ({
              ...project,
              processes: {
                ...project.processes,
                [event.process.operation]: event.process,
              },
            }),
          ),
        };
      }
      return state;
    }
  }
}

type RequestPayload = ClientRequest extends infer Request
  ? Request extends ClientRequest
    ? Omit<Request, "version" | "requestId">
    : never
  : never;

interface ConnectionValue extends ConnectionState {
  connect: (url: string, pairingToken?: string) => Promise<void>;
  disconnect: () => void;
  forget: () => Promise<void>;
  request: <T = unknown>(payload: RequestPayload) => Promise<T>;
  setReview: (review: ReviewResult) => void;
}

const ConnectionContext = createContext<ConnectionValue | null>(null);

export function ConnectionProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(connectionReducer, {
    status: "disconnected",
    logs: [],
  });
  const clientRef = useRef<CockpitClient | null>(null);
  const autoConnectStarted = useRef(false);
  if (clientRef.current == null) {
    clientRef.current = new CockpitClient({
      onStatus: (status) => dispatch({ type: "status", status }),
      onEvent: (event) => dispatch({ type: "event", event }),
      onError: (message) => dispatch({ type: "error", message }),
    });
  }

  const connect = useCallback(async (url: string, pairingToken?: string) => {
    dispatch({ type: "error", message: undefined });
    try {
      const data = (await clientRef.current?.connect(url, pairingToken)) as
        | { snapshot?: MachineSnapshot }
        | undefined;
      if (data?.snapshot)
        dispatch({ type: "snapshot", snapshot: data.snapshot });
    } catch (error) {
      dispatch({ type: "status", status: "disconnected" });
      dispatch({
        type: "error",
        message: error instanceof Error ? error.message : "Connection failed",
      });
      throw error;
    }
  }, []);

  useEffect(() => {
    if (autoConnectStarted.current) return;
    autoConnectStarted.current = true;
    let active = true;
    void getLastBridgeUrl().then((url) => {
      if (!active || !url) return;
      void connect(url).catch(() => {
        // The provider exposes the actionable pairing or transport error.
      });
    });
    return () => {
      active = false;
    };
  }, [connect]);

  const value = useMemo<ConnectionValue>(
    () => ({
      ...state,
      connect,
      disconnect: () => {
        clientRef.current?.disconnect();
        dispatch({ type: "reset" });
      },
      forget: async () => {
        await clientRef.current?.forget();
        dispatch({ type: "reset" });
      },
      request: <T,>(payload: RequestPayload) =>
        clientRef.current?.request<T>(payload) ??
        Promise.reject(new Error("Client unavailable")),
      setReview: (review) => dispatch({ type: "review", review }),
    }),
    [connect, state],
  );

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection(): ConnectionValue {
  const context = useContext(ConnectionContext);
  if (!context)
    throw new Error("useConnection must be used inside ConnectionProvider");
  return context;
}
