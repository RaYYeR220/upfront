# Review Upfront in five minutes

Upfront tells a freelancer or small supplier how to bill a client company: Net 30, a deposit, prepayment or decline. An agent buys the client's public records one lookup at a time (paid through Kite Agent Passport), applies the user's own credit policy (compiled by SERV Reasoning), and has the decision reviewed by an independent panel (Reppo).

## 1. Watch a real check (1 minute)

Open **https://upfront-terms.vercel.app**. The hero replays two production checks from 15 Nov. Hover a source to see its price and Base transaction.

Then open the full record of one of them: **[KD Soccer Consulting, €6,800](https://upfront-terms.vercel.app/c/ce94109b-39ca-4e62-b0fb-bb713e0014b7)**. It shows the terms (Decline), the reason and the fact it cites, six paid lookups with their transactions, the independent review (score 100, ship), and "The check, step by step": every step's input, output, model, cost and time.

## 2. Run your own (2 minutes)

Go to **[/check](https://upfront-terms.vercel.app/check)** and type a French company number (SIREN) or name and an invoice amount. Try `552032534` (Danone) or `841936560` (KD Soccer Consulting), or any French company. The steps stream as they run: the plan chooses what to buy for the amount, Kite pays each lookup in USDC on Base, the compiled policy decides in milliseconds, and the review lands about a minute later. Free checks are limited to three a day per visitor and paid from our own Passport.

## 3. See the policy as SERV compiled it (1 minute)

Open **[/policy](https://upfront-terms.vercel.app/policy)**. Next to the freelancer policy in plain English are the ten rules SERV compiled from it, what they give ten sample clients, and the two places where the rules and a plain reading of the text disagree. Writing your own policy saves it and compiles it the same way.

## 4. The evidence (1 minute)

Open **[/backtest](https://upfront-terms.vercel.app/backtest)**:

- French companies stop paying a median of <!-- num:gap.company.median -->144<!-- /num --> days before the gazette publishes their insolvency (<!-- num:gap.company.n -->43,438<!-- /num --> companies in 2026).
- On the day they stopped paying, the freelancer policy asks a deposit or more from <!-- num:bt.upfront.caught -->58%<!-- /num --> of 150 failing companies and <!-- num:bt.upfront.falseAlarm -->41%<!-- /num --> of their healthy twins; a rule of thumb, <!-- num:bt.rule.caught -->27%<!-- /num --> and <!-- num:bt.rule.falseAlarm -->17%<!-- /num -->.
- Which public signs separate the two groups at all (only late or missing accounts do).
- Every policy revision SERV proposed, Reppo's review of it, and why it was not kept.

## Check it yourself

- [PROOF.md](PROOF.md): every payment as a Basescan link, the review ids, the compiled policy file.
- [CLAIMS.md](CLAIMS.md): every public claim with its evidence tier and the command that reproduces it, plus what we do not claim.
- `pnpm install && pnpm test`: the test suite (rules, compiled policies, payments, review packets, the check pipeline, the API).
- `pnpm --filter @upfront/backtest run`: replays the whole backtest from the stored evidence and the stored compiled policy, without any key.
- [FEEDBACK.md](FEEDBACK.md): what we measured about SERV, Kite and Reppo while building, including costs and the bugs we hit.

## What each partner does

| Partner | Its job in Upfront | Where to see it |
|---|---|---|
| SERV Reasoning | Compiles each policy into rules (with Prompt Guard on the user's text); plans which records to buy for the amount; picks between companies with similar names; proposes policy revisions from the backtest record | /policy, the "Plan" and "Decide" steps of any check, `packages/serv` |
| Kite Agent Passport | Pays every lookup in USDC on Base from a session scoped to one data provider, capped per lookup and in total; a refused lookup is shown as a receipt | receipts on any check, [PROOF.md](PROOF.md), `packages/kite` |
| Reppo | Reviews every decision without seeing who the client is; a block makes the terms stricter; reviews each proposed policy revision before it is measured | the review line on any check, `packages/reppo`, `apps/backtest/results/tuning.json` |

## For agents

- `GET https://45-77-62-228.sslip.io/v1/check?siren=…&amount=…` returns the terms with reasons and evidence, paid per call over x402 ($0.50 in USDC on Base).
- MCP server at `https://45-77-62-228.sslip.io/mcp` with `check_client` and `get_check`.
