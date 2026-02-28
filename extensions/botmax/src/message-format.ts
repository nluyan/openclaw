export type BotmaxInboundMessage = {
  senderId: string;
  body: string;
};

const HEARTBEAT_PING = "<<<ping>>>";
const HEARTBEAT_PONG = "<<<pong>>>";

export function parseBotmaxInboundText(text: string): BotmaxInboundMessage | null {
  const trimmed = text?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === HEARTBEAT_PING || trimmed === HEARTBEAT_PONG) {
    return null;
  }
  if (!trimmed.startsWith("[[[")) {
    return null;
  }
  const endIndex = trimmed.indexOf("]]]");
  if (endIndex <= 2) {
    return null;
  }
  const senderId = trimmed.slice(3, endIndex).trim();
  if (!senderId) {
    return null;
  }
  const body = trimmed.slice(endIndex + 3).trim();
  if (!body) {
    return null;
  }
  return { senderId, body };
}

export function formatBotmaxOutboundText(recipientId: string, text: string): string {
  const normalizedRecipient = recipientId?.trim();
  if (!normalizedRecipient) {
    throw new Error("Botmax recipientId is required");
  }
  return `[[[${normalizedRecipient}]]]${text ?? ""}`;
}
