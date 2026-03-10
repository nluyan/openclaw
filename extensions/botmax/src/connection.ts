import WebSocket from "ws";
import type { ResolvedBotmaxAccount } from "./types.js";
import { formatBotmaxOutboundText } from "./message-format.js";
import { getBotmaxRuntime } from "./runtime.js";

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

export async function sendBotmaxText(
  accountId: string,
  recipientId: string,
  text: string,
): Promise<void> {
  const conn = getActiveConnection(accountId);
  if (!conn) {
    throw new Error("Botmax connection is not active");
  }
  let effectiveRecipient = recipientId.trim();
  if (effectiveRecipient && !effectiveRecipient.includes(":") && effectiveRecipient !== "all") {
    const prefix = lastSenderPrefixByAccount.get(accountId);
    if (prefix) {
      effectiveRecipient = `${prefix}:${effectiveRecipient}`;
    }
  }
  const payload = formatBotmaxOutboundText(effectiveRecipient, text);
  try {
    conn.log?.(`botmax[${accountId}] outbound raw: ${payload}`);
    if (!conn.log) {
      const core = getBotmaxRuntime();
      const logger = core.logging.getChildLogger({ module: "botmax" });
      logger.info(`botmax[${accountId}] outbound raw: ${payload}`);
    }
    if (effectiveRecipient !== recipientId) {
      conn.log?.(
        `botmax[${accountId}] normalized recipient '${recipientId}' -> '${effectiveRecipient}'`,
      );
    } else if (effectiveRecipient !== "all" && !effectiveRecipient.includes(":")) {
      conn.log?.(
        `botmax[${accountId}] recipient missing channel prefix: '${recipientId}'`,
      );
    }
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
      enqueue(async () => {
        await sendRaw(text);
      }, { countOutbound: true }),
    sendHeartbeat: (text: string) =>
      enqueue(async () => {
        if (outboundPending > 0 || heartbeatBlockCount > 0) {
          return false;
        }
        await sendRaw(text);
        return true;
      }, { countOutbound: false }),
    setHeartbeatBlocked: (blocked: boolean) => {
      heartbeatBlockCount += blocked ? 1 : -1;
      if (heartbeatBlockCount < 0) {
        heartbeatBlockCount = 0;
      }
    },
  };
}
