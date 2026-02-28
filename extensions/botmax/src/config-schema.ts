import { z } from "zod";

const wsUrlSchema = z
  .string()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "ws:" || parsed.protocol === "wss:";
    } catch {
      return false;
    }
  }, "URL must use ws:// or wss://");

const BotmaxAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  server: wsUrlSchema.optional(),
  textChunkLimit: z.number().int().positive().optional(),
  doneToken: z.string().nullable().optional(),
});

export const BotmaxConfigSchema = BotmaxAccountSchema.extend({
  accounts: z.record(z.string(), BotmaxAccountSchema.optional()).optional(),
});
