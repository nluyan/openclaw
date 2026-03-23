import type { OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import { chunkTextForOutbound, createReplyPrefixOptions } from "openclaw/plugin-sdk";
import { buildOutboundAttachmentsFromReply, materializeInboundAttachments } from "./attachments.js";
import { sendBotmaxMessage, sendBotmaxText, suspendBotmaxHeartbeat } from "./connection.js";
import type { BotmaxInboundAttachment } from "./message-format.js";
import { getBotmaxRuntime } from "./runtime.js";
import type { ResolvedBotmaxAccount } from "./types.js";

function resolveReplyToIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const replyToId = (payload as { replyToId?: unknown }).replyToId;
  return typeof replyToId === "string" && replyToId.trim().length > 0
    ? replyToId.trim()
    : undefined;
}

export async function handleBotmaxInbound(params: {
  senderId: string;
  senderName?: string;
  senderUsername?: string;
  accountId?: string;
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

  const route = core.channel.routing.resolveAgentRoute({
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
    await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg: config,
      dispatcherOptions: {
        ...prefixOptions,
        deliver,
        onError: (err, info) => {
          runtime.error?.(`botmax ${info.kind} reply failed: ${String(err)}`);
        },
      },
      replyOptions: {
        onModelSelected,
      },
    });
  } finally {
    try {
      if (outboundDelivered === 0) {
        runtime.log?.(
          `botmax[${account.accountId}] no outbound reply for sender ${senderId} (target=${replyTargetId})`,
        );
      }
    } finally {
      releaseHeartbeat();
    }
  }
}
