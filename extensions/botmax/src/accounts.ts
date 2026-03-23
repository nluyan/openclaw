import type { OpenClawConfig } from "./runtime-api.js";
import { DEFAULT_ACCOUNT_ID } from "./runtime-api.js";
import type { BotmaxChannelConfig, ResolvedBotmaxAccount } from "./types.js";

const DEFAULT_TEXT_CHUNK_LIMIT = 2000;

export function normalizeBotmaxId(value: string): string {
  return value
    .trim()
    .replace(/^botmax:/i, "")
    .toLowerCase();
}

function getChannelConfig(cfg: OpenClawConfig): BotmaxChannelConfig {
  return (cfg.channels?.botmax ?? {}) as BotmaxChannelConfig;
}

function hasOwnAccount(
  accounts: Record<string, BotmaxChannelConfig["accounts"][string]> | undefined,
  accountId: string,
): boolean {
  if (!accounts) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(accounts, accountId);
}

function resolveConfiguredAccountId(
  channelConfig: BotmaxChannelConfig,
  accountId?: string | null,
): string {
  const requestedAccountId = accountId?.trim();
  if (!requestedAccountId) {
    return DEFAULT_ACCOUNT_ID;
  }

  const accounts = channelConfig.accounts;
  if (!accounts || Object.keys(accounts).length === 0) {
    return DEFAULT_ACCOUNT_ID;
  }

  if (hasOwnAccount(accounts, requestedAccountId)) {
    return requestedAccountId;
  }

  if (hasOwnAccount(accounts, DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }

  const configuredAccountIds = Object.keys(accounts);
  if (configuredAccountIds.length === 1) {
    return configuredAccountIds[0] ?? requestedAccountId;
  }

  return requestedAccountId;
}

export function listAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = getChannelConfig(cfg).accounts;
  if (accounts && Object.keys(accounts).length > 0) {
    return Object.keys(accounts);
  }
  return [DEFAULT_ACCOUNT_ID];
}

export function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedBotmaxAccount {
  const channelConfig = getChannelConfig(cfg);
  const resolvedAccountId = resolveConfiguredAccountId(channelConfig, accountId);
  const accountOverride = channelConfig.accounts?.[resolvedAccountId] ?? {};

  const envServer = process.env.BOTMAX_SERVER;
  const envTextChunkLimit = process.env.BOTMAX_TEXT_CHUNK_LIMIT;

  const server = accountOverride.server ?? channelConfig.server ?? envServer ?? "";
  const textChunkLimitRaw =
    accountOverride.textChunkLimit ?? channelConfig.textChunkLimit ?? envTextChunkLimit;
  const textChunkLimit =
    typeof textChunkLimitRaw === "number"
      ? textChunkLimitRaw
      : typeof textChunkLimitRaw === "string" && textChunkLimitRaw.trim()
        ? Number.parseInt(textChunkLimitRaw, 10)
        : DEFAULT_TEXT_CHUNK_LIMIT;

  return {
    accountId: resolvedAccountId,
    name: accountOverride.name ?? channelConfig.name,
    enabled: accountOverride.enabled ?? channelConfig.enabled ?? true,
    server,
    textChunkLimit:
      Number.isFinite(textChunkLimit) && textChunkLimit > 0
        ? textChunkLimit
        : DEFAULT_TEXT_CHUNK_LIMIT,
  };
}

export function isAccountConfigured(account: ResolvedBotmaxAccount): boolean {
  return Boolean(account.server.trim());
}
