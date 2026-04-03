import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGlobalSingleton } from "../../../src/shared/global-singleton.js";
import { clearBotmaxRuntime, setBotmaxRuntime } from "./runtime.js";

const { runtimeSnapshotRef } = vi.hoisted(() => ({
  runtimeSnapshotRef: { current: null as OpenClawConfig | null },
}));

vi.mock("openclaw/plugin-sdk/config-runtime", () => ({
  getRuntimeConfigSnapshot: () => runtimeSnapshotRef.current,
}));

import {
  createBotmaxDirectory,
  deleteBotmaxPath,
  listBotmaxFiles,
  readBotmaxFile,
  refreshBotmaxBindingsAfterWrite,
  syncBotmaxManagedRuntimeConfigMirror,
  writeBotmaxFile,
} from "./file-ops.js";

const tempDirs: string[] = [];
const FALLBACK_GATEWAY_CONTEXT_STATE_KEY = Symbol.for(
  "openclaw.fallbackGatewayContextState",
);

function setFallbackGatewayContextForTest(context: {
  stopChannel: (channelId: string, accountId?: string) => Promise<void>;
  startChannel: (channelId: string, accountId?: string) => Promise<void>;
  logGateway: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
}) {
  const state = resolveGlobalSingleton<{
    context?: typeof context;
  }>(FALLBACK_GATEWAY_CONTEXT_STATE_KEY, () => ({ context: undefined }));
  state.context = context;
}

function clearFallbackGatewayContextForTest() {
  const state = resolveGlobalSingleton<{
    context?: unknown;
  }>(FALLBACK_GATEWAY_CONTEXT_STATE_KEY, () => ({ context: undefined }));
  state.context = undefined;
}

afterEach(async () => {
  runtimeSnapshotRef.current = null;
  clearBotmaxRuntime();
  clearFallbackGatewayContextForTest();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "botmax-file-ops-"));
  tempDirs.push(dir);
  return dir;
}

