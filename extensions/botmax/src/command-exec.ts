import { getBotmaxRuntime } from "./runtime.js";

type CommandMapping = {
  method: string;
  defaultParams: Record<string, unknown>;
  scopes?: string[];
};

export type BotmaxCommandExecutionResult = {
  ok: boolean;
  method?: string;
  data?: unknown;
  output: string;
};

const DOUBLE_QUOTE_ESCAPES = new Set(["\\", '"', "$", "`", "\n", "\r"]);

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
  if (
    normalized === "false" ||
    normalized === "0" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return undefined;
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

function mapCommandToGatewayMethod(tokens: string[]): CommandMapping {
  if (tokens.length < 3) {
    throw new Error("command must include namespace and action, e.g. openclaw devices list");
  }
  if (tokens[0].toLowerCase() !== "openclaw") {
    throw new Error("command must start with 'openclaw'");
  }

  const namespace = tokens[1].toLowerCase();
  const action = tokens[2].toLowerCase();

  if (namespace === "gateway" && action === "call") {
    const method = tokens[3]?.trim();
    if (!method) {
      throw new Error("openclaw gateway call requires a gateway method name");
    }

    let paramsValue: unknown = {};

    for (let index = 4; index < tokens.length; index += 1) {
      const token = tokens[index] ?? "";
      if (!token) {
        continue;
      }
      if (token.startsWith("--params")) {
        const { value, nextIndex } = readOptionValue(tokens, index);
        if (!value) {
          throw new Error("--params requires a JSON value");
        }
        try {
          paramsValue = JSON.parse(value);
        } catch {
          throw new Error("--params must be valid JSON");
        }
        index = nextIndex;
        continue;
      }
      if (token === "--json") {
        continue;
      }
      throw new Error(`unsupported argument '${token}' for openclaw gateway call`);
    }

    return {
      method,
      defaultParams: typeof paramsValue === "object" && paramsValue !== null ? paramsValue : {},
    };
  }

  if (namespace !== "devices") {
    throw new Error(`unsupported openclaw namespace '${tokens[1]}'`);
  }

  if (action === "list") {
    return {
      method: "device.pair.list",
      defaultParams: {},
      scopes: ["operator.pairing"],
    };
  }

  if (action === "approve") {
    let requestId: string | undefined;
    let latest = false;

    for (let index = 3; index < tokens.length; index += 1) {
      const token = tokens[index] ?? "";
      if (!token) {
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
      if (!token.startsWith("--") && !requestId) {
        requestId = token.trim();
        continue;
      }
      throw new Error(`unsupported argument '${token}' for openclaw devices approve`);
    }

    if (!latest && !requestId) {
      throw new Error("openclaw devices approve requires requestId or --latest");
    }

    return {
      method: "device.pair.approve",
      defaultParams: latest ? { latest: true } : { requestId },
      scopes: ["operator.pairing"],
    };
  }

  throw new Error(`unsupported openclaw devices action '${tokens[2]}'`);
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
    mapped = mapCommandToGatewayMethod(argv);
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }

  const runtime = getBotmaxRuntime();
  try {
    const data = await runtime.system.callGatewayCli({
      method: mapped.method,
      params: mapped.defaultParams,
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      ...(mapped.scopes ? { scopes: mapped.scopes } : {}),
    });
    return {
      ok: true,
      method: mapped.method,
      data,
      output: stringifyResult(data),
    };
  } catch (error) {
    return {
      ok: false,
      method: mapped.method,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}
