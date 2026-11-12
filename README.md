# Upfront

**French companies stop paying their bills a median of <!-- num:gap.company.median -->144<!-- /num --> days before the official gazette says so.** Upfront tells you how to bill a client before you find out the hard way: Net 30, a deposit, prepayment, or no.

KD Soccer Consulting filed its last accounts for 2019. It stopped paying its debts on 28 March 2025. The gazette published its liquidation on 14 October 2026, 565 days later. Every supplier that sent it an invoice on 30-day terms in between was lending money to a company that had already stopped paying, and the signs were public the whole time.

Upfront is a counterparty check for freelancers, agencies and small suppliers. You type the client (company number, VAT number or name) and the amount. An agent buys the public records it needs, one lookup at a time, applies **your** credit policy, has an independent panel review the decision, and gives you **payment terms**, not a score, with every reason linked to the record that proves it and the receipt for what that record cost.

- **Terms, not a number.** "Net 30 up to €4,000", "30% deposit, balance on delivery", "prepay only", "decline". Ready to paste into the quote.
- **Every reason has a receipt.** Each fact comes from a paid lookup in the public registers (company register, official gazette, filed accounts, commercial courts), paid in USDC on Base through Kite Agent Passport, with its price and transaction.
- **Your policy, compiled.** Write your rules in plain English, or start from a preset (freelancer, agency, wholesaler). SERV Reasoning compiles them into a reasoning graph that decides each check the same way.
- **A second opinion on every decision.** An independent evaluation panel (Reppo) reviews each decision against your policy and the facts. If it disagrees, the terms get stricter, never looser.
- **It keeps watching.** Clients with open invoices are re-checked for €0.01 a week. You hear from Upfront only when something changes, and if a client enters insolvency you get the deadline to declare your claim and a filled-in declaration.

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
| floors | script | Hard rules the model can never go below: an open liquidation means decline, a reorganisation means prepay. |
| decide | agent (SERV) | Your policy, compiled by SERV Reasoning, applied to the facts. Every reason must cite a fact; anything else is rejected and the safe default applies. |
| review | external (Reppo) | An independent panel judges the decision against the policy and the facts. It sees "Company A", never the name or number. |
| terms | script | The terms, as a sentence and as a clause for the invoice. |

Every step is recorded with its input, output, model, cost and duration, so you can open any check and see why it ended where it did.

## Proof

| | |
|---|---|
| Silent gap, companies, 2026 | median <!-- num:gap.company.median -->144<!-- /num --> days over <!-- num:gap.company.n -->43,438<!-- /num --> liquidations and reorganisations; <!-- num:gap.company.over180 -->46%<!-- /num --> longer than six months |
| Backtest | see [`apps/backtest`](apps/backtest) and [JUDGES.md](JUDGES.md) |

Numbers in this file are rendered from [`apps/backtest/results`](apps/backtest/results) by `pnpm --filter @upfront/backtest render`. None is typed by hand.

## Run it

```sh
pnpm install
pnpm test

# Local, without keys or money: recorded registry answers and a fixed decision rule
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
- Reppo's evaluation feed is public, so reviews are redacted: the panel judges the reasoning without knowing who the client is.
- The free demo pays from our own Passport with a daily cap.

## License

MIT
