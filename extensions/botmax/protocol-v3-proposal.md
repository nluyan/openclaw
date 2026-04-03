# Botmax Transport Protocol v3 Proposal

Status:

- Working contract for the Botmax v3 transport shape.
- The current runtime uses v3 for BotKeeper <-> OpenClaw text chat, attachments, `command.exec`, `command.result`, `file.read`, `file.list`, `file.write`, `directory.create`, `file.delete`, and `file.result`.
- Telegram is the first runtime surface with end-to-end media relay enabled.
- Current runtime details are documented in [botmax.md](./botmax.md).

Proposal assets:

- Human-readable proposal: [protocol-v3-proposal.md](./protocol-v3-proposal.md)
- Draft JSON Schema: [protocol-v3.schema.json](./protocol-v3.schema.json)

## Goals

Botmax v3 should carry enough information to let OpenClaw reconstruct the same inbound context quality that native channels such as Telegram and Slack already provide.

The design goals are:

- Preserve the real source platform instead of collapsing everything into `botmax`.
- Separate conversation identity from sender identity.
- Carry stable message ids, reply chains, thread ids, mentions, and media.
- Allow pure media messages with no text.
- Carry explicit trust and authorization signals instead of relying on plugin-side defaults.
- Keep one JSON-RPC envelope while using structured payloads inside `params`.

## Why v2 is insufficient

Current v2 is intentionally small, but it loses too much information before the message reaches OpenClaw.

Observed problems:

- No sender display metadata:
  `SenderName` must fall back to `senderId`.
- No real platform identity:
  OpenClaw only sees `Provider = "botmax"` instead of `telegram`, `discord`, or another real origin.
- No group labels:
  `GroupSubject` and `ConversationLabel` degrade to ids.
- No stable message id:
  reply chains, dedupe, and thread reconstruction are weak.
- No reply or quote context:
  `ReplyToId`, `ReplyToBody`, and `ReplyToSender` cannot be populated.
- No thread context:
  `MessageThreadId`, `ThreadLabel`, `ParentSessionKey`, and forum semantics cannot be derived.
- No mention semantics:
  `WasMentioned` and `BotUsername` are unavailable.
- No media payload:
  pure image, audio, video, and file messages cannot be represented cleanly.
- No forward metadata:
  `ForwardedFrom*` fields are unavailable.
- Weak auth semantics:
  `CommandAuthorized` must not be guessed or defaulted to `true`.

## Design principles

1. Keep JSON-RPC as the transport envelope.
2. Use a shared structured context for both `chat.message` and `command.exec`.
3. Distinguish:
   - transport bridge identity
   - real origin platform identity
   - conversation identity
   - sender identity
   - message identity
4. Treat user-controlled strings as untrusted content.
5. Treat route ids, message ids, timestamps, and auth signals as trusted metadata when produced by BotKeeper.
6. Make `text` optional so pure media messages are valid.
7. Require explicit reply routing information instead of letting OpenClaw guess.

## Transport envelope

The outer envelope remains unchanged:

```json
{
  "jsonrpc": "2.0",
  "method": "botmax.transport",
  "id": "optional-rpc-id",
  "params": {
    "v": 3,
    "type": "chat.message"
  }
}
```

Notes:

- `id` is for request and response correlation only.
- Provider message identity must live inside `params.message.id`, not in JSON-RPC `id`.
- The draft schema for the full envelope and all payload variants lives in [protocol-v3.schema.json](./protocol-v3.schema.json).

## Shared context model

### `transport`

Trusted metadata about the BotKeeper to OpenClaw bridge itself.

```json
{
  "bridge": "botmax",
  "connectionId": "optional-connection-id",
  "receivedAtMs": 1773561600000,
  "dedupeKey": "optional-stable-dedupe-key",
  "traceId": "optional-trace-id"
}
```

Recommended rules:

- `bridge` is always `botmax`.
- `receivedAtMs` is the time BotKeeper accepted the event.
- `dedupeKey` should be stable across BotKeeper retries for the same inbound event.

### `origin`

Trusted metadata about the real upstream platform.

```json
{
  "platform": "telegram",
  "surface": "telegram",
  "accountId": "default",
  "botId": "telegram:bot:123456",
  "botUsername": "my_bot"
}
```

Recommended rules:

- `platform` is the real message source, such as `telegram`, `discord`, `slack`, or `line`.
- `surface` may equal `platform`, or may carry a more specific OpenClaw-facing surface label when needed.
- `accountId` matches the OpenClaw channel account when applicable.

