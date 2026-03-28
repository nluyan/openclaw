import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BotmaxFileEncoding } from "./message-format.js";

export type BotmaxFileReadResult = {
  path: string;
  encoding: BotmaxFileEncoding;
  content: string;
  sizeBytes: number;
};

export type BotmaxFileWriteResult = {
  path: string;
  encoding: BotmaxFileEncoding;
  sizeBytes: number;
};

export type BotmaxFileDeleteResult = {
  path: string;
  encoding: BotmaxFileEncoding;
  sizeBytes: number;
};

export class BotmaxFileOperationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BotmaxFileOperationError";
    this.code = code;
  }
}

export function normalizeBotmaxFileEncoding(value: string | undefined): BotmaxFileEncoding {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "utf8" || normalized === "utf-8") {
    return "utf8";
  }
  if (normalized === "base64") {
    return "base64";
  }
  throw new BotmaxFileOperationError("INVALID_ENCODING", `unsupported file encoding: ${value}`);
}

export async function readBotmaxFile(params: {
  path: string;
  encoding?: string;
}): Promise<BotmaxFileReadResult> {
  const normalizedPath = requirePath(params.path);
  const encoding = normalizeBotmaxFileEncoding(params.encoding);

  try {
    const buffer = await readFile(normalizedPath);
    return {
      path: normalizedPath,
      encoding,
      content: encodeContent(buffer, encoding),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    throw mapFileOperationError(normalizedPath, error);
  }
}

export async function writeBotmaxFile(params: {
  path: string;
  content: string;
  encoding?: string;
  ensureDirectory?: boolean;
}): Promise<BotmaxFileWriteResult> {
  const normalizedPath = requirePath(params.path);
  const encoding = normalizeBotmaxFileEncoding(params.encoding);

  try {
    if (params.ensureDirectory ?? true) {
      await mkdir(dirname(normalizedPath), { recursive: true });
    }

    const buffer = decodeContent(params.content, encoding);
    await writeFile(normalizedPath, buffer);

    return {
      path: normalizedPath,
      encoding,
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    throw mapFileOperationError(normalizedPath, error);
  }
}

export async function deleteBotmaxFile(params: {
  path: string;
  encoding?: string;
}): Promise<BotmaxFileDeleteResult> {
  const normalizedPath = requirePath(params.path);
  const encoding = normalizeBotmaxFileEncoding(params.encoding);

  try {
    await unlink(normalizedPath);
    return {
      path: normalizedPath,
      encoding,
      sizeBytes: 0,
    };
  } catch (error) {
    throw mapFileOperationError(normalizedPath, error);
  }
}

function requirePath(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new BotmaxFileOperationError("INVALID_PATH", "path is required");
  }
  return normalized;
}

function encodeContent(buffer: Buffer, encoding: BotmaxFileEncoding): string {
  if (encoding === "base64") {
    return buffer.toString("base64");
  }
  return buffer.toString("utf8");
}

function decodeContent(content: string, encoding: BotmaxFileEncoding): Buffer {
  if (encoding === "base64") {
    return decodeBase64(content);
  }
  return Buffer.from(content, "utf8");
}

function decodeBase64(content: string): Buffer {
  const normalized = content.trim();
  if (!normalized) {
    return Buffer.alloc(0);
  }
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new BotmaxFileOperationError("INVALID_BASE64", "content is not valid base64");
  }
  const buffer = Buffer.from(normalized, "base64");
  if (buffer.toString("base64") !== normalized) {
    throw new BotmaxFileOperationError("INVALID_BASE64", "content is not valid base64");
  }
  return buffer;
}

function mapFileOperationError(path: string, error: unknown): BotmaxFileOperationError {
  if (error instanceof BotmaxFileOperationError) {
    return error;
  }

  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;

  if (code === "ENOENT") {
    return new BotmaxFileOperationError("FILE_NOT_FOUND", `file not found: ${path}`);
  }
  if (code === "EACCES" || code === "EPERM") {
    return new BotmaxFileOperationError("ACCESS_DENIED", `access denied: ${path}`);
  }
  if (code === "EISDIR") {
    return new BotmaxFileOperationError("IS_DIRECTORY", `path is a directory: ${path}`);
  }

  return new BotmaxFileOperationError(
    "FILE_OPERATION_FAILED",
    error instanceof Error ? error.message : String(error),
  );
}
