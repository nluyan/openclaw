import {
  approveNodePairingLocally,
  clearDevicePairingLocally,
  listNodePairingLocally,
  renamePairedNodeLocally,
  rejectNodePairingLocally,
  removePairedDeviceLocally,
  revokeDeviceTokenLocally,
  rotateDeviceTokenLocally,
} from "./local-state-commands.js";
import {
  approveDevicePairing,
  listDevicePairing,
  runPluginCommandWithTimeout,
} from "./runtime-api.js";

type CommandMapping =
  | {
      kind: "devices.list";
      method: "device.pair.list";
    }
  | {
      kind: "devices.approve";
      method: "device.pair.approve";
      requestId?: string;
      latest: boolean;
    }
  | {
      kind: "devices.reject";
      method: "device.pair.reject";
      requestId: string;
    }
  | {
      kind: "devices.remove";
      method: "device.pair.remove";
      deviceId: string;
    }
  | {
      kind: "devices.clear";
      method: "device.pair.clear";
      includePending: boolean;
    }
  | {
      kind: "devices.rotate";
      method: "device.token.rotate";
      deviceId: string;
      role: string;
      scopes?: string[];
    }
  | {
      kind: "devices.revoke";
      method: "device.token.revoke";
      deviceId: string;
      role: string;
    }
  | {
      kind: "nodes.pending";
      method: "node.pair.list";
    }
  | {
      kind: "nodes.approve";
      method: "node.pair.approve";
      requestId: string;
    }
  | {
      kind: "nodes.reject";
      method: "node.pair.reject";
      requestId: string;
    }
  | {
      kind: "nodes.rename";
      method: "node.rename";
      nodeQuery: string;
      displayName: string;
    }
  | {
      kind: "gateway.restart";
      method: "gateway.restart";
      delayMs?: number;
      reason?: string;
    }
  | {
      kind: "command.forward";
      argv: string[];
    };

export type BotmaxCommandExecutionResult = {
  ok: boolean;
  method?: string;
  data?: unknown;
  output: string;
};

const DOUBLE_QUOTE_ESCAPES = new Set(["\\", '"', "$", "`", "\n", "\r"]);
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

function stringifyResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isDoubleQuoteEscape(next: string | undefined): next is string {
  return Boolean(next && DOUBLE_QUOTE_ESCAPES.has(next));
}

function splitCommandArgs(raw: string): string[] | null {
  const tokens: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  const pushToken = () => {
    if (buf.length > 0) {
      tokens.push(buf);
      buf = "";
    }
  };

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (!inSingle && !inDouble && ch === "\\") {
      escaped = true;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        buf += ch;
      }
      continue;
    }
    if (inDouble) {
      const next = raw[i + 1];
      if (ch === "\\" && isDoubleQuoteEscape(next)) {
        buf += next;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (/\s/.test(ch)) {
      pushToken();
      continue;
    }
    buf += ch;
  }

  if (escaped || inSingle || inDouble) {
    return null;
  }
  pushToken();
  return tokens;
}

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (!value) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return undefined;
}

