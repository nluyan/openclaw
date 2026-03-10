const HEARTBEAT_PING = "<<<ping>>>";
const HEARTBEAT_PONG = "<<<pong>>>";
const BOTMAX_JSONRPC_VERSION = "2.0";
const BOTMAX_TRANSPORT_METHOD = "botmax.transport";
const BOTMAX_TRANSPORT_VERSION = 2;
const CHAT_MESSAGE_TYPE = "chat.message";
const COMMAND_EXEC_TYPE = "command.exec";
const COMMAND_RESULT_TYPE = "command.result";
const CHAT_TYPE_DIRECT = "direct";
const CHAT_TYPE_GROUP = "group";

type JsonRpcId = string | number | null;
type BotmaxChatType = typeof CHAT_TYPE_DIRECT | typeof CHAT_TYPE_GROUP;

type BotmaxTransportChatMessage = {
  v: number;
  type: typeof CHAT_MESSAGE_TYPE;
  from: string;
  to: string;
  text: string;
  chatType?: BotmaxChatType;
  chatId?: string;
  senderId?: string;
};

type BotmaxTransportCommandExec = {
  v: number;
  type: typeof COMMAND_EXEC_TYPE;
  from: string;
  to?: string;
  command: string;
  timeoutMs?: number;
  chatType?: BotmaxChatType;
  chatId?: string;
  senderId?: string;
};

type BotmaxTransportCommandResult = {
  v: number;
  type: typeof COMMAND_RESULT_TYPE;
  from: string;
  to: string;
  command: string;
  method?: string;
  ok: boolean;
  output: string;
  data?: unknown;
};

type BotmaxTransportParams =
  | BotmaxTransportChatMessage
  | BotmaxTransportCommandExec
  | BotmaxTransportCommandResult;

type BotmaxJsonRpcFrame = {
  jsonrpc: typeof BOTMAX_JSONRPC_VERSION;
  method: typeof BOTMAX_TRANSPORT_METHOD;
  params: BotmaxTransportParams;
  id?: JsonRpcId;
};

export type BotmaxInboundMessage =
  | {
      kind: "chat";
      senderId: string;
      body: string;
      chatType: BotmaxChatType;
      chatId?: string;
      replyTargetId: string;
      requestId?: JsonRpcId;
    }
  | {
      kind: "command";
      senderId: string;
      command: string;
      timeoutMs?: number;
      chatType: BotmaxChatType;
      chatId?: string;
      replyTargetId: string;
      requestId?: JsonRpcId;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeJsonRpcId(value: unknown): JsonRpcId | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function normalizeChatType(value: unknown): BotmaxChatType {
  if (typeof value !== "string") {
    return CHAT_TYPE_DIRECT;
  }
  return value.trim().toLowerCase() === CHAT_TYPE_GROUP ? CHAT_TYPE_GROUP : CHAT_TYPE_DIRECT;
}

function parseJsonRpcMessage(trimmed: string): BotmaxInboundMessage | null {
  let frame: unknown;
  try {
    frame = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(frame)) {
    return null;
  }
  if (frame.jsonrpc !== BOTMAX_JSONRPC_VERSION || frame.method !== BOTMAX_TRANSPORT_METHOD) {
    return null;
  }
  if (!isRecord(frame.params)) {
    return null;
  }

  const params = frame.params;
  if (params.v !== BOTMAX_TRANSPORT_VERSION) {
    return null;
  }
  const senderIdRaw =
    typeof params.senderId === "string" && params.senderId.trim()
      ? params.senderId.trim()
      : typeof params.from === "string"
        ? params.from.trim()
        : "";
  const senderId = senderIdRaw;
  if (!senderId) {
    return null;
  }
  const chatType = normalizeChatType(params.chatType);
  const chatId =
    typeof params.chatId === "string" && params.chatId.trim() ? params.chatId.trim() : undefined;
  const replyTargetId = chatType === CHAT_TYPE_GROUP && chatId ? chatId : senderId;
  const requestId = normalizeJsonRpcId(frame.id);
  const type = typeof params.type === "string" ? params.type.trim() : "";

  if (type === CHAT_MESSAGE_TYPE) {
    const body = typeof params.text === "string" ? params.text.trim() : "";
    if (!body) {
      return null;
    }
    return {
      kind: "chat",
      senderId,
      body,
      chatType,
      chatId,
      replyTargetId,
      requestId,
    };
  }

  if (type === COMMAND_EXEC_TYPE) {
    const command = typeof params.command === "string" ? params.command.trim() : "";
    if (!command) {
      return null;
    }
    const timeoutMs =
      typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
        ? Math.floor(params.timeoutMs)
        : undefined;
    return {
      kind: "command",
      senderId,
      command,
      timeoutMs,
      chatType,
      chatId,
      replyTargetId,
      requestId,
    };
  }

  return null;
}

function stringifyTransportFrame(params: BotmaxTransportParams, requestId?: JsonRpcId): string {
  const frame: BotmaxJsonRpcFrame = {
    jsonrpc: BOTMAX_JSONRPC_VERSION,
    method: BOTMAX_TRANSPORT_METHOD,
    params,
  };
  if (requestId !== undefined) {
    frame.id = requestId;
  }
  return JSON.stringify(frame);
}

export function parseBotmaxInboundText(text: string): BotmaxInboundMessage | null {
  const trimmed = text?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === HEARTBEAT_PING || trimmed === HEARTBEAT_PONG) {
    return null;
  }
  return parseJsonRpcMessage(trimmed);
}

export function formatBotmaxOutboundText(params: {
  recipientId: string;
  text: string;
  senderId?: string;
  requestId?: JsonRpcId;
}): string {
  const normalizedRecipient = params.recipientId?.trim();
  if (!normalizedRecipient) {
    throw new Error("Botmax recipientId is required");
  }
  const from = params.senderId?.trim() || "openclaw:botmax";
  return stringifyTransportFrame(
    {
      v: BOTMAX_TRANSPORT_VERSION,
      type: CHAT_MESSAGE_TYPE,
      from,
      to: normalizedRecipient,
      text: params.text ?? "",
    },
    params.requestId,
  );
}

export function formatBotmaxOutboundCommandResult(params: {
  recipientId: string;
  command: string;
  ok: boolean;
  output: string;
  method?: string;
  data?: unknown;
  senderId?: string;
  requestId?: JsonRpcId;
}): string {
  const normalizedRecipient = params.recipientId?.trim();
  if (!normalizedRecipient) {
    throw new Error("Botmax recipientId is required");
  }
  const command = params.command?.trim();
  if (!command) {
    throw new Error("Botmax command result requires command");
  }
  const from = params.senderId?.trim() || "openclaw:botmax";
  return stringifyTransportFrame(
    {
      v: BOTMAX_TRANSPORT_VERSION,
      type: COMMAND_RESULT_TYPE,
      from,
      to: normalizedRecipient,
      command,
      method: params.method,
      ok: params.ok,
      output: params.output ?? "",
      data: params.data,
    },
    params.requestId,
  );
}
