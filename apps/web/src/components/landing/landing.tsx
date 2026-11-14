import type { CSSProperties } from "react";
import Link from "next/link";
import silentGap from "@/data/silent-gap.json";
import { RUNS } from "./hero-runs";
import { LandingRoot } from "./landing-root";
import "./landing.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parseDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}

/** The silent-gap figures shown on the page, all read from the BODACC study (companies only). */
function gapFigures() {
  const c = silentGap.byPersonType.company;
  const from = parseDay(silentGap.window.from);
  const to = parseDay(silentGap.window.to);
  const sameYear = from.y === to.y;
  return {
    median: c.medianDays,
    companies: c.nMeasured.toLocaleString("en-US"),
    over180: `${Math.round(c.shareOver180Days * 100)}%`,
    atCap: `${Math.round(c.shareAtLegalCap * 100)}%`,
    months: sameYear ? `${MONTHS[from.m]} to ${MONTHS[to.m]} ${to.y}` : `${MONTHS[from.m]} ${from.y} to ${MONTHS[to.m]} ${to.y}`,
    span: `${from.d} ${MONTHS[from.m].slice(0, 3)}${sameYear ? "" : ` ${from.y}`} to ${to.d} ${MONTHS[to.m].slice(0, 3)} ${to.y}`,
  };
}

const delay = (d: string) => ({ "--d": d }) as CSSProperties;

const CODE_HTTP = `<span class="k">GET</span> /v1/check?siren=841936560&amp;amount=6800
<span class="c">← </span><span class="r">402 Payment Required</span>  <span class="c">x402 · exact · </span><span class="r">$0.50</span><span class="c"> USDC · Base</span>

<span class="c"># the client pays and retries the same request</span>
<span class="c">← </span><span class="k">200 OK</span>
{
  <span class="k">"company"</span>: { <span class="k">"id"</span>: <span class="s">"841936560"</span>, <span class="k">"name"</span>: <span class="s">"KD SOCCER CONSULTING"</span> },
  <span class="k">"terms"</span>: { <span class="k">"mode"</span>: <span class="r">"decline"</span> },
  <span class="k">"summary"</span>: <span class="s">"Decline: do not extend credit or take the work."</span>,
  <span class="k">"floor"</span>: <span class="s">"decline"</span>,
  <span class="k">"reasons"</span>: [{
    <span class="k">"text"</span>: <span class="s">"An insolvency proceeding is open."</span>,
    <span class="k">"evidence"</span>: [{ <span class="k">"kind"</span>: <span class="s">"proceeding.open"</span>,
                   <span class="k">"source"</span>: <span class="s">"sirenic/alertes"</span>, <span class="k">"paidUsd"</span>: <span class="r">0.01</span> }]
  }],
  <span class="k">"costs"</span>: { <span class="k">"evidenceUsd"</span>: <span class="r">0.035</span> }
}  <span class="c">// trimmed</span>`;

const CODE_MCP = `<span class="c"># streamable HTTP, one server per request</span>
<span class="k">POST</span> /mcp

<span class="c">tools</span>
  <span class="k">check_client</span>  { query, amount_eur, net_days? }
  <span class="c">  SIREN, SIRET, FR VAT number or name → terms, reasons, evidence</span>
  <span class="k">get_check</span>     { check_id }
  <span class="c">  a finished check, with the independent review once it lands</span>`;

function Glyph({ kind }: { kind: "diamond" | "ring" | "rings" | "square" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      {kind === "diamond" && <path className="gl" d="M6 1.2 10.8 6 6 10.8 1.2 6Z" />}
      {(kind === "ring" || kind === "rings") && <circle className="gl" cx="6" cy="6" r="4.6" />}
      {kind === "rings" && <circle className="gl" cx="6" cy="6" r="1.8" />}
      {kind === "square" && <rect className="gl" x="1.8" y="1.8" width="8.4" height="8.4" />}
    </svg>
  );
}

