import {
  approveChannelPairingCode,
} from "openclaw/plugin-sdk/conversation-runtime";
import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import {
  listFeishuDirectoryGroupsLive,
} from "../../feishu/src/directory.js";
import {
  approveNodePairingLocally,
  clearDevicePairingLocally,
  listNodePairingLocally,
  renamePairedNodeLocally,
  rejectDevicePairingLocally,
  rejectNodePairingLocally,
  removePairedDeviceLocally,
  revokeDeviceTokenLocally,
  rotateDeviceTokenLocally,
} from "./local-state-commands.js";
import {
  approveDevicePairing,
  listDevicePairing,
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
      kind: "pairing.approve";
      method: "channel.pair.approve";
      channel: string;
      code: string;
      accountId?: string;
    }
  | {
      kind: "directory.groups.list";
      method: "channel.directory.groups.list";
      channel: string;
      accountId?: string;
      query?: string;
      limit?: number;
    }
  | {
      kind: "gateway.restart";
      method: "gateway.restart";
      delayMs?: number;
      reason?: string;
    };

export type BotmaxCommandExecutionResult = {
  ok: boolean;
  method?: string;
  data?: unknown;
  output: string;
};

const DOUBLE_QUOTE_ESCAPES = new Set(["\\", '"', "$", "`", "\n", "\r"]);
const SUPPORTED_BOTMAX_COMMANDS = [
  "openclaw devices list",
  "openclaw devices approve <requestId|--latest>",
  "openclaw devices reject <requestId>",
  "openclaw devices remove <deviceId>",
  "openclaw devices clear --yes [--pending]",
  "openclaw devices rotate --device <deviceId> --role <role> [--scope <scope>...]",
  "openclaw devices revoke --device <deviceId> --role <role>",
  "openclaw nodes pending",
  "openclaw nodes approve <requestId>",
  "openclaw nodes reject <requestId>",
  "openclaw nodes rename --node <id|name|ip> --name <displayName>",
  "openclaw pairing approve <channel> <code> [--account <accountId>]",
  "openclaw directory groups list --channel feishu [--account <accountId>] [--query <query>] [--limit <n>]",
  "openclaw gateway restart",
].join("; ");

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

function createUnsupportedCommandError(command: string): Error {
  return new Error(
    `Botmax command forwarding is disabled. Unsupported command: ${command}. Supported commands: ${SUPPORTED_BOTMAX_COMMANDS}`,
  );
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

function normalizePairingChannel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error("pairing channel is required");
  }
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error(`invalid pairing channel: ${value}`);
  }
  return normalized;
}

function tryMapPairingApprove(tokens: string[]): CommandMapping | null {
  let channel: string | undefined;
  let accountId: string | undefined;
  const positional: string[] = [];

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    if (token.startsWith("--channel")) {
      const resolved = readRequiredLongOption(tokens, index, "--channel");
      channel = normalizePairingChannel(resolved.value);
      index = resolved.nextIndex;
      continue;
    }
    if (token.startsWith("--account")) {
      const resolved = readRequiredLongOption(tokens, index, "--account");
      accountId = resolved.value.trim();
      index = resolved.nextIndex;
      continue;
    }
    if (token.startsWith("--notify")) {
      return null;
    }
    if (token.startsWith("--")) {
      return null;
    }
    positional.push(token.trim());
  }

  if (channel) {
    if (positional.length !== 1) {
      throw new Error("openclaw pairing approve with --channel requires exactly one code");
    }
    return {
      kind: "pairing.approve",
      method: "channel.pair.approve",
      channel,
      code: positional[0] ?? "",
      accountId,
    };
  }

  if (positional.length === 2) {
    return {
      kind: "pairing.approve",
      method: "channel.pair.approve",
      channel: normalizePairingChannel(positional[0] ?? ""),
      code: positional[1] ?? "",
      accountId,
    };
  }

  if (positional.length === 1) {
    return null;
  }

  throw new Error("openclaw pairing approve requires <channel> <code>");
}

