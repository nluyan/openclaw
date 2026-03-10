import { describe, expect, it } from "vitest";
import {
  formatBotmaxOutboundCommandResult,
  formatBotmaxOutboundText,
  parseBotmaxInboundText,
} from "./message-format.js";

describe("botmax message format", () => {
  it("parses json-rpc chat frames", () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: "req-1",
      params: {
        v: 2,
        type: "chat.message",
        from: "telegram:123",
        to: "openclaw:botmax",
        text: "hi",
      },
    });
    const parsed = parseBotmaxInboundText(frame);
    expect(parsed).toEqual({
      kind: "chat",
      senderId: "telegram:123",
      body: "hi",
      chatType: "direct",
      chatId: undefined,
      replyTargetId: "telegram:123",
      requestId: "req-1",
    });
  });

  it("parses json-rpc command frames", () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: 42,
      params: {
        v: 2,
        type: "command.exec",
        from: "telegram:123",
        to: "openclaw:botmax",
        command: "openclaw devices list",
        timeoutMs: 9000,
      },
    });
    const parsed = parseBotmaxInboundText(frame);
    expect(parsed).toEqual({
      kind: "command",
      senderId: "telegram:123",
      command: "openclaw devices list",
      timeoutMs: 9000,
      chatType: "direct",
      chatId: undefined,
      replyTargetId: "telegram:123",
      requestId: 42,
    });
  });

  it("parses group chat metadata and routes replies to chatId", () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "botmax.transport",
      params: {
        v: 2,
        type: "chat.message",
        from: "telegram:123",
        senderId: "telegram:123",
        to: "openclaw:botmax",
        text: "group hi",
        chatType: "group",
        chatId: "telegram:-100001",
      },
    });
    const parsed = parseBotmaxInboundText(frame);
    expect(parsed).toEqual({
      kind: "chat",
      senderId: "telegram:123",
      body: "group hi",
      chatType: "group",
      chatId: "telegram:-100001",
      replyTargetId: "telegram:-100001",
      requestId: undefined,
    });
  });

  it("rejects non-jsonrpc payloads", () => {
    expect(parseBotmaxInboundText("[[[telegram:123]]]hello")).toBeNull();
  });

  it("formats outbound chat as json-rpc", () => {
    const frame = JSON.parse(
      formatBotmaxOutboundText({
        recipientId: "telegram:123",
        text: "hello",
        requestId: "req-2",
      }),
    );
    expect(frame).toEqual({
      jsonrpc: "2.0",
      method: "botmax.transport",
      id: "req-2",
      params: {
        v: 2,
        type: "chat.message",
        from: "openclaw:botmax",
        to: "telegram:123",
        text: "hello",
      },
    });
  });

  it("formats outbound command result as json-rpc", () => {
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
    expect(frame).toEqual({
      jsonrpc: "2.0",
      method: "botmax.transport",
      params: {
        v: 2,
        type: "command.result",
        from: "openclaw:botmax",
        to: "telegram:123",
        command: "openclaw devices list",
        method: "device.pair.list",
        ok: true,
        output: "[]",
        data: [],
      },
    });
  });
});
