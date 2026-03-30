import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  getRuntimeConfigSnapshot,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/config-runtime";
import type { GatewayRequestHandlerOptions } from "openclaw/plugin-sdk/core";
import { normalizeAccountId } from "openclaw/plugin-sdk/routing";
import { resolveGlobalSingleton } from "openclaw/plugin-sdk/text-runtime";
import type { BotmaxFileEncoding } from "./message-format.js";
import { getBotmaxRuntime } from "./runtime.js";

type ChannelId = string;
type GatewayRequestContext = GatewayRequestHandlerOptions["context"];

export type BotmaxFileReadResult = {
  path: string;
  encoding: BotmaxFileEncoding;
  content: string;
  sizeBytes: number;
};

export type BotmaxFileWriteResult = {
  path: string;
  encoding: BotmaxFileEncoding;
  sizeBytes: number;
};

export type BotmaxFileDeleteResult = {
  path: string;
  encoding: BotmaxFileEncoding;
  sizeBytes: number;
};

type ManagedRuntimeSection = "models" | "agents" | "bindings" | "channels";

type OpenClawBindingEntry = {
  match?: {
    channel?: unknown;
    accountId?: unknown;
  };
};

type ManagedRuntimeRestartTarget = {
  channelId: string;
  accountId?: string;
};

type ManagedRuntimeRestartOutcome =
  | { status: "no-targets" }
  | { status: "context-unavailable"; targets: ManagedRuntimeRestartTarget[] }
  | { status: "restarted"; targets: ManagedRuntimeRestartTarget[] };

const MANAGED_RUNTIME_SECTION_BY_PATH: Record<string, ManagedRuntimeSection> = {
  "/root/.openclaw/models.json": "models",
  "/root/.openclaw/agents.json": "agents",
  "/root/.openclaw/bindings.json": "bindings",
  "/root/.openclaw/channels.json": "channels",
};

const FALLBACK_GATEWAY_CONTEXT_STATE_KEY: unique symbol = Symbol.for(
  "openclaw.fallbackGatewayContextState",
);

type FallbackGatewayContext = Pick<
  GatewayRequestContext,
  "logGateway" | "startChannel" | "stopChannel"
>;

type FallbackGatewayContextState = {
  context: FallbackGatewayContext | undefined;
};

const fallbackGatewayContextState =
  resolveGlobalSingleton<FallbackGatewayContextState>(
    FALLBACK_GATEWAY_CONTEXT_STATE_KEY,
    () => ({ context: undefined }),
  );

const CHANNELS_EXCLUDED_FROM_BINDING_RESTART_FALLBACK = new Set(["botmax"]);

export class BotmaxFileOperationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BotmaxFileOperationError";
    this.code = code;
  }
}

function normalizeManagedRuntimePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function resolveManagedRuntimeSection(
  path: string,
): ManagedRuntimeSection | null {
  return (
    MANAGED_RUNTIME_SECTION_BY_PATH[normalizeManagedRuntimePath(path)] ?? null
  );
}

function cloneManagedRuntimeValue<T>(value: T): T {
  return structuredClone(value);
}

function parseBotmaxJsonContent(content: string): unknown | undefined {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function updateManagedRuntimeSection(
  target: OpenClawConfig | null,
  section: ManagedRuntimeSection,
  nextValue: unknown,
): void {
  if (!target) {
    return;
  }
  (target as Record<string, unknown>)[section] =
    cloneManagedRuntimeValue(nextValue);
}

function resolveManagedRuntimeMirrorTargets(): OpenClawConfig[] {
  const targets: OpenClawConfig[] = [];

  try {
    const runtimeConfig = getBotmaxRuntime().config.loadConfig();
    if (runtimeConfig && typeof runtimeConfig === "object") {
      targets.push(runtimeConfig);
    }
  } catch {
    // Botmax file operations also run in tests or early startup paths where
    // the plugin runtime may not be initialized yet.
  }

  const runtimeSnapshot = getRuntimeConfigSnapshot();
  if (
    runtimeSnapshot &&
    typeof runtimeSnapshot === "object" &&
    !targets.includes(runtimeSnapshot)
  ) {
    targets.push(runtimeSnapshot);
  }

  return targets;
}

function logBotmaxRuntimeMirror(message: string): void {
  console.log(`[botmax] ${message}`);
  try {
    const runtime = getBotmaxRuntime();
    runtime.logging
      .getChildLogger({ plugin: "botmax", feature: "managed-config-mirror" })
      .info(message);
  } catch {
    // Console log above is the canonical fallback for container diagnostics.
  }
}

function resolveFallbackGatewayContext(): FallbackGatewayContext | null {
  return fallbackGatewayContextState.context ?? null;
}

function normalizeBindingChannelId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolveBindingRestartAccountId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() === "*") {
    return undefined;
  }
  return normalizeAccountId(typeof value === "string" ? value : undefined);
}