function tryMapDirectoryGroupsList(tokens: string[]): CommandMapping | null {
  let channel: string | undefined;
  let accountId: string | undefined;
  let query: string | undefined;
  let limit: number | undefined;

  for (let index = 4; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token || isJsonFlag(token)) {
      continue;
    }
    if (token.startsWith("--channel")) {
      const resolved = readRequiredLongOption(tokens, index, "--channel");
      channel = normalizePairingChannel(resolved.value);
      index = resolved.nextIndex;
      continue;
    }
    if (token.startsWith("--account")) {
      const resolved = readRequiredLongOption(tokens, index, "--account");
      accountId = resolved.value.trim();
      index = resolved.nextIndex;
      continue;
    }
    if (token.startsWith("--query")) {
      const resolved = readRequiredLongOption(tokens, index, "--query");
      query = resolved.value;
      index = resolved.nextIndex;
      continue;
    }
    if (token.startsWith("--limit")) {
      const resolved = readRequiredLongOption(tokens, index, "--limit");
      limit = parseNonNegativeInteger(resolved.value, "--limit");
      index = resolved.nextIndex;
      continue;
    }
    return null;
  }

  if (!channel) {
    throw new Error("openclaw directory groups list requires --channel");
  }

  return {
    kind: "directory.groups.list",
    method: "channel.directory.groups.list",
    channel,
    accountId,
    query,
    limit,
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
    const mapped = tryMapGatewayRestart(tokens);
    if (mapped) {
      return mapped;
    }
    throw createUnsupportedCommandError(tokens.join(" "));
  }

  if (namespace === "devices") {
    if (action === "list") {
      const mapped = tryMapDevicesList(tokens);
      if (mapped) {
        return mapped;
      }
      throw createUnsupportedCommandError(tokens.join(" "));
    }

    if (action === "approve") {
      const mapped = tryMapDevicesApprove(tokens);
      if (mapped) {
        return mapped;
      }
      throw createUnsupportedCommandError(tokens.join(" "));
    }

    if (action === "reject") {
      const mapped = tryMapDevicesReject(tokens);
      if (mapped) {
        return mapped;
      }
      throw createUnsupportedCommandError(tokens.join(" "));
    }

    if (action === "remove") {
      const mapped = tryMapDevicesRemove(tokens);
      if (mapped) {
        return mapped;
      }
      throw createUnsupportedCommandError(tokens.join(" "));
    }

    if (action === "clear") {
      const mapped = tryMapDevicesClear(tokens);
      if (mapped) {
        return mapped;
      }
      throw createUnsupportedCommandError(tokens.join(" "));
    }

    if (action === "rotate") {
      const mapped = tryMapDevicesRotate(tokens);
      if (mapped) {
        return mapped;
      }
      throw createUnsupportedCommandError(tokens.join(" "));
    }

    if (action === "revoke") {
      const mapped = tryMapDevicesRevoke(tokens);
      if (mapped) {
        return mapped;
      }
      throw createUnsupportedCommandError(tokens.join(" "));
    }
  }

  if (namespace === "nodes") {
    if (action === "pending") {
      const mapped = tryMapNodesPending(tokens);
      if (mapped) {
        return mapped;
      }
      throw createUnsupportedCommandError(tokens.join(" "));
    }

    if (action === "approve") {
      const mapped = tryMapNodesApprove(tokens);
      if (mapped) {
        return mapped;
      }
      throw createUnsupportedCommandError(tokens.join(" "));
    }

    if (action === "reject") {
      const mapped = tryMapNodesReject(tokens);
      if (mapped) {
        return mapped;
      }
      throw createUnsupportedCommandError(tokens.join(" "));
    }

    if (action === "rename") {
      const mapped = tryMapNodesRename(tokens);
      if (mapped) {
        return mapped;
      }
      throw createUnsupportedCommandError(tokens.join(" "));
    }
  }

  if (namespace === "pairing" && action === "approve") {
    const mapped = tryMapPairingApprove(tokens);
    if (mapped) {
      return mapped;
    }
    throw createUnsupportedCommandError(tokens.join(" "));
  }

  if (namespace === "directory" && action === "groups" && tokens[3]?.toLowerCase() === "list") {
    const mapped = tryMapDirectoryGroupsList(tokens);
    if (mapped) {
      return mapped;
    }
    throw createUnsupportedCommandError(tokens.join(" "));
  }

  throw createUnsupportedCommandError(tokens.join(" "));
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
      const rejected = await rejectDevicePairingLocally(mapped.requestId);
      if (!rejected) {
        throw new Error(`pairing request not found: ${mapped.requestId}`);
      }
      data = rejected;
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
    } else if (mapped.kind === "pairing.approve") {
      const approved = await approveChannelPairingCode({
        channel: mapped.channel,
        code: mapped.code,
        ...(mapped.accountId ? { accountId: mapped.accountId } : {}),
      });
      if (!approved) {
        throw new Error(`No pending pairing request found for code: ${mapped.code}`);
      }
      data = {
        channel: mapped.channel,
        ...(mapped.accountId ? { accountId: mapped.accountId } : {}),
        id: approved.id,
        entry: approved.entry,
      };
    } else if (mapped.kind === "directory.groups.list") {
      if (mapped.channel !== "feishu") {
        throw new Error(
          `Botmax only supports directory groups list for channel feishu; received ${mapped.channel}`,
        );
      }
      data = await listFeishuDirectoryGroupsLive({
        cfg: loadConfig(),
        ...(mapped.accountId ? { accountId: mapped.accountId } : {}),
        ...(mapped.query ? { query: mapped.query } : {}),
        ...(typeof mapped.limit === "number" ? { limit: mapped.limit } : {}),
      });
    } else {
      const _exhaustive: never = mapped;
      throw new Error(`Unsupported mapped command: ${String(_exhaustive)}`);
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
