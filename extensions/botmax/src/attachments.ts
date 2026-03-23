import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BotmaxAttachment,
  BotmaxAttachmentKind,
  BotmaxAttachmentSendAs,
  BotmaxInboundAttachment,
  BotmaxOutboundAttachmentInput,
} from "./message-format.js";
import {
  buildMediaPayload,
  buildRandomTempFilePath,
  loadOutboundMediaFromUrl,
  resolveOutboundMediaUrls,
  resolvePreferredOpenClawTmpDir,
  type PluginRuntime,
} from "./runtime-api.js";

const BOTMAX_INLINE_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const BOTMAX_INBOUND_TMP_DIR = path.join(resolvePreferredOpenClawTmpDir(), "botmax-inbound");

type LoadedAttachment = {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeReplyText(payload: unknown): string | undefined {
  return isRecord(payload) ? normalizeNonEmptyString(payload.text) : undefined;
}

function isAudioAsVoice(payload: unknown): boolean {
  return isRecord(payload) && payload.audioAsVoice === true;
}

function resolveMediaSources(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return [];
  }
  return resolveOutboundMediaUrls({
    mediaUrl: typeof payload.mediaUrl === "string" ? payload.mediaUrl : undefined,
    mediaUrls: Array.isArray(payload.mediaUrls)
      ? payload.mediaUrls.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : undefined,
  });
}

