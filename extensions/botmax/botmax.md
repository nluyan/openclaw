# Botmax Channel (OpenClaw)

## Overview
- The Botmax plugin connects OpenClaw to BotKeeper over WebSocket using `BOTMAX_SERVER`.
- Query parameters such as `botid`, and `token` should be appended directly to `BOTMAX_SERVER` when needed.
- BotKeeper routes inbound WebSocket text to the corresponding channel (for example, Telegram via `telegram:<userId>`).

## Message Format
- **Inbound to OpenClaw:** `[[[sender_id]]]this is a message`
- **Outbound from OpenClaw:** `[[[recipient_id]]]this is a message`
- Replies always use the original `sender_id` as `recipient_id`.
- If an outbound `recipient_id` omits a channel prefix (e.g. `telegram:`), Botmax reuses the last observed sender prefix for that account.
- Proactive assistant messages (not tied to a specific inbound message) use `recipient_id=all`.

## Troubleshooting Reconnect Loops
- Raw inbound/outbound frames are logged as `botmax[<accountId>] inbound raw: ...` and `botmax[<accountId>] outbound raw: ...`.
- Heartbeat pings (`<<<ping>>>`) and pongs (`<<<pong>>>`) are not logged; suppressed heartbeats still log `heartbeat suppressed`.
- Check BotKeeper logs for `WebSocket client requested close` to see close status and description.
- Check BotKeeper logs for `WebSocket error` to capture transport failures (state + error message).
- Check BotKeeper logs for `Telegram send failed` to catch downstream delivery errors without killing the WebSocket.
- If OpenClaw keeps reconnecting, correlate the timestamp with `/tmp/openclaw/openclaw-<date>.log` for `botmax` connect failures.
- If you see `starting channel (abort=true)` or `abort received before start`, the channel task is being cancelled immediately (likely by a gateway restart/reload or a manual stop).
- If you see `abort received; stopping channel`, the gateway is actively stopping the channel (track what triggered `stopChannel` or a config reload at the same time).
