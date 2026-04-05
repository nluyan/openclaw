const HEARTBEAT_PING = "<<<ping>>>";
const HEARTBEAT_PONG = "<<<pong>>>";
const BOTMAX_JSONRPC_VERSION = "2.0";
const BOTMAX_TRANSPORT_METHOD = "botmax.transport";
const BOTMAX_TRANSPORT_VERSION = 3;
const CHAT_MESSAGE_TYPE = "chat.message";
const COMMAND_EXEC_TYPE = "command.exec";
const COMMAND_RESULT_TYPE = "command.result";
const DEVICE_REQUEST_TYPE = "device.request";
const DEVICE_RESULT_TYPE = "device.result";
const FILE_READ_TYPE = "file.read";
const FILE_LIST_TYPE = "file.list";
const FILE_WRITE_TYPE = "file.write";
const DIRECTORY_CREATE_TYPE = "directory.create";
const FILE_DELETE_TYPE = "file.delete";
const FILE_RESULT_TYPE = "file.result";
const CHAT_TYPE_DIRECT = "direct";
const CHAT_TYPE_GROUP = "group";
const CHAT_TYPE_CHANNEL = "channel";

type JsonRpcId = string | number | null;
type BotmaxChatType = typeof CHAT_TYPE_DIRECT | typeof CHAT_TYPE_GROUP | typeof CHAT_TYPE_CHANNEL;
export type BotmaxFileEncoding = "utf8" | "base64";
export type BotmaxAttachmentKind = "image" | "audio" | "video" | "file" | "sticker" | "location";
export type BotmaxAttachmentSendAs =
  | "photo"
  | "image"
  | "voice"
  | "audio"
  | "video"
  | "video_note"
  | "document"
  | "sticker"
  | "location";

type BotmaxTransportContext = {
  bridge: "botmax";
  receivedAtMs: number;
  connectionId?: string;
  dedupeKey?: string;
  traceId?: string;
};

type BotmaxOriginContext = {
  platform: string;
  surface?: string;
  accountId?: string;
  botId?: string;
  botUsername?: string;
};

type BotmaxConversationContext = {
  id: string;
  nativeId?: string;
  kind: BotmaxChatType;
  replyTargetId: string;
  agentId?: string;
  title?: string;
  channelName?: string;
  spaceName?: string;
  threadId?: string | number;
  threadLabel?: string;
  parentId?: string;
  isForum?: boolean;
};

type BotmaxResultConversationContext = {
  id: string;
  nativeId?: string;
  replyTargetId: string;
  threadId?: string | number;
};

type BotmaxFileContext = {
  operation: "read" | "list" | "write" | "mkdir" | "delete";
  path: string;
  encoding: BotmaxFileEncoding;
  includeHidden?: boolean;
  content?: string;
  ensureDirectory?: boolean;
  recursive?: boolean;
};

export type BotmaxDeviceOperation =
  | "list"
  | "approve"
  | "reject"
  | "remove"
  | "clear"
  | "rotate"
  | "revoke";

type BotmaxDeviceContext = {
  operation: BotmaxDeviceOperation;
  pairingRequestId?: string;
  latest?: boolean;
  includePending?: boolean;
  deviceId?: string;
  role?: string;
  scopes?: string[];
};

type BotmaxSenderContext = {
  id: string;
  nativeId?: string;
  displayName?: string;
  username?: string;
  tag?: string;
  e164?: string;
  isBot?: boolean;
};

type BotmaxAuthContext = {
  deliveryAuthenticated: boolean;
  commandAuthorized: boolean;
  senderIsOwner?: boolean;
  scopes?: string[];
};

type BotmaxReplyToContext = {
  id: string;
  nativeId?: string;
  senderId?: string;
  senderLabel?: string;
  text?: string;
  isQuote?: boolean;
};

type BotmaxMentionsContext = {
  botMentioned: boolean;
  mentionedIds: string[];
};

type BotmaxAttachmentDeliveryHints = {
  sendAs?: BotmaxAttachmentSendAs;
};

export type BotmaxBinaryAttachment = {
  id: string;
  kind: Exclude<BotmaxAttachmentKind, "location">;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  fetchUrl?: string;
  sharedPath?: string;
  inlineBase64?: string;
  caption?: string;
  transcript?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  deliveryHints?: BotmaxAttachmentDeliveryHints;
};

export type BotmaxLocationAttachment = {
  id: string;
  kind: "location";
  label?: string;
  latitude: number;
  longitude: number;
  deliveryHints?: BotmaxAttachmentDeliveryHints;
};

export type BotmaxAttachment = BotmaxBinaryAttachment | BotmaxLocationAttachment;
export type BotmaxInboundAttachment = BotmaxAttachment;
export type BotmaxOutboundAttachmentInput = BotmaxAttachment;

type BotmaxMessageContext = {
  id: string;
  nativeId?: string;
  fullId?: string;
  text?: string;
  createdAtMs: number;
  editedAtMs?: number;
  replyTo?: BotmaxReplyToContext;
  mentions: BotmaxMentionsContext;
  attachments?: BotmaxAttachment[];
};

