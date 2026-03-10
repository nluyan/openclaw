import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setBotmaxRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getBotmaxRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Botmax runtime not initialized - plugin not registered");
  }
  return runtime;
}
