import type { ChannelAccountSnapshot, ChannelPlugin } from "openclaw/plugin-sdk";
import {
  buildBaseChannelStatusSummary,
  buildChannelConfigSchema,
  chunkTextForOutbound,
  collectStatusIssuesFromLastError,
  createDefaultChannelRuntimeState,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk";
import { BotmaxConfigSchema } from "./config-schema.js";
import { isAccountConfigured, listAccountIds, normalizeBotmaxId, resolveAccount } from "./accounts.js";
import { getBotmaxRuntime } from "./runtime.js";
import { sendBotmaxText, suspendBotmaxHeartbeat } from "./connection.js";
import { monitorBotmaxAccount } from "./monitor.js";
import type { ResolvedBotmaxAccount } from "./types.js";

const CHANNEL_ID = "botmax" as const;
const botmaxConfigSchema = buildChannelConfigSchema(BotmaxConfigSchema);

function normalizeBotmaxMessagingTarget(raw: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^botmax:/i, "");
}

export const botmaxPlugin: ChannelPlugin<ResolvedBotmaxAccount> = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "Botmax",
    selectionLabel: "Botmax (WebSocket)",
    docsPath: "/channels/botmax",
    docsLabel: "botmax",
    blurb: "WebSocket bridge for Botmax",
    order: 95,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.botmax"] },
  configSchema: botmaxConfigSchema,
  config: {
    listAccountIds: (cfg) => listAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "botmax",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "botmax",
        accountId,
        clearBaseFields: ["server", "botId", "imUserId", "token", "name"],
      }),
    isConfigured: (account) => isAccountConfigured(account),
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: isAccountConfigured(account),
      server: account.server,
      imUserId: account.imUserId,
    }),
    resolveDefaultTo: ({ cfg, accountId }) => {
      const account = resolveAccount(cfg, accountId);
      return account.imUserId?.trim() || undefined;
    },
  },
  messaging: {
    normalizeTarget: normalizeBotmaxMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => Boolean(raw?.trim()),
      hint: "<imUserId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId }) => {
      const account = resolveAccount(cfg, accountId);
      const peerId = account.imUserId?.trim();
      return peerId ? [{ kind: "user", id: normalizeBotmaxId(peerId) }] : [];
    },
    listGroups: async () => [],
  },
  outbound: {
    deliveryMode: "gateway",
    chunker: (text, limit) => chunkTextForOutbound(text, limit),
    chunkerMode: "text",
    textChunkLimit: 2000,
    sendText: async ({ to, text, accountId, cfg }) => {
      const account = resolveAccount(cfg, accountId);
      if (!isAccountConfigured(account)) {
        throw new Error("Botmax account is not configured");
      }
      const target = normalizeBotmaxId(to ?? "") || normalizeBotmaxId(account.imUserId);
      if (!target) {
        throw new Error("Botmax target is required");
      }
      if (normalizeBotmaxId(account.imUserId) !== target) {
        throw new Error(
          `Botmax target must match account imUserId (${account.imUserId}) or select the correct account`,
        );
      }
      const core = getBotmaxRuntime();
      const tableMode = core.channel.text.resolveMarkdownTableMode({
        cfg,
        channel: CHANNEL_ID,
        accountId: account.accountId,
      });
      const message = core.channel.text.convertMarkdownTables(text ?? "", tableMode);
      const releaseHeartbeat = suspendBotmaxHeartbeat(account.accountId);
      try {
        await sendBotmaxText(account.accountId, message);
      } finally {
        releaseHeartbeat();
      }
      return { channel: CHANNEL_ID, messageId: `botmax-${Date.now()}`, chatId: target };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, cfg }) => {
      const account = resolveAccount(cfg, accountId);
      if (!isAccountConfigured(account)) {
        throw new Error("Botmax account is not configured");
      }
      const target = normalizeBotmaxId(to ?? "") || normalizeBotmaxId(account.imUserId);
      if (!target) {
        throw new Error("Botmax target is required");
      }
      if (normalizeBotmaxId(account.imUserId) !== target) {
        throw new Error(
          `Botmax target must match account imUserId (${account.imUserId}) or select the correct account`,
        );
      }
      if (!mediaUrl) {
        throw new Error("Botmax mediaUrl is required");
      }
      const core = getBotmaxRuntime();
      const tableMode = core.channel.text.resolveMarkdownTableMode({
        cfg,
        channel: CHANNEL_ID,
        accountId: account.accountId,
      });
      const caption = core.channel.text.convertMarkdownTables(text ?? "", tableMode);
      const payload = `${caption}\n\nAttachment: ${mediaUrl}`.trim();
      const releaseHeartbeat = suspendBotmaxHeartbeat(account.accountId);
      try {
        await sendBotmaxText(account.accountId, payload);
      } finally {
        releaseHeartbeat();
      }
      return { channel: CHANNEL_ID, messageId: `botmax-${Date.now()}`, chatId: target };
    },
  },
  status: {
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
    collectStatusIssues: (accounts) => collectStatusIssuesFromLastError(CHANNEL_ID, accounts),
    buildChannelSummary: ({ snapshot }) => buildBaseChannelStatusSummary(snapshot),
    buildAccountSnapshot: ({ account, runtime }) => {
      const configured = isAccountConfigured(account);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
        server: account.server,
        imUserId: account.imUserId,
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.enabled) {
        ctx.log?.info(`botmax[${account.accountId}] disabled, skipping`);
        return { stop: () => {} };
      }
      if (!isAccountConfigured(account)) {
        ctx.log?.warn?.(`botmax[${account.accountId}] not configured, skipping`);
        ctx.setStatus({
          accountId: account.accountId,
          running: false,
          lastError: "not configured",
        });
        return { stop: () => {} };
      }
      ctx.log?.info(
        `botmax[${account.accountId}] starting channel (abort=${ctx.abortSignal.aborted})`,
      );
      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
        lastError: null,
      });
      const monitor = monitorBotmaxAccount({
        account,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });
      await new Promise<void>((resolve) => {
        if (ctx.abortSignal.aborted) {
          ctx.log?.info(`botmax[${account.accountId}] abort received before start`);
          monitor.stop();
          resolve();
          return;
        }
        ctx.abortSignal.addEventListener(
          "abort",
          () => {
          ctx.log?.info(`botmax[${account.accountId}] abort received; stopping channel`);
          monitor.stop();
          resolve();
        },
        { once: true },
      );
    });
      ctx.log?.info(`botmax[${account.accountId}] channel stopped`);
    },
  },
};
