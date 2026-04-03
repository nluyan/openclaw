import WebSocket from "ws";
import { executeBotmaxGatewayCommand } from "./command-exec.js";
import {
  buildBotmaxUrl,
  clearActiveConnection,
  createBotmaxSender,
  sendBotmaxCommandResult,
  sendBotmaxFileResult,
  redactBotmaxUrl,
  rememberBotmaxSender,
  setActiveConnection,
} from "./connection.js";
import {
  BotmaxFileOperationError,
  createBotmaxDirectory,
  deleteBotmaxPath,
  listBotmaxFiles,
  readBotmaxFile,
  writeBotmaxFile,
} from "./file-ops.js";
import { handleBotmaxInbound } from "./inbound.js";
import { parseBotmaxInboundText } from "./message-format.js";
import type { OpenClawConfig, RuntimeEnv } from "./runtime-api.js";
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
const BOTMAX_RUNTIME_BUILD_MARKER = "botmax-managed-config-2026-03-30-v8";

async function openSocket(
  url: string,
  abortSignal: AbortSignal,
): Promise<WebSocket> {
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

async function waitForDisconnect(
  ws: WebSocket,
  abortSignal: AbortSignal,
): Promise<{
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

export function monitorBotmaxAccount(options: BotmaxMonitorOptions): {
  stop: () => void;
} {
  const { account, config, runtime, abortSignal, statusSink } = options;
  let stopped = false;
  let activeSocket: WebSocket | null = null;

  runtime.log?.(
    `botmax[${account.accountId}]: runtime marker ${BOTMAX_RUNTIME_BUILD_MARKER}`,
  );

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
      runtime.log?.(
        `botmax[${account.accountId}]: connecting to ${redactedUrl}`,
      );

      try {
        const ws = await openSocket(url, abortSignal);
        activeSocket = ws;
        attempt = 0;
        statusSink?.({
          running: true,
          lastStartAt: Date.now(),
          lastError: null,
        });

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
          if (
            stopped ||
            abortSignal.aborted ||
            ws.readyState !== WebSocket.OPEN
          ) {
            return;
          }
          void sender
            .sendHeartbeat(HEARTBEAT_PING)
            .then((sent) => {
              if (!sent) {
                runtime.log?.(
                  `botmax[${account.accountId}] heartbeat suppressed`,
                );
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
          if (inbound.kind === "chat") {
            rememberBotmaxSender(account.accountId, inbound.senderId);
            void handleBotmaxInbound({
              senderId: inbound.senderId,
              senderName: inbound.senderName,
              senderUsername: inbound.senderUsername,
              accountId: inbound.accountId,
              agentId: inbound.agentId,
              body: inbound.body,
              chatType: inbound.chatType,
              chatId: inbound.chatId,
              conversationId: inbound.conversationId,
              conversationNativeId: inbound.conversationNativeId,
              conversationTitle: inbound.conversationTitle,
              replyTargetId: inbound.replyTargetId,
              requestId: inbound.requestId,
              provider: inbound.provider,
              surface: inbound.surface,
              botUsername: inbound.botUsername,
              messageId: inbound.messageId,
              messageFullId: inbound.messageFullId,
              timestampMs: inbound.timestampMs,
              replyToId: inbound.replyToId,
              replyToBody: inbound.replyToBody,
              replyToSender: inbound.replyToSender,
              threadId: inbound.threadId,
              wasMentioned: inbound.wasMentioned,
              commandAuthorized: inbound.commandAuthorized,
              transcript: inbound.transcript,
              attachments: inbound.attachments,
              account,
              config,
              runtime,
              statusSink: (patch) => statusSink?.(patch),
            }).catch((err) => {
              runtime.error?.(
                `botmax[${account.accountId}]: inbound error: ${String(err)}`,
              );
            });
            return;
          }

          if (inbound.kind === "command") {
            rememberBotmaxSender(account.accountId, inbound.senderId);
            void executeBotmaxGatewayCommand({
              command: inbound.command,
              timeoutMs: inbound.timeoutMs,
            })
              .then(async (result) => {
                await sendBotmaxCommandResult({
                  accountId: account.accountId,
                  recipientId: inbound.replyTargetId,
                  command: inbound.command,
                  method: result.method,
                  ok: result.ok,
                  output: result.output,
                  data: result.data,
                  requestId: inbound.requestId,
                  chatType: inbound.chatType,
                  conversationId: inbound.conversationId,
                  conversationNativeId: inbound.conversationNativeId,
                  platform: inbound.provider,
                  surface: inbound.surface,
                  threadId: inbound.threadId,
                });
              })
              .catch(async (err) => {
                runtime.error?.(
                  `botmax[${account.accountId}]: command execution error: ${String(err)}`,
                );
                try {
                  await sendBotmaxCommandResult({
                    accountId: account.accountId,
                    recipientId: inbound.replyTargetId,
                    command: inbound.command,
                    ok: false,
                    output: err instanceof Error ? err.message : String(err),
                    requestId: inbound.requestId,
                    chatType: inbound.chatType,
                    conversationId: inbound.conversationId,
                    conversationNativeId: inbound.conversationNativeId,
                    platform: inbound.provider,
                    surface: inbound.surface,
                    threadId: inbound.threadId,
                  });
                } catch (sendErr) {
                  runtime.error?.(
                    `botmax[${account.accountId}]: command result send error: ${String(sendErr)}`,
                  );
                }
              });
            return;
          }

          if (inbound.kind === "file.read") {
            void readBotmaxFile({
              path: inbound.path,
              encoding: inbound.encoding,
            })
              .then(async (result) => {
                await sendBotmaxFileResult({
                  accountId: account.accountId,
                  operation: "read",
                  path: result.path,
                  encoding: result.encoding,
                  ok: true,
                  output: `read ${result.sizeBytes} bytes from ${result.path}`,
                  data: result,
                  requestId: inbound.requestId,
                  platform: "internal",
                  surface: "internal",
                });
              })
              .catch(async (err) => {
                await sendBotmaxFileErrorResult({
                  accountId: account.accountId,
                  operation: "read",
                  path: inbound.path,
                  encoding: inbound.encoding,
                  requestId: inbound.requestId,
                  runtime,
                  error: err,
                });
              });
            return;
          }

          if (inbound.kind === "file.list") {
            void listBotmaxFiles({
              path: inbound.path,
              includeHidden: inbound.includeHidden,
            })
              .then(async (result) => {
                await sendBotmaxFileResult({
                  accountId: account.accountId,
                  operation: "list",
                  path: result.path,
                  encoding: "utf8",
                  ok: true,
                  output: `listed ${result.entries.length} item(s) in ${result.path}`,
                  data: result,
                  requestId: inbound.requestId,
                  platform: "internal",
                  surface: "internal",
                });
              })
              .catch(async (err) => {
                await sendBotmaxFileErrorResult({
                  accountId: account.accountId,
                  operation: "list",
                  path: inbound.path,
                  encoding: "utf8",
                  requestId: inbound.requestId,
                  runtime,
                  error: err,
                });
              });
            return;
          }

          if (inbound.kind === "file.write") {
            void writeBotmaxFile({
              path: inbound.path,
              content: inbound.content,
              encoding: inbound.encoding,
              ensureDirectory: inbound.ensureDirectory,
            })
              .then(async (result) => {
                await sendBotmaxFileResult({
                  accountId: account.accountId,
                  operation: "write",
                  path: result.path,
                  encoding: result.encoding,
                  ok: true,
                  output: `wrote ${result.sizeBytes} bytes to ${result.path}`,
                  data: result,
                  requestId: inbound.requestId,
                  platform: "internal",
                  surface: "internal",
                });
              })
              .catch(async (err) => {
                await sendBotmaxFileErrorResult({
                  accountId: account.accountId,
                  operation: "write",
                  path: inbound.path,
                  encoding: inbound.encoding,
                  requestId: inbound.requestId,
                  runtime,
                  error: err,
                });
              });
            return;
          }

          if (inbound.kind === "directory.create") {
            void createBotmaxDirectory({
              path: inbound.path,
              recursive: inbound.recursive,
            })
              .then(async (result) => {
                await sendBotmaxFileResult({
                  accountId: account.accountId,
                  operation: "mkdir",
                  path: result.path,
                  encoding: "utf8",
                  ok: true,
                  output: `created directory ${result.path}`,
                  data: result,
                  requestId: inbound.requestId,
                  platform: "internal",
                  surface: "internal",
                });
              })
              .catch(async (err) => {
                await sendBotmaxFileErrorResult({
                  accountId: account.accountId,
                  operation: "mkdir",
                  path: inbound.path,
                  encoding: "utf8",
                  requestId: inbound.requestId,
                  runtime,
                  error: err,
                });
              });
            return;
          }

          if (inbound.kind === "file.delete") {
            void deleteBotmaxPath({
              path: inbound.path,
              encoding: inbound.encoding,
            })
              .then(async (result) => {
                await sendBotmaxFileResult({
                  accountId: account.accountId,
                  operation: "delete",
                  path: result.path,
                  encoding: result.encoding,
                  ok: true,
                  output: `deleted ${result.path}`,
                  data: result,
                  requestId: inbound.requestId,
                  platform: "internal",
                  surface: "internal",
                });
              })
              .catch(async (err) => {
                await sendBotmaxFileErrorResult({
                  accountId: account.accountId,
                  operation: "delete",
                  path: inbound.path,
                  encoding: inbound.encoding,
                  requestId: inbound.requestId,
                  runtime,
                  error: err,
                });
              });
          }
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
          runtime.error?.(
            `botmax[${account.accountId}]: connect failed: ${message}`,
          );
          statusSink?.({
            lastError: message,
            running: false,
            lastStopAt: Date.now(),
          });
        }
      }

      if (stopped || abortSignal.aborted) {
        break;
      }

      const delay =
        RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  };

  void run();

  return { stop };
}

async function sendBotmaxFileErrorResult(params: {
  accountId: string;
  operation: "read" | "list" | "write" | "mkdir" | "delete";
  path: string;
  encoding: "utf8" | "base64";
  requestId?: string | number | null;
  runtime: RuntimeEnv;
  error: unknown;
}): Promise<void> {
  const output =
    params.error instanceof Error ? params.error.message : String(params.error);
  const errorCode =
    params.error instanceof BotmaxFileOperationError
      ? params.error.code
      : "FILE_OPERATION_FAILED";

  params.runtime.error?.(
    `botmax[${params.accountId}]: file ${params.operation} error (${params.path}): ${output}`,
  );

  try {
    await sendBotmaxFileResult({
      accountId: params.accountId,
      operation: params.operation,
      path: params.path,
      encoding: params.encoding,
      ok: false,
      output,
      errorCode,
      requestId: params.requestId,
      platform: "internal",
      surface: "internal",
    });
  } catch (sendErr) {
    params.runtime.error?.(
      `botmax[${params.accountId}]: file result send error: ${String(sendErr)}`,
    );
  }
}