function tryParseRemoteUrl(source: string): URL | null {
  try {
    const url = new URL(source);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

function resolveLocalPath(source: string): string {
  if (source.startsWith("file://")) {
    return fileURLToPath(source);
  }
  return source;
}

function sanitizeFileName(fileName: string, fallbackBase: string): string {
  const base = path
    .basename(fileName)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base) {
    return base;
  }
  return `${fallbackBase}.bin`;
}

function buildAttachmentId(index: number, kind: BotmaxAttachmentKind): string {
  return `botmax-attachment-${kind}-${index + 1}`;
}

function mapMimeToAttachmentKind(
  runtime: PluginRuntime,
  mimeType: string | undefined,
): Exclude<BotmaxAttachmentKind, "location"> {
  const mediaKind = runtime.media.mediaKindFromMime(mimeType ?? undefined);
  switch (mediaKind) {
    case "image":
      return "image";
    case "audio":
      return "audio";
    case "video":
      return "video";
    case "document":
    default:
      return "file";
  }
}

function resolveSendAsHint(
  kind: Exclude<BotmaxAttachmentKind, "location">,
  audioAsVoice: boolean,
): BotmaxAttachmentSendAs | undefined {
  if (kind === "audio") {
    return audioAsVoice ? "voice" : "audio";
  }
  if (kind === "image") {
    return "photo";
  }
  if (kind === "video") {
    return "video";
  }
  if (kind === "sticker") {
    return "sticker";
  }
  return "document";
}

async function detectMimeFromSource(
  runtime: PluginRuntime,
  source: string,
  buffer?: Buffer,
): Promise<string | undefined> {
  try {
    return (
      (await runtime.media.detectMime({
        ...(buffer ? { buffer } : {}),
        filePath: source,
      })) ?? undefined
    );
  } catch {
    return undefined;
  }
}

async function loadInboundAttachment(
  attachment: BotmaxInboundAttachment,
  runtime: PluginRuntime,
): Promise<LoadedAttachment | null> {
  if (attachment.kind === "location") {
    return null;
  }

  if (attachment.fetchUrl) {
    const response = await fetch(attachment.fetchUrl);
    if (!response.ok) {
      throw new Error(
        `failed fetching ${attachment.fetchUrl}: ${response.status} ${response.statusText}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType =
      attachment.mimeType ??
      normalizeNonEmptyString(response.headers.get("content-type")?.split(";")[0] ?? undefined);
    const fileName = sanitizeFileName(
      attachment.name ??
        path.basename(new URL(attachment.fetchUrl).pathname) ??
        `${attachment.kind}-${attachment.id}`,
      `${attachment.kind}-${attachment.id}`,
    );
    return { buffer, fileName, mimeType: contentType };
  }

  if (attachment.sharedPath) {
    const sourcePath = resolveLocalPath(attachment.sharedPath);
    const buffer = await readFile(sourcePath);
    const fileName = sanitizeFileName(
      attachment.name ?? path.basename(sourcePath) ?? `${attachment.kind}-${attachment.id}`,
      `${attachment.kind}-${attachment.id}`,
    );
    const mimeType =
      attachment.mimeType ?? (await detectMimeFromSource(runtime, sourcePath, buffer));
    return { buffer, fileName, mimeType };
  }

  if (attachment.inlineBase64) {
    const buffer = Buffer.from(attachment.inlineBase64, "base64");
    const fileName = sanitizeFileName(
      attachment.name ?? `${attachment.kind}-${attachment.id}.bin`,
      `${attachment.kind}-${attachment.id}`,
    );
    const mimeType = attachment.mimeType ?? (await detectMimeFromSource(runtime, fileName, buffer));
    return { buffer, fileName, mimeType };
  }

  return null;
}

export async function materializeInboundAttachments(params: {
  attachments?: BotmaxInboundAttachment[];
  runtime: PluginRuntime;
}): Promise<{
  mediaPayload: ReturnType<typeof buildMediaPayload>;
  transcript?: string;
}> {
  const attachments = params.attachments ?? [];
  if (attachments.length === 0) {
    return {
      mediaPayload: {},
      transcript: undefined,
    };
  }

  await mkdir(BOTMAX_INBOUND_TMP_DIR, { recursive: true });

  const mediaList: Array<{ path: string; contentType?: string }> = [];
  const transcriptParts: string[] = [];

  for (const attachment of attachments) {
    if (attachment.kind !== "location") {
      try {
        const loaded = await loadInboundAttachment(attachment, params.runtime);
        if (loaded) {
          const extension = path.extname(loaded.fileName);
          const tempPath = buildRandomTempFilePath({
            prefix: "openclaw-botmax-inbound",
            extension,
            tmpDir: BOTMAX_INBOUND_TMP_DIR,
          });
          await writeFile(tempPath, loaded.buffer, { mode: 0o600 });
          const mimeType =
            loaded.mimeType ??
            (await detectMimeFromSource(params.runtime, loaded.fileName, loaded.buffer));
          mediaList.push({
            path: tempPath,
            contentType: mimeType ?? undefined,
          });
        }
      } catch (error) {
        params.runtime.logging
          .getChildLogger({ module: "botmax" })
          .warn(`botmax: failed materializing attachment ${attachment.id}: ${String(error)}`);
      }
    }

    const transcript =
      attachment.kind === "location" ? undefined : normalizeNonEmptyString(attachment.transcript);
    if (transcript) {
      transcriptParts.push(transcript);
    }
  }

  return {
    mediaPayload: buildMediaPayload(mediaList, { preserveMediaTypeCardinality: true }),
    transcript: transcriptParts.length > 0 ? transcriptParts.join("\n\n") : undefined,
  };
}

export async function buildOutboundAttachmentsFromReply(params: {
  payload: unknown;
  runtime: PluginRuntime;
  mediaLocalRoots?: readonly string[];
}): Promise<{
  text?: string;
  attachments: BotmaxOutboundAttachmentInput[];
}> {
  const text = normalizeReplyText(params.payload);
  const mediaSources = resolveMediaSources(params.payload);
  const audioAsVoice = isAudioAsVoice(params.payload);
  if (mediaSources.length === 0) {
    return {
      text,
      attachments: [],
    };
  }

  const attachments: BotmaxOutboundAttachmentInput[] = [];

  for (const [index, mediaSource] of mediaSources.entries()) {
    const remoteUrl = tryParseRemoteUrl(mediaSource);
    if (remoteUrl) {
      const mimeType = await detectMimeFromSource(params.runtime, mediaSource);
      const kind = mapMimeToAttachmentKind(params.runtime, mimeType);
      attachments.push({
        id: buildAttachmentId(index, kind),
        kind,
        name: sanitizeFileName(
          path.basename(remoteUrl.pathname) || `${kind}-${index + 1}`,
          `${kind}-${index + 1}`,
        ),
        mimeType,
        fetchUrl: mediaSource,
        deliveryHints: {
          sendAs: resolveSendAsHint(kind, audioAsVoice),
        },
      });
      continue;
    }

    const loaded = await loadOutboundMediaFromUrl(mediaSource, {
      maxBytes: BOTMAX_INLINE_ATTACHMENT_MAX_BYTES,
      mediaLocalRoots: params.mediaLocalRoots,
    });
    const localPath = resolveLocalPath(mediaSource);
    const buffer = loaded.buffer;
    const mimeType =
      loaded.contentType ?? (await detectMimeFromSource(params.runtime, localPath, buffer));
    const kind = mapMimeToAttachmentKind(params.runtime, mimeType);
    attachments.push({
      id: buildAttachmentId(index, kind),
      kind,
      name: sanitizeFileName(loaded.fileName ?? path.basename(localPath), `${kind}-${index + 1}`),
      mimeType,
      sizeBytes: buffer.length,
      inlineBase64: buffer.toString("base64"),
      deliveryHints: {
        sendAs: resolveSendAsHint(kind, audioAsVoice),
      },
    });
  }

  return {
    text,
    attachments,
  };
}
