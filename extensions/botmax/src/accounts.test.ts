import { describe, expect, it, vi } from "vitest";

vi.mock("./runtime-api.js", () => ({
  DEFAULT_ACCOUNT_ID: "default",
}));

import { resolveAccount } from "./accounts.js";

describe("botmax account resolution", () => {
  it("does not expose a done token even when legacy env is set", () => {
    vi.stubEnv("BOTMAX_SERVER", "wss://botmax.example/ws");
    vi.stubEnv("BOTMAX_TEXT_CHUNK_LIMIT", "4096");
    vi.stubEnv("BOTMAX_DONE_TOKEN", "<<<done>>>");

    const account = resolveAccount({});

    expect(account).toEqual({
      accountId: "default",
      enabled: true,
      name: undefined,
      server: "wss://botmax.example/ws",
      textChunkLimit: 4096,
    });
    expect(Object.hasOwn(account, "doneToken")).toBe(false);
  });
});
