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
  upfront: "Upfront, freelancer policy v1",
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
                  <th className="py-3 font-normal">Caught minus false alarms</th>
                  <th className="py-3 font-normal">Average loss per €5,000 invoice to a failing company</th>
                </tr>
              </thead>
              <tbody>
                {(["net30", "rule", "upfront"] as const)
                  .filter((a) => bt.metrics[a]?.nFailing)
                  .map((a) => {
                    const m = bt.metrics[a];
                    return (
                      <tr key={a} className={`border-b border-line ${a === "upfront" ? "text-ink" : "text-ink2"}`}>
                        <td className="py-3">{ARM_LABEL[a]}</td>
                        <td className={`mono py-3 ${a === "upfront" ? "text-rose" : ""}`}>{pct(m.caughtFailing)}</td>
                        <td className="mono py-3">{pct(m.falseAlarmControls)}</td>
                        <td className="mono py-3">{(m.caughtFailing - m.falseAlarmControls).toFixed(2)}</td>
                        <td className="mono py-3">{eur(m.avgLossPerInvoiceEur)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <p className="mt-3 max-w-3xl text-[12.5px] text-ink4">
              {int(bt.counts.companies)} companies, {bt.counts.unavailable} not found. Evidence: every gazette notice and the national
              register, free public data, cut to what was public on the day. Decisions: the freelancer policy as SERV compiled it (
              {bt.setup.program.rules} rules), applied by code, so the table replays exactly with{" "}
              <span className="mono">pnpm --filter @upfront/backtest run</span> and no key.
            </p>
          </div>
        ) : (
          <p className="mt-8 text-[14px] text-ink3">The backtest is running; the table appears here when it completes.</p>
        )}
      </section>

      {bt?.signs && (
        <section className="mt-16 border-t border-line pt-10">
          <div className="eyebrow">What the public record can tell you</div>
          <h2 className="mt-2 max-w-3xl text-[28px] font-medium tracking-[-0.02em]">
            On the day they stop paying, only one kind of sign sets failing companies apart: late accounts.
          </h2>
          <p className="mt-3 max-w-3xl text-[15px] text-ink2">
            Each sign on its own, among the 150 companies that stopped paying and their 150 healthy twins. Age, losses and missing
            financials are as common in healthy companies. That is why no policy built on public records alone can catch every
            failure without flagging good clients, and why the terms are a deposit, not a refusal.
          </p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead className="text-[12.5px] text-ink3">
                <tr className="border-b border-line">
                  <th className="py-2 font-normal">Sign</th>
                  <th className="py-2 font-normal">Stopped paying</th>
                  <th className="py-2 font-normal">Kept paying</th>
                </tr>
              </thead>
              <tbody>
                {bt.signs
                  .filter((x: Json) => x.failing + x.controls > 0)
                  .map((x: Json) => (
                    <tr key={x.sign} className={`border-b border-line ${x.separation >= 0.06 ? "text-ink" : "text-ink3"}`}>
                      <td className="py-2">{x.sign}</td>
                      <td className={`mono py-2 ${x.separation >= 0.06 ? "text-rose" : ""}`}>{x.failing}</td>
                      <td className="mono py-2">{x.controls}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tuning && (
        <section className="mt-16 border-t border-line pt-10">
          <div className="eyebrow">Feedback that changes the policy</div>
          <h2 className="mt-2 max-w-3xl text-[28px] font-medium tracking-[-0.02em]">
            SERV proposes a revision from the policy's record, Reppo reviews it, and it stays only if it does better.
          </h2>
          <p className="mt-3 max-w-3xl text-[15px] text-ink2">
            The record is {tuning.split.train} of the companies; the other {tuning.split.holdout} never influence a decision and
            are shown for every version. No revision has been kept so far. The one that was measured did worse than the starting
            policy on the training companies and better on the held-out ones; with 60 failing and 60 healthy companies on each side,
            neither difference is clear of chance, which is why the rule decides on one half and only reports the other.
          </p>
          <ol className="mt-8 flex flex-col">
            {tuning.history.map((h: Json) => (
              <li key={h.version} className="grid gap-2 border-t border-line py-4 md:grid-cols-[60px_1fr_260px]">
                <span className="mono text-ink3">v{h.version}</span>
                <span className="text-[14.5px] text-ink2">
                  {h.rationale}
                  <span className="mt-1 block text-[12.5px] text-ink4">
                    {h.review ? `Reppo ${h.review.score}/100, ${h.review.route}. ` : ""}
                    {h.why === "baseline" ? "Starting policy." : h.why}
                  </span>
                </span>
                <span className={`mono text-[13px] ${h.accepted ? "text-ink" : "text-ink4"}`}>
                  {h.train
                    ? `held out: caught ${pct(h.holdout.caughtFailing)} · false alarms ${pct(h.holdout.falseAlarmControls)}`
                    : "not measured"}
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
