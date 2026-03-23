import { botmaxPlugin } from "./src/channel.js";
import type { OpenClawPluginApi } from "./src/runtime-api.js";
import { emptyPluginConfigSchema } from "./src/runtime-api.js";
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
