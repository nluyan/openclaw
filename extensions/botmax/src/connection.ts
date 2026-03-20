import WebSocket from "ws";
import {
  formatBotmaxOutboundCommandResult,
  formatBotmaxOutboundFileResult,
  formatBotmaxOutboundMessage,
  type BotmaxOutboundAttachmentInput,
  type BotmaxFileEncoding,
} from "./message-format.js";
import { getBotmaxRuntime } from "./runtime.js";
import type { ResolvedBotmaxAccount } from "./types.js";

export type BotmaxConnection = {
  accountId: string;
  ws: WebSocket;
  sendText: (text: string) => Promise<void>;
  sendHeartbeat: (text: string) => Promise<boolean>;
  setHeartbeatBlocked: (blocked: boolean) => void;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
  log?: (message: string) => void;
};

const activeConnections = new Map<string, BotmaxConnection>();
const lastSenderPrefixByAccount = new Map<string, string>();

type BotmaxSendEnvelopeOptions = {
  requestId?: string | number | null;
  senderId?: string;
  chatType?: "direct" | "group" | "channel";
  conversationId?: string;
  conversationNativeId?: string;
  replyToId?: string;
  platform?: string;
  surface?: string;
  botUsername?: string;
  threadId?: string | number;
  messageId?: string;
};

export function rememberBotmaxSender(accountId: string, senderId: string): void {
  const trimmed = senderId.trim();
  const separator = trimmed.indexOf(":");
  if (separator <= 0) {
    return;
  }
  const prefix = trimmed.slice(0, separator).trim();
  if (!prefix) {
    return;
  }
  lastSenderPrefixByAccount.set(accountId, prefix.toLowerCase());
}

export function buildBotmaxUrl(account: ResolvedBotmaxAccount): string {
  return account.server;
}

export function redactBotmaxUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("token")) {
      parsed.searchParams.set("token", "***");
    }
    return parsed.toString();
  } catch {
    return url.replace(/token=[^&]+/i, "token=***");
  }
}

export function setActiveConnection(connection: BotmaxConnection): void {
  activeConnections.set(connection.accountId, connection);
}

export function getActiveConnection(accountId: string): BotmaxConnection | undefined {
  return activeConnections.get(accountId);
}

export function clearActiveConnection(accountId: string): void {
  activeConnections.delete(accountId);
}

function normalizeBotmaxRecipient(accountId: string, recipientId: string): string {
  let effectiveRecipient = recipientId.trim();
  if (effectiveRecipient && !effectiveRecipient.includes(":") && effectiveRecipient !== "all") {
    const prefix = lastSenderPrefixByAccount.get(accountId);
    if (prefix) {
      effectiveRecipient = `${prefix}:${effectiveRecipient}`;
    }
  }
  return effectiveRecipient;
}

function logBotmaxOutboundPayload(params: {
  accountId: string;
  conn: BotmaxConnection;
  payload: string;
  recipientId: string;
  effectiveRecipient: string;
}): void {
  try {
    params.conn.log?.(`botmax[${params.accountId}] outbound raw: ${params.payload}`);
    if (!params.conn.log) {
      const core = getBotmaxRuntime();
      const logger = core.logging.getChildLogger({ module: "botmax" });
      logger.info(`botmax[${params.accountId}] outbound raw: ${params.payload}`);
    }
    if (params.effectiveRecipient !== params.recipientId) {
      params.conn.log?.(
        `botmax[${params.accountId}] normalized recipient '${params.recipientId}' -> '${params.effectiveRecipient}'`,
      );
    } else if (params.effectiveRecipient !== "all" && !params.effectiveRecipient.includes(":")) {
      params.conn.log?.(
        `botmax[${params.accountId}] recipient missing channel prefix: '${params.recipientId}'`,
      );
    }
  } catch {
    // Ignore logging failures to avoid blocking outbound delivery.
  }
}

export async function sendBotmaxMessage(
  accountId: string,
  recipientId: string,
  message: {
    text?: string;
    attachments?: BotmaxOutboundAttachmentInput[];
  },
  options?: BotmaxSendEnvelopeOptions,
): Promise<void> {
  const conn = getActiveConnection(accountId);
  if (!conn) {
    throw new Error("Botmax connection is not active");
  }
  const effectiveRecipient = normalizeBotmaxRecipient(accountId, recipientId);
  const payload = formatBotmaxOutboundMessage({
    recipientId: effectiveRecipient,
    text: message.text,
    attachments: message.attachments,
    requestId: options?.requestId,
    senderId: options?.senderId,
    chatType: options?.chatType,
    conversationId: options?.conversationId,
    conversationNativeId: options?.conversationNativeId,
    replyToId: options?.replyToId,
    platform: options?.platform,
    surface: options?.surface,
    botUsername: options?.botUsername,
    threadId: options?.threadId,
    messageId: options?.messageId,
  });
  logBotmaxOutboundPayload({
    accountId,
    conn,
    payload,
    recipientId,
    effectiveRecipient,
  });
  await conn.sendText(payload);
  conn.statusSink?.({ lastOutboundAt: Date.now() });
}

