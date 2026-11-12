import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const metadata = { title: "Evidence · Upfront" };

type Json = Record<string, any>;
function load(name: string): Json | null {
  const file = join(process.cwd(), "src/data", name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Json) : null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const int = (x: number) => new Intl.NumberFormat("en-US").format(x);
const eur = (x: number) => `€${int(Math.round(x))}`;

const ARM_LABEL: Record<string, string> = {
  net30: "Net 30 for everyone (what most freelancers do)",
  rule: "A credit controller's rule of thumb",
  raw: "The same model and policy, without SERV",
  upfront: "Upfront",
};

export default function Evidence() {
  const gap = load("silent-gap.json");
  const bt = load("backtest.json");
  const tuning = load("tuning.json");
  const reviews = load("reppo-sample.json");
  const c = gap?.byPersonType?.company;

  return (
    <div className="wrap py-16 md:py-24">
      <div className="eyebrow">Evidence</div>
      <h1 className="display mt-3 max-w-4xl text-[48px] md:text-[72px]">The bills keep coming after the money stops.</h1>

      {c && (
        <section className="mt-14 grid gap-10 border-t border-line pt-10 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <div className="mono text-[96px] font-light leading-none tracking-[-0.06em] text-rose md:text-[140px]">{c.medianDays}</div>
            <div className="mt-2 text-[18px] text-ink2">days, median</div>
          </div>
          <div className="text-[16px] leading-relaxed text-ink2">
            <p>
              When a French company goes into liquidation or reorganisation, the court fixes the day it actually stopped
              paying its debts. We read that date in every opening judgment published in the official gazette (BODACC)
              between {gap.window.from} and {gap.window.to}: <span className="text-ink">{int(c.nMeasured)} companies</span>.
            </p>
            <p className="mt-4">
              The median company had stopped paying <span className="text-ink">{c.medianDays} days</span> before the gazette said
              so. <span className="text-ink">{pct(c.shareOver180Days)}</span> were silent for more than six months. The delay is
              before the court, not after it: a judgment reaches the gazette in a median of {gap.quality?.medianPublicationLagDays}{" "}
              days.
            </p>
            <p className="mt-4 text-[14px] text-ink3">
              French law lets a court date the cessation of payments at most 18 months before the judgment, so for{" "}
              {pct(c.shareAtLegalCap)} of companies the real gap is longer than measured. Reproduce:{" "}
              <span className="mono">pnpm --filter @upfront/backtest gap</span>.
            </p>
          </div>
        </section>
      )}

      <section className="mt-16 border-t border-line pt-10">
        <div className="eyebrow">Backtest</div>
        <h2 className="mt-2 max-w-3xl text-[28px] font-medium tracking-[-0.02em]">
          On the day each company stopped paying, what would you have been told?
        </h2>
        <p className="mt-3 max-w-3xl text-[15px] text-ink2">
          150 companies that later went insolvent and 150 healthy companies matched on legal form, region, sector and age, all
          checked on the same dates with only the records that were public on that day. The invoice is €5,000 on 30-day terms.
        </p>
        {bt ? (
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[14.5px]">
              <thead className="text-[12.5px] text-ink3">
                <tr className="border-b border-line">
                  <th className="py-3 font-normal">How you decide</th>
                  <th className="py-3 font-normal">Failing companies asked for a deposit or more</th>
                  <th className="py-3 font-normal">Healthy companies asked the same</th>
                  <th className="py-3 font-normal">Average loss per €5,000 invoice to a failing company</th>
                </tr>
              </thead>
              <tbody>
                {(["net30", "rule", "raw", "upfront"] as const)
                  .filter((a) => bt.metrics[a]?.nFailing)
                  .map((a) => {
                    const m = bt.metrics[a];
                    return (
                      <tr key={a} className={`border-b border-line ${a === "upfront" ? "text-ink" : "text-ink2"}`}>
                        <td className="py-3">{ARM_LABEL[a]}</td>
                        <td className={`mono py-3 ${a === "upfront" ? "text-rose" : ""}`}>{pct(m.caughtFailing)}</td>
                        <td className="mono py-3">{pct(m.falseAlarmControls)}</td>
                        <td className="mono py-3">{eur(m.avgLossPerInvoiceEur)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <p className="mt-3 text-[12.5px] text-ink4">
              {int(bt.counts.companies)} companies checked, {bt.counts.unavailable} not available in the register. Evidence bought
              for the whole backtest: ${bt.costs.evidenceUsd.toFixed(2)} in USDC through Kite Agent Passport.
            </p>
          </div>
        ) : (
          <p className="mt-8 text-[14px] text-ink3">The backtest is running; the table appears here when it completes.</p>
        )}
      </section>

      {tuning && (
        <section className="mt-16 border-t border-line pt-10">
          <div className="eyebrow">Feedback that changes the policy</div>
          <h2 className="mt-2 max-w-3xl text-[28px] font-medium tracking-[-0.02em]">
            Mistakes and independent reviews rewrite the policy. A revision stays only if it does better on companies it never saw.
          </h2>
          <ol className="mt-8 flex flex-col">
            {tuning.history.map((h: Json) => (
              <li key={h.version} className="grid gap-2 border-t border-line py-4 md:grid-cols-[80px_1fr_220px]">
                <span className="mono text-ink3">v{h.version}</span>
                <span className="text-[14.5px] text-ink2">{h.rationale}</span>
                <span className={`mono text-[13px] ${h.accepted ? "text-ink" : "text-ink4 line-through"}`}>
                  caught {pct(h.holdout.caughtFailing)} · false alarms {pct(h.holdout.falseAlarmControls)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {reviews && (
        <section className="mt-16 border-t border-line pt-10">
          <div className="eyebrow">Independent review</div>
          <p className="mt-3 max-w-3xl text-[16px] text-ink2">
            Reppo's panel reviewed {reviews.completed} decisions without knowing which company they were about: it agreed with{" "}
            <span className="text-ink">{pct(reviews.routes.ship)}</span>, flagged {pct(reviews.routes.review)} and blocked{" "}
            {pct(reviews.routes.block)}. A review takes a median of {reviews.medianSeconds} seconds.
          </p>
        </section>
      )}
    </div>
  );
}
