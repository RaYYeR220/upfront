# Upfront

**French companies stop paying their bills a median of <!-- num:gap.company.median -->144<!-- /num --> days before the official gazette says so.** Upfront tells you how to bill a client before you find out the hard way: Net 30, a deposit, prepayment, or no.

KD Soccer Consulting filed its last accounts for 2019. It stopped paying its debts on 28 March 2025. The gazette published its liquidation on 14 October 2026, 565 days later. Every supplier that sent it an invoice on 30-day terms in between was lending money to a company that had already stopped paying, and the signs were public the whole time.

Upfront is a counterparty check for freelancers, agencies and small suppliers. You type the client (company number, VAT number or name) and the amount. An agent buys the public records it needs, one lookup at a time, applies **your** credit policy, has an independent panel review the decision, and gives you **payment terms**, not a score, with every reason linked to the record that proves it and the receipt for what that record cost.

- **Terms, not a number.** "Net 30 up to €4,000", "30% deposit, balance on delivery", "prepay only", "decline". Ready to paste into the quote.
- **Every reason has a receipt.** Each fact comes from a paid lookup in the public registers (company register, official gazette, filed accounts, commercial courts), paid in USDC on Base through Kite Agent Passport, with its price and transaction.
- **Your policy, compiled.** Write your rules in plain English, or start from a preset. SERV Reasoning compiles them into rules, Upfront tries the rules on ten sample clients before using them, and every check applies the same rules the same way, so each term names the rule that set it.
- **A second opinion on every decision.** An independent evaluation panel (Reppo) reviews each decision against your policy and the facts. If it blocks the decision, the terms get stricter, never looser.
- **It keeps watching.** Clients with open invoices are re-checked for €0.01 a week. You hear from Upfront only when something changes, and if a client enters insolvency you get the deadline to declare your claim and a filled-in declaration.

Try it: **https://upfront-terms.vercel.app** · a real check: [KD Soccer Consulting, €6,800](https://upfront-terms.vercel.app/c/ce94109b-39ca-4e62-b0fb-bb713e0014b7) · reviewer guide: [JUDGES.md](JUDGES.md)

## How a check works

```
resolve → plan → buy → extract → floors → decide → review → terms
```

| Step | Kind | What happens |
|---|---|---|
| resolve | decision | Company number, SIRET or VAT number goes straight through; a name is searched in the register and, if several companies match, you choose. |
| plan | agent (SERV) | Decides which records are worth buying for this amount: a €400 job gets a cheap check, a €20,000 contract a thorough one. Code keeps the essentials and enforces the budget. |
| buy | external (Kite) | Each record is paid through Kite Agent Passport within a session cap of $0.20 per lookup. A lookup over the cap is refused by Kite and shown, never hidden. |
| extract | script | Typed facts with the date each became public: open and past insolvency proceedings, the court-fixed date payments stopped, accounts on file and how late they are, filed results, court decisions. |
| floors | script | Hard rules no policy can go below: an open liquidation means decline, a reorganisation means prepay. |
| decide | compiled policy (SERV) | Your policy, compiled once by SERV into rules, applied to the facts by code in milliseconds. Every reason names the rule that fired and the facts behind it. |
| review | external (Reppo) | An independent panel judges the decision against the policy and the facts. It sees "Company A", never the name or number. |
| terms | script | The terms, as a sentence and as a clause for the invoice. |

Every step is recorded with its input, output, model, cost and duration, so you can open any check and see why it ended where it did.

### Why the policy is compiled

A policy is the business owner's own rules: "a 30% deposit when the accounts are six months late". Asking a model to re-read them for every client makes the same client get different terms on different days, and makes every check slow and paid. Upfront asks SERV once per policy version: it turns the text into typed rules over eleven signals (age, how late the accounts are, never filed, losses, equity, court decisions, past insolvency, invoice size…), with Prompt Guard screening the text the user wrote. Before the rules are used, code tries them on ten sample clients: a rule that asks a healthy, profitable client for a deposit, or one that fires for everybody, goes back to SERV with the reason. Where the rules and a plain reading of the policy still disagree, the policy page says so. Parts of a policy that no signal can express are listed, never silently dropped.

## Evidence

