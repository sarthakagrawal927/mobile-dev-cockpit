import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_VERSION,
  type CommandCandidate,
  type MachineSnapshot,
  type RepositorySummary,
  type ClientRequest,
  type ServerResponse,
} from "@mobile-dev-cockpit/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { BridgeConfig } from "../src/config.js";
import { BridgeServer } from "../src/server.js";
import { CockpitClient } from "../../../apps/mobile/src/lib/client.js";

const servers: BridgeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function fixture(): BridgeConfig {
  const repositoryPath = mkdtempSync(join(tmpdir(), "cockpit-server-"));
  execFileSync("git", ["init", "-q"], { cwd: repositoryPath });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repositoryPath,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repositoryPath });
  writeFileSync(join(repositoryPath, "file.txt"), "before\n");
  execFileSync("git", ["add", "file.txt"], { cwd: repositoryPath });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repositoryPath });
  writeFileSync(join(repositoryPath, "file.txt"), "after\n");
  return {
    machineName: "Test Mac",
    host: "127.0.0.1",
    port: 0,
    pairingTtlSeconds: 60,
    sessionTtlSeconds: 86_400,
    approvalTtlSeconds: 60,
    logLineLimit: 100,
    diffByteLimit: 10_000,
    stateFile: join(repositoryPath, ".state", "state.json"),
    catalogFile: join(repositoryPath, ".state", "projects.json"),
    discoveryRoots: [],
    projects: [
      {
        id: "site",
        name: "Site",
        repositoryPath,
        previewUrl: "http://localhost:3000/",
        productionUrl: "https://example.com/",
        environment: {},
        commands: {
          dev: [
            process.execPath,
            "-e",
            'console.log("ready"); setInterval(() => {}, 1000)',
          ],
          build: [process.execPath, "-e", 'console.log("built")'],
          agent: [
            process.execPath,
            "-e",
            'process.stdin.on("data", d => console.log("agent:" + d.toString().trim())); setInterval(() => {}, 1000)',
          ],
          agentResume: [
            process.execPath,
            "-e",
            'console.log("resumed"); setInterval(() => {}, 1000)',
          ],
          deploy: [process.execPath, "-e", 'console.log("deployed")'],
        },
      },
    ],
  };
}

