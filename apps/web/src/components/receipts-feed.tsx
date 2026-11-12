"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { shortHash, sourceOf, usd } from "@/lib/format";
import type { Meta } from "@/lib/types";

type Row = { id: string; check_id: string | null; url: string; amount_usd: number; tx_hash: string | null; network: string; status: string; refusal_code: string | null; paid_at: string };

export function ReceiptsFeed() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    void api.meta().then(setMeta).catch(() => {});
    void api
      .receipts(100)
      .then((r) => setRows(r.receipts as unknown as Row[]))
      .catch(() => {});
  }, []);
  return (
    <div>
      {meta && (
        <div className="grid grid-cols-2 gap-6 border-y border-line py-8 md:grid-cols-4">
          {[
            ["checks run", String(meta.checks)],
            ["lookups paid", String(meta.lookups)],
            ["refused by Passport", String(meta.refusedLookups)],
            ["evidence bought", usd(meta.evidenceUsd)],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="mono text-[36px] font-light tracking-[-0.04em]">{v}</div>
              <div className="text-[13px] text-ink3">{k}</div>
            </div>
          ))}
        </div>
      )}
      <ul className="mt-8 flex flex-col">
        {rows.map((r) => {
          const tx = r.tx_hash && r.network === "eip155:8453" ? `https://basescan.org/tx/${r.tx_hash}` : null;
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line py-2.5 text-[13.5px]">
              <span className="mono w-40 text-[12px] text-ink4">{new Date(r.paid_at).toISOString().slice(0, 16).replace("T", " ")}</span>
              <span className={`w-24 ${r.status === "refused" ? "text-rose2 line-through" : "text-ink2"}`}>{sourceOf(r.url)}</span>
              <span className="mono flex-1 truncate text-[12px] text-ink4">
                {r.status === "refused" ? `refused · ${r.refusal_code}` : tx ? <a href={tx} target="_blank" rel="noreferrer" className="hover:text-ink">{shortHash(r.tx_hash!)} ↗</a> : r.status}
              </span>
              {r.check_id && (
                <a href={`/c/${r.check_id}`} className="text-[12.5px] text-ink3 hover:text-ink">
                  check →
                </a>
              )}
              <span className="mono w-16 text-right">{r.status === "settled" ? usd(r.amount_usd) : "—"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
