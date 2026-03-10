import { describe, expect, it, vi } from "vitest";
import { executeBotmaxGatewayCommand } from "./command-exec.js";
import { setBotmaxRuntime } from "./runtime.js";
import type { PluginRuntime } from "openclaw/plugin-sdk";

describe("botmax command execution", () => {
  it("maps devices list to gateway method", async () => {
    const callGatewayCli = vi.fn(async () => ({ pending: [] }));
    setBotmaxRuntime({
      system: {
        callGatewayCli,
      },
    } as unknown as PluginRuntime);

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw devices list",
    });

    expect(callGatewayCli).toHaveBeenCalledWith({
      method: "device.pair.list",
      params: {},
      scopes: ["operator.pairing"],
    });
    expect(result.ok).toBe(true);
    expect(result.method).toBe("device.pair.list");
  });

  it("maps devices approve latest", async () => {
    const callGatewayCli = vi.fn(async () => ({ ok: true }));
    setBotmaxRuntime({
      system: {
        callGatewayCli,
      },
    } as unknown as PluginRuntime);

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw devices approve --latest",
      timeoutMs: 5000,
    });

    expect(callGatewayCli).toHaveBeenCalledWith({
      method: "device.pair.approve",
      params: { latest: true },
      timeoutMs: 5000,
      scopes: ["operator.pairing"],
    });
    expect(result.ok).toBe(true);
    expect(result.method).toBe("device.pair.approve");
  });

  it("returns validation error for unsupported command", async () => {
    setBotmaxRuntime({
      system: {
        callGatewayCli: vi.fn(async () => ({})),
      },
    } as unknown as PluginRuntime);

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw foo bar",
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("unsupported openclaw namespace");
  });

  it("maps gateway call with params", async () => {
    const callGatewayCli = vi.fn(async () => ({ ok: true }));
    setBotmaxRuntime({
      system: {
        callGatewayCli,
      },
    } as unknown as PluginRuntime);

    const result = await executeBotmaxGatewayCommand({
      command: 'openclaw gateway call health --params "{\\"foo\\":1}"',
    });

    expect(callGatewayCli).toHaveBeenCalledWith({
      method: "health",
      params: { foo: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.method).toBe("health");
  });
});
