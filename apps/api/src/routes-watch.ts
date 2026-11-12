import type { Client } from "@libsql/client";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { getCheck } from "./repo.ts";
import { type Notifier, startToken } from "./telegram.ts";
import { ipHash } from "./service.ts";
import { createWatch, linkTelegram, runWatches, type WatchDeps, watchByToken, watchEvents } from "./watch.ts";

export interface WatchRoutesCtx {
  db: Client;
  adminToken?: string;
  telegramSecret?: string;
  telegramBotUsername?: string;
  notifier: Notifier | null;
  webUrl: string;
  maxActiveWatches: number;
  maxWatchesPerIp: number;
  salt: string;
  clientIp: (c: Context) => string | null;
  watchDeps: () => WatchDeps;
}

const WatchBody = z.object({
  siren: z.string().regex(/^\d{9}$/).optional(),
  checkId: z.string().uuid().optional(),
  invoiceAmountEur: z.number().int().min(1).max(10_000_000),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  label: z.string().trim().max(80).optional(),
});

export function registerWatchRoutes(app: Hono, ctx: WatchRoutesCtx): void {
  app.post("/api/watch", async (c) => {
    const parsed = WatchBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success || (!parsed.data.siren && !parsed.data.checkId)) return c.json({ error: "invalid_request" }, 400);
    const hash = ipHash(ctx.clientIp(c) ?? "unknown", ctx.salt);
    let siren = parsed.data.siren;
    let label = parsed.data.label;
    if (parsed.data.checkId) {
      const row = await getCheck(ctx.db, parsed.data.checkId);
      if (!row?.result) return c.json({ error: "unknown_check" }, 404);
      siren = row.result.entity.id;
      label = label ?? row.result.entity.name;
    }
    const today = new Date().toISOString().slice(0, 10);
    const w = await createWatch(ctx.db, {
      siren: siren!,
      label,
      invoiceAmountEur: parsed.data.invoiceAmountEur,
      dueOn: parsed.data.dueOn,
      since: today,
      lastCheckId: parsed.data.checkId,
      ipHash: hash,
    }, { maxActive: ctx.maxActiveWatches, maxPerIp: ctx.maxWatchesPerIp });
    if (!w) return c.json({ error: "watch_quota" }, 429);
    return c.json(
      {
        token: w.token,
        watchUrl: `${ctx.webUrl}/watch/${w.token}`,
        telegramLink: ctx.telegramBotUsername ? `https://t.me/${ctx.telegramBotUsername}?start=${w.linkToken}` : null,
      },
      201,
    );
  });

  app.get("/api/watch/:token", async (c) => {
    const w = await watchByToken(ctx.db, c.req.param("token"));
    if (!w) return c.json({ error: "not_found" }, 404);
    const { token: _t, linkToken: _l, telegramChatId, ...rest } = w;
    return c.json({ ...rest, telegramLinked: !!telegramChatId, events: await watchEvents(ctx.db, w.id) });
  });

  app.post("/api/telegram/webhook", async (c) => {
    if (!ctx.telegramSecret || c.req.header("x-telegram-bot-api-secret-token") !== ctx.telegramSecret) {
      return c.json({ error: "forbidden" }, 403);
    }
    const start = startToken(await c.req.json().catch(() => null));
    if (start) {
      const w = await linkTelegram(ctx.db, start.token, start.chatId);
      await ctx.notifier
        ?.send(
          start.chatId,
          w
            ? `Watching ${w.label ?? w.siren} for you. You'll hear from me only if something changes in the official gazette.`
            : "That link was already used or has expired. Add the client again from the check page.",
        )
        .catch(() => {});
    }
    return c.json({ ok: true });
  });

  app.post("/api/watch/run", async (c) => {
    if (!ctx.adminToken || c.req.header("x-admin-token") !== ctx.adminToken) return c.json({ error: "forbidden" }, 403);
    return c.json(await runWatches(ctx.watchDeps()));
  });
}
