import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { BotmaxChannelConfig, ResolvedBotmaxAccount } from "./types.js";

const DEFAULT_TEXT_CHUNK_LIMIT = 2000;
const DEFAULT_DONE_TOKEN = "<<<done>>>";

export function normalizeBotmaxId(value: string): string {
  return value.trim().replace(/^botmax:/i, "").toLowerCase();
}

function getChannelConfig(cfg: OpenClawConfig): BotmaxChannelConfig {
  return (cfg.channels?.botmax ?? {}) as BotmaxChannelConfig;
}

export function listAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = getChannelConfig(cfg).accounts;
  if (accounts && Object.keys(accounts).length > 0) {
    return Object.keys(accounts);
  }
  return [DEFAULT_ACCOUNT_ID];
}

export function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedBotmaxAccount {
  const resolvedAccountId = accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const channelConfig = getChannelConfig(cfg);
  const accountOverride = channelConfig.accounts?.[resolvedAccountId] ?? {};

  const envServer = process.env.BOTMAX_SERVER;
  const envTextChunkLimit = process.env.BOTMAX_TEXT_CHUNK_LIMIT;
  const envDoneToken = process.env.BOTMAX_DONE_TOKEN;

  const server =
    accountOverride.server ?? channelConfig.server ?? envServer ?? "";
  const textChunkLimitRaw =
    accountOverride.textChunkLimit ?? channelConfig.textChunkLimit ?? envTextChunkLimit;
  const textChunkLimit =
    typeof textChunkLimitRaw === "number"
      ? textChunkLimitRaw
      : typeof textChunkLimitRaw === "string" && textChunkLimitRaw.trim()
        ? Number.parseInt(textChunkLimitRaw, 10)
        : DEFAULT_TEXT_CHUNK_LIMIT;

  const doneToken =
    accountOverride.doneToken ?? channelConfig.doneToken ?? envDoneToken ?? undefined;

  const resolvedDoneToken =
    doneToken === null
      ? null
      : typeof doneToken === "string" && doneToken.trim()
        ? doneToken.trim()
        : DEFAULT_DONE_TOKEN;

  return {
    accountId: resolvedAccountId,
    name: accountOverride.name ?? channelConfig.name,
    enabled: accountOverride.enabled ?? channelConfig.enabled ?? true,
    server,
    textChunkLimit: Number.isFinite(textChunkLimit) && textChunkLimit > 0
      ? textChunkLimit
      : DEFAULT_TEXT_CHUNK_LIMIT,
    doneToken: resolvedDoneToken,
  };
}

export function isAccountConfigured(account: ResolvedBotmaxAccount): boolean {
  return Boolean(account.server.trim());
}
