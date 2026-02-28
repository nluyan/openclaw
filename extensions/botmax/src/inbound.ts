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
  senderId: string;
  body: string;
  account: ResolvedBotmaxAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { senderId, body, account, config, runtime, statusSink } = params;
  const core = getBotmaxRuntime();
  const rawBody = body.trim();
  if (!rawBody) {
    return;
  }

  statusSink?.({ lastInboundAt: Date.now() });

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

  const envelopeBody = core.channel.reply.formatAgentEnvelope({
    channel: "Botmax",
    from: senderId,
    timestamp: Date.now(),
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: envelopeBody,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: senderId,
    To: senderId,
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
    OriginatingTo: senderId,
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

  let outboundDelivered = 0;

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
      await sendBotmaxText(account.accountId, senderId, chunk);
      outboundDelivered += 1;
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
      if (outboundDelivered === 0) {
        runtime.log?.(
          `botmax[${account.accountId}] no outbound reply for sender ${senderId}`,
        );
      }
      if (account.doneToken !== null) {
        await sendBotmaxText(account.accountId, senderId, account.doneToken);
      }
    } finally {
      releaseHeartbeat();
    }
  }
}