const STEPS: { glyph: "diamond" | "ring" | "rings" | "square"; name: string; kind: string; partner?: boolean; text: string }[] = [
  { glyph: "diamond", name: "resolve", kind: "decision", text: "A company number, SIRET or VAT number goes straight through. A name is searched in the register, and if several companies match, you choose." },
  { glyph: "ring", name: "plan", kind: "agent · SERV", partner: true, text: "Decides which records are worth buying for this amount: a €400 job gets a cheap check, a €20,000 contract a thorough one." },
  { glyph: "rings", name: "buy", kind: "external · Kite", partner: true, text: "Kite Agent Passport pays each record in USDC on Base, capped at $0.20 a lookup. A lookup over the cap is refused and shown, never hidden." },
  { glyph: "square", name: "extract", kind: "script", text: "Typed facts with the date each became public: open and past proceedings, the day payments stopped, accounts on file, court decisions." },
  { glyph: "square", name: "floors", kind: "script", text: "Hard rules the model can never go below: an open liquidation means decline, a reorganisation means prepay." },
  { glyph: "ring", name: "decide", kind: "agent · SERV", partner: true, text: "Your policy, compiled by SERV Reasoning, applied to the facts. Every reason must cite a fact, or the safe default applies." },
  { glyph: "rings", name: "review", kind: "external · Reppo", partner: true, text: 'An independent panel judges the decision against your policy and the facts. It sees "Company A", never the name or number.' },
  { glyph: "square", name: "terms", kind: "script", text: "The terms, as a sentence for you and as a clause for the invoice." },
];