type BotmaxTransportChatMessage = {
  v: typeof BOTMAX_TRANSPORT_VERSION;
  type: typeof CHAT_MESSAGE_TYPE;
  transport: BotmaxTransportContext;
  origin: BotmaxOriginContext;
  conversation: BotmaxConversationContext;
  sender: BotmaxSenderContext;
  message: BotmaxMessageContext;
  auth: BotmaxAuthContext;
  extensions?: Record<string, unknown>;
};

type BotmaxTransportCommandExec = {
  v: typeof BOTMAX_TRANSPORT_VERSION;
  type: typeof COMMAND_EXEC_TYPE;
  transport: BotmaxTransportContext;
  origin: BotmaxOriginContext;
  conversation: BotmaxConversationContext;
  sender: BotmaxSenderContext;
  message?: BotmaxMessageContext;
  command: {
    text: string;
    timeoutMs?: number;
  };
  auth: BotmaxAuthContext;
  extensions?: Record<string, unknown>;
};

type BotmaxTransportCommandResult = {
  v: typeof BOTMAX_TRANSPORT_VERSION;
  type: typeof COMMAND_RESULT_TYPE;
  transport: BotmaxTransportContext;
  origin: BotmaxOriginContext;
  conversation: BotmaxResultConversationContext;
  command: {
    text: string;
    method?: string;
  };
  result: {
    ok: boolean;
    output: string;
    errorCode?: string;
    data?: unknown;
  };
  extensions?: Record<string, unknown>;
};

type BotmaxTransportDeviceRequest = {
  v: typeof BOTMAX_TRANSPORT_VERSION;
  type: typeof DEVICE_REQUEST_TYPE;
  transport: BotmaxTransportContext;
  origin: BotmaxOriginContext;
  device: BotmaxDeviceContext;
  extensions?: Record<string, unknown>;
};

type BotmaxTransportDeviceResult = {
  v: typeof BOTMAX_TRANSPORT_VERSION;
  type: typeof DEVICE_RESULT_TYPE;
  transport: BotmaxTransportContext;
  origin: BotmaxOriginContext;
  device: BotmaxDeviceContext;
  result: {
    ok: boolean;
    output: string;
    errorCode?: string;
    data?: unknown;
  };
  extensions?: Record<string, unknown>;
};

type BotmaxTransportFileRead = {
  v: typeof BOTMAX_TRANSPORT_VERSION;
  type: typeof FILE_READ_TYPE;
  transport: BotmaxTransportContext;
  origin: BotmaxOriginContext;
  file: BotmaxFileContext & {
    operation: "read";
  };
  extensions?: Record<string, unknown>;
};

type BotmaxTransportFileWrite = {
  v: typeof BOTMAX_TRANSPORT_VERSION;
  type: typeof FILE_WRITE_TYPE;
  transport: BotmaxTransportContext;
  origin: BotmaxOriginContext;
  file: BotmaxFileContext & {
    operation: "write";
    content: string;
  };
  extensions?: Record<string, unknown>;
};

type BotmaxTransportFileList = {
  v: typeof BOTMAX_TRANSPORT_VERSION;
  type: typeof FILE_LIST_TYPE;
  transport: BotmaxTransportContext;
  origin: BotmaxOriginContext;
  file: BotmaxFileContext & {
    operation: "list";
  };
  extensions?: Record<string, unknown>;
};

type BotmaxTransportDirectoryCreate = {
  v: typeof BOTMAX_TRANSPORT_VERSION;
  type: typeof DIRECTORY_CREATE_TYPE;
  transport: BotmaxTransportContext;
  origin: BotmaxOriginContext;
  file: BotmaxFileContext & {
    operation: "mkdir";
  };
  extensions?: Record<string, unknown>;
};

type BotmaxTransportFileDelete = {
  v: typeof BOTMAX_TRANSPORT_VERSION;
  type: typeof FILE_DELETE_TYPE;
  transport: BotmaxTransportContext;
  origin: BotmaxOriginContext;
  file: BotmaxFileContext & {
    operation: "delete";
  };
  extensions?: Record<string, unknown>;
};

type BotmaxTransportFileResult = {
  v: typeof BOTMAX_TRANSPORT_VERSION;
  type: typeof FILE_RESULT_TYPE;
  transport: BotmaxTransportContext;
  origin: BotmaxOriginContext;
  file: BotmaxFileContext;
  result: {
    ok: boolean;
    output: string;
    errorCode?: string;
    data?: unknown;
  };
  extensions?: Record<string, unknown>;
};

type BotmaxTransportParams =
  | BotmaxTransportChatMessage
  | BotmaxTransportCommandExec
  | BotmaxTransportCommandResult
  | BotmaxTransportDeviceRequest
  | BotmaxTransportDeviceResult
  | BotmaxTransportFileRead
  | BotmaxTransportFileList
  | BotmaxTransportFileWrite
  | BotmaxTransportDirectoryCreate
  | BotmaxTransportFileDelete
  | BotmaxTransportFileResult;