### `conversation`

Trusted routing metadata for the active conversation.

```json
{
  "id": "telegram:-1001234567890",
  "nativeId": "-1001234567890",
  "kind": "group",
  "replyTargetId": "telegram:-1001234567890",
  "agentId": "main",
  "title": "Release Squad",
  "channelName": null,
  "spaceName": null,
  "threadId": "77",
  "threadLabel": "Ops Thread",
  "parentId": "telegram:-1001234567890",
  "isForum": true
}
```

Recommended rules:

- `id` is the canonical Botmax conversation id.
- `replyTargetId` is where replies should go.
- `agentId` is an optional trusted OpenClaw ingress target. When present, the Botmax plugin should route directly to that agent instead of relying on static OpenClaw `bindings`.
- For direct messages, `replyTargetId` usually equals `id`.
- For group or channel messages, `id` is the group or channel conversation id, not the sender id.
- `threadId` is provider-native and may be a string or a number serialized as a string.

### `sender`

Mostly untrusted display metadata plus one trusted sender id.

```json
{
  "id": "telegram:8431265513",
  "nativeId": "8431265513",
  "displayName": "Alice",
  "username": "alice_demo",
  "tag": null,
  "e164": null,
  "isBot": false
}
```

Recommended rules:

- `id` is canonical and trusted.
- `displayName`, `username`, `tag`, and `e164` should be treated as user-controlled display metadata.

### `auth`

Trusted authorization state, computed by BotKeeper or another trusted server component.

```json
{
  "deliveryAuthenticated": true,
  "commandAuthorized": false,
  "senderIsOwner": false,
  "scopes": []
}
```

Recommended rules:

- `deliveryAuthenticated` must describe the BotKeeper to OpenClaw transport trust boundary.
- `commandAuthorized` must be explicit and must default to `false` when absent.
- OpenClaw should never infer `commandAuthorized = true` from missing data.

## `chat.message`

### Shape

```json
{
  "v": 3,
  "type": "chat.message",
  "transport": {},
  "origin": {},
  "conversation": {},
  "sender": {},
  "message": {},
  "auth": {},
  "extensions": {}
}
```

### `message`

```json
{
  "id": "tg:msg:987654321",
  "nativeId": "987654321",
  "fullId": "telegram:-1001234567890:987654321",
  "text": "message",
  "createdAtMs": 1773561600000,
  "editedAtMs": null,
  "replyTo": null,
  "forwardedFrom": null,
  "mentions": {
    "botMentioned": false,
    "mentionedIds": []
  },
  "attachments": []
}
```

Required fields:

- `message.id`
- `message.createdAtMs`
- At least one of:
  - `message.text`
  - `message.attachments`

### `replyTo`

```json
{
  "id": "tg:msg:987654300",
  "nativeId": "987654300",
  "senderId": "telegram:10001",
  "senderLabel": "Bob",
  "text": "quoted text",
  "isQuote": false
}
```

### `forwardedFrom`

```json
{
  "id": "telegram:10001",
  "label": "Bob",
  "username": "bob",
  "type": "user",
  "title": null,
  "chatType": "direct",
  "messageId": "12345",
  "dateMs": 1773561000000
}
```

### `attachments`

Each attachment should support one of three materialization modes:

- remote fetch:
  `fetchUrl`
- inline payload for small files:
  `inlineBase64`
- shared storage reference:
  `sharedPath`

```json
{
  "id": "att-1",
  "kind": "image",
  "name": "photo.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 102400,
  "fetchUrl": "https://botkeeper.example/internal/media/att-1?token=...",
  "inlineBase64": null,
  "sharedPath": null,
  "sha256": "optional-sha256",
  "caption": null,
  "transcript": null,
  "width": 1024,
  "height": 768,
  "durationMs": null
}
```

Recommended attachment kinds:

- `image`
- `audio`
- `video`
- `file`
- `sticker`
- `location`

Rules:

- At least one of `fetchUrl`, `inlineBase64`, or `sharedPath` should be present.
- `text` may be empty when attachments exist.
- `transcript` is useful for voice notes and audio attachments.

### Example: direct message

