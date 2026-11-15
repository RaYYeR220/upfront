import { termsHeadline } from "@/lib/format";
import type { Terms } from "@/lib/types";

export interface CompiledView {
  compiledBy: string;
  rules: { id: string; why: string; then: { mode: Terms["mode"]; netDays: number | null; depositPct: number | null; creditLimitEur?: number | null } }[];
  untranslated: string[];
  warnings: string[];
  samples: { id: string; label: string; terms: Terms; fired: string[] }[];
}

const asTerms = (t: CompiledView["rules"][number]["then"]): Terms => ({
  mode: t.mode,
  ...(t.netDays != null ? { netDays: t.netDays } : {}),
  ...(t.depositPct != null ? { depositPct: t.depositPct } : {}),
  ...(t.creditLimitEur != null ? { creditLimitEur: t.creditLimitEur } : {}),
});

const tone = (m: Terms["mode"]) => (m === "net" ? "text-ink2" : "text-rose2");

/** A policy as SERV compiled it: the rules code applies, and what they give ten sample clients. */
export function CompiledPolicy({ view, compact = false }: { view: CompiledView; compact?: boolean }) {
  return (
    <div className="text-[13.5px]">
      <div className="eyebrow mb-3">
        Compiled by SERV into {view.rules.length} rules · {view.compiledBy}
      </div>
      <ul className="divide-y divide-line">
        {view.rules.map((r) => (
          <li key={r.id} className="flex items-baseline justify-between gap-4 py-2">
            <span className="text-ink2">{r.why}</span>
            <span className={`mono shrink-0 text-[12px] ${tone(r.then.mode)}`}>{termsHeadline(asTerms(r.then))}</span>
          </li>
        ))}
      </ul>
      {!compact && (
        <>
          <div className="eyebrow mt-6 mb-3">Tried on ten sample clients before use</div>
          <ul className="divide-y divide-line">
            {view.samples.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-4 py-2">
                <span className="text-ink3">{s.label}</span>
                <span className={`mono shrink-0 text-[12px] ${tone(s.terms.mode)}`}>{termsHeadline(s.terms)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {view.untranslated.filter((u) => !/liquidat|ceased|sanction/i.test(u)).length > 0 && (
        <p className="mt-4 text-[12.5px] text-ink3">
          Not turned into rules: {view.untranslated.filter((u) => !/liquidat|ceased|sanction/i.test(u)).join(" · ")}. Liquidation, ceased trading and sanctions are always declined by the
          fixed rules underneath.
        </p>
      )}
      {view.warnings.length > 0 && (
        <div className="mt-4 rounded-[12px] border border-line2 p-3 text-[12.5px] text-ink3">
          <span className="text-ink2">Where the rules and a plain reading of the policy disagree: </span>
          {view.warnings.map((w) => w.replace(/ Fix the rules so they agree with the policy\.$/, "")).join(" ")}
        </div>
      )}
    </div>
  );
}
