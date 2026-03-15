# Botmax Channel (OpenClaw)

## Overview

- The Botmax plugin connects OpenClaw to BotKeeper over WebSocket using `BOTMAX_SERVER`.
- Query parameters such as `botid`, and `token` should be appended directly to `BOTMAX_SERVER` when needed.
- BotKeeper routes inbound WebSocket text to the corresponding channel (for example, Telegram via `telegram:<userId>`).

## Unified Transport Protocol (JSON-RPC)

- Botmax now uses one JSON-RPC envelope (`jsonrpc=2.0`, `method=botmax.transport`) for both chat text and command execution.
- Legacy `[[[id]]]text` protocol is fully removed.
- Heartbeats remain text frames: `<<<ping>>>` and `<<<pong>>>`.

### Chat Message Frame

```json
{
  "jsonrpc": "2.0",
  "method": "botmax.transport",
  "id": "optional-request-id",
  "params": {
    "v": 2,
    "type": "chat.message",
    "from": "telegram:123456",
    "to": "openclaw:botmax",
    "text": "hello",
    "chatType": "group",
    "chatId": "telegram:-1001234567890",
    "senderId": "telegram:123456"
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
    "v": 2,
    "type": "command.exec",
    "from": "telegram:123456",
    "to": "openclaw:botmax",
    "command": "openclaw devices list",
    "timeoutMs": 10000,
    "chatType": "group",
    "chatId": "telegram:-1001234567890",
    "senderId": "telegram:123456"
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
    "v": 2,
    "type": "command.result",
    "from": "openclaw:botmax",
    "to": "telegram:123456",
    "command": "openclaw devices list",
    "method": "device.pair.list",
    "ok": true,
    "output": "{ ...stringified result... }",
    "data": {}
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

- BotKeeper <-> OpenClaw only accepts JSON-RPC `botmax.transport` frames (`params.v=2`).
- OpenClaw accepts `chat.message` and `command.exec`.
- BotKeeper consumes `chat.message` and `command.result`.
- For `chatType=group`, OpenClaw routes and replies by `chatId` (not by `from`).
- For `chatType=direct`, OpenClaw routes and replies by `from`.
- Botmax chat replies end with the actual outbound message only; the plugin does not append any `<<<done>>>` marker.

## Troubleshooting Reconnect Loops

- Raw inbound/outbound frames are logged as `botmax[<accountId>] inbound raw: ...` and `botmax[<accountId>] outbound raw: ...`.
- Heartbeat pings (`<<<ping>>>`) and pongs (`<<<pong>>>`) are not logged; suppressed heartbeats still log `heartbeat suppressed`.
- Check BotKeeper logs for `WebSocket client requested close` to see close status and description.
- Check BotKeeper logs for `WebSocket error` to capture transport failures (state + error message).
- Check BotKeeper logs for `Telegram send failed` to catch downstream delivery errors without killing the WebSocket.
- If OpenClaw keeps reconnecting, correlate the timestamp with `/tmp/openclaw/openclaw-<date>.log` for `botmax` connect failures.
- If you see `starting channel (abort=true)` or `abort received before start`, the channel task is being cancelled immediately (likely by a gateway restart/reload or a manual stop).
- If you see `abort received; stopping channel`, the gateway is actively stopping the channel (track what triggered `stopChannel` or a config reload at the same time).
