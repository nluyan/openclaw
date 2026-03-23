import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildOutboundAttachmentsFromReply, materializeInboundAttachments } from "./attachments.js";
import { sendBotmaxMessage, sendBotmaxText, suspendBotmaxHeartbeat } from "./connection.js";
import type { BotmaxInboundAttachment } from "./message-format.js";
import type { OpenClawConfig, RuntimeEnv } from "./runtime-api.js";
import { chunkTextForOutbound, createReplyPrefixOptions } from "./runtime-api.js";
import { getBotmaxRuntime } from "./runtime.js";
import type { ResolvedBotmaxAccount } from "./types.js";

const DEFAULT_AGENT_ID = "main";
const VALID_AGENT_ID_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/i;
const INVALID_AGENT_ID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;
const BOTMAX_REPLY_LOG_PREVIEW_MAX_CHARS = 160;

function normalizeBotmaxAgentId(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return DEFAULT_AGENT_ID;
  }
  if (VALID_AGENT_ID_RE.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return (
    trimmed
      .toLowerCase()
      .replace(INVALID_AGENT_ID_CHARS_RE, "-")
      .replace(LEADING_DASH_RE, "")
      .replace(TRAILING_DASH_RE, "")
      .slice(0, 64) || DEFAULT_AGENT_ID
  );
}

function resolveReplyToIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const replyToId = (payload as { replyToId?: unknown }).replyToId;
  return typeof replyToId === "string" && replyToId.trim().length > 0
    ? replyToId.trim()
    : undefined;
}

function buildBotmaxReplyPayloadSummary(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return `type=${typeof payload}`;
  }

  const record = payload as {
    text?: unknown;
    mediaUrl?: unknown;
    mediaUrls?: unknown;
    replyToId?: unknown;
    audioAsVoice?: unknown;
  };
  const text =
    typeof record.text === "string" && record.text.trim().length > 0
      ? record.text.replace(/\s+/g, " ").trim().slice(0, BOTMAX_REPLY_LOG_PREVIEW_MAX_CHARS)
      : undefined;
  const mediaUrls = Array.isArray(record.mediaUrls)
    ? record.mediaUrls.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  const parts = [
    text ? `text="${text}"` : "text=<empty>",
    typeof record.mediaUrl === "string" && record.mediaUrl.trim().length > 0
      ? `mediaUrl=${record.mediaUrl.trim()}`
      : undefined,
    mediaUrls.length > 0 ? `mediaUrls=${mediaUrls.length}` : undefined,
    typeof record.replyToId === "string" && record.replyToId.trim().length > 0
      ? `replyToId=${record.replyToId.trim()}`
      : undefined,
    record.audioAsVoice === true ? "audioAsVoice=true" : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.join(", ");
}

function normalizeBotmaxLogPreview(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, BOTMAX_REPLY_LOG_PREVIEW_MAX_CHARS) : undefined;
}

function summarizeTranscriptAssistantEntry(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as {
    type?: unknown;
    timestamp?: unknown;
    message?: {
      role?: unknown;
      provider?: unknown;
      model?: unknown;
      stopReason?: unknown;
      errorMessage?: unknown;
      content?: Array<{ type?: unknown; text?: unknown }>;
    };
  };
  if (record.type !== "message" || record.message?.role !== "assistant") {
    return null;
  }

  const textPart = Array.isArray(record.message.content)
    ? record.message.content.find(
        (part): part is { type: "text"; text: string } =>
          part?.type === "text" && typeof part.text === "string",
      )
    : undefined;

  return {
    timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
    provider: typeof record.message.provider === "string" ? record.message.provider : undefined,
    model: typeof record.message.model === "string" ? record.message.model : undefined,
    stopReason:
      typeof record.message.stopReason === "string" ? record.message.stopReason : undefined,
    errorMessage:
      typeof record.message.errorMessage === "string" ? record.message.errorMessage : undefined,
    textPreview: normalizeBotmaxLogPreview(textPart?.text),
  };
}

async function inspectBotmaxSessionTranscript(params: {
  storePath: string;
  sessionKey: string;
}): Promise<string | undefined> {
  try {
    const rawStore = await readFile(params.storePath, "utf8");
    const parsedStore = JSON.parse(rawStore) as Record<string, unknown>;
    const entry = parsedStore[params.sessionKey.trim().toLowerCase()];
    if (!entry || typeof entry !== "object") {
      return undefined;
    }

    const sessionFileRaw =
      typeof (entry as { sessionFile?: unknown }).sessionFile === "string"
        ? (entry as { sessionFile?: string }).sessionFile?.trim()
        : undefined;
    if (!sessionFileRaw) {
      return undefined;
    }

    const sessionFile = path.isAbsolute(sessionFileRaw)
      ? sessionFileRaw
      : path.resolve(path.dirname(params.storePath), sessionFileRaw);
    const rawTranscript = await readFile(sessionFile, "utf8");
    const lines = rawTranscript.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const assistantEntries: Record<string, unknown>[] = [];

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const parsedLine = JSON.parse(lines[index] ?? "") as unknown;
        const summary = summarizeTranscriptAssistantEntry(parsedLine);
        if (summary) {
          assistantEntries.push(summary);
          if (assistantEntries.length >= 2) {
            break;
          }
        }
      } catch {
        // Ignore malformed transcript lines during diagnostics.
      }
    }

    return JSON.stringify({
      sessionFile,
      assistantTail: assistantEntries,
    });
  } catch (error) {
    return JSON.stringify({
      diagnosticError: String(error),
    });
  }
}

