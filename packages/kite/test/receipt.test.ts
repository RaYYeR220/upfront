import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeKite } from "../src/fake.ts";
import { parseExecute, txFromActivity } from "../src/receipt.ts";

const fx = (n: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", `${n}.json`), "utf8"));
const req = { url: "https://api.sirenic.eu/v1/entreprise/552032534", idempotencyKey: "k1" };
const meta = { payer: "house" as const, now: "2026-11-12T16:02:00Z" };

describe("parseExecute", () => {
  it("records a settled session payment with the merchant's response", () => {
    const r = parseExecute(fx("execute-session-success"), 0, req, meta);
    expect(r.httpStatus).toBe(200);
    expect(r.body).toMatchObject({ denomination: "DANONE" });
    expect(r.receipt).toMatchObject({
      merchant: "api.sirenic.eu",
      url: req.url,
      amountUsd: 0.005,
      network: "eip155:8453",
      status: "settled",
      payer: "house",
      txHash: null,
      paidAt: "2026-11-12T16:02:00Z",
    });
  });

  it("reads the amount from the message when the allowance paid", () => {
    expect(parseExecute(fx("execute-allowance-success"), 0, req, meta).receipt).toMatchObject({
      amountUsd: 0.01,
      status: "settled",
    });
  });

  it("turns a Kite refusal into a refused receipt without throwing", () => {
    const r = parseExecute(fx("execute-total-exceeded"), 6, req, meta);
    expect(r.httpStatus).toBeNull();
    expect(r.receipt).toMatchObject({ status: "refused", refusalCode: "session_total_exceeded", amountUsd: 0 });
  });

  it("records a merchant error as failed and unpaid", () => {
    const r = parseExecute(fx("execute-merchant-404"), 0, req, meta);
    expect(r.httpStatus).toBe(404);
    expect(r.receipt).toMatchObject({ status: "failed", amountUsd: 0 });
  });

  it("treats garbage output as a failed lookup", () => {
    expect(parseExecute("not json", 1, req, meta).receipt.status).toBe("failed");
  });
});

describe("txFromActivity", () => {
  it("finds the settlement hash for a paid URL", () => {
    expect(txFromActivity(fx("activity"), req.url, "2026-11-12T16:02:00Z")).toBe(
      "0x7f3c9a1e2b4d5f60718293a4b5c6d7e8f9012345678901234567890abcdef12",
    );
    expect(txFromActivity(fx("activity"), "https://other.example/x", "2026-11-12T16:02:00Z")).toBeNull();
  });
});

describe("FakeKite", () => {
  it("serves scripted responses and refusals with receipts", async () => {
    const kite = new FakeKite({
      [req.url]: { status: 200, body: { ok: true }, priceUsd: 0.005 },
      "https://api.sirenic.eu/v1/entreprise/552032534/alertes": { refuse: "session_total_exceeded" },
    });
    const a = await kite.execute(req, { payer: "house", home: "/tmp" });
    expect(a.receipt).toMatchObject({ status: "settled", amountUsd: 0.005 });
    const b = await kite.execute(
      { url: "https://api.sirenic.eu/v1/entreprise/552032534/alertes", idempotencyKey: "k2" },
      { payer: "house", home: "/tmp" },
    );
    expect(b.receipt).toMatchObject({ status: "refused", refusalCode: "session_total_exceeded" });
    expect(kite.calls).toHaveLength(2);
  });
});
