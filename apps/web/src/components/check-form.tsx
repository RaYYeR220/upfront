"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api, ERROR_TEXT } from "@/lib/api";

const EXAMPLES = [
  { label: "DANONE", query: "552032534", amount: 4000 },
  { label: "KD SOCCER CONSULTING", query: "841936560", amount: 6800 },
];

export function CheckForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [amount, setAmount] = useState("4000");
  const [policy, setPolicy] = useState("freelancer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(q: string, a: number) {
    setBusy(true);
    setError(null);
    try {
      const { checkId } = await api.startCheck({ query: q, amountEur: a, policyId: policy });
      router.push(`/c/${checkId}`);
    } catch (e) {
      setError(e instanceof ApiError ? (ERROR_TEXT[e.code] ?? "Something went wrong. Try again.") : "Can't reach Upfront right now.");
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const a = Number.parseInt(amount.replace(/\D/g, ""), 10);
        if (query.trim().length < 2 || !a) {
          setError("Type a company and an amount.");
          return;
        }
        void start(query.trim(), a);
      }}
    >
      <div className={`flex flex-col gap-3 ${compact ? "" : "md:flex-row"}`}>
        <input
          className="field md:flex-[2]"
          placeholder="Company number, VAT number or name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Client company"
          autoFocus={!compact}
        />
        <div className="relative md:flex-1">
          <span className="pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2 text-ink3">€</span>
          <input
            className="field pl-9"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Invoice amount in euros"
          />
        </div>
        <button type="submit" className="btn btn-rose h-12 justify-center" disabled={busy}>
          {busy ? "Starting…" : "Check a client"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink3">
        <label className="flex items-center gap-2">
          Policy
          <select
            className="rounded-full border border-line2 bg-transparent px-3 py-1 text-ink2 outline-none"
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
          >
            <option value="freelancer">Freelancer or studio</option>
            <option value="agency">Agency with milestones</option>
            <option value="wholesaler">Wholesaler shipping on account</option>
          </select>
        </label>
        <span>Try:</span>
        {EXAMPLES.map((x) => (
          <button
            key={x.query}
            type="button"
            className="underline decoration-line2 underline-offset-4 hover:text-ink"
            onClick={() => {
              setQuery(x.query);
              setAmount(String(x.amount));
              void start(x.query, x.amount);
            }}
            disabled={busy}
          >
            {x.label}
          </button>
        ))}
      </div>
      {error && <p className="text-[13.5px] text-rose2">{error}</p>}
    </form>
  );
}