export function Landing() {
  const gap = gapFigures();
  return (
    <LandingRoot>
      <div className="grain" aria-hidden="true" />

      <section className="hero">
        <div className="wrap">
          <h1 className="rv-in" style={delay(".06s")}>
            Know who to bill upfront.
          </h1>
          <p className="sub rv-in" style={delay(".12s")}>
            Upfront buys a client company&apos;s public record a few cents a lookup, applies your own credit policy and hands you
            the terms: Net&nbsp;30, a deposit, prepay or decline.
          </p>
          <div className="ctas rv-in" style={delay(".18s")}>
            <Link className="btn pri" href="/check">
              Check a client
            </Link>
            <Link className="btn ghost" href={`/c/${RUNS.kd.checkId}`}>
              See a real check <span className="arr" aria-hidden="true">&rarr;</span>
            </Link>
          </div>
          <p className="proof rv-in" style={delay(".22s")}>
            <i />
            Evidence paid in USDC on Base · every decision reviewed independently
          </p>
        </div>

        <div className="band">
          <div className="stage fade-in" id="stage">
            <svg
              id="svg"
              role="img"
              aria-label="A client company at the centre. Priced lookups go out to public sources, facts come back and orbit the client, and the payment terms form at the centre. An independent review sits apart."
            />
            <div className="hub" id="hub" aria-live="polite">
              <div className="hname" id="hname">
                KD SOCCER CONSULTING
              </div>
              <div className="hterm" id="hterm" />
              <div className="hcost">
                <span className="roll num" id="spent">
                  $0.000
                </span>
                <span className="of">
                  {" of "}
                  <span className="num" id="budget">
                    $0.30
                  </span>
                </span>
              </div>
            </div>
            <div className="dec" id="dec">
              <div className="l1" id="l1" />
              <div className="l2" id="l2" />
            </div>
            <div className="rcpt" id="rcpt" role="tooltip" />
          </div>
          <div className="runs-row rv-in" style={delay(".34s")}>
            <div className="runs" role="tablist" aria-label="Live checks">
              <span className="lbl">Live checks</span>
              <button className="tab" type="button" role="tab" data-run="kd" aria-selected="true">
                KD SOCCER CONSULTING<span className="m">€6,800</span>
              </button>
              <button className="tab" type="button" role="tab" data-run="danone" aria-selected="false">
                DANONE<span className="m">€4,000</span>
              </button>
            </div>
            <div className="cap">Replayed from live checks on 14 Nov, slowed down · hover a source for its receipt</div>
          </div>
        </div>
      </section>

      {/* the silent gap */}
      <section className="sec first-sec" id="gap">
        <div className="wrap">
          <p className="eyebrow reveal">
            <i />
            The silent gap
          </p>
          <div className="gap-top reveal">
            <div className="big" aria-hidden="true">
              <span className="n">{gap.median}</span>
              <span className="u">days</span>
            </div>
            <div>
              <h2>French companies stop paying a median of {gap.median}&nbsp;days before the gazette says so.</h2>
              <p className="lede">
                From the date a court fixed as the day a company stopped paying, to the day the official gazette (BODACC)
                published its liquidation or reorganisation. <span style={{ color: "var(--ink)" }}>{gap.companies}</span>{" "}
                companies, {gap.months}. <span style={{ color: "var(--ink)" }}>{gap.over180}</span> stayed silent longer than
                six months.
              </p>
            </div>
          </div>
          <div
            className="strip reveal"
            id="strip"
            data-median={gap.median}
            role="img"
            aria-label="One dot per company, placed by how many days passed between stopping payment and the gazette notice. Dense under three months, a long thin tail, and a pile-up at the 18-month legal cap."
          >
            <canvas id="gapc" />
            <div className="mk top" id="mk-med">
              <b>median</b> <span className="r">{gap.median} days</span>
            </div>
            <div className="mk top" id="mk-cap">
              <b>18-month legal cap</b>
              <span className="lng"> · {gap.atCap} sit here, so long gaps are a lower bound</span>
            </div>
            <div className="mk bot" id="mk-kd">
              <b>KD SOCCER CONSULTING</b> · <span className="r">565 days</span>
            </div>
            <div className="mk tail" id="mk-tail" />
          </div>
          <div className="kd reveal">
            <div className="who">
              KD SOCCER CONSULTING<span>Bussy-Saint-Georges · SIREN 841 936 560</span>
            </div>
            <div>
              <p className="line">
                Last accounts filed: 2019. Stopped paying: <em>28 Mar 2025</em>. Gazette: <em>14 Oct 2026</em>.
              </p>
              <p className="note">
                Every supplier that sent it an invoice on 30-day terms in between was lending to a company that had already
                stopped paying, and the signs were public the whole time.
              </p>
              <p className="src-note">
                One dot per company · BODACC open data, opening judgments published {gap.span} that state a stop-payment date.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* how a check works */}
      <section className="sec" id="how">
        <div className="wrap two">
          <div className="reveal">
            <p className="eyebrow">
              <i />
              How a check works
            </p>
            <h2>Eight steps from a company number to the terms.</h2>
            <p className="lede">
              Every step is recorded with its input, output, model, cost and duration, so you can open any check and see why it
              ended where it did.
            </p>
            <ul className="partners">
              <li>
                <b>SERV Reasoning</b> <span className="who">(OpenServ)</span> compiles your policy and decides.
              </li>
              <li>
                <b>Kite Agent Passport</b> pays each lookup within a spending cap.
              </li>
              <li>
                <b>Reppo</b> reviews every decision independently.
              </li>
            </ul>
          </div>
          <ol className="steps reveal">
            {STEPS.map((s, i) => (
              <li className="step" key={s.name}>
                <div className="sh">
                  <Glyph kind={s.glyph} />
                  <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                  <b>{s.name}</b>
                  <span className={s.partner ? "k p" : "k"}>{s.kind}</span>
                </div>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* your policy */}
      <section className="sec" id="policy">
        <div className="wrap two">
          <div className="reveal">
            <p className="eyebrow">
              <i />
              Your policy
            </p>
            <h2>Your credit policy, in plain English.</h2>
            <p className="lede">
              Start from a preset (freelancer, agency, wholesaler) or write your own. SERV Reasoning compiles it into the graph
              that decides every check the same way.
            </p>
            <p className="bigline">
              Change a rule, <span>the terms change.</span>
            </p>
          </div>
          <div className="doc reveal">
            <div className="doc-h">
              <span>
                <b>freelancer</b> · preset · v1
              </span>
              <span>compiled by SERV Reasoning</span>
            </div>
            <ul className="rules">
              <li className="rule">
                <p>
                  <b>Default:</b> Net 30, credit limit equal to the invoice, when the client is active, has traded for 3+ years,
                  has filed recent accounts and has no gazette or court trouble.
                </p>
                <span className="term">Net 30</span>
              </li>
              <li className="rule">
                <p>
                  <b>Ask a 30% deposit when</b> the company is under 2 years old; its latest accounts are 6+ months overdue; a
                  commercial court ruled against it in the last 12 months; the invoice is above 10,000 EUR and nothing is known
                  about its finances.
                </p>
                <span className="term">30% deposit</span>
              </li>
              <li className="rule">
                <p>
                  <b>Ask a 50% deposit when</b> its accounts are 18+ months overdue or were never filed; or its last filed year
                  shows a loss above 20% of revenue, or negative equity.
                </p>
                <span className="term">50% deposit</span>
              </li>
              <li className="rule">
                <p>
                  <b>Prepay only when</b> a past insolvency proceeding ended less than 3 years ago under a continuation plan; or
                  two or more deposit triggers fire together.
                </p>
                <span className="term">Prepay only</span>
              </li>
              <li className="rule fired">
                <p>
                  <b>Decline when</b> the company is in liquidation, has ceased trading, or is sanctioned.
                  <span className="fired-note">Fired for KD SOCCER CONSULTING: open liquidation</span>
                </p>
                <span className="term">Decline</span>
              </li>
            </ul>
            <p className="doc-f">
              Conflicting signals: the most recent dated fact wins, and a hard fact (gazette, court, filing date) beats a soft
              one. Never offer more than 45 days.
            </p>
          </div>
        </div>
      </section>

      {/* keeps watching */}
      <section className="sec" id="watch">
        <div className="wrap two">
          <div className="reveal">
            <p className="eyebrow">
              <i />
              Keeps watching
            </p>
            <h2>Quiet until it isn&apos;t.</h2>
            <p className="lede">
              Clients with an open invoice are re-checked for a cent a week. You hear from Upfront only when something changes,
              and if a client enters insolvency you get the deadline to declare your claim and a filled-in declaration.
            </p>
          </div>
          <div className="wcard pre reveal" id="wcard">
            <div className="w-h">
              <div className="nm">
                MY REGIE CONCEPT<span>Argenteuil</span>
              </div>
              <div className="amt">
                open invoice <span className="num">€2,400</span>
                <br />
                example amount
              </div>
            </div>
            <ul className="wrows">
              {["19 Oct", "26 Oct", "2 Nov"].map((wk) => (
                <li className="wr" key={wk}>
                  <span className="wk">Week of {wk}</span>
                  <span className="st">
                    <i />
                    No change
                  </span>
                  <span className="fee">$0.01</span>
                </li>
              ))}
              <li className="wr turn">
                <span className="wk">Week of 9 Nov</span>
                <span className="st">
                  <i />
                  Liquidation published 12 Nov 2026
                </span>
                <span className="fee">$0.01</span>
                <div className="claim">
                  <p className="cl">
                    Declare your <span className="num">€2,400</span> claim to the liquidator by{" "}
                    <span className="num">12 Jan 2027</span>.
                  </p>
                  <p className="meta">
                    Selarl De Keating (Me Christian Hart De Keating) · Tribunal de Commerce de Pontoise
                  </p>
                  <div className="acts">
                    <a className="p" href="#watch">
                      Draft the declaration &rarr;
                    </a>
                    <a className="q" href="#watch">
                      Stop work
                    </a>
                    <span className="left" id="left" />
                  </div>
                </div>
              </li>
            </ul>
            <p className="w-f">
              It stopped paying on <em>1 Mar 2026</em>. The gazette said so <em>256 days</em> later.
            </p>
          </div>
        </div>
      </section>

      {/* for agents */}
      <section className="sec" id="agents">
        <div className="wrap two">
          <div className="reveal">
            <p className="eyebrow">
              <i />
              For agents
            </p>
            <h2>Agents can ask before they invoice.</h2>
            <p className="lede">
              An agent that sells on credit gets the same answer you do: the terms, the reasons and the evidence behind each one.
            </p>
            <ul className="doors">
              <li>
                <code>GET /v1/check</code> · <span className="p">$0.50</span> a call over x402, in USDC on Base
              </li>
              <li>
                MCP server at <code>/mcp</code> · <code>check_client</code>, <code>get_check</code>
              </li>
            </ul>
          </div>
          <div className="code reveal">
            <div className="code-h" role="tablist" aria-label="Interface">
              <button className="ctab" type="button" role="tab" aria-selected="true" data-c="http">
                HTTP · x402
              </button>
              <button className="ctab" type="button" role="tab" aria-selected="false" data-c="mcp">
                MCP
              </button>
            </div>
            <pre id="c-http" dangerouslySetInnerHTML={{ __html: CODE_HTTP }} />
            <pre id="c-mcp" hidden dangerouslySetInnerHTML={{ __html: CODE_MCP }} />
          </div>
        </div>
      </section>

      {/* closing call to action */}
      <section className="closer">
        <div className="wrap">
          <div className="f-top reveal">
            <h3>Check a client before you send the invoice.</h3>
            <div className="ctas">
              <Link className="btn pri" href="/check">
                Check a client
              </Link>
              <Link className="btn ghost" href={`/c/${RUNS.kd.checkId}`}>
                See a real check <span className="arr" aria-hidden="true">&rarr;</span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </LandingRoot>
  );
}