function parseNonNegativeInteger(value: string, flagName: string): number {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${flagName} requires a non-negative integer`);
  }
  return Number.parseInt(normalized, 10);
}

function readOptionValue(tokens: string[], index: number): { value?: string; nextIndex: number } {
  const current = tokens[index] ?? "";
  const equalIndex = current.indexOf("=");
  if (equalIndex > 0) {
    return {
      value: current.slice(equalIndex + 1).trim(),
      nextIndex: index,
    };
  }
  const candidate = tokens[index + 1];
  if (!candidate || candidate.startsWith("--")) {
    return { value: undefined, nextIndex: index };
  }
  return {
    value: candidate,
    nextIndex: index + 1,
  };
}

function isJsonFlag(token: string): boolean {
  return token === "--json";
}

function tryMapDevicesList(tokens: string[]): CommandMapping | null {
  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    return null;
  }

  return {
    kind: "devices.list",
    method: "device.pair.list",
  };
}

function tryMapDevicesApprove(tokens: string[]): CommandMapping | null {
  let requestId: string | undefined;
  let latest = false;

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    if (token.startsWith("--request-id")) {
      const { value, nextIndex } = readOptionValue(tokens, index);
      if (!value) {
        throw new Error("--request-id requires a value");
      }
      requestId = value.trim();
      index = nextIndex;
      continue;
    }
    if (token.startsWith("--latest")) {
      const { value, nextIndex } = readOptionValue(tokens, index);
      const parsed = parseBooleanFlag(value);
      latest = parsed ?? true;
      index = nextIndex;
      continue;
    }
    if (token.startsWith("--")) {
      return null;
    }
    if (!requestId) {
      requestId = token.trim();
      continue;
    }
    return null;
  }

  if (!requestId && !latest) {
    latest = true;
  }
  if (!latest && !requestId) {
    throw new Error("openclaw devices approve requires requestId or --latest");
  }

  return {
    kind: "devices.approve",
    method: "device.pair.approve",
    requestId,
    latest,
  };
}

function tryMapDevicesReject(tokens: string[]): CommandMapping | null {
  let requestId: string | undefined;

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    if (token.startsWith("--request-id")) {
      const { value, nextIndex } = readOptionValue(tokens, index);
      if (!value) {
        throw new Error("--request-id requires a value");
      }
      requestId = value.trim();
      index = nextIndex;
      continue;
    }
    if (token.startsWith("--")) {
      return null;
    }
    if (!requestId) {
      requestId = token.trim();
      continue;
    }
    return null;
  }

  if (!requestId) {
    throw new Error("openclaw devices reject requires requestId");
  }

  return {
    kind: "devices.reject",
    method: "device.pair.reject",
    requestId,
  };
}

function tryMapDevicesRemove(tokens: string[]): CommandMapping | null {
  let deviceId: string | undefined;

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    if (token.startsWith("--")) {
      return null;
    }
    if (!deviceId) {
      deviceId = token.trim();
      continue;
    }
    return null;
  }

  if (!deviceId) {
    throw new Error("openclaw devices remove requires deviceId");
  }

  return {
    kind: "devices.remove",
    method: "device.pair.remove",
    deviceId,
  };
}

function tryMapDevicesClear(tokens: string[]): CommandMapping | null {
  let yes = false;
  let includePending = false;

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    if (token.startsWith("--yes")) {
      const { value, nextIndex } = readOptionValue(tokens, index);
      const parsed = parseBooleanFlag(value);
      yes = parsed ?? true;
      index = nextIndex;
      continue;
    }
    if (token.startsWith("--pending")) {
      const { value, nextIndex } = readOptionValue(tokens, index);
      const parsed = parseBooleanFlag(value);
      includePending = parsed ?? true;
      index = nextIndex;
      continue;
    }
    return null;
  }

  if (!yes) {
    throw new Error("openclaw devices clear requires --yes");
  }

  return {
    kind: "devices.clear",
    method: "device.pair.clear",
    includePending,
  };
}

function readRequiredLongOption(
  tokens: string[],
  startIndex: number,
  optionName: string,
): { value: string; nextIndex: number } {
  const { value, nextIndex } = readOptionValue(tokens, startIndex);
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${optionName} requires a value`);
  }
  return {
    value: normalized,
    nextIndex,
  };
}