```json
{
  "jsonrpc": "2.0",
  "method": "botmax.transport",
  "id": "evt-001",
  "params": {
    "v": 3,
    "type": "chat.message",
    "transport": {
      "bridge": "botmax",
      "receivedAtMs": 1773561600000,
      "dedupeKey": "telegram:8431265513:987654321"
    },
    "origin": {
      "platform": "telegram",
      "surface": "telegram",
      "accountId": "default",
      "botId": "telegram:bot:123456",
      "botUsername": "my_bot"
    },
    "conversation": {
      "id": "telegram:8431265513",
      "nativeId": "8431265513",
      "kind": "direct",
      "replyTargetId": "telegram:8431265513"
    },
    "sender": {
      "id": "telegram:8431265513",
      "nativeId": "8431265513",
      "displayName": "Alice",
      "username": "alice_demo",
      "isBot": false
    },
    "message": {
      "id": "tg:msg:987654321",
      "nativeId": "987654321",
      "fullId": "telegram:8431265513:987654321",
      "text": "message",
      "createdAtMs": 1773561600000,
      "mentions": {
        "botMentioned": false,
        "mentionedIds": []
      },
      "attachments": []
    },
    "auth": {
      "deliveryAuthenticated": true,
      "commandAuthorized": false,
      "senderIsOwner": false,
      "scopes": []
    }
  }
}
```

### Example: group message with reply and image

```json
{
  "jsonrpc": "2.0",
  "method": "botmax.transport",
  "params": {
    "v": 3,
    "type": "chat.message",
    "transport": {
      "bridge": "botmax",
      "receivedAtMs": 1773561600000
    },
    "origin": {
      "platform": "telegram",
      "surface": "telegram",
      "accountId": "default",
      "botUsername": "my_bot"
    },
    "conversation": {
      "id": "telegram:-1001234567890",
      "nativeId": "-1001234567890",
      "kind": "group",
      "replyTargetId": "telegram:-1001234567890",
      "title": "Release Squad",
      "threadId": "77",
      "threadLabel": "Ops Thread",
      "parentId": "telegram:-1001234567890",
      "isForum": true
    },
    "sender": {
      "id": "telegram:8431265513",
      "nativeId": "8431265513",
      "displayName": "Alice",
      "username": "alice_demo",
      "isBot": false
    },
    "message": {
      "id": "tg:msg:987654322",
      "nativeId": "987654322",
      "fullId": "telegram:-1001234567890:987654322",
      "text": "please check this",
      "createdAtMs": 1773561600000,
      "replyTo": {
        "id": "tg:msg:987654300",
        "nativeId": "987654300",
        "senderId": "telegram:10001",
        "senderLabel": "Bob",
        "text": "old message",
        "isQuote": false
      },
      "mentions": {
        "botMentioned": true,
        "mentionedIds": ["telegram:bot:123456"]
      },
      "attachments": [
        {
          "id": "att-1",
          "kind": "image",
          "name": "photo.jpg",
          "mimeType": "image/jpeg",
          "sizeBytes": 102400,
          "fetchUrl": "https://botkeeper.example/internal/media/att-1?token=...",
          "width": 1024,
          "height": 768
        }
      ]
    },
    "auth": {
      "deliveryAuthenticated": true,
      "commandAuthorized": false
    }
  }
}
```

## `command.exec`

`command.exec` should reuse the same shared context shape so command execution still has full routing, sender, and auth semantics.

### Shape

```json
{
  "v": 3,
  "type": "command.exec",
  "transport": {},
  "origin": {},
  "conversation": {},
  "sender": {},
  "message": {},
  "command": {
    "text": "openclaw devices list",
    "timeoutMs": 10000
  },
  "auth": {},
  "extensions": {}
}
```

Notes:

- `message` is optional for non-chat initiated commands, but should be present whenever the command came from a real message.
- `auth.commandAuthorized` is required for any command that originated from an end user.

## `command.result`

`command.result` should include enough context to route the response correctly without guessing.

### Shape

```json
{
  "v": 3,
  "type": "command.result",
  "transport": {},
  "origin": {},
  "conversation": {
    "id": "telegram:8431265513",
    "replyTargetId": "telegram:8431265513",
    "threadId": null
  },
  "command": {
    "text": "openclaw devices list",
    "method": "device.pair.list"
  },
  "result": {
    "ok": true,
    "output": "[]",
    "data": []
  }
}
```

## `file.read`, `file.list`, `file.write`, `directory.create`, `file.delete`, and `file.result`

These are BotKeeper control-plane RPCs for browsing and mutating files inside the OpenClaw runtime without shelling out through the command transport.

### `file.read`

