import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PENDING_TTL_MS = 5 * 60 * 1000;
const DEVICE_SCOPE_IMPLICATIONS: Readonly<Record<string, readonly string[]>> = {
  "operator.admin": ["operator.read", "operator.write", "operator.approvals", "operator.pairing"],
  "operator.write": ["operator.read"],
};
const LEGACY_STATE_DIRNAMES = [".clawdbot", ".moldbot", ".moltbot"];
const NEW_STATE_DIRNAME = ".openclaw";

type DevicePairingPendingRequest = {
  requestId: string;
  deviceId: string;
  publicKey: string;
  displayName?: string;
  platform?: string;
  deviceFamily?: string;
  clientId?: string;
  clientMode?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  silent?: boolean;
  isRepair?: boolean;
  ts: number;
};

type DeviceAuthToken = {
  token: string;
  role: string;
  scopes: string[];
  createdAtMs: number;
  rotatedAtMs?: number;
  revokedAtMs?: number;
  lastUsedAtMs?: number;
};

type PairedDevice = {
  deviceId: string;
  publicKey: string;
  displayName?: string;
  platform?: string;
  deviceFamily?: string;
  clientId?: string;
  clientMode?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  approvedScopes?: string[];
  remoteIp?: string;
  tokens?: Record<string, DeviceAuthToken>;
  createdAtMs: number;
  approvedAtMs: number;
};

type DevicePairingStateFile = {
  pendingById: Record<string, DevicePairingPendingRequest>;
  pairedByDeviceId: Record<string, PairedDevice>;
};

type NodePairingPendingRequest = {
  requestId: string;
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  remoteIp?: string;
  silent?: boolean;
  isRepair?: boolean;
  ts: number;
};

type NodePairingPairedNode = {
  nodeId: string;
  token: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  remoteIp?: string;
  bins?: string[];
  createdAtMs: number;
  approvedAtMs: number;
  lastConnectedAtMs?: number;
};

type NodePairingStateFile = {
  pendingById: Record<string, NodePairingPendingRequest>;
  pairedByNodeId: Record<string, NodePairingPairedNode>;
};

let stateCommandQueue = Promise.resolve();

function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = stateCommandQueue.then(fn, fn);
  stateCommandQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function normalizeText(value: string | undefined | null): string {
  return value?.trim() ?? "";
}

function resolveHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicitHome = normalizeText(env.OPENCLAW_HOME);
  if (explicitHome) {
    if (explicitHome === "~") {
      return normalizeText(env.HOME) || normalizeText(env.USERPROFILE) || os.homedir();
    }
    if (explicitHome.startsWith("~/") || explicitHome.startsWith("~\\")) {
      const base = normalizeText(env.HOME) || normalizeText(env.USERPROFILE) || os.homedir();
      return path.resolve(explicitHome.replace(/^~(?=$|[\\/])/, base));
    }
    return path.resolve(explicitHome);
  }

  return path.resolve(normalizeText(env.HOME) || normalizeText(env.USERPROFILE) || os.homedir());
}

function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = normalizeText(env.OPENCLAW_STATE_DIR) || normalizeText(env.CLAWDBOT_STATE_DIR);
  if (override) {
    if (override.startsWith("~/") || override.startsWith("~\\")) {
      return path.resolve(override.replace(/^~(?=$|[\\/])/, resolveHomeDir(env)));
    }
    return path.resolve(override);
  }

  const homeDir = resolveHomeDir(env);
  const newDir = path.join(homeDir, NEW_STATE_DIRNAME);
  if (env.OPENCLAW_TEST_FAST === "1") {
    return newDir;
  }

  if (fs.existsSync(newDir)) {
    return newDir;
  }

  for (const legacy of LEGACY_STATE_DIRNAMES) {
    const candidate = path.join(homeDir, legacy);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return newDir;
}