function tryMapDevicesRotate(tokens: string[]): CommandMapping | null {
  let deviceId: string | undefined;
  let role: string | undefined;
  const scopes: string[] = [];

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    if (token.startsWith("--device")) {
      const resolved = readRequiredLongOption(tokens, index, "--device");
      deviceId = resolved.value;
      index = resolved.nextIndex;
      continue;
    }
    if (token.startsWith("--role")) {
      const resolved = readRequiredLongOption(tokens, index, "--role");
      role = resolved.value;
      index = resolved.nextIndex;
      continue;
    }
    if (token.startsWith("--scope")) {
      const resolved = readRequiredLongOption(tokens, index, "--scope");
      scopes.push(resolved.value);
      index = resolved.nextIndex;
      continue;
    }
    return null;
  }

  if (!deviceId || !role) {
    throw new Error("openclaw devices rotate requires --device and --role");
  }

  return {
    kind: "devices.rotate",
    method: "device.token.rotate",
    deviceId,
    role,
    scopes: scopes.length > 0 ? scopes : undefined,
  };
}

function tryMapDevicesRevoke(tokens: string[]): CommandMapping | null {
  let deviceId: string | undefined;
  let role: string | undefined;

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    if (token.startsWith("--device")) {
      const resolved = readRequiredLongOption(tokens, index, "--device");
      deviceId = resolved.value;
      index = resolved.nextIndex;
      continue;
    }
    if (token.startsWith("--role")) {
      const resolved = readRequiredLongOption(tokens, index, "--role");
      role = resolved.value;
      index = resolved.nextIndex;
      continue;
    }
    return null;
  }

  if (!deviceId || !role) {
    throw new Error("openclaw devices revoke requires --device and --role");
  }

  return {
    kind: "devices.revoke",
    method: "device.token.revoke",
    deviceId,
    role,
  };
}

function tryMapNodesPending(tokens: string[]): CommandMapping | null {
  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    return null;
  }

  return {
    kind: "nodes.pending",
    method: "node.pair.list",
  };
}

function tryMapNodesApprove(tokens: string[]): CommandMapping | null {
  let requestId: string | undefined;

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    if (token.startsWith("--request-id")) {
      const resolved = readRequiredLongOption(tokens, index, "--request-id");
      requestId = resolved.value;
      index = resolved.nextIndex;
      continue;
    }
    if (token.startsWith("--")) {
      return null;
    }
    if (!requestId) {
      requestId = token.trim();
      continue;
    }
    return null;
  }

  if (!requestId) {
    throw new Error("openclaw nodes approve requires requestId");
  }

  return {
    kind: "nodes.approve",
    method: "node.pair.approve",
    requestId,
  };
}

function tryMapNodesReject(tokens: string[]): CommandMapping | null {
  let requestId: string | undefined;

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    if (token.startsWith("--request-id")) {
      const resolved = readRequiredLongOption(tokens, index, "--request-id");
      requestId = resolved.value;
      index = resolved.nextIndex;
      continue;
    }
    if (token.startsWith("--")) {
      return null;
    }
    if (!requestId) {
      requestId = token.trim();
      continue;
    }
    return null;
  }

  if (!requestId) {
    throw new Error("openclaw nodes reject requires requestId");
  }

  return {
    kind: "nodes.reject",
    method: "node.pair.reject",
    requestId,
  };
}

function tryMapNodesRename(tokens: string[]): CommandMapping | null {
  let nodeQuery: string | undefined;
  let displayName: string | undefined;

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    if (token.startsWith("--node")) {
      const resolved = readRequiredLongOption(tokens, index, "--node");
      nodeQuery = resolved.value;
      index = resolved.nextIndex;
      continue;
    }
    if (token.startsWith("--name")) {
      const resolved = readRequiredLongOption(tokens, index, "--name");
      displayName = resolved.value;
      index = resolved.nextIndex;
      continue;
    }
    return null;
  }

  if (!nodeQuery || !displayName) {
    throw new Error("openclaw nodes rename requires --node and --name");
  }

  return {
    kind: "nodes.rename",
    method: "node.rename",
    nodeQuery,
    displayName,
  };
}

