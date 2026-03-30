import type { PluginRuntime } from "./runtime-api.js";

const BOTMAX_RUNTIME_STATE_KEY: unique symbol = Symbol.for("botmax.pluginRuntimeState");

type BotmaxRuntimeState = {
  runtime: PluginRuntime | null;
};

function resolveBotmaxRuntimeState(): BotmaxRuntimeState {
  const globalScope = globalThis as Record<PropertyKey, unknown>;
  const existing = globalScope[BOTMAX_RUNTIME_STATE_KEY];
  if (existing && typeof existing === "object") {
    return existing as BotmaxRuntimeState;
  }
  const created: BotmaxRuntimeState = { runtime: null };
  globalScope[BOTMAX_RUNTIME_STATE_KEY] = created;
  return created;
}

export function setBotmaxRuntime(next: PluginRuntime): void {
  resolveBotmaxRuntimeState().runtime = next;
}

export function clearBotmaxRuntime(): void {
  resolveBotmaxRuntimeState().runtime = null;
}

export function getBotmaxRuntime(): PluginRuntime {
  const runtime = resolveBotmaxRuntimeState().runtime;
  if (!runtime) {
    throw new Error("Botmax runtime not initialized - plugin not registered");
  }
  return runtime;
}
