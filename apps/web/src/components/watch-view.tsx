"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { eur, fmtDate } from "@/lib/format";

type WatchEvent = { at: string; kind: string; payload: Record<string, any> };
type Watch = {
  siren: string;
  label: string | null;
  invoiceAmountEur: number;
  dueOn: string | null;
  lastCheckedOn: string;
  telegramLinked: boolean;
  events: WatchEvent[];
};

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const end = Date.parse(`${to}T23:59:59+01:00`);
  const s = Math.max(0, Math.floor((end - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (
    <span className="mono">
      {d}d {String(h).padStart(2, "0")}h {String(m).padStart(2, "0")}m {String(s % 60).padStart(2, "0")}s
    </span>
  );
}

export function WatchView({ token }: { token: string }) {
  const [w, setW] = useState<Watch | null>(null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api
      .getWatch(token)
      .then((x) => setW(x as unknown as Watch))
      .catch(() => setMissing(true));
  }, [token]);

  if (missing) return <div className="wrap py-14 text-ink2">This watch doesn't exist.</div>;
  if (!w) return <div className="wrap py-14 text-ink3">Loading…</div>;
  const alert = w.events.find((e) => e.kind === "insolvency");
  const checks = w.events.filter((e) => e.kind === "no_change");

  return (
    <div className="wrap py-14">
      <div className="eyebrow flex items-center gap-2">
        <span className={`dot ${alert ? "" : "dot-live"}`} />
        {alert ? "Something changed" : "Watching"}
      </div>
      <h1 className="mt-2 text-[34px] font-medium tracking-[-0.03em] md:text-[44px]">{w.label ?? w.siren}</h1>
      <div className="mt-1 flex flex-wrap gap-x-4 text-[14px] text-ink3">
        <span className="mono">SIREN {w.siren}</span>
        <span>open invoice <span className="mono text-ink2">{eur(w.invoiceAmountEur)}</span></span>
        {w.dueOn && <span>due {fmtDate(w.dueOn)}</span>}
        <span>last checked {fmtDate(w.lastCheckedOn)}</span>
        <span>{w.telegramLinked ? "Telegram alerts on" : "Telegram alerts off"}</span>
      </div>

      {alert ? (
        <section className="card mt-8 border-rose-b p-6 md:p-8" style={{ borderColor: "var(--rose-b)" }}>
          <div className="text-[14px] text-rose2">
            {String(alert.payload.notice?.category ?? "").includes("liquidation") ? "Liquidation" : "Insolvency proceeding"} published{" "}
            {fmtDate(alert.payload.notice.publishedOn)} · {alert.payload.notice.court}
          </div>
          <h2 className="mt-2 text-[28px] font-medium tracking-[-0.02em] md:text-[36px]">
            Declare your {eur(w.invoiceAmountEur)} claim by {fmtDate(alert.payload.deadline)}.
          </h2>
          <p className="mt-2 text-[15px] text-ink2">
            {alert.payload.representative
              ? `Send it to ${alert.payload.representative.name} (${alert.payload.representative.role}).`
              : "Send it to the court-appointed representative named in the gazette notice."}{" "}
            {alert.payload.notice.cessationDate && `The court dates their payment stop to ${fmtDate(alert.payload.notice.cessationDate)}.`}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <span className="text-[13px] text-ink3">Time left</span>
            <span className="text-[22px] text-ink">
              <Countdown to={alert.payload.deadline} />
            </span>
          </div>
          <details className="mt-6">
            <summary className="cursor-pointer text-[14px] text-ink2 hover:text-ink">Your claim declaration, filled in</summary>
            <pre className="mono mt-3 whitespace-pre-wrap rounded-[12px] border border-line bg-black/30 p-4 text-[12.5px] leading-relaxed text-ink2">
              {alert.payload.draft}
            </pre>
            <button
              type="button"
              className="btn mt-3 h-9 px-4 text-[13px]"
              onClick={() => {
                void navigator.clipboard.writeText(alert.payload.draft);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy the declaration"}
            </button>
          </details>
        </section>
      ) : (
        <p className="mt-8 max-w-2xl text-[16px] text-ink2">
          Nothing has changed. Upfront checks the official gazette for this company every week and will tell you if it does.
        </p>
      )}

      <section className="mt-10">
        <div className="eyebrow mb-3">Weekly checks</div>
        <ul className="flex flex-col">
          {w.events.length === 0 && <li className="text-[14px] text-ink3">The first check runs tomorrow morning.</li>}
          {w.events.map((e) => (
            <li key={`${e.at}-${e.kind}`} className="flex gap-4 border-t border-line py-2 text-[13.5px] text-ink2 first:border-t-0">
              <span className="mono w-28 text-ink4">{fmtDate(e.at)}</span>
              <span className="flex-1">
                {e.kind === "no_change" ? "No change in the gazette" : e.kind === "insolvency" ? "Insolvency proceeding published" : e.kind === "notice" ? "New gazette notice" : e.kind.replace(/_/g, " ")}
              </span>
              {e.kind === "no_change" && <span className="mono text-ink4">€0.01</span>}
            </li>
          ))}
        </ul>
        {checks.length > 0 && <p className="mt-3 text-[12.5px] text-ink4">{checks.length} quiet checks so far.</p>}
      </section>
    </div>
  );
}
