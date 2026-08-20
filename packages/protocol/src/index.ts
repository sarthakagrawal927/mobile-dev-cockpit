export const PROTOCOL_VERSION = 1 as const;

export type OperationName =
  | "dev"
  | "tunnel"
  | "build"
  | "test"
  | "agent"
  | "deploy"
  | "rollback";
export type ProcessPhase =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "stopped";

export type ProjectCapabilities = Record<OperationName, boolean> & {
  agentResume: boolean;
};

export type ProjectSource = "static" | "dynamic";
export type CandidateOperation = OperationName | "agentResume";
export type CandidateSource = "package" | "agent" | "manifest";
export type CandidateRisk = "routine" | "review" | "guarded";

export interface ProjectSummary {
  id: string;
  name: string;
  previewUrl?: string;
  productionUrl?: string;
  capabilities: ProjectCapabilities;
  processes: Partial<Record<OperationName, ProcessSnapshot>>;
  source: ProjectSource;
}

export interface RepositorySummary {
  id: string;
  name: string;
  relativeLocation: string;
  ecosystem: "node" | "unknown";
  packageManager?: "pnpm" | "npm" | "yarn" | "bun";
  enrollment: "available" | "enrolled";
  enrolledProjectId?: string;
}

export interface CommandCandidate {
  id: string;
  operation: CandidateOperation;
  label: string;
  argvLabel: string;
  source: CandidateSource;
  risk: CandidateRisk;
  scriptBody?: string;
}

export interface EnrollmentProposal {
  id: string;
  action: "enroll" | "update" | "remove";
  repository?: RepositorySummary;
  projectId?: string;
  projectName: string;
  candidates: CommandCandidate[];
  selectedCandidateIds: string[];
  expiresAt: string;
}

export interface ProcessSnapshot {
  operation: OperationName;
  phase: ProcessPhase;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  recentLogs: LogEntry[];
}

export interface LogEntry {
  projectId: string;
  operation: OperationName;
  stream: "stdout" | "stderr" | "system";
  line: string;
  timestamp: string;
}

export interface MachineSnapshot {
  machineName: string;
  bridgeVersion: string;
  protocolVersion: typeof PROTOCOL_VERSION;
  projects: ProjectSummary[];
}

export interface ReviewResult {
  projectId: string;
  files: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
  diff: string;
  truncated: boolean;
}

export type ApprovalOperation = "deploy" | "rollback" | "revert" | "commit";

export interface ApprovalRequest {
  id: string;
  projectId: string;
  projectName: string;
  operation: ApprovalOperation;
  commandLabel: string;
  target?: string;
  expiresAt: string;
}

interface RequestBase {
  version: typeof PROTOCOL_VERSION;
  requestId: string;
}

export type ClientRequest =
  | (RequestBase & { type: "pair"; pairingToken: string; clientName: string })
  | (RequestBase & { type: "authenticate"; sessionToken: string })
  | (RequestBase & { type: "getSnapshot" })
  | (RequestBase & { type: "discoverRepositories" })
  | (RequestBase & { type: "getEnrollmentOptions"; repositoryId: string })
  | (RequestBase & {
      type: "requestEnrollment";
      repositoryId: string;
      candidateIds: string[];
    })
  | (RequestBase & {
      type: "requestProjectRemoval";
      projectId: string;
    })
  | (RequestBase & {
      type: "resolveEnrollment";
      proposalId: string;
      approve: boolean;
    })
  | (RequestBase & {
      type: "startOperation";
      projectId: string;
      operation: "dev" | "tunnel" | "build" | "test" | "agent";
    })
  | (RequestBase & {
      type: "stopOperation";
      projectId: string;
      operation: OperationName;
    })
  | (RequestBase & {
      type: "agentInstruction";
      projectId: string;
      instruction: string;
    })
  | (RequestBase & { type: "resumeAgent"; projectId: string })
  | (RequestBase & {
      type: "agentAttachment";
      projectId: string;
      mimeType: "image/jpeg" | "image/png";
      base64: string;
      note?: string;
    })
  | (RequestBase & { type: "getReview"; projectId: string })
  | (RequestBase & { type: "stageFile"; projectId: string; file: string })
  | (RequestBase & { type: "unstageFile"; projectId: string; file: string })
  | (RequestBase & {
      type: "requestApproval";
      projectId: string;
      operation: ApprovalOperation;
      file?: string;
      message?: string;
    })
  | (RequestBase & {
      type: "resolveApproval";
      approvalId: string;
      approve: boolean;
    });

