import { beforeEach, describe, expect, it, vi } from "vitest";
import { setBotmaxRuntime } from "./runtime.js";

const {
  sendBotmaxMessageMock,
  sendBotmaxTextMock,
  releaseHeartbeatMock,
  suspendBotmaxHeartbeatMock,
  materializeInboundAttachmentsMock,
  buildOutboundAttachmentsFromReplyMock,
} = vi.hoisted(() => {
  const releaseHeartbeatMock = vi.fn();
  return {
    sendBotmaxMessageMock: vi.fn(),
    sendBotmaxTextMock: vi.fn(),
    releaseHeartbeatMock,
    suspendBotmaxHeartbeatMock: vi.fn(() => releaseHeartbeatMock),
    materializeInboundAttachmentsMock: vi.fn(),
    buildOutboundAttachmentsFromReplyMock: vi.fn(),
  };
});

vi.mock("openclaw/plugin-sdk", () => ({
  chunkTextForOutbound: vi.fn((text: string) => [text]),
  createReplyPrefixOptions: vi.fn(() => ({ onModelSelected: undefined })),
}));

vi.mock("./attachments.js", () => ({
  materializeInboundAttachments: materializeInboundAttachmentsMock,
  buildOutboundAttachmentsFromReply: buildOutboundAttachmentsFromReplyMock,
}));

vi.mock("./connection.js", () => ({
  sendBotmaxMessage: sendBotmaxMessageMock,
  sendBotmaxText: sendBotmaxTextMock,
  suspendBotmaxHeartbeat: suspendBotmaxHeartbeatMock,
}));

import { handleBotmaxInbound } from "./inbound.js";

beforeEach(() => {
  sendBotmaxMessageMock.mockReset();
  sendBotmaxTextMock.mockReset();
  releaseHeartbeatMock.mockReset();
  suspendBotmaxHeartbeatMock.mockClear();
  materializeInboundAttachmentsMock.mockReset();
  buildOutboundAttachmentsFromReplyMock.mockReset();
  materializeInboundAttachmentsMock.mockResolvedValue({
    mediaPayload: {},
    transcript: undefined,
  });
  buildOutboundAttachmentsFromReplyMock.mockImplementation(async (params: { payload: unknown }) => {
    const payload =
      params.payload && typeof params.payload === "object"
        ? (params.payload as { text?: string })
        : {};
    return {
      text: payload.text,
      attachments: [],
    };
  });
});

