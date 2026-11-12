import type { Client } from "@libsql/client";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Hub } from "./hub.ts";
import { getPolicy, listChecks, listPolicyVersions, listReceipts, meta, savePolicyVersion } from "./repo.ts";
import type { CheckService } from "./service.ts";
import { PRESETS, loadPolicy } from "@upfront/serv";

export interface AppCtx {
  db: Client;
  hub: Hub;
  checks: CheckService;
  adminToken?: string;
  corsOrigins: string[];
  extraRoutes?: (app: Hono) => void;
}

const CheckBody = z.object({
  query: z.string().trim().min(2).max(160),
  amountEur: z.number().int().min(1).max(10_000_000),
  netDaysRequested: z.number().int().min(0).max(120).optional(),
  policyId: z.string().min(1).max(64).default("freelancer"),
  policyVersion: z.number().int().min(1).optional(),
});

const PolicyBody = z.object({ name: z.string().trim().min(1).max(80), text: z.string().trim().min(20).max(4000) });

export function clientIp(h: (name: string) => string | undefined): string | null {
  const fwd = h("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h("x-real-ip") ?? null;
}

export function createApp(ctx: AppCtx): Hono {
  const app = new Hono();
  app.use("/api/*", cors({ origin: ctx.corsOrigins.length ? ctx.corsOrigins : "*" }));

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/checks", async (c) => {
    const parsed = CheckBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    const b = parsed.data;
    const policy = await getPolicy(ctx.db, b.policyId, b.policyVersion);
    if (!policy) return c.json({ error: "unknown_policy" }, 404);
    const unlimited = !!ctx.adminToken && c.req.header("x-admin-token") === ctx.adminToken;
    const r = await ctx.checks.start({
      query: b.query,
      amountEur: b.amountEur,
      netDaysRequested: b.netDaysRequested,
      policy,
      ip: clientIp((n) => c.req.header(n)),
      unlimited,
    });
    if ("error" in r) return c.json(r, r.error === "demo_quota" ? 429 : 503);
    return c.json(r, 202);
  });

  app.get("/api/checks", async (c) => {
    const limit = Math.min(50, Number(c.req.query("limit") ?? 20) || 20);
    return c.json({ checks: await listChecks(ctx.db, limit) });
  });

  app.get("/api/checks/:id", async (c) => {
    const row = await ctx.checks.get(c.req.param("id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(row);
  });

  app.get("/api/checks/:id/stream", async (c) => {
    const id = c.req.param("id");
    const row = await ctx.checks.get(id);
    if (!row) return c.json({ error: "not_found" }, 404);
    return streamSSE(c, async (stream) => {
      if (!ctx.hub.has(id)) {
        // Finished long ago: send the stored outcome and stop.
        await stream.writeSSE({ event: "outcome", data: JSON.stringify({ kind: row.status, result: row.result, candidates: row.candidates }) });
        await stream.writeSSE({ event: "end", data: "{}" });
        return;
      }
      let done = false;
      const queue: { event: string; data: unknown }[] = [];
      let wake: (() => void) | null = null;
      const { backlog, unsubscribe } = ctx.hub.subscribe(id, (e) => {
        queue.push(e);
        wake?.();
      });
      queue.unshift(...backlog);
      stream.onAbort(() => {
        done = true;
        unsubscribe();
        wake?.();
      });
      while (!done) {
        while (queue.length) {
          const e = queue.shift()!;
          await stream.writeSSE({ event: e.event, data: JSON.stringify(e.data) });
          if (e.event === "end") done = true;
        }
        if (done) break;
        await new Promise<void>((res) => {
          wake = res;
          setTimeout(res, 15_000);
        });
        wake = null;
        if (!queue.length) await stream.writeSSE({ event: "ping", data: "{}" });
      }
      unsubscribe();
    });
  });

  app.get("/api/policies", async (c) =>
    c.json({ presets: PRESETS.map((p) => loadPolicy(p)) }),
  );

  app.get("/api/policies/:id", async (c) => {
    const versions = await listPolicyVersions(ctx.db, c.req.param("id"));
    if (!versions.length) return c.json({ error: "not_found" }, 404);
    return c.json({ versions });
  });

  app.post("/api/policies", async (c) => {
    const parsed = PolicyBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const id = `p_${crypto.randomUUID().slice(0, 8)}`;
    return c.json(await savePolicyVersion(ctx.db, id, parsed.data.name, parsed.data.text), 201);
  });

  app.post("/api/policies/:id/versions", async (c) => {
    const id = c.req.param("id");
    if ((PRESETS as readonly string[]).includes(id)) return c.json({ error: "presets_are_read_only" }, 400);
    const prev = await getPolicy(ctx.db, id);
    if (!prev) return c.json({ error: "not_found" }, 404);
    const parsed = PolicyBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    return c.json(await savePolicyVersion(ctx.db, id, parsed.data.name, parsed.data.text), 201);
  });

  app.get("/api/receipts", async (c) => {
    const limit = Math.min(200, Number(c.req.query("limit") ?? 50) || 50);
    return c.json({ receipts: await listReceipts(ctx.db, limit) });
  });

  app.get("/api/meta", async (c) => c.json(await meta(ctx.db)));

  ctx.extraRoutes?.(app);
  return app;
}