export interface ServerResponse {
  version: typeof PROTOCOL_VERSION;
  type: "response";
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export type ServerEvent =
  | {
      version: typeof PROTOCOL_VERSION;
      type: "snapshot";
      snapshot: MachineSnapshot;
    }
  | { version: typeof PROTOCOL_VERSION; type: "log"; entry: LogEntry }
  | {
      version: typeof PROTOCOL_VERSION;
      type: "process";
      projectId: string;
      process: ProcessSnapshot;
    }
  | {
      version: typeof PROTOCOL_VERSION;
      type: "approval";
      approval: ApprovalRequest;
    };

export type ServerMessage = ServerResponse | ServerEvent;

export class ProtocolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const requestKeys: Record<ClientRequest["type"], readonly string[]> = {
  pair: ["version", "type", "requestId", "pairingToken", "clientName"],
  authenticate: ["version", "type", "requestId", "sessionToken"],
  getSnapshot: ["version", "type", "requestId"],
  discoverRepositories: ["version", "type", "requestId"],
  getEnrollmentOptions: ["version", "type", "requestId", "repositoryId"],
  requestEnrollment: [
    "version",
    "type",
    "requestId",
    "repositoryId",
    "candidateIds",
  ],
  requestProjectRemoval: ["version", "type", "requestId", "projectId"],
  resolveEnrollment: ["version", "type", "requestId", "proposalId", "approve"],
  startOperation: ["version", "type", "requestId", "projectId", "operation"],
  stopOperation: ["version", "type", "requestId", "projectId", "operation"],
  agentInstruction: [
    "version",
    "type",
    "requestId",
    "projectId",
    "instruction",
  ],
  resumeAgent: ["version", "type", "requestId", "projectId"],
  agentAttachment: [
    "version",
    "type",
    "requestId",
    "projectId",
    "mimeType",
    "base64",
    "note",
  ],
  getReview: ["version", "type", "requestId", "projectId"],
  stageFile: ["version", "type", "requestId", "projectId", "file"],
  unstageFile: ["version", "type", "requestId", "projectId", "file"],
  requestApproval: [
    "version",
    "type",
    "requestId",
    "projectId",
    "operation",
    "file",
    "message",
  ],
  resolveApproval: ["version", "type", "requestId", "approvalId", "approve"],
};

const operationNames: OperationName[] = [
  "dev",
  "tunnel",
  "build",
  "test",
  "agent",
  "deploy",
  "rollback",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProtocolError(
      "invalid_message",
      `${key} must be a non-empty string`,
    );
  }
  return value;
}