```json
{
  "v": 3,
  "type": "file.read",
  "transport": {},
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
```

### `file.list`

```json
{
  "v": 3,
  "type": "file.list",
  "transport": {},
  "origin": {
    "platform": "internal",
    "surface": "internal"
  },
  "file": {
    "operation": "list",
    "path": "/root",
    "encoding": "utf8",
    "includeHidden": true
  }
}
```

### `file.write`

```json
{
  "v": 3,
  "type": "file.write",
  "transport": {},
  "origin": {
    "platform": "internal",
    "surface": "internal"
  },
  "file": {
    "operation": "write",
    "path": "/root/.openclaw/config.json",
    "encoding": "utf8",
    "content": "{ ... }",
    "ensureDirectory": true
  }
}
```

### `directory.create`

```json
{
  "v": 3,
  "type": "directory.create",
  "transport": {},
  "origin": {
    "platform": "internal",
    "surface": "internal"
  },
  "file": {
    "operation": "mkdir",
    "path": "/root/uploads",
    "encoding": "utf8",
    "recursive": true
  }
}
```

### `file.delete`

```json
{
  "v": 3,
  "type": "file.delete",
  "transport": {},
  "origin": {
    "platform": "internal",
    "surface": "internal"
  },
  "file": {
    "operation": "delete",
    "path": "/root/uploads/old.log",
    "encoding": "utf8"
  }
}
```

Rules:

- `file.operation` is one of `read`, `list`, `write`, `mkdir`, or `delete`.
- `file.encoding` currently supports `utf8` and `base64`.
- `file.list` may request `includeHidden = true` to include dotfiles in directory listings.
- `file.write` requires `file.content`.
- `file.write` may request `ensureDirectory = true` so the plugin creates parent directories before writing.
- `directory.create` may request `recursive = true` so parent directories are created automatically.
- `file.delete` deletes either a file or a directory tree at the target path.

### `file.result`

```json
{
  "v": 3,
  "type": "file.result",
  "transport": {},
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
```

Failure responses should set:

- `result.ok = false`
- `result.output` to a human-readable error string
- `result.errorCode` when a stable machine-readable cause is available, such as `FILE_NOT_FOUND`, `ACCESS_DENIED`, `INVALID_PATH`, `INVALID_ENCODING`, or `INVALID_BASE64`

## OpenClaw mapping recommendation

This is the recommended v3 to `MsgContext` mapping inside the Botmax plugin.

| v3 field                                                  | OpenClaw field                           | Notes                                                                |
| --------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| `message.text`                                            | `BodyForAgent`, `RawBody`, `CommandBody` | `Body` should still be a formatted envelope built from this content. |
| `conversation.id`                                         | `From`                                   | Use conversation identity, not sender identity.                      |
| `conversation.replyTargetId ?? conversation.id`           | `To`                                     | Required for reply routing.                                          |
| `origin.accountId`                                        | `AccountId`                              |                                                                      |
| `conversation.kind`                                       | `ChatType`                               | `direct`, `group`, or `channel`.                                     |
| `sender.displayName`                                      | `SenderName`                             | Fallback: `sender.username`, then `sender.id`.                       |
| `sender.id`                                               | `SenderId`                               |                                                                      |
| `sender.username`                                         | `SenderUsername`                         |                                                                      |
| `sender.tag`                                              | `SenderTag`                              |                                                                      |
| `sender.e164`                                             | `SenderE164`                             |                                                                      |
| `origin.platform`                                         | `Provider`                               | Do not use `botmax` here unless the real source is unknown.          |
| `origin.surface ?? origin.platform`                       | `Surface`                                |                                                                      |
| `origin.botUsername`                                      | `BotUsername`                            |                                                                      |
| `message.id`                                              | `MessageSid`                             |                                                                      |
| `message.fullId`                                          | `MessageSidFull`                         |                                                                      |
| `message.replyTo.id`                                      | `ReplyToId`                              |                                                                      |
| `message.replyTo.text`                                    | `ReplyToBody`                            |                                                                      |
| `message.replyTo.senderLabel ?? message.replyTo.senderId` | `ReplyToSender`                          |                                                                      |
| `message.replyTo.isQuote`                                 | `ReplyToIsQuote`                         |                                                                      |
| `message.forwardedFrom.label`                             | `ForwardedFrom`                          |                                                                      |
| `message.forwardedFrom.type`                              | `ForwardedFromType`                      |                                                                      |
| `message.forwardedFrom.username`                          | `ForwardedFromUsername`                  |                                                                      |
| `message.forwardedFrom.title`                             | `ForwardedFromTitle`                     |                                                                      |
| `message.forwardedFrom.chatType`                          | `ForwardedFromChatType`                  |                                                                      |
| `message.forwardedFrom.messageId`                         | `ForwardedFromMessageId`                 |                                                                      |
| `message.forwardedFrom.dateMs`                            | `ForwardedDate`                          |                                                                      |
| `message.createdAtMs`                                     | `Timestamp`                              |                                                                      |
| `message.mentions.botMentioned`                           | `WasMentioned`                           |                                                                      |
| `conversation.threadId`                                   | `MessageThreadId`                        |                                                                      |
| `conversation.threadLabel`                                | `ThreadLabel`                            |                                                                      |
| `conversation.isForum`                                    | `IsForum`                                |                                                                      |
| `conversation.id`                                         | `OriginatingTo`                          | Use the active conversation id, not the sender id.                   |
| `origin.platform`                                         | `OriginatingChannel`                     | Route replies by the real source platform.                           |
| `auth.commandAuthorized ?? false`                         | `CommandAuthorized`                      | Default deny.                                                        |