describe("botmax inbound replies", () => {
  it("sends only the actual reply content", async () => {
    const finalizeInboundContext = vi.fn((ctx) => ctx);
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
          finalizeInboundContext,
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
      exit: vi.fn(),
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
    expect(sendBotmaxMessageMock).not.toHaveBeenCalled();
    expect(sendBotmaxTextMock).toHaveBeenCalledTimes(1);
    expect(sendBotmaxTextMock).toHaveBeenCalledWith("default", "telegram:123", "reply text", {
      requestId: "req-1",
      chatType: "direct",
      conversationId: "telegram:123",
      replyToId: undefined,
      platform: "botmax",
      surface: "botmax",
      botUsername: undefined,
      threadId: undefined,
    });
    expect(finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        Transcript: undefined,
      }),
    );
    expect(runtime.log).not.toHaveBeenCalledWith(expect.stringContaining("<<<done>>>"));
    expect(suspendBotmaxHeartbeatMock).toHaveBeenCalledWith("default");
    expect(releaseHeartbeatMock).toHaveBeenCalledTimes(1);
  });

  it("materializes inbound attachments and sends attachment replies through botmax frames", async () => {
    const finalizeInboundContext = vi.fn((ctx) => ctx);
    materializeInboundAttachmentsMock.mockResolvedValue({
      mediaPayload: {
        MediaPath: "/tmp/inbound.ogg",
        MediaPaths: ["/tmp/inbound.ogg"],
        MediaType: "audio",
        MediaTypes: ["audio"],
      },
      transcript: "voice transcript",
    });
    buildOutboundAttachmentsFromReplyMock.mockResolvedValue({
      text: "voice reply",
      attachments: [
        {
          id: "att-1",
          kind: "audio",
          inlineBase64: "UklGRg==",
          mimeType: "audio/ogg",
          deliveryHints: {
            sendAs: "voice",
          },
        },
      ],
    });
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({
        text: "voice reply",
        mediaUrl: "file:///tmp/reply.ogg",
        audioAsVoice: true,
      });
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
          finalizeInboundContext,
          dispatchReplyWithBufferedBlockDispatcher,
        },
        text: {
          resolveMarkdownTableMode: vi.fn(() => "plain"),
          convertMarkdownTables: vi.fn((text) => text),
        },
      },
    } as never);

    await handleBotmaxInbound({
      senderId: "telegram:123",
      body: "[Audio]\nTranscript:\nvoice transcript",
      chatType: "direct",
      replyTargetId: "telegram:123",
      requestId: "req-media",
      attachments: [
        {
          id: "voice-1",
          kind: "audio",
          fetchUrl: "https://r2.example.test/voice-1",
          mimeType: "audio/ogg",
        },
      ],
      account: {
        accountId: "default",
        enabled: true,
        server: "wss://botmax.example/ws",
        textChunkLimit: 2000,
      },
      config: {},
      runtime: {
        error: vi.fn(),
        log: vi.fn(),
        exit: vi.fn(),
      },
    });

    expect(materializeInboundAttachmentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            id: "voice-1",
            kind: "audio",
          }),
        ],
      }),
    );
    expect(finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        Transcript: "voice transcript",
        MediaPath: "/tmp/inbound.ogg",
        MediaPaths: ["/tmp/inbound.ogg"],
        MediaType: "audio",
        MediaTypes: ["audio"],
      }),
    );
    expect(sendBotmaxTextMock).not.toHaveBeenCalled();
    expect(sendBotmaxMessageMock).toHaveBeenCalledWith(
      "default",
      "telegram:123",
      {
        text: "voice reply",
        attachments: [
          expect.objectContaining({
            id: "att-1",
            kind: "audio",
            deliveryHints: {
              sendAs: "voice",
            },
          }),
        ],
      },
      {
        requestId: "req-media",
        chatType: "direct",
        conversationId: "telegram:123",
        replyToId: undefined,
        platform: "botmax",
        surface: "botmax",
        botUsername: undefined,
        threadId: undefined,
      },
    );
    expect(suspendBotmaxHeartbeatMock).toHaveBeenCalledWith("default");
    expect(releaseHeartbeatMock).toHaveBeenCalledTimes(1);
  });

  it("forwards replyToId from reply payloads into outbound botmax frames", async () => {
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({
        text: "reply text",
        replyToId: "msteams:msg:activity-123",
      });
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

    await handleBotmaxInbound({
      senderId: "msteams:user-1",
      body: "hello",
      chatType: "channel",
      chatId: "conversation-1",
      conversationId: "msteams:channel:conversation-1|binding:binding-1",
      conversationNativeId: "conversation-1",
      replyTargetId:
        "msteams:conversation:conversation-1|binding:00000000-0000-0000-0000-000000000001|replyTo:activity-999",
      requestId: "req-teams",
      provider: "msteams",
      surface: "msteams",
      account: {
        accountId: "default",
        enabled: true,
        server: "wss://botmax.example/ws",
        textChunkLimit: 2000,
      },
      config: {},
      runtime: {
        error: vi.fn(),
        log: vi.fn(),
        exit: vi.fn(),
      },
    });

    expect(sendBotmaxTextMock).toHaveBeenCalledWith(
      "default",
      "msteams:conversation:conversation-1|binding:00000000-0000-0000-0000-000000000001|replyTo:activity-999",
      "reply text",
      {
        requestId: "req-teams",
        chatType: "channel",
        conversationId: "msteams:channel:conversation-1|binding:binding-1",
        conversationNativeId: "conversation-1",
        replyToId: "msteams:msg:activity-123",
        platform: "msteams",
        surface: "msteams",
        botUsername: undefined,
        threadId: undefined,
      },
    );
  });
});
