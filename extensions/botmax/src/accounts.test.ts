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

  it("falls back to default account when an unknown account id is requested in single-account mode", () => {
    vi.stubEnv("BOTMAX_SERVER", "wss://botmax.example/ws");

    const account = resolveAccount(
      {
        channels: {
          botmax: {
            enabled: true,
            server: "wss://botmax.example/ws",
          },
        },
      },
      "657e471d-cd59-4991-b961-9f114aed588b",
    );

    expect(account.accountId).toBe("default");
    expect(account.server).toBe("wss://botmax.example/ws");
  });

  it("falls back to the configured default account when unknown account id is requested", () => {
    const account = resolveAccount(
      {
        channels: {
          botmax: {
            accounts: {
              default: {
                server: "wss://botmax.default/ws",
              },
              work: {
                server: "wss://botmax.work/ws",
              },
            },
          },
        },
      },
      "binding-unknown",
    );

    expect(account.accountId).toBe("default");
    expect(account.server).toBe("wss://botmax.default/ws");
  });

  it("falls back to the only configured account when default account is not present", () => {
    const account = resolveAccount(
      {
        channels: {
          botmax: {
            accounts: {
              primary: {
                server: "wss://botmax.primary/ws",
              },
            },
          },
        },
      },
      "binding-unknown",
    );

    expect(account.accountId).toBe("primary");
    expect(account.server).toBe("wss://botmax.primary/ws");
  });
});
