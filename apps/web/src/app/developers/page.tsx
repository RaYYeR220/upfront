import { API_BASE } from "@/lib/api";

export const metadata = { title: "For agents · Upfront" };

const sample = `{
  "company": { "jurisdiction": "FR", "id": "841936560", "name": "KD SOCCER CONSULTING" },
  "terms": { "mode": "decline" },
  "summary": "Decline: do not extend credit or take the work.",
  "reasons": [
    {
      "text": "An insolvency proceeding is open.",
      "evidence": [{ "kind": "proceeding.open", "source": "sirenic/alertes", "paidUsd": 0.01, "tx": "0x…" }]
    }
  ],
  "floor": "decline",
  "review": { "status": "pending" },
  "url": "https://…/c/<checkId>"
}`;

export default function Developers() {
  return (
    <div className="wrap py-16 md:py-24">
      <div className="eyebrow">For agents</div>
      <h1 className="display mt-3 max-w-3xl text-[48px] md:text-[72px]">Ask before you invoice.</h1>
      <p className="mt-5 max-w-2xl text-[17px] text-ink2">
        Invoicing agents, marketplaces and anything else that sells on credit can call Upfront before they send the bill:
        one request in, payment terms out, with the evidence and its receipts.
      </p>

      <section className="mt-14 grid gap-6 lg:grid-cols-2">
        <div className="card p-6 md:p-8">
          <div className="eyebrow">Pay per call · x402</div>
          <h2 className="mt-2 text-[24px] font-medium tracking-[-0.02em]">$0.50 per check, in USDC on Base</h2>
          <p className="mt-3 text-[14.5px] text-ink2">
            No account and no key. The first call answers <span className="mono">402</span> with the price; any x402 client
            (including a Kite Agent Passport) pays and retries. A check that fails is never settled, so it is never charged.
          </p>
          <pre className="mono mt-5 overflow-auto rounded-[12px] border border-line bg-black/30 p-4 text-[12.5px] leading-relaxed text-ink2">
{`GET ${API_BASE}/v1/check?siren=841936560&amount=6800&net_days=30

# With Kite Agent Passport
kpass session execute \\
  --url "${API_BASE}/v1/check?siren=841936560&amount=6800" \\
  --idempotency-key $(uuidgen) --output json`}
          </pre>
          <p className="mt-3 text-[12.5px] text-ink4">Invoices up to €20,000. French companies. Sole traders are refused before payment.</p>
        </div>

        <div className="card p-6 md:p-8">
          <div className="eyebrow">MCP</div>
          <h2 className="mt-2 text-[24px] font-medium tracking-[-0.02em]">Two tools for any MCP client</h2>
          <p className="mt-3 text-[14.5px] text-ink2">
            <span className="mono">check_client</span> runs a check (company number, VAT number or name, plus the amount) and
            returns the terms with reasons and evidence. <span className="mono">get_check</span> returns a finished check,
            including the independent review once it lands.
          </p>
          <pre className="mono mt-5 overflow-auto rounded-[12px] border border-line bg-black/30 p-4 text-[12.5px] leading-relaxed text-ink2">
{`# Streamable HTTP
${API_BASE}/mcp

# e.g. in a coding agent
mcp add --transport http upfront ${API_BASE}/mcp`}
          </pre>
          <p className="mt-3 text-[12.5px] text-ink4">Free MCP checks are limited per day across all callers.</p>
        </div>
      </section>

      <section className="mt-6 card p-6 md:p-8">
        <div className="eyebrow">Response</div>
        <pre className="mono mt-4 overflow-auto text-[12.5px] leading-relaxed text-ink2">{sample}</pre>
      </section>
    </div>
  );
}
