export interface Notifier {
  send(chatId: string, text: string): Promise<void>;
}

/** Telegram Bot API sender. Messages are plain text; links are left to Telegram's auto-linking. */
export function telegramNotifier(token: string, f: typeof fetch = fetch): Notifier {
  return {
    async send(chatId, text) {
      const r = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      if (!r.ok) throw new Error(`telegram sendMessage failed: HTTP ${r.status}`);
    },
  };
}

/** `/start <token>` from a deep link `t.me/<bot>?start=<token>`. */
export function startToken(update: unknown): { chatId: string; token: string } | null {
  const msg = (update as { message?: { text?: string; chat?: { id?: number | string } } })?.message;
  const m = /^\/start\s+([A-Za-z0-9_-]{8,64})$/.exec(msg?.text?.trim() ?? "");
  if (!m || msg?.chat?.id === undefined) return null;
  return { chatId: String(msg.chat.id), token: m[1]! };
}
