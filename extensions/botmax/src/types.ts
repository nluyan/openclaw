export interface BotmaxChannelConfig {
  enabled?: boolean;
  name?: string;
  server?: string;
  textChunkLimit?: number;
  accounts?: Record<string, BotmaxAccountRaw>;
}

export interface BotmaxAccountRaw {
  enabled?: boolean;
  name?: string;
  server?: string;
  textChunkLimit?: number;
}

export interface ResolvedBotmaxAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  server: string;
  textChunkLimit: number;
}