type BotmaxJsonRpcFrame = {
  jsonrpc: typeof BOTMAX_JSONRPC_VERSION;
  method: typeof BOTMAX_TRANSPORT_METHOD;
  params: BotmaxTransportParams;
  id?: JsonRpcId;
};

type BotmaxInboundBase = {
  senderId: string;
  senderName: string;
  senderUsername?: string;
  accountId?: string;
  agentId?: string;
  provider: string;
  surface: string;
  botUsername?: string;
  conversationId: string;
  conversationNativeId?: string;
  chatType: BotmaxChatType;
  chatId?: string;
  conversationTitle?: string;
  replyTargetId: string;
  requestId?: JsonRpcId;
  messageId?: string;
  messageFullId?: string;
  timestampMs: number;
  threadId?: string | number;
  replyToId?: string;
  replyToBody?: string;
  replyToSender?: string;
  wasMentioned: boolean;
  commandAuthorized: boolean;
  transcript?: string;
  attachments?: BotmaxAttachment[];
};

export type BotmaxInboundMessage =
  | (BotmaxInboundBase & {
      kind: "chat";
      body: string;
    })
  | (BotmaxInboundBase & {
      kind: "command";
      command: string;
      timeoutMs?: number;
    })
  | {
      kind: "device.request";
      requestId?: JsonRpcId;
      operation: BotmaxDeviceOperation;
      pairingRequestId?: string;
      latest?: boolean;
      includePending?: boolean;
      deviceId?: string;
      role?: string;
      scopes?: string[];
    }
  | {
      kind: "file.read";
      requestId?: JsonRpcId;
      path: string;
      encoding: BotmaxFileEncoding;
    }
  | {
      kind: "file.list";
      requestId?: JsonRpcId;
      path: string;
      includeHidden: boolean;
    }
  | {
      kind: "file.write";
      requestId?: JsonRpcId;
      path: string;
      encoding: BotmaxFileEncoding;
      content: string;
      ensureDirectory: boolean;
    }
  | {
      kind: "directory.create";
      requestId?: JsonRpcId;
      path: string;
      recursive: boolean;
    }
  | {
      kind: "file.delete";
      requestId?: JsonRpcId;
      path: string;
      encoding: BotmaxFileEncoding;
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

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeFileEncoding(value: unknown): BotmaxFileEncoding | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "utf8" || normalized === "utf-8") {
    return "utf8";
  }
  if (normalized === "base64") {
    return "base64";
  }
  return undefined;
}

function normalizeThreadId(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  return normalizeNonEmptyString(value);
}

function normalizeChatType(value: unknown): BotmaxChatType {
  if (typeof value !== "string") {
    return CHAT_TYPE_DIRECT;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === CHAT_TYPE_GROUP) {
    return CHAT_TYPE_GROUP;
  }
  if (normalized === CHAT_TYPE_CHANNEL) {
    return CHAT_TYPE_CHANNEL;
  }
  return CHAT_TYPE_DIRECT;
}

function normalizeNativeId(scopedId: string): string | undefined {
  const separator = scopedId.indexOf(":");
  if (separator < 0 || separator === scopedId.length - 1) {
    return undefined;
  }
  const nativeId = scopedId.slice(separator + 1).trim();
  return nativeId || undefined;
}

function inferPlatformFromScopedId(scopedId: string): string {
  const separator = scopedId.indexOf(":");
  if (separator <= 0) {
    return "botmax";
  }
  return scopedId.slice(0, separator).trim().toLowerCase() || "botmax";
}

function inferChatTypeFromRecipient(recipientId: string): BotmaxChatType {
  if (recipientId === "all") {
    return CHAT_TYPE_CHANNEL;
  }
  const nativeId = normalizeNativeId(recipientId) ?? recipientId;
  if (nativeId.startsWith("-")) {
    return CHAT_TYPE_GROUP;
  }
  return CHAT_TYPE_DIRECT;
}

function buildTransportContext(now: number, dedupeKey?: string): BotmaxTransportContext {
  return {
    bridge: "botmax",
    receivedAtMs: now,
    dedupeKey,
  };
}

function buildOriginContext(params: {
  platform?: string;
  surface?: string;
  botUsername?: string;
}): BotmaxOriginContext {
  const platform = normalizeNonEmptyString(params.platform) ?? "botmax";
  const surface = normalizeNonEmptyString(params.surface) ?? platform;
  const botUsername = normalizeNonEmptyString(params.botUsername);
  return {
    platform,
    surface,
    botUsername,
  };
}

function buildConversationContext(params: {
  recipientId: string;
  chatType?: BotmaxChatType;
  conversationId?: string;
  conversationNativeId?: string;
  threadId?: string | number;
}): BotmaxConversationContext {
  const conversationId = normalizeNonEmptyString(params.conversationId) ?? params.recipientId;
  const chatType = params.chatType ?? inferChatTypeFromRecipient(conversationId);
  return {
    id: conversationId,
    nativeId:
      normalizeNonEmptyString(params.conversationNativeId) ?? normalizeNativeId(conversationId),
    kind: chatType,
    replyTargetId: params.recipientId,
    threadId: params.threadId,
  };
}

