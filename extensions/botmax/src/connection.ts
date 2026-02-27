import WebSocket from "ws";
import type { ResolvedBotmaxAccount } from "./types.js";

export type BotmaxConnection = {
  accountId: string;
  ws: WebSocket;
  sendText: (text: string) => Promise<void>;
  sendHeartbeat: (text: string) => Promise<boolean>;
  setHeartbeatBlocked: (blocked: boolean) => void;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
};

const activeConnections = new Map<string, BotmaxConnection>();

export function buildBotmaxUrl(account: ResolvedBotmaxAccount): string {
  const base = new URL(account.server);
  base.searchParams.set("botid", account.botId);
  base.searchParams.set("imuserid", account.imUserId);
  base.searchParams.set("token", account.token);
  return base.toString();
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

export async function sendBotmaxText(accountId: string, text: string): Promise<void> {
  const conn = getActiveConnection(accountId);
  if (!conn) {
    throw new Error("Botmax connection is not active");
  }
  await conn.sendText(text);
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