function tryMapGatewayRestart(tokens: string[]): CommandMapping | null {
  let delayMs: number | undefined;
  let reason: string | undefined;

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    if (token.startsWith("--delay-ms")) {
      const resolved = readRequiredLongOption(tokens, index, "--delay-ms");
      delayMs = parseNonNegativeInteger(resolved.value, "--delay-ms");
      index = resolved.nextIndex;
      continue;
    }
    if (token.startsWith("--reason")) {
      const resolved = readRequiredLongOption(tokens, index, "--reason");
      reason = resolved.value.trim();
      index = resolved.nextIndex;
      continue;
    }
    return null;
  }

  return {
    kind: "gateway.restart",
    method: "gateway.restart",
    delayMs,
    reason,
  };
}

function mapCommand(tokens: string[]): CommandMapping {
  if (tokens.length === 0) {
    throw new Error("command is empty");
  }
  if (tokens[0].toLowerCase() !== "openclaw") {
    throw new Error("command must start with 'openclaw'");
  }

  const namespace = tokens[1]?.toLowerCase();
  const action = tokens[2]?.toLowerCase();

  if (namespace === "gateway" && action === "call") {
    throw new Error("openclaw gateway call is no longer supported; use a direct openclaw command");
  }

  if (namespace === "gateway" && action === "restart") {
    return tryMapGatewayRestart(tokens) ?? { kind: "command.forward", argv: tokens };
  }

  if (namespace === "devices") {
    if (action === "list") {
      return tryMapDevicesList(tokens) ?? { kind: "command.forward", argv: tokens };
    }

    if (action === "approve") {
      return tryMapDevicesApprove(tokens) ?? { kind: "command.forward", argv: tokens };
    }

    if (action === "reject") {
      return tryMapDevicesReject(tokens) ?? { kind: "command.forward", argv: tokens };
    }

    if (action === "remove") {
      return tryMapDevicesRemove(tokens) ?? { kind: "command.forward", argv: tokens };
    }

    if (action === "clear") {
      return tryMapDevicesClear(tokens) ?? { kind: "command.forward", argv: tokens };
    }

    if (action === "rotate") {
      return tryMapDevicesRotate(tokens) ?? { kind: "command.forward", argv: tokens };
    }

    if (action === "revoke") {
      return tryMapDevicesRevoke(tokens) ?? { kind: "command.forward", argv: tokens };
    }
  }

  if (namespace === "nodes") {
    if (action === "pending") {
      return tryMapNodesPending(tokens) ?? { kind: "command.forward", argv: tokens };
    }

    if (action === "approve") {
      return tryMapNodesApprove(tokens) ?? { kind: "command.forward", argv: tokens };
    }

    if (action === "reject") {
      return tryMapNodesReject(tokens) ?? { kind: "command.forward", argv: tokens };
    }

    if (action === "rename") {
      return tryMapNodesRename(tokens) ?? { kind: "command.forward", argv: tokens };
    }
  }

  return {
    kind: "command.forward",
    argv: tokens,
  };
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return Math.floor(timeoutMs);
  }
  return DEFAULT_COMMAND_TIMEOUT_MS;
}

async function executeForwardedCommand(
  argv: string[],
  timeoutMs: number | undefined,
): Promise<unknown> {
  const result = await runPluginCommandWithTimeout({
    argv,
    timeoutMs: resolveTimeoutMs(timeoutMs),
  });
  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || `command failed (${result.code})`).trim());
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    return {};
  }
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

function requestInProcessGatewayRestart(): {
  ok: boolean;
  pid: number;
  signal: "SIGUSR1";
  mode: "emit" | "signal";
} {
  const mode = process.listenerCount("SIGUSR1") > 0 ? "emit" : "signal";
  if (mode === "emit") {
    process.emit("SIGUSR1");
  } else {
    process.kill(process.pid, "SIGUSR1");
  }
  return {
    ok: true,
    pid: process.pid,
    signal: "SIGUSR1",
    mode,
  };
}

