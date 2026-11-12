"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { evidenceBudgetUsd } from "@upfront/core";
import { api } from "@/lib/api";
import type { CheckView } from "@/lib/check-stream";
import {
  eur,
  factSentence,
  fmtDate,
  NODE_COPY,
  shortHash,
  sourceOf,
  sourceOfFact,
  stricterThanRequested,
  termsDetail,
  termsHeadline,
  txUrl,
  usd,
} from "@/lib/format";
import { NODE_ORDER, type Fact, type NodeName, type Receipt } from "@/lib/types";
import { useCheck } from "@/lib/use-check";

export function LiveCheck({ id }: { id: string }) {
  const view = useCheck(id);
  if (view.status === "needs_choice") return <Choose view={view} />;
  if (["not_found", "cannot_check_individual", "unavailable", "unsupported_jurisdiction", "error"].includes(view.status)) {
    return <Stopped view={view} />;
  }
  return <CheckScreen view={view} />;
}

function CheckScreen({ view }: { view: CheckView }) {
  const r = view.result;
  const factsById = useMemo(() => new Map((r?.facts ?? []).map((f) => [f.id, f])), [r]);
  const receiptsById = useMemo(() => new Map(view.receipts.map((x) => [x.id, x])), [view.receipts]);
  const [open, setOpen] = useState<NodeName | null>(null);
  const [hl, setHl] = useState<string | null>(null);
  const amount = view.amountEur ?? r?.amountEur ?? 0;
  const budget = evidenceBudgetUsd(amount);
  const live = !view.ended;

  return (
    <div className="wrap py-10 md:py-14">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="eyebrow flex items-center gap-2">
            <span className={`dot ${live ? "dot-live" : ""}`} />
            {live ? "Checking live" : r?.asOf ? `Point-in-time check as of ${fmtDate(r.asOf)}` : "Check complete"}
          </div>
          <h1 className="mt-2 text-[34px] font-medium tracking-[-0.03em] md:text-[44px]">
            {r?.entity.name ?? view.query ?? "…"}
          </h1>
          <div className="mt-1 flex flex-wrap gap-x-4 text-[14px] text-ink3">
            {r && <span className="mono">SIREN {r.entity.id.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3")}</span>}
            <span>invoice <span className="mono text-ink2">{eur(amount)}</span></span>
            {r && <span>policy {r.policy.id} v{r.policy.version}</span>}
          </div>
        </div>
      </div>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
        <section className="card p-6 md:p-8">
          <TermsBlock view={view} />
          <div className="mt-8 border-t border-line pt-6">
            <div className="eyebrow mb-3">Why</div>
            {view.finalReasons.length === 0 ? (
              <p className="text-ink3">Collecting evidence…</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {view.finalReasons.map((reason, i) => (
                  <li key={`${i}-${reason.text}`} className="rise text-[15.5px] leading-snug">
                    <span>{reason.text}</span>{" "}
                    <span className="inline-flex flex-wrap gap-1.5 align-middle">
                      {reason.factIds.map((fid) => {
                        const f = factsById.get(fid);
                        const rec = f?.receiptId ? receiptsById.get(f.receiptId) : undefined;
                        return f ? (
                          <FactChip key={fid} fact={f} receipt={rec} active={hl === fid} onHover={setHl} />
                        ) : null;
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ReviewState view={view} />
          {r?.notes.length ? (
            <ul className="mt-6 flex flex-col gap-1.5 text-[13px] text-ink3">
              {r.notes.map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          ) : null}
        </section>

        <div className="flex flex-col gap-6">
          <section className="card p-6">
            <Evidence receipts={view.receipts} spent={view.spentUsd} budget={budget} highlight={hl} factsById={factsById} />
          </section>
          <section className="card p-6">
            <div className="eyebrow mb-3">The check, step by step</div>
            <ol className="flex flex-col">
              {NODE_ORDER.map((name) => {
                const n = view.nodes[name];
                const done = !!n;
                const isOpen = open === name;
                return (
                  <li key={name} className="border-t border-line first:border-t-0">
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 py-2.5 text-left"
                      onClick={() => setOpen(isOpen ? null : name)}
                      disabled={!done}
                    >
                      <NodeGlyph type={n?.type ?? "script"} state={!done ? "wait" : n?.status === "error" ? "error" : n?.status === "skipped" ? "skip" : "ok"} />
                      <span className={`w-20 text-[14px] ${done ? "text-ink" : "text-ink4"}`}>{NODE_COPY[name].title}</span>
                      <span className="flex-1 truncate text-[13px] text-ink3">
                        {NODE_COPY[name].who ? <span className="text-rose2">{NODE_COPY[name].who} · </span> : null}
                        {NODE_COPY[name].what}
                      </span>
                      <span className="mono text-[11.5px] text-ink4">{n ? `${n.ms}ms` : ""}</span>
                    </button>
                    {isOpen && n && (
                      <div className="mb-3 rounded-[10px] border border-line bg-black/30 p-3">
                        <div className="mono mb-2 flex flex-wrap gap-x-4 text-[11.5px] text-ink3">
                          <span>{n.type}</span>
                          <span>{n.status}</span>
                          {n.model && <span>{n.model}</span>}
                          <span>{usd(n.costUsd)}</span>
                        </div>
                        {n.error && <p className="mono mb-2 text-[11.5px] text-rose2">{n.error}</p>}
                        <pre className="mono max-h-56 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-ink2">
                          {JSON.stringify(n.output, null, 1)}
                        </pre>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      </div>

      {r && (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
          <section className="card p-6">
            <FactsList facts={r.facts} receiptsById={receiptsById} highlight={hl} onHover={setHl} />
          </section>
          <section className="card p-6">
            <WatchBox checkId={r.checkId} name={r.entity.name} amount={amount} />
          </section>
        </div>
      )}
    </div>
  );
}

function TermsBlock({ view }: { view: CheckView }) {
  const [copied, setCopied] = useState(false);
  const t = view.final;
  const r = view.result;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3 text-[14px]">
        <span className={t && stricterThanRequested(t) ? "text-ink3 line-through decoration-rose" : "text-ink3"}>Net 30</span>
        <span className="text-ink4">requested</span>
        {r?.floor.floor && <span className="text-rose2">set by a hard rule: {r.floor.because.map((b) => b.rule.replace(/_/g, " ")).join(", ")}</span>}
      </div>
      <div
        key={t ? termsHeadline(t) : "pending"}
        className={`rise mt-2 font-medium tracking-[-0.05em] ${t ? "text-[64px] leading-[0.95] md:text-[88px]" : "text-[48px] text-ink4"} ${t && stricterThanRequested(t) ? "text-ink" : ""}`}
      >
        {t ? termsHeadline(t) : "Checking…"}
      </div>
      {t && <p className="mt-3 text-[16px] text-ink2">{termsDetail(t) ?? r?.issue.summary}</p>}
      {r?.issue.termsText && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <code className="mono max-w-full rounded-[10px] border border-line px-3 py-2 text-[12.5px] text-ink2">{r.issue.termsText}</code>
          <button
            type="button"
            className="btn h-9 px-4 text-[13px]"
            onClick={() => {
              void navigator.clipboard.writeText(r.issue.termsText);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy for the invoice"}
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewState({ view }: { view: CheckView }) {
  const [elapsed, setElapsed] = useState(0);
  const review = view.review;
  const pending = review?.status === "pending";
  useEffect(() => {
    if (!pending) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [pending]);
  if (!view.result) return null;
  let label: React.ReactNode;
  if (!review) label = <span className="text-ink3">Independent review not run for this check</span>;
  else if (review.status === "pending")
    label = (
      <span className="text-ink2">
        Independent review pending <span className="mono text-ink3">0:{String(elapsed).padStart(2, "0")}</span>
      </span>
    );
  else if (review.status === "failed") label = <span className="text-ink3">Independent review unavailable ({review.reason}); terms not reviewed</span>;
  else if (review.route === "block")
    label = (
      <span>
        <span className="text-rose2">Reviewer disagreed · terms tightened one step.</span>{" "}
        <span className="text-ink3">{review.reason}</span>
      </span>
    );
  else
    label = (
      <span>
        <span className="text-ink">Reviewed independently: {review.route === "ship" ? "agrees" : "flags for review"}</span>{" "}
        {typeof review.score === "number" && <span className="mono text-ink3">score {review.score}</span>}
      </span>
    );
  return (
    <div className="mt-6 flex items-center gap-3 border-t border-line pt-5 text-[14px]">
      <span className={`dot ${pending ? "dot-live" : ""}`} style={review?.status === "done" && review.route !== "block" ? { background: "var(--ok)" } : undefined} />
      {label}
      <span className="ml-auto text-[12px] text-ink4">Reppo</span>
    </div>
  );
}

function FactChip({ fact, receipt, active, onHover }: { fact: Fact; receipt?: Receipt; active: boolean; onHover: (id: string | null) => void }) {
  const hard = fact.kind === "proceeding.open" || fact.kind === "sanctions.hit" || fact.kind === "status.ceased_on";
  const url = receipt ? txUrl(receipt) : null;
  return (
    <span
      className={`chip ${hard ? "chip-rose" : ""} ${active ? "border-rose" : ""}`}
      onMouseEnter={() => onHover(fact.id)}
      onMouseLeave={() => onHover(null)}
      title={factSentence(fact)}
    >
      {sourceOfFact(fact)}
      {receipt && <span className="text-ink">{usd(receipt.amountUsd)}</span>}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="underline decoration-line2 underline-offset-2 hover:text-ink">
          {shortHash(receipt!.txHash!)}
        </a>
      ) : receipt ? (
        <span className="text-ink4">settling</span>
      ) : null}
    </span>
  );
}

function Evidence({ receipts, spent, budget, highlight, factsById }: { receipts: Receipt[]; spent: number; budget: number; highlight: string | null; factsById: Map<string, Fact> }) {
  const pct = Math.min(100, (spent / budget) * 100);
  const hlReceipt = highlight ? factsById.get(highlight)?.receiptId : null;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="eyebrow">Evidence bought</div>
        <div className="mono text-[13px]">
          <span className="text-ink">{usd(spent)}</span>
          <span className="text-ink4"> of {usd(budget)}</span>
        </div>
      </div>
      <div className="mt-2 h-px w-full bg-line2">
        <div className="h-px bg-rose transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-ink4">Paid in USDC on Base through Kite Agent Passport · max $0.20 a lookup</p>
      <ul className="mt-4 flex flex-col">
        {receipts.length === 0 && <li className="text-[13.5px] text-ink3">Waiting for the first lookup…</li>}
        {receipts.map((r) => {
          const url = txUrl(r);
          const refused = r.status === "refused";
          const failed = r.status === "failed";
          return (
            <li
              key={r.id}
              className={`rise flex items-center gap-3 border-t border-line py-2 text-[13.5px] first:border-t-0 ${hlReceipt === r.id ? "text-ink" : ""}`}
            >
              <span className={`w-24 ${refused ? "text-rose2 line-through" : "text-ink2"}`}>{sourceOf(r.url)}</span>
              <span className="mono flex-1 truncate text-[11.5px] text-ink4">
                {refused ? `refused by Passport · ${r.refusalCode}` : failed ? `${r.refusalCode ?? "failed"} · not billed` : url ? <a href={url} target="_blank" rel="noreferrer" className="hover:text-ink">{shortHash(r.txHash!)} ↗</a> : "settling…"}
              </span>
              <span className="mono text-[12.5px]">{refused || failed ? "—" : usd(r.amountUsd)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FactsList({ facts, receiptsById, highlight, onHover }: { facts: Fact[]; receiptsById: Map<string, Receipt>; highlight: string | null; onHover: (id: string | null) => void }) {
  const shown = facts.filter((f) => f.kind !== "bodacc.event");
  return (
    <div>
      <div className="eyebrow mb-3">Every fact, with the date it became public</div>
      <ul className="flex flex-col">
        {shown.map((f) => {
          const rec = f.receiptId ? receiptsById.get(f.receiptId) : undefined;
          return (
            <li
              key={f.id}
              onMouseEnter={() => onHover(f.id)}
              onMouseLeave={() => onHover(null)}
              className={`flex items-baseline gap-3 border-t border-line py-2 text-[13.5px] first:border-t-0 ${highlight === f.id ? "text-ink" : "text-ink2"}`}
            >
              <span className="mono w-10 text-[11px] text-ink4">{f.id}</span>
              <span className="flex-1">{factSentence(f)}</span>
              <span className="mono text-[11px] text-ink4">{sourceOfFact(f)}{rec ? ` · ${usd(rec.amountUsd)}` : ""}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WatchBox({ checkId, name, amount }: { checkId: string; name: string; amount: number }) {
  const [due, setDue] = useState("");
  const [state, setState] = useState<{ telegramLink: string | null; watchUrl: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <div className="eyebrow mb-2">Keep watching {name}</div>
      <p className="text-[14px] text-ink2">
        Upfront re-checks the gazette every week for <span className="mono">€0.01</span> and tells you only if something changes,
        including the deadline to declare your claim if they go insolvent.
      </p>
      {state ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {state.telegramLink && (
            <a className="btn btn-rose h-10" href={state.telegramLink} target="_blank" rel="noreferrer">
              Get alerts in Telegram
            </a>
          )}
          <a className="btn h-10" href={state.watchUrl.replace(/^https?:\/\/[^/]+/, "")}>
            Open the watch page
          </a>
        </div>
      ) : (
        <form
          className="mt-4 flex flex-wrap gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              setState(await api.createWatch({ checkId, invoiceAmountEur: amount, dueOn: due || undefined }));
            } catch {
              setErr("Couldn't start the watch. Try again.");
            }
          }}
        >
          <label className="flex items-center gap-2 text-[13px] text-ink3">
            Invoice due
            <input type="date" className="field h-10 w-auto" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <button type="submit" className="btn h-10">
            Watch for {eur(amount)}
          </button>
        </form>
      )}
      {err && <p className="mt-2 text-[13px] text-rose2">{err}</p>}
    </div>
  );
}

function NodeGlyph({ type, state }: { type: string; state: "wait" | "ok" | "error" | "skip" }) {
  const stroke = state === "wait" ? "var(--ink4)" : state === "error" ? "var(--rose)" : state === "skip" ? "var(--ink3)" : "var(--ink)";
  const fill = state === "ok" ? "var(--rose-a)" : "none";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="flex-none">
      {type === "script" && <rect x="2" y="2" width="10" height="10" fill={fill} stroke={stroke} />}
      {type === "decision" && <path d="M7 1.5 12.5 7 7 12.5 1.5 7Z" fill={fill} stroke={stroke} />}
      {type === "agent" && <circle cx="7" cy="7" r="5.5" fill={fill} stroke={stroke} />}
      {type === "external" && (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={stroke} />
          <circle cx="7" cy="7" r="2.5" fill={state === "ok" ? "var(--rose)" : "none"} stroke={stroke} />
        </>
      )}
    </svg>
  );
}

function Choose({ view }: { view: CheckView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="wrap py-14">
      <h1 className="text-[34px] font-medium tracking-[-0.03em]">Which company did you mean?</h1>
      <p className="mt-2 text-ink3">Several companies match “{view.query}”. Upfront doesn't guess: pick the right one.</p>
      <ul className="mt-6 flex max-w-2xl flex-col">
        {(view.candidates ?? []).map((c) => (
          <li key={c.siren} className="border-t border-line">
            <button
              type="button"
              disabled={busy}
              className="flex w-full items-baseline gap-4 py-3 text-left hover:text-rose2"
              onClick={async () => {
                setBusy(true);
                const { checkId } = await api.startCheck({ query: c.siren, amountEur: view.amountEur ?? 1000 });
                router.push(`/c/${checkId}`);
              }}
            >
              <span className="flex-1 text-[16px]">{c.name}</span>
              <span className="text-[13px] text-ink3">{c.city}</span>
              <span className="mono text-[12px] text-ink4">{c.siren}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STOPPED: Record<string, { title: string; text: string }> = {
  not_found: { title: "No such company", text: "Nothing in the French register matches that number or name. Check it and try again." },
  cannot_check_individual: { title: "Upfront checks companies, not people", text: "This is a sole trader. Their records belong to a person, so Upfront stops here and buys nothing." },
  unavailable: { title: "The register didn't answer", text: "The first lookup could not be bought, so nothing else was. Nothing was charged for the failed lookup." },
  unsupported_jurisdiction: { title: "Not covered yet", text: "Upfront covers French companies today." },
  error: { title: "Something went wrong", text: "The check stopped. Try again in a minute." },
};

function Stopped({ view }: { view: CheckView }) {
  const s = STOPPED[view.status] ?? STOPPED.error!;
  return (
    <div className="wrap py-14">
      <div className="eyebrow">{view.query}</div>
      <h1 className="mt-2 text-[34px] font-medium tracking-[-0.03em]">{s.title}</h1>
      <p className="mt-2 max-w-xl text-ink2">{s.text}</p>
      <a href="/check" className="btn mt-6">
        Check another client
      </a>
    </div>
  );
}
