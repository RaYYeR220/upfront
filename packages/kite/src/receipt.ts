import { randomUUID } from "node:crypto";
import type { Receipt } from "@upfront/core";
import type { ExecuteRequest, ExecuteResult } from "./types.ts";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

/** Kite refusals: the budget or scope said no, nothing was paid. */
const REFUSALS = new Set([
  "session_rule_exceeded",
  "session_total_exceeded",
  "session_endpoint_forbidden",
  "recurring_budget_exhausted",
  "allowance_unavailable",
  "allowance_disabled",
  "allowance_too_small",
  "wallet_empty",
  "insufficient_balance",
]);

function amountOf(out: Json): number {
  const req = obj(out.payment_requirement);
  const n = Number.parseFloat(String(req.amount ?? ""));
  if (Number.isFinite(n)) return n;
  const m = /Paid (?:USD|USDC)\s*([\d.]+)/i.exec(String(out.user_message ?? ""));
  return m ? Number.parseFloat(m[1] ?? "0") : 0;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Turns one `kpass session execute --output json` result into the merchant's
 * answer and a receipt. Never throws: a refusal or a broken output is a receipt too.
 */
export function parseExecute(
  raw: unknown,
  exitCode: number,
  req: ExecuteRequest,
  meta: { payer: "house" | "user"; now: string },
): ExecuteResult {
  let out: Json;
  try {
    out = typeof raw === "string" ? obj(JSON.parse(raw)) : obj(raw);
  } catch {
    out = {};
  }
  const base: Receipt = {
    id: randomUUID(),
    merchant: hostOf(req.url),
    url: req.url,
    amountUsd: 0,
    txHash: null,
    network: "unknown",
    paidAt: meta.now,
    payer: meta.payer,
    status: "failed",
  };

  const code = typeof out.error_code === "string" ? out.error_code : null;
  if (code || exitCode !== 0) {
    const details = obj(out.details);
    const outcome = typeof details.outcome === "string" ? details.outcome : null;
    if (code && REFUSALS.has(code)) {
      return { httpStatus: null, body: out, receipt: { ...base, status: "refused", refusalCode: code } };
    }
    if (code === "payment_settled_unfulfilled") {
      return {
        httpStatus: null,
        body: out,
        receipt: { ...base, status: "failed", refusalCode: code, amountUsd: amountOf(out), network: "eip155:8453" },
      };
    }
    return {
      httpStatus: null,
      body: out,
      receipt: { ...base, status: "failed", refusalCode: outcome ?? code ?? `exit_${exitCode}` },
    };
  }

  const x = obj(out.x402);
  const status = typeof x.status_code === "number" ? x.status_code : null;
  const body = x.parsed_response_body ?? x.response_body ?? null;
  const network = typeof x.chain_id === "number" ? `eip155:${x.chain_id}` : "solana";
  if (status !== null && status >= 200 && status < 300) {
    return { httpStatus: status, body, receipt: { ...base, status: "settled", amountUsd: amountOf(out), network } };
  }
  return { httpStatus: status, body, receipt: { ...base, status: "failed", network, refusalCode: `http_${status}` } };
}

/** Finds the on-chain settlement hash of an x402 payment for `url` at or after `since`. */
export function txFromActivity(activity: unknown, url: string, since: string): string | null {
  const events = Array.isArray(obj(activity).events) ? (obj(activity).events as unknown[]) : [];
  for (const e of events) {
    const ev = obj(e);
    if (ev.kind !== "x402_payment") continue;
    if (String(ev.occurred_at ?? "") < since.slice(0, 19)) continue;
    const tx = obj(obj(ev.details).transaction);
    if (obj(tx.x402).request_url === url && typeof tx.tx_hash === "string") return tx.tx_hash;
  }
  return null;
}