function buildMessageContext(params: {
  text?: string;
  attachments?: BotmaxAttachment[];
  createdAtMs: number;
  conversationId: string;
  messageId?: string;
  replyToId?: string;
}): BotmaxMessageContext {
  const text = normalizeNonEmptyString(params.text);
  const attachments = params.attachments?.filter(Boolean) ?? [];
  if (!text && attachments.length === 0) {
    throw new Error("Botmax chat message requires text or attachments");
  }
  const messageId =
    normalizeNonEmptyString(params.messageId) ??
    `botmax:msg:${params.createdAtMs}:${Math.random().toString(36).slice(2, 10)}`;
  return {
    id: messageId,
    fullId: `${params.conversationId}:${messageId}`,
    text,
    createdAtMs: params.createdAtMs,
    replyTo: params.replyToId
      ? {
          id: params.replyToId,
        }
      : undefined,
    mentions: {
      botMentioned: false,
      mentionedIds: [],
    },
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

function buildAttachmentSummary(attachments: BotmaxAttachment[]): string {
  return attachments
    .map((attachment, index) => {
      const suffix = attachments.length > 1 ? ` ${index + 1}/${attachments.length}` : "";
      if (attachment.kind === "location") {
        const label =
          normalizeNonEmptyString(attachment.label) ??
          `${attachment.latitude.toFixed(6)}, ${attachment.longitude.toFixed(6)}`;
        return `[Location${suffix}]\n${label}`;
      }

      const title = `[${attachment.kind[0]?.toUpperCase() ?? ""}${attachment.kind.slice(1)}${suffix}]`;
      const lines = [title];
      const caption = normalizeNonEmptyString(attachment.caption);
      if (caption) {
        lines.push(`Caption:\n${caption}`);
      }
      const transcript = normalizeNonEmptyString(attachment.transcript);
      if (transcript) {
        lines.push(`Transcript:\n${transcript}`);
      }
      if (!caption && !transcript) {
        const fallback =
          normalizeNonEmptyString(attachment.name) ?? normalizeNonEmptyString(attachment.mimeType);
        if (fallback) {
          lines.push(fallback);
        }
      }
      return lines.join("\n");
    })
    .join("\n\n")
    .trim();
}

function buildMessageBody(text: string | undefined, attachments: BotmaxAttachment[]): string {
  const trimmedText = text?.trim() ?? "";
  const attachmentSummary = buildAttachmentSummary(attachments);
  if (!trimmedText) {
    return attachmentSummary;
  }
  if (!attachmentSummary) {
    return trimmedText;
  }
  return `${trimmedText}\n\n${attachmentSummary}`.trim();
}

function resolveTranscript(attachments: BotmaxAttachment[]): string | undefined {
  const transcripts = attachments
    .map((attachment) =>
      attachment.kind !== "location" ? normalizeNonEmptyString(attachment.transcript) : undefined,
    )
    .filter((value): value is string => Boolean(value));
  if (transcripts.length === 0) {
    return undefined;
  }
  return transcripts.join("\n\n");
}

function parseMentions(value: unknown): BotmaxMentionsContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const mentionedIds = Array.isArray(value.mentionedIds)
    ? value.mentionedIds
        .map((entry) => normalizeNonEmptyString(entry))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  return {
    botMentioned: normalizeBoolean(value.botMentioned) ?? false,
    mentionedIds,
  };
}

function parseReplyTo(value: unknown): BotmaxReplyToContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = normalizeNonEmptyString(value.id);
  if (!id) {
    return undefined;
  }
  return {
    id,
    nativeId: normalizeNonEmptyString(value.nativeId),
    senderId: normalizeNonEmptyString(value.senderId),
    senderLabel: normalizeNonEmptyString(value.senderLabel),
    text: normalizeNonEmptyString(value.text),
    isQuote: normalizeBoolean(value.isQuote),
  };
}