export function parseClientRequest(input: string | unknown): ClientRequest {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new ProtocolError("invalid_json", "Message is not valid JSON");
    }
  }

  if (!isRecord(value))
    throw new ProtocolError("invalid_message", "Message must be an object");
  if (value.version !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      "unsupported_version",
      `Protocol version ${PROTOCOL_VERSION} is required`,
    );
  }

  const type = requireString(value, "type") as ClientRequest["type"];
  if (!(type in requestKeys))
    throw new ProtocolError("unknown_type", `Unknown request type: ${type}`);

  const allowed = new Set(requestKeys[type]);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey)
    throw new ProtocolError("unknown_field", `Unexpected field: ${unknownKey}`);

  requireString(value, "requestId");
  switch (type) {
    case "pair":
      requireString(value, "pairingToken");
      requireString(value, "clientName");
      break;
    case "authenticate":
      requireString(value, "sessionToken");
      break;
    case "requestEnrollment": {
      requireString(value, "repositoryId");
      if (
        !Array.isArray(value.candidateIds) ||
        value.candidateIds.length === 0 ||
        value.candidateIds.length > 12 ||
        value.candidateIds.some(
          (candidate) =>
            typeof candidate !== "string" || candidate.length === 0,
        ) ||
        new Set(value.candidateIds).size !== value.candidateIds.length
      ) {
        throw new ProtocolError(
          "invalid_candidates",
          "candidateIds must contain 1 to 12 unique opaque IDs",
        );
      }
      break;
    }
    case "getEnrollmentOptions":
      requireString(value, "repositoryId");
      break;
    case "requestProjectRemoval":
      requireString(value, "projectId");
      break;
    case "resolveEnrollment":
      requireString(value, "proposalId");
      if (typeof value.approve !== "boolean") {
        throw new ProtocolError("invalid_message", "approve must be boolean");
      }
      break;
    case "startOperation": {
      requireString(value, "projectId");
      const operation = requireString(value, "operation");
      if (!["dev", "tunnel", "build", "test", "agent"].includes(operation)) {
        throw new ProtocolError(
          "invalid_operation",
          "Only dev, tunnel, build, test, or agent can start directly",
        );
      }
      break;
    }
    case "stopOperation": {
      requireString(value, "projectId");
      const operation = requireString(value, "operation");
      if (!operationNames.includes(operation as OperationName)) {
        throw new ProtocolError("invalid_operation", "Unknown operation");
      }
      break;
    }
    case "agentInstruction":
      requireString(value, "projectId");
      if (requireString(value, "instruction").length > 20_000) {
        throw new ProtocolError(
          "instruction_too_large",
          "Instruction exceeds 20,000 characters",
        );
      }
      break;
    case "resumeAgent":
      requireString(value, "projectId");
      break;
    case "agentAttachment": {
      requireString(value, "projectId");
      const mimeType = requireString(value, "mimeType");
      if (!["image/jpeg", "image/png"].includes(mimeType)) {
        throw new ProtocolError(
          "unsupported_attachment",
          "Only JPEG and PNG screenshots are supported",
        );
      }
      const base64 = requireString(value, "base64");
      if (base64.length > 5_600_000) {
        throw new ProtocolError(
          "attachment_too_large",
          "Screenshot exceeds the 4 MB decoded limit",
        );
      }
      if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        throw new ProtocolError(
          "invalid_attachment",
          "Screenshot is not canonical base64",
        );
      }
      if (
        value.note !== undefined &&
        (typeof value.note !== "string" || value.note.length > 2_000)
      ) {
        throw new ProtocolError(
          "invalid_message",
          "Screenshot note must be at most 2,000 characters",
        );
      }
      break;
    }
    case "getReview":
      requireString(value, "projectId");
      break;
    case "stageFile":
    case "unstageFile":
      requireString(value, "projectId");
      if (requireString(value, "file").length > 4_096)
        throw new ProtocolError("invalid_file", "File path is too long");
      break;
    case "requestApproval": {
      requireString(value, "projectId");
      const operation = requireString(value, "operation");
      if (!["deploy", "rollback", "revert", "commit"].includes(operation)) {
        throw new ProtocolError(
          "invalid_operation",
          "Unknown approval operation",
        );
      }
      if (operation === "revert") {
        if (requireString(value, "file").length > 4_096)
          throw new ProtocolError("invalid_file", "File path is too long");
        if (value.message !== undefined)
          throw new ProtocolError(
            "unknown_field",
            "message is not valid for revert",
          );
      } else if (operation === "commit") {
        const message = requireString(value, "message");
        if (message.length > 200)
          throw new ProtocolError(
            "invalid_message",
            "Commit message exceeds 200 characters",
          );
        if (value.file !== undefined)
          throw new ProtocolError(
            "unknown_field",
            "file is not valid for commit",
          );
      } else if (value.file !== undefined || value.message !== undefined) {
        throw new ProtocolError(
          "unknown_field",
          "Deploy and rollback do not accept file or message",
        );
      }
      break;
    }
    case "resolveApproval":
      requireString(value, "approvalId");
      if (typeof value.approve !== "boolean") {
        throw new ProtocolError("invalid_message", "approve must be boolean");
      }
      break;
    case "getSnapshot":
    case "discoverRepositories":
      break;
  }

  return value as unknown as ClientRequest;
}

export function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