function resolvePairingPaths(subdir: "devices" | "nodes") {
  const dir = path.join(resolveStateDir(), subdir);
  return {
    dir,
    pendingPath: path.join(dir, "pending.json"),
    pairedPath: path.join(dir, "paired.json"),
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fsPromises.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsPromises.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsPromises.rename(tmpPath, filePath);
}

function pruneExpiredPending<T extends { ts: number }>(pendingById: Record<string, T>): void {
  const nowMs = Date.now();
  for (const [id, req] of Object.entries(pendingById)) {
    if (nowMs - req.ts > PENDING_TTL_MS) {
      delete pendingById[id];
    }
  }
}

async function loadDeviceState(): Promise<DevicePairingStateFile> {
  const { pendingPath, pairedPath } = resolvePairingPaths("devices");
  const [pending, paired] = await Promise.all([
    readJsonFile<Record<string, DevicePairingPendingRequest>>(pendingPath),
    readJsonFile<Record<string, PairedDevice>>(pairedPath),
  ]);
  const state: DevicePairingStateFile = {
    pendingById: pending ?? {},
    pairedByDeviceId: paired ?? {},
  };
  pruneExpiredPending(state.pendingById);
  return state;
}

async function persistDeviceState(state: DevicePairingStateFile): Promise<void> {
  const { pendingPath, pairedPath } = resolvePairingPaths("devices");
  await Promise.all([
    writeJsonAtomic(pendingPath, state.pendingById),
    writeJsonAtomic(pairedPath, state.pairedByDeviceId),
  ]);
}

async function loadNodeState(): Promise<NodePairingStateFile> {
  const { pendingPath, pairedPath } = resolvePairingPaths("nodes");
  const [pending, paired] = await Promise.all([
    readJsonFile<Record<string, NodePairingPendingRequest>>(pendingPath),
    readJsonFile<Record<string, NodePairingPairedNode>>(pairedPath),
  ]);
  const state: NodePairingStateFile = {
    pendingById: pending ?? {},
    pairedByNodeId: paired ?? {},
  };
  pruneExpiredPending(state.pendingById);
  return state;
}

async function persistNodeState(state: NodePairingStateFile): Promise<void> {
  const { pendingPath, pairedPath } = resolvePairingPaths("nodes");
  await Promise.all([
    writeJsonAtomic(pendingPath, state.pendingById),
    writeJsonAtomic(pairedPath, state.pairedByNodeId),
  ]);
}

function normalizeDeviceId(deviceId: string): string {
  return normalizeText(deviceId);
}

function normalizeNodeId(nodeId: string): string {
  return normalizeText(nodeId);
}

function normalizeRole(role: string | undefined): string | null {
  const normalized = normalizeText(role);
  return normalized || null;
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  if (!Array.isArray(scopes)) {
    return [];
  }

  const out = new Set<string>();
  for (const scope of scopes) {
    const normalized = normalizeText(scope);
    if (normalized) {
      out.add(normalized);
    }
  }
  return [...out].toSorted();
}

function expandScopeImplications(scopes: string[]): string[] {
  const expanded = new Set(scopes);
  const queue = [...scopes];
  while (queue.length > 0) {
    const scope = queue.pop();
    if (!scope) {
      continue;
    }
    for (const impliedScope of DEVICE_SCOPE_IMPLICATIONS[scope] ?? []) {
      if (!expanded.has(impliedScope)) {
        expanded.add(impliedScope);
        queue.push(impliedScope);
      }
    }
  }
  return [...expanded];
}

function scopesAllow(requested: string[], allowed: string[]): boolean {
  if (requested.length === 0) {
    return true;
  }
  if (allowed.length === 0) {
    return false;
  }

  const allowedSet = new Set(allowed);
  return requested.every((scope) => allowedSet.has(scope));
}

function scopesAllowWithImplications(requested: string[], allowed: string[]): boolean {
  return scopesAllow(expandScopeImplications(requested), expandScopeImplications(allowed));
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function cloneDeviceTokens(device: PairedDevice): Record<string, DeviceAuthToken> {
  return device.tokens ? { ...device.tokens } : {};
}

function buildDeviceAuthToken(params: {
  role: string;
  scopes: string[];
  existing?: DeviceAuthToken;
  now: number;
  rotatedAtMs?: number;
}): DeviceAuthToken {
  return {
    token: newToken(),
    role: params.role,
    scopes: params.scopes,
    createdAtMs: params.existing?.createdAtMs ?? params.now,
    rotatedAtMs: params.rotatedAtMs,
    revokedAtMs: undefined,
    lastUsedAtMs: params.existing?.lastUsedAtMs,
  };
}

function resolveDeviceTokenUpdateContext(
  state: DevicePairingStateFile,
  deviceId: string,
  role: string,
): {
  device: PairedDevice;
  role: string;
  tokens: Record<string, DeviceAuthToken>;
  existing: DeviceAuthToken | undefined;
} | null {
  const device = state.pairedByDeviceId[normalizeDeviceId(deviceId)];
  if (!device) {
    return null;
  }
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) {
    return null;
  }
  const tokens = cloneDeviceTokens(device);
  return {
    device,
    role: normalizedRole,
    tokens,
    existing: tokens[normalizedRole],
  };
}

export async function removePairedDeviceLocally(
  deviceId: string,
): Promise<{ deviceId: string } | null> {
  return await withStateLock(async () => {
    const state = await loadDeviceState();
    const normalized = normalizeDeviceId(deviceId);
    if (!normalized || !state.pairedByDeviceId[normalized]) {
      return null;
    }
    delete state.pairedByDeviceId[normalized];
    await persistDeviceState(state);
    return { deviceId: normalized };
  });
}

export async function clearDevicePairingLocally(params: {
  includePending: boolean;
}): Promise<{ removedDeviceIds: string[]; rejectedRequestIds: string[] }> {
  return await withStateLock(async () => {
    const state = await loadDeviceState();
    const removedDeviceIds = Object.keys(state.pairedByDeviceId).toSorted();
    const rejectedRequestIds = params.includePending
      ? Object.keys(state.pendingById).toSorted()
      : [];

    state.pairedByDeviceId = {};
    if (params.includePending) {
      state.pendingById = {};
    }

    await persistDeviceState(state);
    return { removedDeviceIds, rejectedRequestIds };
  });
}

export async function rejectDevicePairingLocally(
  requestId: string,
): Promise<{ requestId: string; deviceId: string } | null> {
  return await withStateLock(async () => {
    const state = await loadDeviceState();
    const pending = state.pendingById[normalizeText(requestId)];
    if (!pending) {
      return null;
    }

    delete state.pendingById[normalizeText(requestId)];
    await persistDeviceState(state);
    return {
      requestId: normalizeText(requestId),
      deviceId: pending.deviceId,
    };
  });
}

export async function rotateDeviceTokenLocally(params: {
  deviceId: string;
  role: string;
  scopes?: string[];
}): Promise<DeviceAuthToken | null> {
  return await withStateLock(async () => {
    const state = await loadDeviceState();
    const context = resolveDeviceTokenUpdateContext(state, params.deviceId, params.role);
    if (!context) {
      return null;
    }

    const { device, role, tokens, existing } = context;
    const requestedScopes = normalizeScopes(params.scopes ?? existing?.scopes ?? device.scopes);
    const approvedScopes = normalizeScopes(
      device.approvedScopes ?? device.scopes ?? existing?.scopes,
    );
    if (!scopesAllowWithImplications(requestedScopes, approvedScopes)) {
      return null;
    }

    const now = Date.now();
    const next = buildDeviceAuthToken({
      role,
      scopes: requestedScopes,
      existing,
      now,
      rotatedAtMs: now,
    });

    tokens[role] = next;
    device.tokens = tokens;
    state.pairedByDeviceId[device.deviceId] = device;
    await persistDeviceState(state);
    return next;
  });
}

export async function revokeDeviceTokenLocally(params: {
  deviceId: string;
  role: string;
}): Promise<DeviceAuthToken | null> {
  return await withStateLock(async () => {
    const state = await loadDeviceState();
    const normalizedDeviceId = normalizeDeviceId(params.deviceId);
    const device = state.pairedByDeviceId[normalizedDeviceId];
    if (!device) {
      return null;
    }

    const role = normalizeRole(params.role);
    if (!role || !device.tokens?.[role]) {
      return null;
    }

    const tokens = { ...device.tokens };
    const entry = { ...tokens[role], revokedAtMs: Date.now() };
    tokens[role] = entry;
    device.tokens = tokens;
    state.pairedByDeviceId[device.deviceId] = device;
    await persistDeviceState(state);
    return entry;
  });
}

export async function listNodePairingLocally(): Promise<{
  pending: NodePairingPendingRequest[];
  paired: NodePairingPairedNode[];
}> {
  const state = await loadNodeState();
  return {
    pending: Object.values(state.pendingById).toSorted((a, b) => b.ts - a.ts),
    paired: Object.values(state.pairedByNodeId).toSorted((a, b) => b.approvedAtMs - a.approvedAtMs),
  };
}

export async function approveNodePairingLocally(
  requestId: string,
): Promise<{ requestId: string; node: NodePairingPairedNode } | null> {
  return await withStateLock(async () => {
    const state = await loadNodeState();
    const pending = state.pendingById[requestId];
    if (!pending) {
      return null;
    }

    const now = Date.now();
    const existing = state.pairedByNodeId[pending.nodeId];
    const node: NodePairingPairedNode = {
      nodeId: pending.nodeId,
      token: newToken(),
      displayName: pending.displayName,
      platform: pending.platform,
      version: pending.version,
      coreVersion: pending.coreVersion,
      uiVersion: pending.uiVersion,
      deviceFamily: pending.deviceFamily,
      modelIdentifier: pending.modelIdentifier,
      caps: pending.caps,
      commands: pending.commands,
      permissions: pending.permissions,
      remoteIp: pending.remoteIp,
      createdAtMs: existing?.createdAtMs ?? now,
      approvedAtMs: now,
      lastConnectedAtMs: existing?.lastConnectedAtMs,
      bins: existing?.bins,
    };

    delete state.pendingById[requestId];
    state.pairedByNodeId[pending.nodeId] = node;
    await persistNodeState(state);
    return { requestId, node };
  });
}

export async function rejectNodePairingLocally(
  requestId: string,
): Promise<{ requestId: string; nodeId: string } | null> {
  return await withStateLock(async () => {
    const state = await loadNodeState();
    const pending = state.pendingById[requestId];
    if (!pending) {
      return null;
    }

    delete state.pendingById[requestId];
    await persistNodeState(state);
    return {
      requestId,
      nodeId: pending.nodeId,
    };
  });
}

function normalizeNodeLookupKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function listKnownNodes(nodes: NodePairingPairedNode[]): string {
  return nodes
    .map((node) => node.displayName || node.remoteIp || node.nodeId)
    .filter(Boolean)
    .join(", ");
}

function resolvePairedNodeMatches(
  nodes: NodePairingPairedNode[],
  query: string,
): NodePairingPairedNode[] {
  const trimmed = normalizeText(query);
  if (!trimmed) {
    return [];
  }

  const normalized = normalizeNodeLookupKey(trimmed);
  return nodes.filter((node) => {
    if (node.nodeId === trimmed) {
      return true;
    }
    if (typeof node.remoteIp === "string" && normalizeText(node.remoteIp) === trimmed) {
      return true;
    }
    const displayName = normalizeText(node.displayName);
    if (displayName && normalizeNodeLookupKey(displayName) === normalized) {
      return true;
    }
    if (trimmed.length >= 6 && node.nodeId.startsWith(trimmed)) {
      return true;
    }
    return false;
  });
}

function resolvePairedNodeId(state: NodePairingStateFile, query: string): string {
  const trimmed = normalizeText(query);
  if (!trimmed) {
    throw new Error("node required");
  }

  const nodes = Object.values(state.pairedByNodeId);
  const matches = resolvePairedNodeMatches(nodes, trimmed);
  if (matches.length === 1) {
    return matches[0]!.nodeId;
  }
  if (matches.length === 0) {
    const known = listKnownNodes(nodes);
    throw new Error(`unknown node: ${trimmed}${known ? ` (known: ${known})` : ""}`);
  }

  throw new Error(
    `ambiguous node: ${trimmed} (matches: ${matches
      .map((node) => node.displayName || node.remoteIp || node.nodeId)
      .join(", ")})`,
  );
}

export async function renamePairedNodeLocally(params: {
  query: string;
  displayName: string;
}): Promise<{ nodeId: string; displayName: string }> {
  return await withStateLock(async () => {
    const state = await loadNodeState();
    const nodeId = resolvePairedNodeId(state, params.query);
    const existing = state.pairedByNodeId[nodeId];
    if (!existing) {
      throw new Error(`unknown node: ${normalizeText(params.query)}`);
    }

    const displayName = normalizeText(params.displayName);
    if (!displayName) {
      throw new Error("displayName required");
    }

    state.pairedByNodeId[nodeId] = {
      ...existing,
      displayName,
    };
    await persistNodeState(state);
    return { nodeId, displayName };
  });
}