function parseAttachment(value: unknown): BotmaxAttachment | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeNonEmptyString(value.id);
  const kind = normalizeNonEmptyString(value.kind);
  if (!id || !kind) {
    return null;
  }
  if (kind === "location") {
    const latitude =
      typeof value.latitude === "number" && Number.isFinite(value.latitude)
        ? value.latitude
        : undefined;
    const longitude =
      typeof value.longitude === "number" && Number.isFinite(value.longitude)
        ? value.longitude
        : undefined;
    if (latitude == null || longitude == null) {
      return null;
    }
    return {
      id,
      kind: "location",
      label: normalizeNonEmptyString(value.label),
      latitude,
      longitude,
      deliveryHints: isRecord(value.deliveryHints)
        ? {
            sendAs: normalizeNonEmptyString(value.deliveryHints.sendAs) as
              | BotmaxAttachmentSendAs
              | undefined,
          }
        : undefined,
    };
  }

  if (!["image", "audio", "video", "file", "sticker"].includes(kind)) {
    return null;
  }
  if (
    !normalizeNonEmptyString(value.fetchUrl) &&
    !normalizeNonEmptyString(value.sharedPath) &&
    !normalizeNonEmptyString(value.inlineBase64)
  ) {
    return null;
  }
  return {
    id,
    kind: kind as Exclude<BotmaxAttachmentKind, "location">,
    name: normalizeNonEmptyString(value.name),
    mimeType: normalizeNonEmptyString(value.mimeType),
    sizeBytes:
      typeof value.sizeBytes === "number" &&
      Number.isFinite(value.sizeBytes) &&
      value.sizeBytes >= 0
        ? Math.floor(value.sizeBytes)
        : undefined,
    fetchUrl: normalizeNonEmptyString(value.fetchUrl),
    sharedPath: normalizeNonEmptyString(value.sharedPath),
    inlineBase64: normalizeNonEmptyString(value.inlineBase64),
    caption: typeof value.caption === "string" ? value.caption.trim() : undefined,
    transcript: typeof value.transcript === "string" ? value.transcript.trim() : undefined,
    width:
      typeof value.width === "number" && Number.isFinite(value.width) && value.width > 0
        ? Math.floor(value.width)
        : undefined,
    height:
      typeof value.height === "number" && Number.isFinite(value.height) && value.height > 0
        ? Math.floor(value.height)
        : undefined,
    durationMs:
      typeof value.durationMs === "number" &&
      Number.isFinite(value.durationMs) &&
      value.durationMs >= 0
        ? Math.floor(value.durationMs)
        : undefined,
    deliveryHints: isRecord(value.deliveryHints)
      ? {
          sendAs: normalizeNonEmptyString(value.deliveryHints.sendAs) as
            | BotmaxAttachmentSendAs
            | undefined,
        }
      : undefined,
  };
}

function parseAttachments(value: unknown): BotmaxAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => parseAttachment(entry))
    .filter((entry): entry is BotmaxAttachment => Boolean(entry));
}

function parseMessageContext(value: unknown): BotmaxMessageContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeNonEmptyString(value.id);
  const createdAtMs = normalizeTimestamp(value.createdAtMs);
  const mentions = parseMentions(value.mentions);
  if (!id || createdAtMs == null || !mentions) {
    return null;
  }
  const text = typeof value.text === "string" ? value.text.trim() : undefined;
  const attachments = parseAttachments(value.attachments);
  if (!text && attachments.length === 0) {
    return null;
  }
  return {
    id,
    nativeId: normalizeNonEmptyString(value.nativeId),
    fullId: normalizeNonEmptyString(value.fullId),
    text,
    createdAtMs,
    editedAtMs: normalizeTimestamp(value.editedAtMs),
    replyTo: parseReplyTo(value.replyTo),
    mentions,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

function parseTransportContext(value: unknown): BotmaxTransportContext | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.bridge !== "botmax") {
    return null;
  }
  const receivedAtMs = normalizeTimestamp(value.receivedAtMs);
  if (receivedAtMs == null) {
    return null;
  }
  return {
    bridge: "botmax",
    receivedAtMs,
    connectionId: normalizeNonEmptyString(value.connectionId),
    dedupeKey: normalizeNonEmptyString(value.dedupeKey),
    traceId: normalizeNonEmptyString(value.traceId),
  };
}

function parseOriginContext(value: unknown): BotmaxOriginContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const platform = normalizeNonEmptyString(value.platform);
  if (!platform) {
    return null;
  }
  return {
    platform,
    surface: normalizeNonEmptyString(value.surface),
    accountId: normalizeNonEmptyString(value.accountId),
    botId: normalizeNonEmptyString(value.botId),
    botUsername: normalizeNonEmptyString(value.botUsername),
  };
}

function parseConversationContext(value: unknown): BotmaxConversationContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeNonEmptyString(value.id);
  const replyTargetId = normalizeNonEmptyString(value.replyTargetId);
  if (!id || !replyTargetId) {
    return null;
  }
  return {
    id,
    nativeId: normalizeNonEmptyString(value.nativeId),
    replyTargetId,
    kind: normalizeChatType(value.kind),
    agentId: normalizeNonEmptyString(value.agentId),
    title: normalizeNonEmptyString(value.title),
    channelName: normalizeNonEmptyString(value.channelName),
    spaceName: normalizeNonEmptyString(value.spaceName),
    threadId: normalizeThreadId(value.threadId),
    threadLabel: normalizeNonEmptyString(value.threadLabel),
    parentId: normalizeNonEmptyString(value.parentId),
    isForum: normalizeBoolean(value.isForum),
  };
}

function parseResultConversationContext(value: unknown): BotmaxResultConversationContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeNonEmptyString(value.id);
  const replyTargetId = normalizeNonEmptyString(value.replyTargetId);
  if (!id || !replyTargetId) {
    return null;
  }
  return {
    id,
    nativeId: normalizeNonEmptyString(value.nativeId),
    replyTargetId,
    threadId: normalizeThreadId(value.threadId),
  };
}

