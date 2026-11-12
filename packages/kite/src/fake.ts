import { randomUUID } from "node:crypto";
import type { ExecuteRequest, ExecuteResult, KiteExecutor, PayerRef } from "./types.ts";

export type FakeRoute = { status: number; body: unknown; priceUsd: number } | { refuse: string };

/** Scripted stand-in for Kite Passport, for tests and the offline demo mode. */
export class FakeKite implements KiteExecutor {
  readonly calls: { req: ExecuteRequest; payer: PayerRef }[] = [];
  constructor(
    private routes: Record<string, FakeRoute>,
    private opts: { totalCapUsd?: number } = {},
  ) {}
  private spent = 0;

  async execute(req: ExecuteRequest, payer: PayerRef): Promise<ExecuteResult> {
    this.calls.push({ req, payer });
    const now = new Date().toISOString();
    const base = {
      id: randomUUID(),
      merchant: new URL(req.url).host,
      url: req.url,
      txHash: null,
      network: "eip155:8453",
      paidAt: now,
      payer: payer.payer,
    };
    const route = this.routes[req.url];
    if (!route) {
      return { httpStatus: 404, body: { error: "not_found" }, receipt: { ...base, amountUsd: 0, status: "failed", refusalCode: "http_404" } };
    }
    if ("refuse" in route) {
      return { httpStatus: null, body: null, receipt: { ...base, amountUsd: 0, status: "refused", refusalCode: route.refuse } };
    }
    if (this.opts.totalCapUsd !== undefined && this.spent + route.priceUsd > this.opts.totalCapUsd + 1e-9) {
      return {
        httpStatus: null,
        body: null,
        receipt: { ...base, amountUsd: 0, status: "refused", refusalCode: "session_total_exceeded" },
      };
    }
    if (route.status >= 300) {
      return { httpStatus: route.status, body: route.body, receipt: { ...base, amountUsd: 0, status: "failed", refusalCode: `http_${route.status}` } };
    }
    this.spent += route.priceUsd;
    return {
      httpStatus: route.status,
      body: route.body,
      receipt: { ...base, amountUsd: route.priceUsd, status: "settled", txHash: `0x${"0".repeat(63)}${this.calls.length % 10}` },
    };
  }

  async activity(): Promise<unknown> {
    return { events: [] };
  }
}