export async function sendBotmaxText(
  accountId: string,
  recipientId: string,
  text: string,
  options?: BotmaxSendEnvelopeOptions,
): Promise<void> {
  await sendBotmaxMessage(
    accountId,
    recipientId,
    {
      text,
    },
    options,
  );
}

export async function sendBotmaxCommandResult(params: {
  accountId: string;
  recipientId: string;
  command: string;
  ok: boolean;
  output: string;
  method?: string;
  data?: unknown;
  requestId?: string | number | null;
  senderId?: string;
  chatType?: "direct" | "group" | "channel";
  conversationId?: string;
  conversationNativeId?: string;
  platform?: string;
  surface?: string;
  threadId?: string | number;
}): Promise<void> {
  const conn = getActiveConnection(params.accountId);
  if (!conn) {
    throw new Error("Botmax connection is not active");
  }
  const recipientId = normalizeBotmaxRecipient(params.accountId, params.recipientId);
  if (!recipientId) {
    throw new Error("Botmax command result recipientId is required");
  }
  const payload = formatBotmaxOutboundCommandResult({
    recipientId,
    command: params.command,
    ok: params.ok,
    output: params.output,
    method: params.method,
    data: params.data,
    requestId: params.requestId,
    senderId: params.senderId,
    chatType: params.chatType,
    conversationId: params.conversationId,
    conversationNativeId: params.conversationNativeId,
    platform: params.platform,
    surface: params.surface,
    threadId: params.threadId,
  });
  try {
    conn.log?.(`botmax[${params.accountId}] outbound command result raw: ${payload}`);
  } catch {
    // Ignore logging failures to avoid blocking outbound delivery.
  }
  await conn.sendText(payload);
  conn.statusSink?.({ lastOutboundAt: Date.now() });
}

export async function sendBotmaxFileResult(params: {
  accountId: string;
  operation: "read" | "write";
  path: string;
  encoding: BotmaxFileEncoding;
  ok: boolean;
  output: string;
  errorCode?: string;
  data?: unknown;
  requestId?: string | number | null;
  platform?: string;
  surface?: string;
}): Promise<void> {
  const conn = getActiveConnection(params.accountId);
  if (!conn) {
    throw new Error("Botmax connection is not active");
  }
  const payload = formatBotmaxOutboundFileResult({
    operation: params.operation,
    path: params.path,
    encoding: params.encoding,
    ok: params.ok,
    output: params.output,
    errorCode: params.errorCode,
    data: params.data,
    requestId: params.requestId,
    platform: params.platform,
    surface: params.surface,
  });
  try {
    conn.log?.(`botmax[${params.accountId}] outbound file result raw: ${payload}`);
  } catch {
    // Ignore logging failures to avoid blocking outbound delivery.
  }
  await conn.sendText(payload);
  conn.statusSink?.({ lastOutboundAt: Date.now() });
}

export function suspendBotmaxHeartbeat(accountId: string): () => void {
  const conn = getActiveConnection(accountId);
  if (!conn) {
    return () => {};
  }
  conn.setHeartbeatBlocked(true);
  return () => {
    conn.setHeartbeatBlocked(false);
  };
}

type EnqueueOptions = {
  countOutbound: boolean;
};

export function createBotmaxSender(ws: WebSocket): {
  sendText: (text: string) => Promise<void>;
  sendHeartbeat: (text: string) => Promise<boolean>;
  setHeartbeatBlocked: (blocked: boolean) => void;
} {
  let sendChain: Promise<unknown> = Promise.resolve();
  let outboundPending = 0;
  let heartbeatBlockCount = 0;

  const sendRaw = (text: string) =>
    new Promise<void>((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Botmax WebSocket is not open"));
        return;
      }
      ws.send(text, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

  const enqueue = <T>(fn: () => Promise<T>, opts: EnqueueOptions): Promise<T> => {
    if (opts.countOutbound) {
      outboundPending += 1;
    }
    const next = sendChain.then(fn);
    sendChain = next.finally(() => {
      if (opts.countOutbound) {
        outboundPending = Math.max(0, outboundPending - 1);
      }
    });
    return next;
  };

  return {
    sendText: (text: string) =>
      enqueue(
        async () => {
          await sendRaw(text);
        },
        { countOutbound: true },
      ),
    sendHeartbeat: (text: string) =>
      enqueue(
        async () => {
          if (outboundPending > 0 || heartbeatBlockCount > 0) {
            return false;
          }
          await sendRaw(text);
          return true;
        },
        { countOutbound: false },
      ),
    setHeartbeatBlocked: (blocked: boolean) => {
      heartbeatBlockCount += blocked ? 1 : -1;
      if (heartbeatBlockCount < 0) {
        heartbeatBlockCount = 0;
      }
    },
  };
}