function parseSenderContext(value: unknown): BotmaxSenderContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeNonEmptyString(value.id);
  if (!id) {
    return null;
  }
  return {
    id,
    nativeId: normalizeNonEmptyString(value.nativeId),
    displayName: normalizeNonEmptyString(value.displayName),
    username: normalizeNonEmptyString(value.username),
    tag: normalizeNonEmptyString(value.tag),
    e164: normalizeNonEmptyString(value.e164),
    isBot: normalizeBoolean(value.isBot),
  };
}

function parseAuthContext(value: unknown): BotmaxAuthContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const deliveryAuthenticated = normalizeBoolean(value.deliveryAuthenticated);
  const commandAuthorized = normalizeBoolean(value.commandAuthorized);
  if (deliveryAuthenticated == null || commandAuthorized == null) {
    return null;
  }
  return {
    deliveryAuthenticated,
    commandAuthorized,
    senderIsOwner: normalizeBoolean(value.senderIsOwner),
    scopes: Array.isArray(value.scopes)
      ? value.scopes
          .map((entry) => normalizeNonEmptyString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : undefined,
  };
}

function parseFileContext(value: unknown): BotmaxFileContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const operation = normalizeNonEmptyString(value.operation);
  const path = normalizeNonEmptyString(value.path);
  const encoding = normalizeFileEncoding(value.encoding);
  if (!operation || !path || !encoding) {
    return null;
  }
  if (
    operation !== "read" &&
    operation !== "list" &&
    operation !== "write" &&
    operation !== "mkdir" &&
    operation !== "delete"
  ) {
    return null;
  }
  const content = typeof value.content === "string" ? value.content : undefined;
  const includeHidden = normalizeBoolean(value.includeHidden);
  const ensureDirectory = normalizeBoolean(value.ensureDirectory);
  const recursive = normalizeBoolean(value.recursive);
  if (operation === "write" && content == null) {
    return null;
  }
  return {
    operation,
    path,
    encoding,
    includeHidden,
    content,
    ensureDirectory,
    recursive,
  };
}

function parseDeviceOperation(value: unknown): BotmaxDeviceOperation | null {
  const normalized = normalizeNonEmptyString(value);
  if (
    normalized === "list" ||
    normalized === "approve" ||
    normalized === "reject" ||
    normalized === "remove" ||
    normalized === "clear" ||
    normalized === "rotate" ||
    normalized === "revoke"
  ) {
    return normalized;
  }
  return null;
}

function parseDeviceContext(value: unknown): BotmaxDeviceContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const operation = parseDeviceOperation(value.operation);
  if (!operation) {
    return null;
  }
  const scopes = Array.isArray(value.scopes)
    ? value.scopes
        .map((entry) => normalizeNonEmptyString(entry))
        .filter((entry): entry is string => Boolean(entry))
    : undefined;
  return {
    operation,
    pairingRequestId: normalizeNonEmptyString(value.pairingRequestId),
    latest: normalizeBoolean(value.latest),
    includePending: normalizeBoolean(value.includePending),
    deviceId: normalizeNonEmptyString(value.deviceId),
    role: normalizeNonEmptyString(value.role),
    scopes,
  };
}