Recommended label derivation:

- Direct message `ConversationLabel`:
  `sender.displayName ?? sender.username ?? sender.id`
- Group or channel `ConversationLabel`:
  `conversation.threadLabel ?? conversation.channelName ?? conversation.title ?? conversation.id`
- Group `GroupSubject`:
  `conversation.title`
- Channel-like `GroupChannel`:
  `conversation.channelName`
- Workspace, guild, or server label:
  `conversation.spaceName`

Recommended media mapping:

- First attachment:
  `MediaPath`, `MediaUrl`, `MediaType`
- All attachments:
  `MediaPaths`, `MediaUrls`, `MediaTypes`

Attachment precedence:

1. `sharedPath`
2. `fetchUrl` after download by the Botmax plugin
3. `inlineBase64` after materialization by the Botmax plugin

## Trust model

The following should be treated as trusted when produced by BotKeeper:

- `transport.*`
- `origin.*`
- `conversation.id`
- `conversation.replyTargetId`
- `conversation.kind`
- `message.id`
- `message.createdAtMs`
- `auth.*`

The following should be treated as untrusted user content or user-controlled metadata:

- `sender.displayName`
- `sender.username`
- `conversation.title`
- `conversation.channelName`
- `conversation.spaceName`
- `message.text`
- `message.replyTo.text`
- `message.replyTo.senderLabel`
- `message.forwardedFrom.*`
- `attachments[*].caption`
- `attachments[*].transcript`

## Runtime status

Current rollout state:

1. The BotKeeper bridge and the OpenClaw Botmax plugin now exchange strict v3 frames.
2. Legacy v2 payloads are rejected by the current runtime parser.
3. Current runtime code relies on:
   - `conversation.id`
   - `conversation.replyTargetId`
   - `message.id`
   - `message.createdAtMs`
   - explicit `auth.commandAuthorized`
4. Telegram attachment relay is now implemented end-to-end:
   - Telegram -> BotKeeper download
   - BotKeeper -> private R2 upload
   - BotKeeper -> OpenClaw signed `fetchUrl` transport in `attachments[]`
   - OpenClaw inbound attachment materialization into temp files and media-aware context
   - OpenClaw outbound attachment serialization back into v3
   - BotKeeper downstream Telegram media send
5. Current first-rollout guardrails:
   - private R2 bucket
   - signed download URLs with `30 minute` TTL
   - `72 hour` object retention target
   - `20 MB` per-file relay limit
6. Current outbound attachment serialization rules:
   - remote media stays as `fetchUrl`
   - local media is encoded as `inlineBase64`
   - audio replies marked with `audioAsVoice` are emitted with `deliveryHints.sendAs = "voice"`

## Non-goals

This proposal does not define:

- WebSocket authentication.
- BotKeeper media download implementation details.
- OpenClaw-side attachment storage layout.
- A compatibility layer that translates v2 payloads into v3 at runtime.

## Schema notes

The JSON Schema is intended to be the machine-readable companion to this document.

Important limits:

- It validates structure, required fields, and basic type constraints.
- It does not encode the full trust model.
- It does not encode provider-specific delivery constraints such as Telegram media group rules.
- It does not guarantee that `sharedPath` points to a safe filesystem root; that remains a runtime validation responsibility.
