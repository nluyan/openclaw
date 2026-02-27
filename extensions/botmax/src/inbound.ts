import type { OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import {
  chunkTextForOutbound,
  createNormalizedOutboundDeliverer,
  createReplyPrefixOptions,
  formatTextWithAttachmentLinks,
  resolveOutboundMediaUrls,
} from "openclaw/plugin-sdk";
import { getBotmaxRuntime } from "./runtime.js";
import { sendBotmaxText, suspendBotmaxHeartbeat } from "./connection.js";
import type { ResolvedBotmaxAccount } from "./types.js";

export async function handleBotmaxInbound(params: {
  text: string;
  account: ResolvedBotmaxAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { text, account, config, runtime, statusSink } = params;
  const core = getBotmaxRuntime();
  const rawBody = text.trim();
  if (!rawBody) {
    return;
  }
  if (rawBody === "<<<ping>>>" || rawBody === "<<<pong>>>") {
    return;
  }

  statusSink?.({ lastInboundAt: Date.now() });

  const senderId = account.imUserId;

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "botmax",
    accountId: account.accountId,
    peer: {
      kind: "direct",
      id: senderId,
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

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Botmax",
    from: senderId,
    timestamp: Date.now(),
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `botmax:${senderId}`,
    To: `botmax:${senderId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "direct",
    ConversationLabel: senderId,
    SenderName: senderId,
    SenderId: senderId,
    Provider: "botmax",
    Surface: "botmax",
    Timestamp: Date.now(),
    OriginatingChannel: "botmax",
    OriginatingTo: `botmax:${senderId}`,
    CommandAuthorized: true,
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

  const deliver = createNormalizedOutboundDeliverer(async (payload) => {
    const combined = formatTextWithAttachmentLinks(
      payload.text,
      resolveOutboundMediaUrls(payload),
    );
    if (!combined.trim()) {
      return;
    }
    const textToSend = core.channel.text.convertMarkdownTables(combined, tableMode);
    const limit = account.textChunkLimit;
    const chunks = limit > 0 ? chunkTextForOutbound(textToSend, limit) : [textToSend];
    for (const chunk of chunks) {
      if (!chunk) {
        continue;
      }
      await sendBotmaxText(account.accountId, chunk);
    }
  });

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
      if (account.doneToken !== null) {
        await sendBotmaxText(account.accountId, account.doneToken);
      }
    } finally {
      releaseHeartbeat();
    }
  }
}