| | |
|---|---|
| Silent gap, companies, 2026 | median <!-- num:gap.company.median -->144<!-- /num --> days over <!-- num:gap.company.n -->43,438<!-- /num --> liquidations and reorganisations; <!-- num:gap.company.over180 -->46%<!-- /num --> longer than six months |
| Backtest, Upfront (freelancer policy v1) | asks a deposit or more from <!-- num:bt.upfront.caught -->53%<!-- /num --> of companies on the day they stopped paying, and from <!-- num:bt.upfront.falseAlarm -->38%<!-- /num --> of their healthy twins |
| Backtest, a credit controller's rule of thumb | <!-- num:bt.rule.caught -->27%<!-- /num --> and <!-- num:bt.rule.falseAlarm -->17%<!-- /num --> |
| Backtest, Net 30 for everyone | 0% and 0%; loses the whole invoice every time |
| Average loss on a €5,000 invoice to a company that stopped paying | Upfront <!-- num:bt.upfront.loss -->€3,453<!-- /num -->, rule <!-- num:bt.rule.loss -->€4,233<!-- /num -->, Net 30 <!-- num:bt.net30.loss -->€5,000<!-- /num --> |

The backtest takes <!-- num:bt.companies -->300<!-- /num --> companies: 150 that went into liquidation or reorganisation and 150 healthy twins matched on legal form, region, sector and age. Each is checked on the day the court says it stopped paying, with only the records that were public that day (every gazette notice and the national register, free open data). The decision is the freelancer policy as SERV compiled it (<!-- num:bt.rules -->10<!-- /num --> rules), so the whole table replays from the stored program without a key: `pnpm --filter @upfront/backtest run`.

Honest reading: the public record is a weak signal on the day payments stop. Late or missing accounts are the only signs more common among the failing companies; age, losses and missing financials are as common among healthy ones (the [evidence page](https://upfront-terms.vercel.app/backtest) lists every sign). Upfront catches almost twice as many failing clients as the rule of thumb, at the price of asking many healthy clients for a deposit, which is why its strict answer is a deposit rather than a refusal.

**Policy revisions.** SERV proposes revisions from the policy's record on <!-- num:tune.train -->180<!-- /num --> of the companies, Reppo reviews each revision, and a revision is kept only if caught-minus-false-alarms improves on those companies; the other <!-- num:tune.holdout -->120<!-- /num --> never decide anything and are reported for every version. So far <!-- num:tune.candidates -->2<!-- /num --> revisions were proposed and none was kept. The one that compiled caught fewer failing companies than it saved in false alarms on the training companies, but did better than the starting policy on the held-out ones; with 60 failing and 60 healthy companies on each side, neither difference is clear of chance. The other did not compile. See [`apps/backtest/results/tuning.json`](apps/backtest/results/tuning.json).

Numbers in this file are rendered from [`apps/backtest/results`](apps/backtest/results) by `pnpm --filter @upfront/backtest render`. None is typed by hand. Proof of live payments and reviews: [PROOF.md](PROOF.md). Every claim and its evidence tier: [CLAIMS.md](CLAIMS.md).

## Run it

```sh
pnpm install
pnpm test

# Replay the backtest from the stored evidence and compiled policy, no key needed
pnpm --filter @upfront/backtest run

# Local app, without keys or money: recorded registry answers and the committed compiled presets
UPFRONT_OFFLINE=1 IP_SALT=dev pnpm --filter @upfront/api dev
NEXT_PUBLIC_API_BASE=http://localhost:8787 pnpm --filter @upfront/web dev
```

Production needs `SERV_API_KEY`, a Kite Agent Passport login for the paying agent, and optionally `REPPO_API_KEY`; see [`deploy/.env.example`](deploy/.env.example).

## For agents

- `GET /v1/check?siren=…&amount=…` returns the terms with reasons and evidence. Pay-per-call over x402: $0.50 in USDC on Base.
- MCP server at `/mcp` with `check_client` and `get_check`.

## Honest limits

- France is covered in depth. Other countries are not yet wired.
- Upfront checks companies, not people. Sole traders are refused before anything is bought.
- On public records alone, the backtest's false-alarm rate is high (<!-- num:bt.upfront.falseAlarm -->38%<!-- /num -->). Your own payment history with a client is the obvious missing signal.
- A compiled policy is only as good as its rules. The policy page shows them, with the sample clients and any disagreement, before you rely on them.
- Reppo's evaluation feed is public, so reviews are redacted: the panel judges the reasoning without knowing who the client is.
- The free demo pays from our own Passport with a daily cap.

## License

MIT