export async function executeBotmaxGatewayCommand(params: {
  command: string;
  timeoutMs?: number;
}): Promise<BotmaxCommandExecutionResult> {
  const rawCommand = params.command.trim();
  if (!rawCommand) {
    return {
      ok: false,
      output: "command is empty",
    };
  }

  const argv = splitCommandArgs(rawCommand);
  if (!argv || argv.length === 0) {
    return {
      ok: false,
      output: "command parsing failed",
    };
  }

  let mapped: CommandMapping;
  try {
    mapped = mapCommand(argv);
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    let data: unknown;

    if (mapped.kind === "devices.list") {
      data = await listDevicePairing();
    } else if (mapped.kind === "gateway.restart") {
      data = requestInProcessGatewayRestart();
      return {
        ok: true,
        method: mapped.method,
        data,
        output: "gateway restart signal emitted",
      };
    } else if (mapped.kind === "devices.approve") {
      const requestId = mapped.latest
        ? (await listDevicePairing()).pending[0]?.requestId
        : mapped.requestId?.trim();
      if (!requestId) {
        throw new Error("no pending pairing request available");
      }
      const approved = await approveDevicePairing(requestId);
      if (!approved) {
        throw new Error(`pairing request not found: ${requestId}`);
      }
      data = approved;
    } else if (mapped.kind === "devices.reject") {
      data = await executeForwardedCommand(
        ["openclaw", "devices", "reject", mapped.requestId, "--json"],
        params.timeoutMs,
      );
    } else if (mapped.kind === "devices.remove") {
      const removed = await removePairedDeviceLocally(mapped.deviceId);
      if (!removed) {
        throw new Error(`paired device not found: ${mapped.deviceId}`);
      }
      data = removed;
    } else if (mapped.kind === "devices.clear") {
      data = await clearDevicePairingLocally({
        includePending: mapped.includePending,
      });
    } else if (mapped.kind === "devices.rotate") {
      const rotated = await rotateDeviceTokenLocally({
        deviceId: mapped.deviceId,
        role: mapped.role,
        scopes: mapped.scopes,
      });
      if (!rotated) {
        throw new Error(`device token rotate failed for ${mapped.deviceId}/${mapped.role}`);
      }
      data = {
        deviceId: mapped.deviceId,
        role: rotated.role,
        token: rotated.token,
        scopes: rotated.scopes,
        rotatedAtMs: rotated.rotatedAtMs ?? rotated.createdAtMs,
      };
    } else if (mapped.kind === "devices.revoke") {
      const revoked = await revokeDeviceTokenLocally({
        deviceId: mapped.deviceId,
        role: mapped.role,
      });
      if (!revoked) {
        throw new Error(`device token revoke failed for ${mapped.deviceId}/${mapped.role}`);
      }
      data = {
        deviceId: mapped.deviceId,
        role: revoked.role,
        revokedAtMs: revoked.revokedAtMs,
      };
    } else if (mapped.kind === "nodes.pending") {
      data = (await listNodePairingLocally()).pending;
    } else if (mapped.kind === "nodes.approve") {
      const approved = await approveNodePairingLocally(mapped.requestId);
      if (!approved) {
        throw new Error(`node pairing request not found: ${mapped.requestId}`);
      }
      data = approved;
    } else if (mapped.kind === "nodes.reject") {
      const rejected = await rejectNodePairingLocally(mapped.requestId);
      if (!rejected) {
        throw new Error(`node pairing request not found: ${mapped.requestId}`);
      }
      data = rejected;
    } else if (mapped.kind === "nodes.rename") {
      data = await renamePairedNodeLocally({
        query: mapped.nodeQuery,
        displayName: mapped.displayName,
      });
    } else {
      data = await executeForwardedCommand(mapped.argv, params.timeoutMs);
    }

    return {
      ok: true,
      method: "method" in mapped ? mapped.method : undefined,
      data,
      output: stringifyResult(data),
    };
  } catch (error) {
    return {
      ok: false,
      method: "method" in mapped ? mapped.method : undefined,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}
