import { afterEach, describe, expect, it, vi } from "vitest";
import { clearBotmaxRuntime, getBotmaxRuntime, setBotmaxRuntime } from "./runtime.js";

const BOTMAX_RUNTIME_STATE_KEY = Symbol.for("botmax.pluginRuntimeState");

afterEach(() => {
  clearBotmaxRuntime();
  delete (globalThis as Record<PropertyKey, unknown>)[BOTMAX_RUNTIME_STATE_KEY];
});

describe("botmax runtime singleton", () => {
  it("stores runtime in a global singleton state", () => {
    const runtime = {
      version: "test",
      config: {
        loadConfig: vi.fn(),
        writeConfigFile: vi.fn(),
      },
    };

    setBotmaxRuntime(runtime as never);

    expect(getBotmaxRuntime()).toBe(runtime);
    expect(
      (globalThis as Record<PropertyKey, unknown>)[BOTMAX_RUNTIME_STATE_KEY],
    ).toMatchObject({
      runtime,
    });
  });

  it("throws when runtime was not initialized", () => {
    expect(() => getBotmaxRuntime()).toThrow(/runtime not initialized/i);
  });
});
