import WebSocket from "ws";
import type { OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import {
  buildBotmaxUrl,
  clearActiveConnection,
  createBotmaxSender,
  redactBotmaxUrl,
  rememberBotmaxSender,
  setActiveConnection,
} from "./connection.js";
import { handleBotmaxInbound } from "./inbound.js";
import { parseBotmaxInboundText } from "./message-format.js";
import type { ResolvedBotmaxAccount } from "./types.js";

export type BotmaxMonitorOptions = {
  account: ResolvedBotmaxAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  statusSink?: (patch: {
    running?: boolean;
    lastStartAt?: number;
    lastStopAt?: number;
    lastError?: string | null;
    lastInboundAt?: number;
    lastOutboundAt?: number;
  }) => void;
};

const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 15000, 30000];
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_PING = "<<<ping>>>";
const HEARTBEAT_PONG = "<<<pong>>>";

async function openSocket(url: string, abortSignal: AbortSignal): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);

    const cleanup = () => {
      ws.removeListener("open", handleOpen);
      ws.removeListener("error", handleError);
      ws.removeListener("close", handleClose);
    };

    const handleOpen = () => {
      cleanup();
      resolve(ws);
    };

    const handleError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const handleClose = (code: number, reason: Buffer) => {
      cleanup();
      const message = reason?.length ? reason.toString() : "closed before open";
      reject(new Error(`WebSocket closed (code ${code}): ${message}`));
    };

    ws.once("open", handleOpen);
    ws.once("error", handleError);
    ws.once("close", handleClose);

    if (abortSignal.aborted) {
      ws.close();
      reject(new Error("aborted"));
      return;
    }

    abortSignal.addEventListener(
      "abort",
      () => {
        ws.close();
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

async function waitForDisconnect(ws: WebSocket, abortSignal: AbortSignal): Promise<{
  code?: number;
  reason?: string;
  error?: Error;
}> {
  return await new Promise((resolve) => {
    const handleClose = (code: number, reason: Buffer) => {
      cleanup();
      resolve({ code, reason: reason?.length ? reason.toString() : undefined });
    };
    const handleError = (err: Error) => {
      cleanup();
      resolve({ error: err });
    };
    const handleAbort = () => {
      cleanup();
      resolve({ error: new Error("aborted") });
    };
    const cleanup = () => {
      ws.removeListener("close", handleClose);
      ws.removeListener("error", handleError);
      abortSignal.removeEventListener("abort", handleAbort);
    };

    ws.once("close", handleClose);
    ws.once("error", handleError);
    abortSignal.addEventListener("abort", handleAbort, { once: true });
  });
}

export function monitorBotmaxAccount(options: BotmaxMonitorOptions): { stop: () => void } {
  const { account, config, runtime, abortSignal, statusSink } = options;
  let stopped = false;
  let activeSocket: WebSocket | null = null;

  const stop = () => {
    stopped = true;
    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
      activeSocket.close(1000, "botmax shutdown");
    } else if (activeSocket) {
      activeSocket.terminate();
    }
  };

  abortSignal.addEventListener("abort", stop, { once: true });

  let attempt = 0;
  const run = async () => {
    while (!stopped && !abortSignal.aborted) {
      const url = buildBotmaxUrl(account);
      const redactedUrl = redactBotmaxUrl(url);
      runtime.log?.(`botmax[${account.accountId}]: connecting to ${redactedUrl}`);

      try {
        const ws = await openSocket(url, abortSignal);
        activeSocket = ws;
        attempt = 0;
        statusSink?.({ running: true, lastStartAt: Date.now(), lastError: null });

        const sender = createBotmaxSender(ws);
        setActiveConnection({
          accountId: account.accountId,
          ws,
          sendText: sender.sendText,
          sendHeartbeat: sender.sendHeartbeat,
          setHeartbeatBlocked: sender.setHeartbeatBlocked,
          statusSink: (patch) => statusSink?.(patch),
          log: (message) => runtime.log?.(message),
        });

        const heartbeat = setInterval(() => {
          if (stopped || abortSignal.aborted || ws.readyState !== WebSocket.OPEN) {
            return;
          }
          void sender
            .sendHeartbeat(HEARTBEAT_PING)
            .then((sent) => {
              if (!sent) {
                runtime.log?.(`botmax[${account.accountId}] heartbeat suppressed`);
              }
            })
            .catch((err) => {
              runtime.error?.(
                `botmax[${account.accountId}]: failed to send heartbeat: ${String(err)}`,
              );
            });
        }, HEARTBEAT_INTERVAL_MS);

        ws.on("message", (data) => {
          if (stopped) {
            return;
          }
          const text = typeof data === "string" ? data : data.toString("utf8");
          if (text !== HEARTBEAT_PONG) {
            runtime.log?.(`botmax[${account.accountId}] inbound raw: ${text}`);
          }
          const inbound = parseBotmaxInboundText(text);
          if (!inbound) {
            return;
          }
          rememberBotmaxSender(account.accountId, inbound.senderId);
          void handleBotmaxInbound({
            senderId: inbound.senderId,
            body: inbound.body,
            account,
            config,
            runtime,
            statusSink: (patch) => statusSink?.(patch),
          }).catch((err) => {
            runtime.error?.(`botmax[${account.accountId}]: inbound error: ${String(err)}`);
          });
        });

        const disconnect = await waitForDisconnect(ws, abortSignal);
        clearInterval(heartbeat);
        clearActiveConnection(account.accountId);
        if (disconnect.error && disconnect.error.message !== "aborted") {
          runtime.error?.(
            `botmax[${account.accountId}]: socket error: ${disconnect.error.message}`,
          );
          statusSink?.({ lastError: disconnect.error.message });
        }
        if (disconnect.code != null) {
          runtime.log?.(
            `botmax[${account.accountId}]: disconnected (code ${disconnect.code}${
              disconnect.reason ? `, ${disconnect.reason}` : ""
            })`,
          );
        }
        statusSink?.({ running: false, lastStopAt: Date.now() });
      } catch (err) {
        clearActiveConnection(account.accountId);
        const message = err instanceof Error ? err.message : String(err);
        if (message !== "aborted") {
          runtime.error?.(`botmax[${account.accountId}]: connect failed: ${message}`);
          statusSink?.({ lastError: message, running: false, lastStopAt: Date.now() });
        }
      }

      if (stopped || abortSignal.aborted) {
        break;
      }

      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  };

  void run();

  return { stop };
}