function buildInboundBase(params: {
  origin: BotmaxOriginContext;
  conversation: BotmaxConversationContext;
  sender: BotmaxSenderContext;
  auth: BotmaxAuthContext;
  message?: BotmaxMessageContext;
  requestId?: JsonRpcId;
}): BotmaxInboundBase {
  const senderName =
    params.sender.displayName?.trim() || params.sender.username?.trim() || params.sender.id.trim();
  const chatType = params.conversation.kind;
  return {
    senderId: params.sender.id,
    senderName,
    senderUsername: params.sender.username,
    accountId: params.origin.accountId,
    ...(params.conversation.agentId ? { agentId: params.conversation.agentId } : {}),
    provider: params.origin.platform,
    surface: params.origin.surface?.trim() || params.origin.platform,
    botUsername: params.origin.botUsername,
    conversationId: params.conversation.id,
    conversationNativeId: params.conversation.nativeId,
    chatType,
    chatId: chatType === CHAT_TYPE_DIRECT ? undefined : params.conversation.id,
    conversationTitle: params.conversation.title,
    replyTargetId: params.conversation.replyTargetId,
    requestId: params.requestId,
    messageId: params.message?.id,
    messageFullId: params.message?.fullId,
    timestampMs: params.message?.createdAtMs ?? Date.now(),
    threadId: params.conversation.threadId,
    replyToId: params.message?.replyTo?.id,
    replyToBody: params.message?.replyTo?.text,
    replyToSender: params.message?.replyTo?.senderLabel ?? params.message?.replyTo?.senderId,
    wasMentioned: params.message?.mentions.botMentioned ?? false,
    commandAuthorized: params.auth.commandAuthorized,
    transcript: resolveTranscript(params.message?.attachments ?? []),
    attachments: params.message?.attachments,
  };
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
  const requestId = normalizeJsonRpcId(frame.id);
  const transport = parseTransportContext(params.transport);
  void transport;
  const origin = parseOriginContext(params.origin);
  const type = normalizeNonEmptyString(params.type);
  if (!transport || !origin || !type) {
    return null;
  }

  if (type === CHAT_MESSAGE_TYPE) {
    const conversation = parseConversationContext(params.conversation);
    const sender = parseSenderContext(params.sender);
    const message = parseMessageContext(params.message);
    const auth = parseAuthContext(params.auth);
    if (!conversation || !sender || !message || !auth) {
      return null;
    }
    const body = buildMessageBody(message.text, message.attachments ?? []);
    if (!body) {
      return null;
    }
    return {
      kind: "chat",
      ...buildInboundBase({
        origin,
        conversation,
        sender,
        auth,
        message,
        requestId,
      }),
      body,
    };
  }

  if (type === COMMAND_EXEC_TYPE) {
    const conversation = parseConversationContext(params.conversation);
    const sender = parseSenderContext(params.sender);
    const auth = parseAuthContext(params.auth);
    if (!conversation || !sender || !auth || !isRecord(params.command)) {
      return null;
    }
    const command = normalizeNonEmptyString(params.command.text);
    if (!command) {
      return null;
    }
    const timeoutMs =
      typeof params.command.timeoutMs === "number" &&
      Number.isFinite(params.command.timeoutMs) &&
      params.command.timeoutMs > 0
        ? Math.floor(params.command.timeoutMs)
        : undefined;
    const message = params.message ? (parseMessageContext(params.message) ?? undefined) : undefined;
    return {
      kind: "command",
      ...buildInboundBase({
        origin,
        conversation,
        sender,
        auth,
        message,
        requestId,
      }),
      command,
      timeoutMs,
    };
  }

  if (type === DEVICE_REQUEST_TYPE) {
    const device = parseDeviceContext(params.device);
    if (!device) {
      return null;
    }
    return {
      kind: "device.request",
      requestId,
      operation: device.operation,
      pairingRequestId: device.pairingRequestId,
      latest: device.latest,
      includePending: device.includePending,
      deviceId: device.deviceId,
      role: device.role,
      scopes: device.scopes,
    };
  }

  if (type === FILE_READ_TYPE) {
    const file = parseFileContext(params.file);
    if (!file || file.operation !== "read") {
      return null;
    }
    return {
      kind: "file.read",
      requestId,
      path: file.path,
      encoding: file.encoding,
    };
  }

  if (type === FILE_LIST_TYPE) {
    const file = parseFileContext(params.file);
    if (!file || file.operation !== "list") {
      return null;
    }
    return {
      kind: "file.list",
      requestId,
      path: file.path,
      includeHidden: file.includeHidden ?? true,
    };
  }

  if (type === FILE_WRITE_TYPE) {
    const file = parseFileContext(params.file);
    if (!file || file.operation !== "write" || file.content == null) {
      return null;
    }
    return {
      kind: "file.write",
      requestId,
      path: file.path,
      encoding: file.encoding,
      content: file.content,
      ensureDirectory: file.ensureDirectory ?? true,
    };
  }

  if (type === DIRECTORY_CREATE_TYPE) {
    const file = parseFileContext(params.file);
    if (!file || file.operation !== "mkdir") {
      return null;
    }
    return {
      kind: "directory.create",
      requestId,
      path: file.path,
      recursive: file.recursive ?? true,
    };
  }

  if (type === FILE_DELETE_TYPE) {
    const file = parseFileContext(params.file);
    if (!file || file.operation !== "delete") {
      return null;
    }
    return {
      kind: "file.delete",
      requestId,
      path: file.path,
      encoding: file.encoding,
    };
  }

  if (type === COMMAND_RESULT_TYPE) {
    const conversation = parseResultConversationContext(params.conversation);
    if (!conversation) {
      return null;
    }
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

export function formatBotmaxOutboundMessage(params: {
  recipientId: string;
  text?: string;
  attachments?: BotmaxOutboundAttachmentInput[];
  senderId?: string;
  requestId?: JsonRpcId;
  chatType?: BotmaxChatType;
  conversationId?: string;
  conversationNativeId?: string;
  replyToId?: string;
  platform?: string;
  surface?: string;
  botUsername?: string;
  messageId?: string;
  threadId?: string | number;
}): string {
  const normalizedRecipient = params.recipientId?.trim();
  if (!normalizedRecipient) {
    throw new Error("Botmax recipientId is required");
  }
  const text = normalizeNonEmptyString(params.text);
  const attachments = params.attachments?.filter(Boolean) ?? [];
  if (!text && attachments.length === 0) {
    throw new Error("Botmax chat message requires text or attachments");
  }
  const from = params.senderId?.trim() || "openclaw:botmax";
  const now = Date.now();
  const platform = params.platform?.trim() || inferPlatformFromScopedId(normalizedRecipient);
  const conversation = buildConversationContext({
    recipientId: normalizedRecipient,
    chatType: params.chatType,
    conversationId: params.conversationId,
    conversationNativeId: params.conversationNativeId,
    threadId: params.threadId,
  });
  return stringifyTransportFrame(
    {
      v: BOTMAX_TRANSPORT_VERSION,
      type: CHAT_MESSAGE_TYPE,
      transport: buildTransportContext(now),
      origin: buildOriginContext({
        platform,
        surface: params.surface,
        botUsername: params.botUsername,
      }),
      conversation,
      sender: {
        id: from,
        nativeId: normalizeNativeId(from),
        displayName: from,
      },
      message: buildMessageContext({
        text,
        attachments,
        createdAtMs: now,
        conversationId: conversation.id,
        messageId: params.messageId,
        replyToId: normalizeNonEmptyString(params.replyToId),
      }),
      auth: {
        deliveryAuthenticated: true,
        commandAuthorized: false,
      },
    },
    params.requestId,
  );
}

export function formatBotmaxOutboundText(params: {
  recipientId: string;
  text: string;
  senderId?: string;
  requestId?: JsonRpcId;
  chatType?: BotmaxChatType;
  conversationId?: string;
  conversationNativeId?: string;
  replyToId?: string;
  platform?: string;
  surface?: string;
  botUsername?: string;
  messageId?: string;
  threadId?: string | number;
}): string {
  const text = params.text ?? "";
  if (!text.trim()) {
    throw new Error("Botmax text message requires non-empty text");
  }
  return formatBotmaxOutboundMessage(params);
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
  chatType?: BotmaxChatType;
  conversationId?: string;
  conversationNativeId?: string;
  platform?: string;
  surface?: string;
  threadId?: string | number;
}): string {
  const normalizedRecipient = params.recipientId?.trim();
  if (!normalizedRecipient) {
    throw new Error("Botmax recipientId is required");
  }
  const command = params.command?.trim();
  if (!command) {
    throw new Error("Botmax command result requires command");
  }
  const platform = params.platform?.trim() || inferPlatformFromScopedId(normalizedRecipient);
  const conversation = buildConversationContext({
    recipientId: normalizedRecipient,
    chatType: params.chatType,
    conversationId: params.conversationId,
    conversationNativeId: params.conversationNativeId,
    threadId: params.threadId,
  });
  return stringifyTransportFrame(
    {
      v: BOTMAX_TRANSPORT_VERSION,
      type: COMMAND_RESULT_TYPE,
      transport: buildTransportContext(Date.now()),
      origin: buildOriginContext({
        platform,
        surface: params.surface,
      }),
      conversation: {
        id: conversation.id,
        nativeId: conversation.nativeId,
        replyTargetId: conversation.replyTargetId,
        threadId: conversation.threadId,
      },
      command: {
        text: command,
        method: params.method,
      },
      result: {
        ok: params.ok,
        output: params.output ?? "",
        data: params.data,
      },
    },
    params.requestId,
  );
}

export function formatBotmaxOutboundFileResult(params: {
  operation: "read" | "list" | "write" | "mkdir" | "delete";
  path: string;
  encoding: BotmaxFileEncoding;
  ok: boolean;
  output: string;
  errorCode?: string;
  data?: unknown;
  requestId?: JsonRpcId;
  platform?: string;
  surface?: string;
}): string {
  const path = normalizeNonEmptyString(params.path);
  if (!path) {
    throw new Error("Botmax file result requires path");
  }
  const platform = params.platform?.trim() || "internal";
  return stringifyTransportFrame(
    {
      v: BOTMAX_TRANSPORT_VERSION,
      type: FILE_RESULT_TYPE,
      transport: buildTransportContext(Date.now()),
      origin: buildOriginContext({
        platform,
        surface: params.surface,
      }),
      file: {
        operation: params.operation,
        path,
        encoding: params.encoding,
      },
      result: {
        ok: params.ok,
        output: params.output ?? "",
        errorCode: normalizeNonEmptyString(params.errorCode),
        data: params.data,
      },
    },
    params.requestId,
  );
}

export function formatBotmaxOutboundDeviceResult(params: {
  operation: BotmaxDeviceOperation;
  pairingRequestId?: string;
  latest?: boolean;
  includePending?: boolean;
  deviceId?: string;
  role?: string;
  scopes?: string[];
  ok: boolean;
  output: string;
  errorCode?: string;
  data?: unknown;
  requestId?: JsonRpcId;
  platform?: string;
  surface?: string;
}): string {
  const platform = params.platform?.trim() || "internal";
  return stringifyTransportFrame(
    {
      v: BOTMAX_TRANSPORT_VERSION,
      type: DEVICE_RESULT_TYPE,
      transport: buildTransportContext(Date.now()),
      origin: buildOriginContext({
        platform,
        surface: params.surface,
      }),
      device: {
        operation: params.operation,
        pairingRequestId: normalizeNonEmptyString(params.pairingRequestId),
        latest: params.latest,
        includePending: params.includePending,
        deviceId: normalizeNonEmptyString(params.deviceId),
        role: normalizeNonEmptyString(params.role),
        scopes: params.scopes?.filter(Boolean),
      },
      result: {
        ok: params.ok,
        output: params.output ?? "",
        errorCode: normalizeNonEmptyString(params.errorCode),
        data: params.data,
      },
    },
    params.requestId,
  );
}
