import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { botmaxPlugin } from "./src/channel.js";
import { setBotmaxRuntime } from "./src/runtime.js";

const plugin = {
  id: "botmax",
  name: "Botmax",
  description: "Botmax channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setBotmaxRuntime(api.runtime);
    api.registerChannel({ plugin: botmaxPlugin });
  },
};

export default plugin;