export async function handleBotmaxInbound(params: {
  senderId: string;
  senderName?: string;
  senderUsername?: string;
  accountId?: string;
  agentId?: string;
  body: string;
  chatType: "direct" | "group" | "channel";
  chatId?: string;
  conversationId?: string;
  conversationNativeId?: string;
  conversationTitle?: string;
  replyTargetId: string;
  requestId?: string | number | null;
  provider?: string;
  surface?: string;
  botUsername?: string;
  messageId?: string;
  messageFullId?: string;
  timestampMs?: number;
  replyToId?: string;
  replyToBody?: string;
  replyToSender?: string;
  threadId?: string | number;
  wasMentioned?: boolean;
  commandAuthorized?: boolean;
  transcript?: string;
  attachments?: BotmaxInboundAttachment[];
  account: ResolvedBotmaxAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const {
    senderId,
    senderName,
    senderUsername,
    accountId,
    agentId,
    body,
    chatType,
    chatId,
    conversationId,
    conversationNativeId,
    conversationTitle,
    replyTargetId,
    requestId,
    provider,
    surface,
    botUsername,
    messageId,
    messageFullId,
    timestampMs,
    replyToId,
    replyToBody,
    replyToSender,
    threadId,
    wasMentioned,
    commandAuthorized,
    transcript,
    attachments,
    account,
    config,
    runtime,
    statusSink,
  } = params;
  const core = getBotmaxRuntime();
  const rawBody = body.trim();
  if (!rawBody) {
    return;
  }
  const isGroupConversation = chatType !== "direct";
  const normalizedConversationId =
    conversationId?.trim() || (isGroupConversation ? chatId?.trim() || replyTargetId : senderId);
  const normalizedConversationNativeId =
    conversationNativeId?.trim() || (isGroupConversation ? normalizedConversationId : undefined);
  const normalizedChatId =
    chatId?.trim() || (isGroupConversation ? normalizedConversationId : undefined);
  const routePeerId = isGroupConversation ? normalizedConversationId : senderId;
  const normalizedProvider = provider?.trim() || "botmax";
  const normalizedSurface = surface?.trim() || normalizedProvider;
  const normalizedSenderName = senderName?.trim() || senderUsername?.trim() || senderId;
  const normalizedConversationLabel = isGroupConversation
    ? conversationTitle?.trim() || normalizedConversationId
    : normalizedSenderName;
  const inboundTimestamp = timestampMs ?? Date.now();
  const routingAccountId = accountId?.trim() || account.accountId;

  statusSink?.({ lastInboundAt: Date.now() });

  const normalizedExplicitAgentId = agentId?.trim() ? normalizeBotmaxAgentId(agentId) : undefined;
  const route = normalizedExplicitAgentId
    ? {
        agentId: normalizedExplicitAgentId,
        accountId: routingAccountId,
        sessionKey: core.channel.routing
          .buildAgentSessionKey({
            agentId: normalizedExplicitAgentId,
            channel: "botmax",
            accountId: routingAccountId,
            peer: {
              kind: isGroupConversation ? "group" : "direct",
              id: routePeerId,
            },
            dmScope: config.session?.dmScope,
            identityLinks: config.session?.identityLinks,
          })
          .toLowerCase(),
      }
    : core.channel.routing.resolveAgentRoute({
        cfg: config,
        channel: "botmax",
        accountId: routingAccountId,
        peer: {
          kind: isGroupConversation ? "group" : "direct",
          id: routePeerId,
        },
      });

  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  const envelopeBody = core.channel.reply.formatAgentEnvelope({
    channel: "Botmax",
    from: normalizedSenderName,
    timestamp: inboundTimestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const materializedAttachments = await materializeInboundAttachments({
    attachments,
    runtime: core,
  });
  const effectiveTranscript = transcript?.trim() || materializedAttachments.transcript;

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: envelopeBody,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    BodyForCommands: rawBody,
    From: normalizedConversationId,
    To: replyTargetId,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: chatType,
    ConversationLabel: normalizedConversationLabel,
    SenderName: normalizedSenderName,
    SenderId: senderId,
    SenderUsername: senderUsername?.trim() || undefined,
    GroupSubject: isGroupConversation ? normalizedConversationLabel : undefined,
    GroupChannel: chatType === "channel" ? normalizedConversationLabel : undefined,
    Provider: normalizedProvider,
    Surface: normalizedSurface,
    BotUsername: botUsername?.trim() || undefined,
    MessageSid: messageId?.trim() || undefined,
    MessageSidFull: messageFullId?.trim() || undefined,
    ReplyToId: replyToId?.trim() || undefined,
    ReplyToBody: replyToBody?.trim() || undefined,
    ReplyToSender: replyToSender?.trim() || undefined,
    Transcript: effectiveTranscript,
    WasMentioned: wasMentioned,
    MessageThreadId: threadId,
    NativeChannelId: normalizedConversationNativeId ?? normalizedConversationId,
    Timestamp: inboundTimestamp,
    OriginatingChannel: "botmax",
    OriginatingTo: replyTargetId,
    CommandAuthorized: commandAuthorized ?? true,
    ...materializedAttachments.mediaPayload,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`botmax: failed updating session meta: ${String(err)}`);
    },
  });

  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg: config,
    channel: "botmax",
    accountId: account.accountId,
  });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: "botmax",
    accountId: account.accountId,
  });

  let outboundDelivered = 0;
  const skippedReplies: string[] = [];
  let dispatchResult:
    | {
        queuedFinal: boolean;
        counts: Record<"tool" | "block" | "final", number>;
      }
    | undefined;

  const deliver = async (payload: unknown) => {
    const replyToId = resolveReplyToIdFromPayload(payload);
    const outbound = await buildOutboundAttachmentsFromReply({
      payload,
      runtime: core,
    });
    const renderedText = outbound.text
      ? core.channel.text.convertMarkdownTables(outbound.text, tableMode)
      : undefined;
    if (outbound.attachments.length > 0) {
      await sendBotmaxMessage(
        account.accountId,
        replyTargetId,
        {
          text: renderedText,
          attachments: outbound.attachments,
        },
        {
          requestId,
          chatType,
          conversationId: normalizedConversationId,
          conversationNativeId: normalizedConversationNativeId,
          replyToId,
          platform: normalizedProvider,
          surface: normalizedSurface,
          botUsername,
          threadId,
        },
      );
      outboundDelivered += 1;
      return;
    }
    const textToSend = renderedText ?? "";
    if (!textToSend.trim()) {
      runtime.log?.(
        `botmax[${account.accountId}] deliver skipped after render: agent=${route.agentId} sender=${senderId} summary=${buildBotmaxReplyPayloadSummary(payload)}`,
      );
      return;
    }
    const limit = account.textChunkLimit;
    const chunks = limit > 0 ? chunkTextForOutbound(textToSend, limit) : [textToSend];
    for (const chunk of chunks) {
      if (!chunk) {
        continue;
      }
      await sendBotmaxText(account.accountId, replyTargetId, chunk, {
        requestId,
        chatType,
        conversationId: normalizedConversationId,
        conversationNativeId: normalizedConversationNativeId,
        replyToId,
        platform: normalizedProvider,
        surface: normalizedSurface,
        botUsername,
        threadId,
      });
      outboundDelivered += 1;
    }
  };

  const releaseHeartbeat = suspendBotmaxHeartbeat(account.accountId);
  try {
    dispatchResult = await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg: config,
      dispatcherOptions: {
        ...prefixOptions,
        deliver,
        onError: (err, info) => {
          runtime.error?.(`botmax ${info.kind} reply failed: ${String(err)}`);
        },
        onSkip: (payload, info) => {
          const message = `kind=${info.kind} reason=${info.reason} summary=${buildBotmaxReplyPayloadSummary(payload)}`;
          if (skippedReplies.length < 5) {
            skippedReplies.push(message);
          }
          runtime.log?.(
            `botmax[${account.accountId}] skipped reply: agent=${route.agentId} sender=${senderId} ${message}`,
          );
        },
      },
      replyOptions: {
        onModelSelected,
      },
    });
  } finally {
    try {
      if (outboundDelivered === 0) {
        const sessionTranscript =
          skippedReplies.length === 0
            ? await inspectBotmaxSessionTranscript({
                storePath,
                sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
              })
            : undefined;
        runtime.log?.(
          `botmax[${account.accountId}] no outbound reply for sender ${senderId} (target=${replyTargetId}, agent=${route.agentId}, queuedFinal=${dispatchResult?.queuedFinal ?? false}, counts=${JSON.stringify(dispatchResult?.counts ?? { tool: 0, block: 0, final: 0 })}, skipped=${JSON.stringify(skippedReplies)}${sessionTranscript ? `, transcript=${sessionTranscript}` : ""})`,
        );
      }
    } finally {
      releaseHeartbeat();
    }
  }
}
