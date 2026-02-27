export interface BotmaxChannelConfig {
  enabled?: boolean;
  name?: string;
  server?: string;
  botId?: string;
  imUserId?: string;
  token?: string;
  textChunkLimit?: number;
  doneToken?: string | null;
  accounts?: Record<string, BotmaxAccountRaw>;
}

export interface BotmaxAccountRaw {
  enabled?: boolean;
  name?: string;
  server?: string;
  botId?: string;
  imUserId?: string;
  token?: string;
  textChunkLimit?: number;
  doneToken?: string | null;
}

export interface ResolvedBotmaxAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  server: string;
  botId: string;
  imUserId: string;
  token: string;
  textChunkLimit: number;
  doneToken: string | null;
}
