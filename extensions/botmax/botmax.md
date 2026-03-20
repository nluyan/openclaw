# Botmax Channel (OpenClaw)

## Overview

- The Botmax plugin connects OpenClaw to BotKeeper over WebSocket using `BOTMAX_SERVER`.
- Query parameters such as `botid`, and `token` should be appended directly to `BOTMAX_SERVER` when needed.
- BotKeeper routes inbound WebSocket text to the corresponding channel (for example, Telegram via `telegram:<userId>`).
- Telegram is the first Botmax v3 media-enabled upstream and downstream surface.

## Unified Transport Protocol (JSON-RPC)

- BotKeeper and the OpenClaw Botmax plugin now use one JSON-RPC envelope (`jsonrpc=2.0`, `method=botmax.transport`) with `params.v=3`.
- Legacy `[[[id]]]text` protocol is fully removed.
- Heartbeats remain text frames: `<<<ping>>>` and `<<<pong>>>`.

### Chat Message Frame

```json
{
  "jsonrpc": "2.0",
  "method": "botmax.transport",
  "id": "optional-request-id",
  "params": {
    "v": 3,
    "type": "chat.message",
    "transport": {
      "bridge": "botmax",
      "receivedAtMs": 1773561600000,
      "dedupeKey": "telegram:-1001234567890:987654321"
    },
    "origin": {
      "platform": "telegram",
      "surface": "telegram",
      "botUsername": "demo_bot"
    },
    "conversation": {
      "id": "telegram:-1001234567890",
      "nativeId": "-1001234567890",
      "kind": "group",
      "replyTargetId": "telegram:-1001234567890",
      "title": "Release Squad",
      "threadId": "77"
    },
    "sender": {
      "id": "telegram:123456",
      "nativeId": "123456",
      "displayName": "Alice",
      "username": "alice_demo",
      "isBot": false
    },
    "message": {
      "id": "tg:msg:987654321",
      "nativeId": "987654321",
      "fullId": "telegram:-1001234567890:987654321",
      "text": "hello",
      "createdAtMs": 1773561600000,
      "replyTo": {
        "id": "tg:msg:987654300",
        "senderId": "telegram:456",
        "senderLabel": "Bob",
        "text": "quoted text",
        "isQuote": false
      },
      "mentions": {
        "botMentioned": false,
        "mentionedIds": []
      },
      "attachments": []
    },
    "auth": {
      "deliveryAuthenticated": true,
      "commandAuthorized": true
    }
  }
}
```

### Command Execute Frame

```json
{
  "jsonrpc": "2.0",
  "method": "botmax.transport",
  "id": "cmd-001",
  "params": {
    "v": 3,
    "type": "command.exec",
    "transport": {
      "bridge": "botmax",
      "receivedAtMs": 1773561600000
    },
    "origin": {
      "platform": "telegram",
      "surface": "telegram"
    },
    "conversation": {
      "id": "telegram:-1001234567890",
      "nativeId": "-1001234567890",
      "kind": "group",
      "replyTargetId": "telegram:-1001234567890"
    },
    "sender": {
      "id": "telegram:123456",
      "nativeId": "123456",
      "displayName": "Alice"
    },
    "message": {
      "id": "tg:msg:987654321",
      "nativeId": "987654321",
      "fullId": "telegram:-1001234567890:987654321",
      "text": "/oc openclaw devices list",
      "createdAtMs": 1773561600000,
      "mentions": {
        "botMentioned": false,
        "mentionedIds": []
      }
    },
    "command": {
      "text": "openclaw devices list",
      "timeoutMs": 10000
    },
    "auth": {
      "deliveryAuthenticated": true,
      "commandAuthorized": true
    }
  }
}
```

### Command Result Frame

```json
{
  "jsonrpc": "2.0",
  "method": "botmax.transport",
  "id": "cmd-001",
  "params": {
    "v": 3,
    "type": "command.result",
    "transport": {
      "bridge": "botmax",
      "receivedAtMs": 1773561605000
    },
    "origin": {
      "platform": "telegram",
      "surface": "telegram"
    },
    "conversation": {
      "id": "telegram:123456",
      "replyTargetId": "telegram:123456"
    },
    "command": {
      "text": "openclaw devices list",
      "method": "device.pair.list"
    },
    "result": {
      "ok": true,
      "output": "{ ...stringified result... }",
      "data": {}
    }
  }
}
```

### File Read / Write Frames

`file.read` and `file.write` are BotKeeper control-plane RPCs for reading and writing files inside the OpenClaw runtime without going through the shell command transport.

```json
{
  "jsonrpc": "2.0",
  "method": "botmax.transport",
  "id": "file-001",
  "params": {
    "v": 3,
    "type": "file.read",
    "transport": {
      "bridge": "botmax",
      "receivedAtMs": 1773561600000
    },
    "origin": {
      "platform": "internal",
      "surface": "internal"
    },
    "file": {
      "operation": "read",
      "path": "/root/.openclaw/config.json",
      "encoding": "utf8"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "method": "botmax.transport",
  "id": "file-001",
  "params": {
    "v": 3,
    "type": "file.result",
    "transport": {
      "bridge": "botmax",
      "receivedAtMs": 1773561600100
    },
    "origin": {
      "platform": "internal",
      "surface": "internal"
    },
    "file": {
      "operation": "read",
      "path": "/root/.openclaw/config.json",
      "encoding": "utf8"
    },
    "result": {
      "ok": true,
      "output": "read 128 bytes from /root/.openclaw/config.json",
      "data": {
        "path": "/root/.openclaw/config.json",
        "encoding": "utf8",
        "content": "{...}",
        "sizeBytes": 128
      }
    }
  }
}
```