function dynamicFixture(): BridgeConfig {
  const repositoryPath = realpathSync(
    mkdtempSync(join(tmpdir(), "cockpit-dynamic-")),
  );
  execFileSync("git", ["init", "-q"], { cwd: repositoryPath });
  writeFileSync(
    join(repositoryPath, "package.json"),
    JSON.stringify({
      name: "dynamic-site",
      packageManager: "npm@11.0.0",
      scripts: {
        dev: `${process.execPath} -e \"console.log('http://localhost:4010'); setInterval(() => {}, 1000)\"`,
        check: `${process.execPath} -e \"console.log('checked')\"`,
        deploy: `${process.execPath} -e \"console.log('deployed')\"`,
      },
    }),
  );
  writeFileSync(
    join(repositoryPath, ".mobile-dev-cockpit.json"),
    JSON.stringify({
      commands: {
        agent: [
          process.execPath,
          "-e",
          "process.stdin.on('data', data => console.log(data.toString().trim())); setInterval(() => {}, 1000)",
        ],
        agentResume: [
          process.execPath,
          "-e",
          "console.log('resumed'); setInterval(() => {}, 1000)",
        ],
      },
    }),
  );
  return {
    machineName: "Dynamic Mac",
    host: "127.0.0.1",
    port: 0,
    pairingTtlSeconds: 60,
    sessionTtlSeconds: 86_400,
    approvalTtlSeconds: 60,
    logLineLimit: 100,
    diffByteLimit: 10_000,
    stateFile: join(repositoryPath, ".state", "state.json"),
    catalogFile: join(repositoryPath, ".state", "projects.json"),
    discoveryRoots: [repositoryPath],
    projects: [],
  };
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function request(
  socket: WebSocket,
  message: ClientRequest,
): Promise<ServerResponse> {
  return new Promise((resolve) => {
    const listener = (data: WebSocket.RawData): void => {
      const response = JSON.parse(data.toString()) as ServerResponse;
      if (
        response.type === "response" &&
        response.requestId === message.requestId
      ) {
        socket.off("message", listener);
        resolve(response);
      }
    };
    socket.on("message", listener);
    socket.send(JSON.stringify(message));
  });
}

describe("BridgeServer", () => {
  it("discovers, stale-checks, enrolls, restores, and removes a dynamic project", async () => {
    const config = dynamicFixture();
    const server = new BridgeServer(config);
    servers.push(server);
    const port = await server.listen();
    const socket = await open(`ws://127.0.0.1:${port}`);
    expect(
      (
        await request(socket, {
          version: PROTOCOL_VERSION,
          type: "discoverRepositories",
          requestId: "unauth-discovery",
        })
      ).error?.code,
    ).toBe("authentication_required");
    await request(socket, {
      version: PROTOCOL_VERSION,
      type: "pair",
      requestId: "pair-dynamic",
      pairingToken: server.pairingToken,
      clientName: "Test phone",
    });
    const discovery = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "discoverRepositories",
      requestId: "discovery",
    });
    const repository = (
      discovery.data as {
        repositories: Array<{ id: string; relativeLocation: string }>;
      }
    ).repositories[0]!;
    expect(repository.relativeLocation).toBe(".");
    expect(JSON.stringify(discovery.data)).not.toContain(
      config.discoveryRoots[0],
    );

    const options = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "getEnrollmentOptions",
      requestId: "options",
      repositoryId: repository.id,
    });
    const candidates = (
      options.data as {
        candidates: Array<{ id: string; operation: string; source: string }>;
      }
    ).candidates.filter(
      (candidate) =>
        ["dev", "test", "deploy"].includes(candidate.operation) ||
        (["agent", "agentResume"].includes(candidate.operation) &&
          candidate.source === "manifest"),
    );
    expect(candidates).toHaveLength(5);
    expect(JSON.stringify(options.data)).not.toContain("repositoryPath");
    expect(JSON.stringify(options.data)).not.toContain('"argv"');

    const staleProposal = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "requestEnrollment",
      requestId: "proposal-stale",
      repositoryId: repository.id,
      candidateIds: candidates.map((candidate) => candidate.id),
    });
    writeFileSync(
      join(config.discoveryRoots[0]!, "package.json"),
      JSON.stringify({
        name: "dynamic-site",
        scripts: {
          dev: `${process.execPath} -e \"console.log('http://localhost:4010'); setInterval(() => {}, 1000)\"`,
          check: `${process.execPath} -e \"console.log('changed')\"`,
          deploy: `${process.execPath} -e \"console.log('deployed')\"`,
        },
      }),
    );
    expect(
      (
        await request(socket, {
          version: PROTOCOL_VERSION,
          type: "resolveEnrollment",
          requestId: "resolve-stale",
          proposalId: (staleProposal.data as { proposal: { id: string } })
            .proposal.id,
          approve: true,
        })
      ).error?.code,
    ).toBe("approval_stale");

    const freshOptions = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "getEnrollmentOptions",
      requestId: "fresh-options",
      repositoryId: repository.id,
    });
    const freshCandidates = (
      freshOptions.data as {
        candidates: Array<{ id: string; operation: string; source: string }>;
      }
    ).candidates.filter(
      (candidate) =>
        ["dev", "test", "deploy"].includes(candidate.operation) ||
        (["agent", "agentResume"].includes(candidate.operation) &&
          candidate.source === "manifest"),
    );
    const freshProposal = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "requestEnrollment",
      requestId: "fresh-proposal",
      repositoryId: repository.id,
      candidateIds: freshCandidates.map((candidate) => candidate.id),
    });
    const proposalId = (freshProposal.data as { proposal: { id: string } })
      .proposal.id;
    const enrolled = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "resolveEnrollment",
      requestId: "enroll",
      proposalId,
      approve: true,
    });
    expect(enrolled.error).toBeUndefined();
    const projectId = (enrolled.data as { projectId: string }).projectId;
    expect(server.snapshot().projects[0]).toMatchObject({
      id: projectId,
      source: "dynamic",
    });
    expect(
      (
        await request(socket, {
          version: PROTOCOL_VERSION,
          type: "resolveEnrollment",
          requestId: "replay-enrollment",
          proposalId,
          approve: true,
        })
      ).error?.code,
    ).toBe("approval_expired");
    const runtimeDeployApproval = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "requestApproval",
      requestId: "dynamic-deploy-approval",
      projectId,
      operation: "deploy",
    });
    expect(runtimeDeployApproval.ok).toBe(true);
    expect(server.snapshot().projects[0]?.processes.deploy).toBeUndefined();
    expect(
      (
        await request(socket, {
          version: PROTOCOL_VERSION,
          type: "startOperation",
          requestId: "dynamic-start-dev",
          projectId,
          operation: "dev",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await request(socket, {
          version: PROTOCOL_VERSION,
          type: "startOperation",
          requestId: "dynamic-start-agent",
          projectId,
          operation: "agent",
        })
      ).ok,
    ).toBe(true);
    await request(socket, {
      version: PROTOCOL_VERSION,
      type: "agentInstruction",
      requestId: "dynamic-agent-input",
      projectId,
      instruction: "status",
    });
    await vi.waitFor(
      () => {
        expect(server.snapshot().projects[0]?.previewUrl).toBe(
          "http://localhost:4010/",
        );
      },
      { interval: 25, timeout: 2_000 },
    );
    expect(
      (
        await request(socket, {
          version: PROTOCOL_VERSION,
          type: "requestProjectRemoval",
          requestId: "busy-removal",
          projectId,
        })
      ).error?.code,
    ).toBe("project_busy");
    await request(socket, {
      version: PROTOCOL_VERSION,
      type: "stopOperation",
      requestId: "dynamic-stop-agent",
      projectId,
      operation: "agent",
    });
    await request(socket, {
      version: PROTOCOL_VERSION,
      type: "stopOperation",
      requestId: "dynamic-stop-dev",
      projectId,
      operation: "dev",
    });
    socket.close();
    await server.close();
    servers.splice(servers.indexOf(server), 1);

    const restarted = new BridgeServer(config);
    servers.push(restarted);
    expect(restarted.snapshot().projects[0]).toMatchObject({
      id: projectId,
      source: "dynamic",
    });
    const restartedPort = await restarted.listen();
    const restartedSocket = await open(`ws://127.0.0.1:${restartedPort}`);
    await request(restartedSocket, {
      version: PROTOCOL_VERSION,
      type: "pair",
      requestId: "pair-restarted",
      pairingToken: restarted.pairingToken,
      clientName: "Test phone",
    });
    const removal = await request(restartedSocket, {
      version: PROTOCOL_VERSION,
      type: "requestProjectRemoval",
      requestId: "remove-proposal",
      projectId,
    });
    await request(restartedSocket, {
      version: PROTOCOL_VERSION,
      type: "resolveEnrollment",
      requestId: "remove",
      proposalId: (removal.data as { proposal: { id: string } }).proposal.id,
      approve: true,
    });
    expect(restarted.snapshot().projects).toEqual([]);
    restartedSocket.close();
  });

  it("pairs the actual mobile client, enrolls, runs an allowlisted test and reconnects from storage", async () => {
    const config = dynamicFixture();
    const server = new BridgeServer(config);
    const port = await server.listen();
    const storage = new Map<string, string>();
    vi.stubGlobal("WebSocket", WebSocket);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    const callbacks = {
      onStatus: () => {},
      onEvent: () => {},
      onError: () => {},
    };
    const client = new CockpitClient(callbacks);
    const reopened = new CockpitClient(callbacks);
    const url = `ws://127.0.0.1:${port}`;
    try {
      await client.connect(url, server.pairingToken);
      const discovery = await client.request<{
        repositories: RepositorySummary[];
      }>({ type: "discoverRepositories" });
      const repository = discovery.repositories[0]!;
      const options = await client.request<{ candidates: CommandCandidate[] }>({
        type: "getEnrollmentOptions",
        repositoryId: repository.id,
      });
      const candidate = options.candidates.find(
        (item) => item.operation === "test",
      )!;
      expect(candidate).toBeDefined();
      const proposal = await client.request<{ proposal: { id: string } }>({
        type: "requestEnrollment",
        repositoryId: repository.id,
        candidateIds: [candidate.id],
      });
      expect(server.snapshot().projects).toEqual([]);
      const enrolled = await client.request<{ projectId: string }>({
        type: "resolveEnrollment",
        proposalId: proposal.proposal.id,
        approve: true,
      });
      await expect(
        client.request({
          type: "resolveEnrollment",
          proposalId: proposal.proposal.id,
          approve: true,
        }),
      ).rejects.toMatchObject({ code: "approval_expired" });
      await client.request({
        type: "startOperation",
        projectId: enrolled.projectId,
        operation: "test",
      });
      await vi.waitFor(
        () =>
          expect(server.snapshot().projects[0]?.processes.test?.phase).toBe(
            "succeeded",
          ),
        { timeout: 5000 },
      );
      expect(
        server
          .snapshot()
          .projects[0]?.processes.test?.recentLogs.some((log) =>
            log.line.includes("checked"),
          ),
      ).toBe(true);
      client.disconnect();
      await reopened.connect(url);
      const snapshot = await reopened.request<{ snapshot: MachineSnapshot }>({
        type: "getSnapshot",
      });
      expect(snapshot.snapshot.projects[0]?.id).toBe(enrolled.projectId);
      expect(snapshot.snapshot.projects[0]?.processes.test?.exitCode).toBe(0);
      await reopened.forget();
      expect(storage.size).toBe(0);
    } finally {
      client.disconnect();
      reopened.disconnect();
      await server.close();
      vi.unstubAllGlobals();
      rmSync(config.discoveryRoots[0]!, { recursive: true, force: true });
    }
  });

  it("expires enrollment approvals", async () => {
    let now = 1_000;
    const config = dynamicFixture();
    config.approvalTtlSeconds = 1;
    const server = new BridgeServer(config, () => now);
    servers.push(server);
    const port = await server.listen();
    const socket = await open(`ws://127.0.0.1:${port}`);
    await request(socket, {
      version: PROTOCOL_VERSION,
      type: "pair",
      requestId: "pair-expiring-enrollment",
      pairingToken: server.pairingToken,
      clientName: "Test phone",
    });
    const discovery = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "discoverRepositories",
      requestId: "expiring-discovery",
    });
    const repositoryId = (
      discovery.data as { repositories: Array<{ id: string }> }
    ).repositories[0]!.id;
    const options = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "getEnrollmentOptions",
      requestId: "expiring-options",
      repositoryId,
    });
    const candidateId = (options.data as { candidates: Array<{ id: string }> })
      .candidates[0]!.id;
    const proposed = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "requestEnrollment",
      requestId: "expiring-proposal",
      repositoryId,
      candidateIds: [candidateId],
    });
    now = 2_000;
    const expired = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "resolveEnrollment",
      requestId: "expired-proposal",
      proposalId: (proposed.data as { proposal: { id: string } }).proposal.id,
      approve: true,
    });
    expect(expired.error?.code).toBe("approval_expired");
    socket.close();
  });

  it("pairs, recovers a snapshot, reviews changes, and consumes deploy approval once", async () => {
    const server = new BridgeServer(fixture());
    servers.push(server);
    const port = await server.listen();
    const socket = await open(`ws://127.0.0.1:${port}`);

    const unauthenticated = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "getSnapshot",
      requestId: "unauth",
    });
    expect(unauthenticated.error?.code).toBe("authentication_required");

    const paired = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "pair",
      requestId: "pair",
      pairingToken: server.pairingToken,
      clientName: "Test phone",
    });
    expect(paired.ok).toBe(true);
    expect((paired.data as { sessionToken: string }).sessionToken).toMatch(
      /^[A-Za-z0-9_-]+$/,
    );

    const snapshot = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "getSnapshot",
      requestId: "snapshot",
    });
    expect(
      (snapshot.data as { snapshot: { projects: unknown[] } }).snapshot
        .projects,
    ).toHaveLength(1);
    expect(
      (
        await request(socket, {
          version: PROTOCOL_VERSION,
          type: "requestProjectRemoval",
          requestId: "remove-static",
          projectId: "site",
        })
      ).error?.code,
    ).toBe("static_project");

    expect(
      (
        await request(socket, {
          version: PROTOCOL_VERSION,
          type: "startOperation",
          requestId: "start-dev",
          projectId: "site",
          operation: "dev",
        })
      ).ok,
    ).toBe(true);

    expect(
      (
        await request(socket, {
          version: PROTOCOL_VERSION,
          type: "startOperation",
          requestId: "start-agent",
          projectId: "site",
          operation: "agent",
        })
      ).ok,
    ).toBe(true);
    const attachment = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "agentAttachment",
      requestId: "attachment",
      projectId: "site",
      mimeType: "image/jpeg",
      base64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64"),
      note: "broken card",
    });
    expect(attachment.ok).toBe(true);
    expect(
      readdirSync(
        join(
          server.config.projects[0]!.repositoryPath,
          ".state",
          "attachments",
        ),
      ),
    ).toHaveLength(1);
    expect(
      (
        await request(socket, {
          version: PROTOCOL_VERSION,
          type: "stopOperation",
          requestId: "stop-agent",
          projectId: "site",
          operation: "agent",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await request(socket, {
          version: PROTOCOL_VERSION,
          type: "stopOperation",
          requestId: "stop-dev",
          projectId: "site",
          operation: "dev",
        })
      ).ok,
    ).toBe(true);

    const review = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "getReview",
      requestId: "review",
      projectId: "site",
    });
    expect(
      (review.data as { review: { files: string[] } }).review.files,
    ).toContain("file.txt");

    const staged = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "stageFile",
      requestId: "stage",
      projectId: "site",
      file: "file.txt",
    });
    expect(
      (staged.data as { review: { stagedFiles: string[] } }).review.stagedFiles,
    ).toContain("file.txt");

    const commitApproval = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "requestApproval",
      requestId: "commit-approval",
      projectId: "site",
      operation: "commit",
      message: "Update fixture",
    });
    const commitApprovalId = (
      commitApproval.data as { approval: { id: string } }
    ).approval.id;
    writeFileSync(
      join(server.config.projects[0]!.repositoryPath, "file.txt"),
      "changed after approval\n",
    );
    execFileSync("git", ["add", "file.txt"], {
      cwd: server.config.projects[0]!.repositoryPath,
    });
    const staleCommit = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "resolveApproval",
      requestId: "stale-commit",
      approvalId: commitApprovalId,
      approve: true,
    });
    expect(staleCommit.error?.code).toBe("approval_stale");
    const freshCommitApproval = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "requestApproval",
      requestId: "fresh-commit-approval",
      projectId: "site",
      operation: "commit",
      message: "Update fixture",
    });
    const committed = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "resolveApproval",
      requestId: "commit",
      approvalId: (freshCommitApproval.data as { approval: { id: string } })
        .approval.id,
      approve: true,
    });
    expect(
      (committed.data as { review: { files: string[] } }).review.files,
    ).not.toContain("file.txt");

    const approvalResponse = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "requestApproval",
      requestId: "approval",
      projectId: "site",
      operation: "deploy",
    });
    const approvalId = (approvalResponse.data as { approval: { id: string } })
      .approval.id;
    const approved = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "resolveApproval",
      requestId: "approve",
      approvalId,
      approve: true,
    });
    expect(approved.ok).toBe(true);

    const replay = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "resolveApproval",
      requestId: "replay",
      approvalId,
      approve: true,
    });
    expect(replay.error?.code).toBe("approval_expired");
    socket.close();
  });

  it("rejects a reused pairing token", async () => {
    const server = new BridgeServer(fixture());
    servers.push(server);
    const port = await server.listen();
    const first = await open(`ws://127.0.0.1:${port}`);
    const second = await open(`ws://127.0.0.1:${port}`);
    const pair = (socket: WebSocket, requestId: string) =>
      request(socket, {
        version: PROTOCOL_VERSION,
        type: "pair",
        requestId,
        pairingToken: server.pairingToken,
        clientName: "Phone",
      });
    expect((await pair(first, "first")).ok).toBe(true);
    expect((await pair(second, "second")).error?.code).toBe("pairing_rejected");
    first.close();
    second.close();
  });

  it("rejects control messages on an already-open socket after session expiry", async () => {
    let now = 1_000;
    const config = fixture();
    config.sessionTtlSeconds = 60;
    const server = new BridgeServer(config, () => now);
    servers.push(server);
    const port = await server.listen();
    const socket = await open(`ws://127.0.0.1:${port}`);
    expect(
      (
        await request(socket, {
          version: PROTOCOL_VERSION,
          type: "pair",
          requestId: "pair-expiry",
          pairingToken: server.pairingToken,
          clientName: "Phone",
        })
      ).ok,
    ).toBe(true);
    now = 61_000;
    const expired = await request(socket, {
      version: PROTOCOL_VERSION,
      type: "getSnapshot",
      requestId: "expired",
    });
    expect(expired.error?.code).toBe("authentication_required");
    socket.close();
  });
});