function addBindingRestartTargets(
  plan: Map<string, { allAccounts: boolean; accountIds: Set<string> }>,
  bindings: unknown,
): void {
  if (!Array.isArray(bindings)) {
    return;
  }

  for (const entry of bindings as OpenClawBindingEntry[]) {
    const channelId = normalizeBindingChannelId(entry?.match?.channel);
    if (
      !channelId ||
      CHANNELS_EXCLUDED_FROM_BINDING_RESTART_FALLBACK.has(channelId)
    ) {
      continue;
    }

    const accountId = resolveBindingRestartAccountId(entry?.match?.accountId);
    const existing = plan.get(channelId) ?? {
      allAccounts: false,
      accountIds: new Set<string>(),
    };
    if (accountId) {
      if (!existing.allAccounts) {
        existing.accountIds.add(accountId);
      }
    } else {
      existing.allAccounts = true;
      existing.accountIds.clear();
    }
    plan.set(channelId, existing);
  }
}

function buildBindingRestartTargets(params: {
  previousBindings: unknown;
  nextBindings: unknown;
}): ManagedRuntimeRestartTarget[] {
  if (isDeepStrictEqual(params.previousBindings, params.nextBindings)) {
    return [];
  }

  const plan = new Map<
    string,
    { allAccounts: boolean; accountIds: Set<string> }
  >();
  addBindingRestartTargets(plan, params.previousBindings);
  addBindingRestartTargets(plan, params.nextBindings);

  const targets: ManagedRuntimeRestartTarget[] = [];
  for (const [channelId, state] of plan) {
    if (state.allAccounts || state.accountIds.size === 0) {
      targets.push({ channelId });
      continue;
    }
    for (const accountId of state.accountIds) {
      targets.push({ channelId, accountId });
    }
  }
  return targets;
}

async function restartManagedRuntimeTargets(params: {
  targets: ManagedRuntimeRestartTarget[];
}): Promise<ManagedRuntimeRestartOutcome> {
  const context = resolveFallbackGatewayContext();

  if (params.targets.length === 0) {
    console.log("[botmax] bindings hot reload skipped: no restart targets");
    context?.logGateway.info(
      "[botmax] bindings hot reload skipped: no restart targets",
    );
    return { status: "no-targets" };
  }

  if (!context) {
    const targetSummary = params.targets
      .map((target) =>
        target.accountId
          ? `${target.channelId}:${target.accountId}`
          : target.channelId,
      )
      .join(", ");
    console.log(
      `[botmax] bindings hot reload skipped: fallback gateway context unavailable (targets: ${targetSummary})`,
    );
    return { status: "context-unavailable", targets: params.targets };
  }

  console.log(
    `[botmax] bindings hot reload active; restart targets: ${params.targets
      .map((target) =>
        target.accountId
          ? `${target.channelId}:${target.accountId}`
          : target.channelId,
      )
      .join(", ")}`,
  );
  context.logGateway.info(
    `[botmax] bindings hot reload active; restart targets: ${params.targets
      .map((target) =>
        target.accountId
          ? `${target.channelId}:${target.accountId}`
          : target.channelId,
      )
      .join(", ")}`,
  );

  for (const target of params.targets) {
    const label = target.accountId
      ? `${target.channelId}:${target.accountId}`
      : target.channelId;
    try {
      console.log(`[botmax] restarting channel after bindings write: ${label}`);
      context.logGateway.info(
        `[botmax] restarting channel after bindings write: ${label}`,
      );
      await context.stopChannel(
        target.channelId as ChannelId,
        target.accountId,
      );
      await context.startChannel(
        target.channelId as ChannelId,
        target.accountId,
      );
    } catch (error) {
      context.logGateway.warn(
        `[botmax] failed to restart channel after bindings write (${label}): ${String(error)}`,
      );
    }
  }

  return { status: "restarted", targets: params.targets };
}

export async function refreshBotmaxBindingsAfterWrite(params: {
  previousBindings: unknown;
  nextBindings: unknown;
}): Promise<ManagedRuntimeRestartOutcome> {
  return await restartManagedRuntimeTargets({
    targets: buildBindingRestartTargets(params),
  });
}

export function syncBotmaxManagedRuntimeConfigMirror(params: {
  path: string;
  content: string;
}): boolean {
  const section = resolveManagedRuntimeSection(params.path);
  if (!section) {
    return false;
  }

  const runtimeTargets = resolveManagedRuntimeMirrorTargets();
  if (runtimeTargets.length === 0) {
    logBotmaxRuntimeMirror(
      `managed config mirror skipped for ${section}: no live runtime targets`,
    );
    return false;
  }

  const parsed = parseBotmaxJsonContent(params.content);
  if (parsed === undefined) {
    logBotmaxRuntimeMirror(
      `managed config mirror skipped for ${section}: invalid JSON payload`,
    );
    return false;
  }

  for (const target of runtimeTargets) {
    updateManagedRuntimeSection(target, section, parsed);
  }
  logBotmaxRuntimeMirror(
    `managed config mirror applied for ${section}: updated ${runtimeTargets.length} live target(s)`,
  );
  return true;
}