describe("botmax file operations", () => {
  it("reads utf8 text files", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "demo.txt");
    await writeFile(filePath, "hello world", "utf8");

    const result = await readBotmaxFile({
      path: filePath,
      encoding: "utf8",
    });

    expect(result).toEqual({
      path: filePath,
      encoding: "utf8",
      content: "hello world",
      sizeBytes: 11,
    });
  });

  it("reads binary files as base64", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "demo.bin");
    const buffer = Buffer.from([0x00, 0x01, 0xff, 0x7f]);
    await writeFile(filePath, buffer);

    const result = await readBotmaxFile({
      path: filePath,
      encoding: "base64",
    });

    expect(result).toEqual({
      path: filePath,
      encoding: "base64",
      content: buffer.toString("base64"),
      sizeBytes: 4,
    });
  });

  it("writes utf8 files and creates parent directories by default", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "nested", "demo.txt");

    const result = await writeBotmaxFile({
      path: filePath,
      content: "hello nested",
      encoding: "utf8",
    });

    expect(result).toEqual({
      path: filePath,
      encoding: "utf8",
      sizeBytes: 12,
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe("hello nested");
  });

  it("lists directory entries with directories first", async () => {
    const dir = await createTempDir();
    const nestedDir = join(dir, "nested");
    const filePath = join(dir, "demo.txt");
    await createBotmaxDirectory({ path: nestedDir });
    await writeFile(filePath, "hello world", "utf8");

    const result = await listBotmaxFiles({
      path: dir,
      includeHidden: true,
    });

    expect(result.path).toBe(dir);
    expect(result.parentPath).toBe(join(dir, ".."));
    expect(result.entries.map((entry) => [entry.name, entry.entryType])).toEqual([
      ["nested", "directory"],
      ["demo.txt", "file"],
    ]);
    expect(result.entries[1]).toMatchObject({
      name: "demo.txt",
      extension: ".txt",
      sizeBytes: 11,
    });
  });

  it("rejects invalid base64 writes", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "demo.bin");

    await expect(
      writeBotmaxFile({
        path: filePath,
        content: "!not-base64!",
        encoding: "base64",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_BASE64",
    });
  });

  it("maps missing file reads to FILE_NOT_FOUND", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "missing.txt");

    await expect(
      readBotmaxFile({
        path: filePath,
        encoding: "utf8",
      }),
    ).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
      message: `file not found: ${filePath}`,
    });
  });

  it("creates directories recursively", async () => {
    const dir = await createTempDir();
    const nestedDir = join(dir, "nested", "deep");

    const result = await createBotmaxDirectory({
      path: nestedDir,
      recursive: true,
    });

    expect(result).toEqual({
      path: nestedDir,
      entryType: "directory",
    });
  });

  it("deletes files", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "delete-me.txt");
    await writeFile(filePath, "bye", "utf8");

    const result = await deleteBotmaxPath({
      path: filePath,
      encoding: "utf8",
    });

    expect(result).toEqual({
      path: filePath,
      entryType: "file",
      encoding: "utf8",
      sizeBytes: 3,
    });
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("deletes directories recursively", async () => {
    const dir = await createTempDir();
    const nestedDir = join(dir, "delete-dir");
    const nestedFile = join(nestedDir, "demo.txt");
    await createBotmaxDirectory({ path: nestedDir });
    await writeFile(nestedFile, "bye", "utf8");

    const result = await deleteBotmaxPath({
      path: nestedDir,
      encoding: "utf8",
    });

    expect(result).toEqual({
      path: nestedDir,
      entryType: "directory",
      encoding: "utf8",
      sizeBytes: 0,
    });
    await expect(readFile(nestedFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("mirrors managed bindings writes into the active runtime snapshots", () => {
    const runtimeSnapshot: OpenClawConfig = {
      bindings: [
        { agentId: "main", match: { channel: "slack", accountId: "default" } },
      ],
      channels: { slack: { enabled: true } },
    };
    runtimeSnapshotRef.current = runtimeSnapshot;

    syncBotmaxManagedRuntimeConfigMirror({
      path: "/root/.openclaw/bindings.json",
      content: JSON.stringify([
        {
          agentId: "research",
          match: { channel: "slack", accountId: "default" },
        },
      ]),
    });

    expect(runtimeSnapshot.bindings).toEqual([
      {
        agentId: "research",
        match: { channel: "slack", accountId: "default" },
      },
    ]);
    expect(runtimeSnapshotRef.current?.bindings).toEqual([
      {
        agentId: "research",
        match: { channel: "slack", accountId: "default" },
      },
    ]);
  });

  it("prefers the injected botmax runtime config target when available", () => {
    const liveRuntimeConfig: OpenClawConfig = {
      bindings: [
        { agentId: "main", match: { channel: "slack", accountId: "default" } },
      ],
    };
    const runtimeSnapshot: OpenClawConfig = {
      bindings: [
        { agentId: "main", match: { channel: "slack", accountId: "default" } },
      ],
    };
    runtimeSnapshotRef.current = runtimeSnapshot;

    setBotmaxRuntime({
      version: "test",
      config: {
        loadConfig: () => liveRuntimeConfig,
        writeConfigFile: vi.fn(),
      },
      logging: {
        shouldLogVerbose: vi.fn(),
        getChildLogger: () => ({
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        }),
      },
    } as never);

    const mirrored = syncBotmaxManagedRuntimeConfigMirror({
      path: "/root/.openclaw/bindings.json",
      content: JSON.stringify([
        {
          agentId: "research",
          match: { channel: "slack", accountId: "default" },
        },
      ]),
    });

    expect(mirrored).toBe(true);
    expect(liveRuntimeConfig.bindings).toEqual([
      {
        agentId: "research",
        match: { channel: "slack", accountId: "default" },
      },
    ]);
    expect(runtimeSnapshot.bindings).toEqual([
      {
        agentId: "research",
        match: { channel: "slack", accountId: "default" },
      },
    ]);
  });

  it("ignores invalid managed config JSON while leaving snapshots untouched", () => {
    const runtimeSnapshot: OpenClawConfig = {
      bindings: [
        { agentId: "main", match: { channel: "feishu", accountId: "default" } },
      ],
    };
    runtimeSnapshotRef.current = runtimeSnapshot;

    syncBotmaxManagedRuntimeConfigMirror({
      path: "/root/.openclaw/bindings.json",
      content: "{not-json",
    });

    expect(runtimeSnapshot.bindings).toEqual([
      { agentId: "main", match: { channel: "feishu", accountId: "default" } },
    ]);
  });

  it("restarts affected channel accounts after managed bindings writes when mirror fallback is needed", async () => {
    const stopChannel = vi.fn(async () => {});
    const startChannel = vi.fn(async () => {});
    setFallbackGatewayContextForTest({
      stopChannel,
      startChannel,
      logGateway: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    });

    await refreshBotmaxBindingsAfterWrite({
      previousBindings: [
        {
          agentId: "main",
          match: { channel: "slack", accountId: "t0amkdte7a6" },
        },
        {
          agentId: "main",
          match: { channel: "telegram", accountId: "baoozibot" },
        },
      ],
      nextBindings: [
        {
          agentId: "coder",
          match: { channel: "slack", accountId: "t0amkdte7a6" },
        },
        {
          agentId: "research",
          match: { channel: "telegram", accountId: "baoozibot" },
        },
      ],
    });

    expect(stopChannel).toHaveBeenCalledTimes(2);
    expect(stopChannel).toHaveBeenCalledWith("slack", "t0amkdte7a6");
    expect(stopChannel).toHaveBeenCalledWith("telegram", "baoozibot");
    expect(startChannel).toHaveBeenCalledTimes(2);
    expect(startChannel).toHaveBeenCalledWith("slack", "t0amkdte7a6");
    expect(startChannel).toHaveBeenCalledWith("telegram", "baoozibot");
  });

  it("reports when bindings hot reload lacks a gateway restart context", async () => {
    clearFallbackGatewayContextForTest();

    const outcome = await refreshBotmaxBindingsAfterWrite({
      previousBindings: [
        {
          agentId: "main",
          match: { channel: "slack", accountId: "t0amkdte7a6" },
        },
      ],
      nextBindings: [
        {
          agentId: "coder",
          match: { channel: "slack", accountId: "t0amkdte7a6" },
        },
      ],
    });

    expect(outcome).toEqual({
      status: "context-unavailable",
      targets: [{ channelId: "slack", accountId: "t0amkdte7a6" }],
    });
  });
});
