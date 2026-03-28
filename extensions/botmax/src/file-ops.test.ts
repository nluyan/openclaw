import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteBotmaxFile, readBotmaxFile, writeBotmaxFile } from "./file-ops.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "botmax-file-ops-"));
  tempDirs.push(dir);
  return dir;
}

describe("botmax file operations", () => {
  it("reads utf8 text files", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "demo.txt");
    await writeFile(filePath, "hello world", "utf8");

    const result = await readBotmaxFile({
      path: filePath,
      encoding: "utf8",
    });

    expect(result).toEqual({
      path: filePath,
      encoding: "utf8",
      content: "hello world",
      sizeBytes: 11,
    });
  });

  it("reads binary files as base64", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "demo.bin");
    const buffer = Buffer.from([0x00, 0x01, 0xff, 0x7f]);
    await writeFile(filePath, buffer);

    const result = await readBotmaxFile({
      path: filePath,
      encoding: "base64",
    });

    expect(result).toEqual({
      path: filePath,
      encoding: "base64",
      content: buffer.toString("base64"),
      sizeBytes: 4,
    });
  });

  it("writes utf8 files and creates parent directories by default", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "nested", "demo.txt");

    const result = await writeBotmaxFile({
      path: filePath,
      content: "hello nested",
      encoding: "utf8",
    });

    expect(result).toEqual({
      path: filePath,
      encoding: "utf8",
      sizeBytes: 12,
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe("hello nested");
  });

  it("rejects invalid base64 writes", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "demo.bin");

    await expect(
      writeBotmaxFile({
        path: filePath,
        content: "!not-base64!",
        encoding: "base64",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_BASE64",
    });
  });

  it("maps missing file reads to FILE_NOT_FOUND", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "missing.txt");

    await expect(
      readBotmaxFile({
        path: filePath,
        encoding: "utf8",
      }),
    ).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
      message: `file not found: ${filePath}`,
    });
  });

  it("deletes files", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "delete-me.txt");
    await writeFile(filePath, "bye", "utf8");

    const result = await deleteBotmaxFile({
      path: filePath,
      encoding: "utf8",
    });

    expect(result).toEqual({
      path: filePath,
      encoding: "utf8",
      sizeBytes: 0,
    });
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
