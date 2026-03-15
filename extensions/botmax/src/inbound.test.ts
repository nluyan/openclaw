import { beforeEach, describe, expect, it, vi } from "vitest";
import { setBotmaxRuntime } from "./runtime.js";

const sendBotmaxTextMock = vi.fn();
const releaseHeartbeatMock = vi.fn();
const suspendBotmaxHeartbeatMock = vi.fn(() => releaseHeartbeatMock);

vi.mock("openclaw/plugin-sdk", () => ({
  chunkTextForOutbound: vi.fn((text: string) => [text]),
  createNormalizedOutboundDeliverer: vi.fn((deliver: unknown) => deliver),
  createReplyPrefixOptions: vi.fn(() => ({ onModelSelected: undefined })),
  formatTextWithAttachmentLinks: vi.fn((text: string) => text),
  resolveOutboundMediaUrls: vi.fn(() => []),
}));

vi.mock("./connection.js", () => ({
  sendBotmaxText: (...args: unknown[]) => sendBotmaxTextMock(...args),
  suspendBotmaxHeartbeat: (...args: unknown[]) => suspendBotmaxHeartbeatMock(...args),
}));

import { handleBotmaxInbound } from "./inbound.js";

beforeEach(() => {
  sendBotmaxTextMock.mockReset();
  releaseHeartbeatMock.mockReset();
  suspendBotmaxHeartbeatMock.mockClear();
});

describe("botmax inbound replies", () => {
  it("sends only the actual reply content", async () => {
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: "reply text" });
    });

    setBotmaxRuntime({
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(() => ({
            agentId: "agent-1",
            sessionKey: "session-1",
            accountId: "default",
          })),
        },
        session: {
          resolveStorePath: vi.fn(() => "/tmp/store"),
          readSessionUpdatedAt: vi.fn(() => undefined),
          recordInboundSession: vi.fn(async () => {}),
        },
        reply: {
          resolveEnvelopeFormatOptions: vi.fn(() => ({})),
          formatAgentEnvelope: vi.fn(() => "envelope"),
          finalizeInboundContext: vi.fn((ctx) => ctx),
          dispatchReplyWithBufferedBlockDispatcher,
        },
        text: {
          resolveMarkdownTableMode: vi.fn(() => "plain"),
          convertMarkdownTables: vi.fn((text) => text),
        },
      },
    } as never);

    const runtime = {
      error: vi.fn(),
      log: vi.fn(),
    };

    await handleBotmaxInbound({
      senderId: "telegram:123",
      body: "hello",
      chatType: "direct",
      replyTargetId: "telegram:123",
      requestId: "req-1",
      account: {
        accountId: "default",
        enabled: true,
        server: "wss://botmax.example/ws",
        textChunkLimit: 2000,
      },
      config: {},
      runtime,
    });

    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    expect(sendBotmaxTextMock).toHaveBeenCalledTimes(1);
    expect(sendBotmaxTextMock).toHaveBeenCalledWith("default", "telegram:123", "reply text", {
      requestId: "req-1",
    });
    expect(runtime.log).not.toHaveBeenCalledWith(expect.stringContaining("<<<done>>>"));
    expect(suspendBotmaxHeartbeatMock).toHaveBeenCalledWith("default");
    expect(releaseHeartbeatMock).toHaveBeenCalledTimes(1);
  });
});