## Supported OpenClaw Commands

- `openclaw devices list` -> `device.pair.list`
- `openclaw devices approve <requestId>` -> `device.pair.approve`
- `openclaw devices approve --latest` -> `device.pair.approve` with latest pending request
- `openclaw devices reject <requestId>` -> `device.pair.reject`
- `openclaw devices remove <deviceId>` -> local paired-device state removal
- `openclaw devices clear --yes [--pending]` -> local bulk device state / pending request cleanup
- `openclaw devices rotate --device <deviceId> --role <role> [--scope <scope> ...]` -> local token rotation
- `openclaw devices revoke --device <deviceId> --role <role>` -> local token revoke
- `openclaw nodes pending` -> local pending node request list
- `openclaw nodes approve <requestId>` -> local node approval from state store
- `openclaw nodes reject <requestId>` -> local node rejection from state store
- `openclaw nodes rename --node <id|name|ip> --name <displayName>` -> local paired-node state rename
- Any other first-class `openclaw <subcommand>` command is executed locally through the OpenClaw CLI.
- `openclaw devices *` runs with CLI semantics and `operator.pairing` scope.
- `openclaw devices list/approve/reject` uses plugin-sdk pairing APIs directly.
- `openclaw devices remove/clear/rotate/revoke` uses botmax-local device state helpers directly.
- `openclaw nodes pending/approve/reject` uses botmax-local node state helpers directly.
- `openclaw nodes rename` resolves the paired node locally by nodeId, display name, or remote IP, then updates the local node state directly.
- `openclaw gateway call *` is rejected. Server-side callers must send the corresponding direct CLI command instead.

## Protocol Rules

- BotKeeper <-> OpenClaw only accepts JSON-RPC `botmax.transport` frames with `params.v=3`.
- OpenClaw accepts `chat.message`, `command.exec`, `file.read`, and `file.write`.
- BotKeeper consumes `chat.message`, `command.result`, and `file.result`.
- `conversation.id` is the conversation identity for routing and session scoping.
- `conversation.replyTargetId` is the concrete delivery target for replies and command results.
- `sender.id` is the actual sender identity and is separate from the conversation id.
- `origin.platform` is forwarded into OpenClaw as the real upstream provider instead of collapsing everything to `botmax`.
- `sender.displayName` and `sender.username` are forwarded so OpenClaw can populate `SenderName` and `SenderUsername`.
- The Telegram -> BotKeeper bridge currently forwards sender labels, usernames, message ids, reply targets, group titles, and thread ids when Telegram provides them.
- Botmax chat replies end with the actual outbound message only; the plugin does not append any `<<<done>>>` marker.
- `file.read` and `file.write` currently support `utf8` and `base64` encodings.
- `file.write` creates parent directories by default when BotKeeper requests `ensureDirectory = true`.

## Rich Attachment Model

- The fuller v3 contract, including attachment and file fields, is documented in [protocol-v3-proposal.md](./protocol-v3-proposal.md).
- The machine-readable schema lives in [protocol-v3.schema.json](./protocol-v3.schema.json).
- The current runtime implements the v3 text, command, attachment, and file-operation envelope end-to-end between BotKeeper and the OpenClaw Botmax plugin.
- Telegram inbound media currently covers `photo`, `voice`, `audio`, `video`, `document`, and `sticker`.
- BotKeeper downloads Telegram media, uploads it to the private R2 bucket, and forwards signed `fetchUrl` attachment references to OpenClaw.
- OpenClaw materializes inbound attachments into temp files and maps them into media-aware inbound context fields such as `MediaPath`, `MediaPaths`, `MediaType`, and `MediaTypes`.
- OpenClaw outbound media replies are serialized back into Botmax v3 attachments:
  - remote media URLs stay as `fetchUrl`
  - local media files are inlined as `inlineBase64`
- BotKeeper currently rehydrates those Botmax attachments and sends them downstream to Telegram with native media APIs.
- Current guardrails:
  - per-file relay limit: `20 MB`
  - R2 download URL TTL: `30 minutes`
  - R2 object retention target: `72 hours` via bucket lifecycle / retention policy

## Troubleshooting Reconnect Loops

- Raw inbound/outbound frames are logged as `botmax[<accountId>] inbound raw: ...` and `botmax[<accountId>] outbound raw: ...`.
- Heartbeat pings (`<<<ping>>>`) and pongs (`<<<pong>>>`) are not logged; suppressed heartbeats still log `heartbeat suppressed`.
- Check BotKeeper logs for `WebSocket client requested close` to see close status and description.
- Check BotKeeper logs for `WebSocket error` to capture transport failures (state + error message).
- Check BotKeeper logs for `Telegram send failed` to catch downstream delivery errors without killing the WebSocket.
- If OpenClaw keeps reconnecting, correlate the timestamp with `/tmp/openclaw/openclaw-<date>.log` for `botmax` connect failures.
- If you see `starting channel (abort=true)` or `abort received before start`, the channel task is being cancelled immediately (likely by a gateway restart/reload or a manual stop).
- If you see `abort received; stopping channel`, the gateway is actively stopping the channel (track what triggered `stopChannel` or a config reload at the same time).
