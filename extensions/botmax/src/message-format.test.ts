import { describe, expect, it } from "vitest";
import {
  formatBotmaxOutboundCommandResult,
  formatBotmaxOutboundDeviceResult,
  formatBotmaxOutboundFileResult,
  formatBotmaxOutboundMessage,
  formatBotmaxOutboundText,
  parseBotmaxInboundText,
} from "./message-format.js";

describe("botmax message format", () => {
  it("parses v3 chat frames with sender metadata", () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: "req-1",
      params: {
        v: 3,
        type: "chat.message",
        transport: {
          bridge: "botmax",
          receivedAtMs: 1773561600000,
        },
        origin: {
          platform: "telegram",
          surface: "telegram",
          accountId: "00000000-0000-0000-0000-000000000001",
          botUsername: "demo_bot",
        },
        conversation: {
          id: "telegram:123",
          nativeId: "123",
          kind: "direct",
          replyTargetId: "telegram:123",
          agentId: "main",
        },
        sender: {
          id: "telegram:123",
          nativeId: "123",
          displayName: "Alice",
          username: "alice_demo",
          isBot: false,
        },
        message: {
          id: "tg:msg:1",
          nativeId: "1",
          fullId: "telegram:123:1",
          text: "hi",
          createdAtMs: 1773561601000,
          mentions: {
            botMentioned: false,
            mentionedIds: [],
          },
          attachments: [],
        },
        auth: {
          deliveryAuthenticated: true,
          commandAuthorized: true,
        },
      },
    });
    const parsed = parseBotmaxInboundText(frame);
    expect(parsed).toEqual({
      kind: "chat",
      senderId: "telegram:123",
      senderName: "Alice",
      senderUsername: "alice_demo",
      accountId: "00000000-0000-0000-0000-000000000001",
      agentId: "main",
      provider: "telegram",
      surface: "telegram",
      botUsername: "demo_bot",
      conversationId: "telegram:123",
      conversationNativeId: "123",
      chatType: "direct",
      chatId: undefined,
      conversationTitle: undefined,
      replyTargetId: "telegram:123",
      requestId: "req-1",
      messageId: "tg:msg:1",
      messageFullId: "telegram:123:1",
      timestampMs: 1773561601000,
      threadId: undefined,
      replyToId: undefined,
      replyToBody: undefined,
      replyToSender: undefined,
      wasMentioned: false,
      commandAuthorized: true,
      transcript: undefined,
      attachments: undefined,
      body: "hi",
    });
  });

  it("parses v3 command frames", () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: 42,
      params: {
        v: 3,
        type: "command.exec",
        transport: {
          bridge: "botmax",
          receivedAtMs: 1773561600000,
        },
        origin: {
          platform: "telegram",
          surface: "telegram",
          accountId: "00000000-0000-0000-0000-000000000002",
        },
        conversation: {
          id: "telegram:123",
          nativeId: "123",
          kind: "direct",
          replyTargetId: "telegram:123",
          agentId: "research",
        },
        sender: {
          id: "telegram:123",
          nativeId: "123",
          displayName: "Alice",
        },
        command: {
          text: "openclaw devices list",
          timeoutMs: 9000,
        },
        auth: {
          deliveryAuthenticated: true,
          commandAuthorized: true,
        },
      },
    });
    const parsed = parseBotmaxInboundText(frame);
    expect(parsed).toEqual({
      kind: "command",
      senderId: "telegram:123",
      senderName: "Alice",
      senderUsername: undefined,
      accountId: "00000000-0000-0000-0000-000000000002",
      agentId: "research",
      provider: "telegram",
      surface: "telegram",
      botUsername: undefined,
      conversationId: "telegram:123",
      conversationNativeId: "123",
      chatType: "direct",
      chatId: undefined,
      conversationTitle: undefined,
      replyTargetId: "telegram:123",
      requestId: 42,
      messageId: undefined,
      messageFullId: undefined,
      timestampMs: expect.any(Number),
      threadId: undefined,
      replyToId: undefined,
      replyToBody: undefined,
      replyToSender: undefined,
      wasMentioned: false,
      commandAuthorized: true,
      transcript: undefined,
      attachments: undefined,
      command: "openclaw devices list",
      timeoutMs: 9000,
    });
  });

  it("parses v3 file read frames", () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: "file-req-1",
      params: {
        v: 3,
        type: "file.read",
        transport: {
          bridge: "botmax",
          receivedAtMs: 1773561600000,
        },
        origin: {
          platform: "internal",
          surface: "internal",
        },
        file: {
          operation: "read",
          path: "/tmp/demo.txt",
          encoding: "utf8",
        },
      },
    });

    const parsed = parseBotmaxInboundText(frame);
    expect(parsed).toEqual({
      kind: "file.read",
      requestId: "file-req-1",
      path: "/tmp/demo.txt",
      encoding: "utf8",
    });
  });

  it("parses v3 device request frames", () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: "device-req-1",
      params: {
        v: 3,
        type: "device.request",
        transport: {
          bridge: "botmax",
          receivedAtMs: 1773561600000,
        },
        origin: {
          platform: "internal",
          surface: "internal",
        },
        device: {
          operation: "rotate",
          deviceId: "dev-1",
          role: "operator",
          scopes: ["operator.read"],
        },
      },
    });

    const parsed = parseBotmaxInboundText(frame);
    expect(parsed).toEqual({
      kind: "device.request",
      requestId: "device-req-1",
      operation: "rotate",
      pairingRequestId: undefined,
      latest: undefined,
      includePending: undefined,
      deviceId: "dev-1",
      role: "operator",
      scopes: ["operator.read"],
    });
  });

  it("parses v3 file list frames", () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: "file-list-1",
      params: {
        v: 3,
        type: "file.list",
        transport: {
          bridge: "botmax",
          receivedAtMs: 1773561600000,
        },
        origin: {
          platform: "internal",
          surface: "internal",
        },
        file: {
          operation: "list",
          path: "/root",
          encoding: "utf8",
          includeHidden: true,
        },
      },
    });

    const parsed = parseBotmaxInboundText(frame);
    expect(parsed).toEqual({
      kind: "file.list",
      requestId: "file-list-1",
      path: "/root",
      includeHidden: true,
    });
  });

  it("parses v3 directory create frames", () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: "mkdir-1",
      params: {
        v: 3,
        type: "directory.create",
        transport: {
          bridge: "botmax",
          receivedAtMs: 1773561600000,
        },
        origin: {
          platform: "internal",
          surface: "internal",
        },
        file: {
          operation: "mkdir",
          path: "/root/uploads",
          encoding: "utf8",
          recursive: true,
        },
      },
    });

    const parsed = parseBotmaxInboundText(frame);
    expect(parsed).toEqual({
      kind: "directory.create",
      requestId: "mkdir-1",
      path: "/root/uploads",
      recursive: true,
    });
  });

  it("parses v3 file delete frames", () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: "file-delete-1",
      params: {
        v: 3,
        type: "file.delete",
        transport: {
          bridge: "botmax",
          receivedAtMs: 1773561600000,
        },
        origin: {
          platform: "internal",
          surface: "internal",
        },
        file: {
          operation: "delete",
          path: "/root/demo.txt",
          encoding: "utf8",
        },
      },
    });

    const parsed = parseBotmaxInboundText(frame);
    expect(parsed).toEqual({
      kind: "file.delete",
      requestId: "file-delete-1",
      path: "/root/demo.txt",
      encoding: "utf8",
    });
  });

  it("parses group chat metadata and routes replies to conversation id", () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "botmax.transport",
      params: {
        v: 3,
        type: "chat.message",
        transport: {
          bridge: "botmax",
          receivedAtMs: 1773561600000,
        },
        origin: {
          platform: "telegram",
        },
        conversation: {
          id: "telegram:-100001",
          nativeId: "-100001",
          kind: "group",
          replyTargetId: "telegram:-100001",
          title: "Release Squad",
          threadId: "77",
        },
        sender: {
          id: "telegram:123",
          displayName: "Alice",
        },
        message: {
          id: "tg:msg:2",
          text: "group hi",
          createdAtMs: 1773561602000,
          replyTo: {
            id: "tg:msg:1",
            senderId: "telegram:456",
            senderLabel: "Bob",
            text: "old message",
            isQuote: false,
          },
          mentions: {
            botMentioned: true,
            mentionedIds: ["telegram:bot:1"],
          },
          attachments: [],
        },
        auth: {
          deliveryAuthenticated: true,
          commandAuthorized: true,
        },
      },
    });
    const parsed = parseBotmaxInboundText(frame);
    expect(parsed).toEqual({
      kind: "chat",
      senderId: "telegram:123",
      senderName: "Alice",
      senderUsername: undefined,
      provider: "telegram",
      surface: "telegram",
      botUsername: undefined,
      conversationId: "telegram:-100001",
      conversationNativeId: "-100001",
      chatType: "group",
      chatId: "telegram:-100001",
      conversationTitle: "Release Squad",
      replyTargetId: "telegram:-100001",
      requestId: undefined,
      messageId: "tg:msg:2",
      messageFullId: undefined,
      timestampMs: 1773561602000,
      threadId: "77",
      replyToId: "tg:msg:1",
      replyToBody: "old message",
      replyToSender: "Bob",
      wasMentioned: true,
      commandAuthorized: true,
      transcript: undefined,
      attachments: undefined,
      body: "group hi",
    });
  });

  it("parses attachment-bearing chat frames and derives transcript/body summary", () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "botmax.transport",
      params: {
        v: 3,
        type: "chat.message",
        transport: {
          bridge: "botmax",
          receivedAtMs: 1773561600000,
        },
        origin: {
          platform: "telegram",
          surface: "telegram",
        },
        conversation: {
          id: "telegram:123",
          nativeId: "123",
          kind: "direct",
          replyTargetId: "telegram:123",
        },
        sender: {
          id: "telegram:123",
          displayName: "Alice",
        },
        message: {
          id: "tg:msg:3",
          createdAtMs: 1773561603000,
          mentions: {
            botMentioned: false,
            mentionedIds: [],
          },
          attachments: [
            {
              id: "att-1",
              kind: "audio",
              fetchUrl: "https://r2.example.test/voice.ogg",
              mimeType: "audio/ogg",
              transcript: "voice transcript",
              durationMs: 3200,
              deliveryHints: {
                sendAs: "voice",
              },
            },
          ],
        },
        auth: {
          deliveryAuthenticated: true,
          commandAuthorized: false,
        },
      },
    });
    const parsed = parseBotmaxInboundText(frame);
    expect(parsed).toEqual({
      kind: "chat",
      senderId: "telegram:123",
      senderName: "Alice",
      senderUsername: undefined,
      provider: "telegram",
      surface: "telegram",
      botUsername: undefined,
      conversationId: "telegram:123",
      conversationNativeId: "123",
      chatType: "direct",
      chatId: undefined,
      conversationTitle: undefined,
      replyTargetId: "telegram:123",
      requestId: undefined,
      messageId: "tg:msg:3",
      messageFullId: undefined,
      timestampMs: 1773561603000,
      threadId: undefined,
      replyToId: undefined,
      replyToBody: undefined,
      replyToSender: undefined,
      wasMentioned: false,
      commandAuthorized: false,
      transcript: "voice transcript",
      attachments: [
        {
          id: "att-1",
          kind: "audio",
          name: undefined,
          mimeType: "audio/ogg",
          sizeBytes: undefined,
          fetchUrl: "https://r2.example.test/voice.ogg",
          sharedPath: undefined,
          inlineBase64: undefined,
          caption: undefined,
          transcript: "voice transcript",
          width: undefined,
          height: undefined,
          durationMs: 3200,
          deliveryHints: {
            sendAs: "voice",
          },
        },
      ],
      body: "[Audio]\nTranscript:\nvoice transcript",
    });
  });

  it("rejects non-jsonrpc payloads", () => {
    expect(parseBotmaxInboundText("[[[telegram:123]]]hello")).toBeNull();
  });

  it("formats outbound chat as v3 json-rpc", () => {
    const frame = JSON.parse(
      formatBotmaxOutboundText({
        recipientId: "telegram:123",
        text: "hello",
        requestId: "req-2",
      }),
    );
    expect(frame).toMatchObject({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: "req-2",
      params: {
        v: 3,
        type: "chat.message",
        transport: {
          bridge: "botmax",
          receivedAtMs: expect.any(Number),
        },
        origin: {
          platform: "telegram",
          surface: "telegram",
        },
        conversation: {
          id: "telegram:123",
          nativeId: "123",
          kind: "direct",
          replyTargetId: "telegram:123",
        },
        sender: {
          id: "openclaw:botmax",
          nativeId: "botmax",
          displayName: "openclaw:botmax",
        },
        message: {
          text: "hello",
          createdAtMs: expect.any(Number),
          mentions: {
            botMentioned: false,
            mentionedIds: [],
          },
        },
        auth: {
          deliveryAuthenticated: true,
          commandAuthorized: false,
        },
      },
    });
    expect(frame.params.message.id).toMatch(/^botmax:msg:/);
    expect(frame.params.message.fullId).toContain("telegram:123:");
  });

  it("formats outbound chat replies with message-level replyTo metadata", () => {
    const frame = JSON.parse(
      formatBotmaxOutboundText({
        recipientId:
          "msteams:conversation:conversation-1|binding:00000000-0000-0000-0000-000000000001|replyTo:activity-999",
        text: "hello",
        replyToId: "msteams:msg:activity-123",
        platform: "msteams",
      }),
    );

    expect(frame).toMatchObject({
      params: {
        type: "chat.message",
        origin: {
          platform: "msteams",
          surface: "msteams",
        },
        message: {
          text: "hello",
          replyTo: {
            id: "msteams:msg:activity-123",
          },
        },
      },
    });
  });

  it("formats outbound attachment messages as v3 json-rpc", () => {
    const frame = JSON.parse(
      formatBotmaxOutboundMessage({
        recipientId: "telegram:123",
        text: "see attachment",
        attachments: [
          {
            id: "att-1",
            kind: "image",
            fetchUrl: "https://cdn.example.test/photo.jpg",
            mimeType: "image/jpeg",
            width: 1280,
            height: 720,
            deliveryHints: {
              sendAs: "photo",
            },
          },
        ],
      }),
    );
    expect(frame).toMatchObject({
      jsonrpc: "2.0",
      method: "botmax.transport",
      params: {
        v: 3,
        type: "chat.message",
        origin: {
          platform: "telegram",
          surface: "telegram",
        },
        conversation: {
          id: "telegram:123",
          replyTargetId: "telegram:123",
        },
        message: {
          text: "see attachment",
          attachments: [
            {
              id: "att-1",
              kind: "image",
              fetchUrl: "https://cdn.example.test/photo.jpg",
              mimeType: "image/jpeg",
              width: 1280,
              height: 720,
              deliveryHints: {
                sendAs: "photo",
              },
            },
          ],
        },
      },
    });
  });

  it("formats outbound command result as v3 json-rpc", () => {
    const frame = JSON.parse(
      formatBotmaxOutboundCommandResult({
        recipientId: "telegram:123",
        command: "openclaw devices list",
        ok: true,
        output: "[]",
        method: "device.pair.list",
        data: [],
      }),
    );
    expect(frame).toMatchObject({
      jsonrpc: "2.0",
      method: "botmax.transport",
      params: {
        v: 3,
        type: "command.result",
        transport: {
          bridge: "botmax",
          receivedAtMs: expect.any(Number),
        },
        origin: {
          platform: "telegram",
          surface: "telegram",
        },
        conversation: {
          id: "telegram:123",
          replyTargetId: "telegram:123",
        },
        command: {
          text: "openclaw devices list",
          method: "device.pair.list",
        },
        result: {
          ok: true,
          output: "[]",
          data: [],
        },
      },
    });
  });

  it("formats outbound file result as v3 json-rpc", () => {
    const frame = JSON.parse(
      formatBotmaxOutboundFileResult({
        operation: "read",
        path: "/tmp/demo.txt",
        encoding: "utf8",
        ok: true,
        output: "read 5 bytes from /tmp/demo.txt",
        data: {
          path: "/tmp/demo.txt",
          encoding: "utf8",
          content: "hello",
          sizeBytes: 5,
        },
        requestId: "file-req-2",
      }),
    );

    expect(frame).toMatchObject({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: "file-req-2",
      params: {
        v: 3,
        type: "file.result",
        transport: {
          bridge: "botmax",
          receivedAtMs: expect.any(Number),
        },
        origin: {
          platform: "internal",
          surface: "internal",
        },
        file: {
          operation: "read",
          path: "/tmp/demo.txt",
          encoding: "utf8",
        },
        result: {
          ok: true,
          output: "read 5 bytes from /tmp/demo.txt",
          data: {
            path: "/tmp/demo.txt",
            encoding: "utf8",
            content: "hello",
            sizeBytes: 5,
          },
        },
      },
    });
  });

  it("formats outbound device result as v3 json-rpc", () => {
    const frame = JSON.parse(
      formatBotmaxOutboundDeviceResult({
        operation: "list",
        ok: true,
        output: "{\"pending\":[],\"paired\":[]}",
        data: {
          pending: [],
          paired: [],
        },
        requestId: "device-req-2",
      }),
    );

    expect(frame).toMatchObject({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: "device-req-2",
      params: {
        v: 3,
        type: "device.result",
        transport: {
          bridge: "botmax",
          receivedAtMs: expect.any(Number),
        },
        origin: {
          platform: "internal",
          surface: "internal",
        },
        device: {
          operation: "list",
        },
        result: {
          ok: true,
          output: "{\"pending\":[],\"paired\":[]}",
          data: {
            pending: [],
            paired: [],
          },
        },
      },
    });
  });
});
