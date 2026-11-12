import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type FacilitatorClient, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import type { Client } from "@libsql/client";
import type { Hono } from "hono";
import { z } from "zod";
import type { CheckResult } from "@upfront/engine";
import { getPolicy } from "./repo.ts";
import type { CheckService } from "./service.ts";

export const BASE_MAINNET = "eip155:8453";
export const PIEVERSE_FACILITATOR = "https://facilitator.pieverse.io/v2";
export const CHECK_PRICE = "$0.50";
/** Free MCP checks per day, shared by all MCP callers; the paid endpoint has no such limit. */
export const MCP_DAILY_CHECKS = 25;

export interface AgentRoutesCtx {
  db: Client;
  checks: CheckService;
  payTo: string | null;
  facilitatorUrl?: string;
  webUrl: string;
  /** Turn off the startup handshake with the facilitator (tests). */
  syncFacilitator?: boolean;
  /** Facilitator override (tests); defaults to Pieverse over HTTP. */
  facilitator?: FacilitatorClient;
}

/** What an agent gets back: the terms, the reasons and the receipts, without the internals. */
export function agentView(r: CheckResult, webUrl: string) {
  return {
    checkId: r.checkId,
    company: r.entity,
    terms: r.final,
    summary: r.issue.summary,
    termsText: r.issue.termsText,
    reasons: r.finalReasons.map((x) => ({
      text: x.text,
      evidence: x.factIds.map((id) => {
        const f = r.facts.find((y) => y.id === id);
        const receipt = f?.receiptId ? r.receipts.find((y) => y.id === f.receiptId) : undefined;
        return { fact: id, kind: f?.kind, value: f?.value, date: f?.observedAt, source: f?.source, paidUsd: receipt?.amountUsd, tx: receipt?.txHash };
      }),
    })),
    floor: r.floor.floor,
    review: r.review,
    reviewed: r.reviewed,
    costs: r.costs,
    url: `${webUrl}/c/${r.checkId}`,
  };
}

async function runToEnd(
  checks: CheckService,
  db: Client,
  a: { query: string; amountEur: number; netDays?: number; unlimited: boolean; ip: string | null; quota?: number },
) {
  const policy = await getPolicy(db, "freelancer");
  const started = await checks.start({
    query: a.query,
    amountEur: a.amountEur,
    netDaysRequested: a.netDays,
    policy: policy!,
    ip: a.ip,
    unlimited: a.unlimited,
    quota: a.quota,
  });
  if ("error" in started) return { error: started.error } as const;
  await checks.wait(started.checkId);
  const row = await checks.get(started.checkId);
  return { row } as const;
}

const PaidQuery = z.object({
  siren: z.string().regex(/^\d{9}$/),
  amount: z.coerce.number().int().min(1).max(10_000_000),
  net_days: z.coerce.number().int().min(0).max(120).optional(),
});

/**
 * Two doors for agents: a pay-per-call HTTP endpoint (x402, USDC on Base) and
 * an MCP server. Agents that sell on credit call them before they invoice.
 */
export function registerAgentRoutes(app: Hono, ctx: AgentRoutesCtx): void {
  if (ctx.payTo) {
    // Reject malformed requests before quoting a price: a 402 should only ever be for a valid request.
    app.use("/v1/check", async (c, next) => {
      const q = PaidQuery.safeParse(c.req.query());
      if (!q.success) return c.json({ error: "invalid_request", hint: "GET /v1/check?siren=<9 digits>&amount=<EUR>&net_days=<days>" }, 400);
      await next();
    });
    const server = new x402ResourceServer(ctx.facilitator ?? new HTTPFacilitatorClient({ url: ctx.facilitatorUrl ?? PIEVERSE_FACILITATOR })).register(
      BASE_MAINNET,
      new ExactEvmScheme(),
    );
    app.use(
      paymentMiddleware(
        {
          "GET /v1/check": {
            accepts: [{ scheme: "exact", price: CHECK_PRICE, network: BASE_MAINNET, payTo: ctx.payTo, maxTimeoutSeconds: 300 }],
            description: "Payment terms for a French company: what to ask before extending credit, with the evidence and its receipts.",
            mimeType: "application/json",
          },
        },
        server,
        undefined,
        undefined,
        ctx.syncFacilitator ?? true,
      ),
    );
    app.get("/v1/check", async (c) => {
      const q = PaidQuery.parse(c.req.query());
      const r = await runToEnd(ctx.checks, ctx.db, { query: q.siren, amountEur: q.amount, netDays: q.net_days, unlimited: true, ip: null });
      if ("error" in r) return c.json({ error: r.error }, 503);
      const row = r.row;
      if (!row || row.status !== "done" || !row.result) {
        // A non-2xx answer is never settled: the caller is not charged.
        return c.json({ error: row?.status ?? "failed", candidates: row?.candidates ?? undefined }, row?.status === "not_found" ? 404 : 422);
      }
      return c.json(agentView(row.result, ctx.webUrl));
    });
  }

  const mcp = new McpServer({ name: "upfront", version: "0.1.0" });
  mcp.registerTool(
    "check_client",
    {
      title: "Check a client before extending credit",
      description:
        "Given a French company (SIREN, SIRET, VAT number or name) and the invoice amount, returns the payment terms to offer (net days, deposit, prepay or decline) with the reasons and the evidence behind each one. Free checks are limited per day.",
      inputSchema: {
        query: z.string().min(2).describe("SIREN, SIRET, FR VAT number, or company name"),
        amount_eur: z.number().int().min(1).describe("Invoice amount in EUR"),
        net_days: z.number().int().min(0).max(120).optional().describe("Payment delay you would like to offer"),
      },
    },
    async ({ query, amount_eur, net_days }) => {
      const r = await runToEnd(ctx.checks, ctx.db, { query, amountEur: amount_eur, netDays: net_days, unlimited: false, ip: "mcp", quota: MCP_DAILY_CHECKS });
      if ("error" in r) return { isError: true, content: [{ type: "text", text: `Not available right now (${r.error}).` }] };
      const row = r.row;
      if (row?.status === "needs_choice") {
        return { content: [{ type: "text", text: JSON.stringify({ needsChoice: row.candidates }, null, 2) }] };
      }
      if (!row?.result) return { isError: true, content: [{ type: "text", text: `No result: ${row?.status ?? "unknown"}.` }] };
      return { content: [{ type: "text", text: JSON.stringify(agentView(row.result, ctx.webUrl), null, 2) }] };
    },
  );
  mcp.registerTool(
    "get_check",
    {
      title: "Get a previous check",
      description: "Returns a finished check by id, including the independent review once it has landed.",
      inputSchema: { check_id: z.string().uuid() },
    },
    async ({ check_id }) => {
      const row = await ctx.checks.get(check_id);
      if (!row?.result) return { isError: true, content: [{ type: "text", text: "No finished check with that id." }] };
      return { content: [{ type: "text", text: JSON.stringify(agentView(row.result, ctx.webUrl), null, 2) }] };
    },
  );
  const transport = new StreamableHTTPTransport();
  app.all("/mcp", async (c) => {
    if (!mcp.isConnected()) await mcp.connect(transport);
    return transport.handleRequest(c);
  });
}