export function normalizeBotmaxFileEncoding(
  value: string | undefined,
): BotmaxFileEncoding {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "utf8" || normalized === "utf-8") {
    return "utf8";
  }
  if (normalized === "base64") {
    return "base64";
  }
  throw new BotmaxFileOperationError(
    "INVALID_ENCODING",
    `unsupported file encoding: ${value}`,
  );
}

export async function readBotmaxFile(params: {
  path: string;
  encoding?: string;
}): Promise<BotmaxFileReadResult> {
  const normalizedPath = requirePath(params.path);
  const encoding = normalizeBotmaxFileEncoding(params.encoding);

  try {
    const buffer = await readFile(normalizedPath);
    return {
      path: normalizedPath,
      encoding,
      content: encodeContent(buffer, encoding),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    throw mapFileOperationError(normalizedPath, error);
  }
}

export async function writeBotmaxFile(params: {
  path: string;
  content: string;
  encoding?: string;
  ensureDirectory?: boolean;
}): Promise<BotmaxFileWriteResult> {
  const normalizedPath = requirePath(params.path);
  const encoding = normalizeBotmaxFileEncoding(params.encoding);
  const managedSection = resolveManagedRuntimeSection(normalizedPath);
  let previousManagedBindings: unknown;

  try {
    if (params.ensureDirectory ?? true) {
      await mkdir(dirname(normalizedPath), { recursive: true });
    }

    if (managedSection === "bindings") {
      try {
        previousManagedBindings = parseBotmaxJsonContent(
          await readFile(normalizedPath, "utf8"),
        );
      } catch {
        previousManagedBindings = getRuntimeConfigSnapshot()?.bindings;
      }
    }

    const buffer = decodeContent(params.content, encoding);
    await writeFile(normalizedPath, buffer);
    const utf8Content =
      encoding === "utf8" ? params.content : buffer.toString("utf8");
    const parsedManagedContent = parseBotmaxJsonContent(utf8Content);

    if (managedSection !== "channels") {
      const mirroredManagedRuntime = syncBotmaxManagedRuntimeConfigMirror({
        path: normalizedPath,
        content: utf8Content,
      });
      if (managedSection === "bindings" && !mirroredManagedRuntime) {
        await refreshBotmaxBindingsAfterWrite({
          previousBindings: previousManagedBindings,
          nextBindings: parsedManagedContent,
        });
      }
    }

    return {
      path: normalizedPath,
      encoding,
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    throw mapFileOperationError(normalizedPath, error);
  }
}

export async function deleteBotmaxFile(params: {
  path: string;
  encoding?: string;
}): Promise<BotmaxFileDeleteResult> {
  const normalizedPath = requirePath(params.path);
  const encoding = normalizeBotmaxFileEncoding(params.encoding);

  try {
    await unlink(normalizedPath);
    return {
      path: normalizedPath,
      encoding,
      sizeBytes: 0,
    };
  } catch (error) {
    throw mapFileOperationError(normalizedPath, error);
  }
}

function requirePath(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new BotmaxFileOperationError("INVALID_PATH", "path is required");
  }
  return normalized;
}

function encodeContent(buffer: Buffer, encoding: BotmaxFileEncoding): string {
  if (encoding === "base64") {
    return buffer.toString("base64");
  }
  return buffer.toString("utf8");
}

function decodeContent(content: string, encoding: BotmaxFileEncoding): Buffer {
  if (encoding === "base64") {
    return decodeBase64(content);
  }
  return Buffer.from(content, "utf8");
}

function decodeBase64(content: string): Buffer {
  const normalized = content.trim();
  if (!normalized) {
    return Buffer.alloc(0);
  }
  if (
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new BotmaxFileOperationError(
      "INVALID_BASE64",
      "content is not valid base64",
    );
  }
  const buffer = Buffer.from(normalized, "base64");
  if (buffer.toString("base64") !== normalized) {
    throw new BotmaxFileOperationError(
      "INVALID_BASE64",
      "content is not valid base64",
    );
  }
  return buffer;
}

function mapFileOperationError(
  path: string,
  error: unknown,
): BotmaxFileOperationError {
  if (error instanceof BotmaxFileOperationError) {
    return error;
  }

  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;

  if (code === "ENOENT") {
    return new BotmaxFileOperationError(
      "FILE_NOT_FOUND",
      `file not found: ${path}`,
    );
  }
  if (code === "EACCES" || code === "EPERM") {
    return new BotmaxFileOperationError(
      "ACCESS_DENIED",
      `access denied: ${path}`,
    );
  }
  if (code === "EISDIR") {
    return new BotmaxFileOperationError(
      "IS_DIRECTORY",
      `path is a directory: ${path}`,
    );
  }

  return new BotmaxFileOperationError(
    "FILE_OPERATION_FAILED",
    error instanceof Error ? error.message : String(error),
  );
}
