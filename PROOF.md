# Proof

Every claim here links to something you can open: a live check, a transaction on Base, or a file in this repository with the script that produces it.

## Live

- App: https://upfront-terms.vercel.app
- API: https://45-77-62-228.sslip.io/api/health
- Telegram bot for watch alerts: [@upfrontservbot](https://t.me/upfrontservbot)

## Two production checks, end to end

Both ran on 14 Nov 2026 against the live API. Each lookup was paid through Kite Agent Passport in USDC on Base; SERV Reasoning applied the freelancer policy; Reppo reviewed the decision.

### KD SOCCER CONSULTING (841936560), €6,800 invoice → Decline

Open the check: https://upfront-terms.vercel.app/c/80685737-d132-4ffd-8b45-5e83c6e7ba6f

| Lookup | Price | Base transaction |
|---|---|---|
| Company register profile | $0.005 | [0xc5be…eb604](https://basescan.org/tx/0xc5be567a037660f1a3bd897649e937f8858448afd192be6157635ed7014eb604) |
| Financial statements | $0.01 | [0xe271…64ad](https://basescan.org/tx/0xe2716c712d7c1f9d83d15231cd9a84df3738b32b7c09d343220e581c571064ad) |
| Gazette insolvency alerts | $0.01 | [0x0a57…e11c](https://basescan.org/tx/0x0a57b8b71bfd6b1fe548149205caccf6ad507cb583f2d5f5d8a71de84b02e11c) |

- The gazette shows a liquidation opened on 28 Sep 2026, published 14 Oct 2026, with payments stopped since 28 Mar 2025. The floor ("open liquidation means decline") set the terms; the policy agreed.
- Reppo evaluation `cmwgm2owl000008jj0h34kbk7`: score 100, route `ship`.
- Evidence $0.025. Decision step 5.3 s.

### DANONE (552032534), €4,000 invoice → Net 30 up to €4,000

Open the check: https://upfront-terms.vercel.app/c/b3bbbf38-7748-4313-b8f0-ea4ce0ce460b

| Lookup | Price | Base transaction |
|---|---|---|
| Company register profile | $0.005 | [0x2d9c…dcb7](https://basescan.org/tx/0x2d9cc1e51e269dd1a9656d2995f43d94ca176fa44606de7152739534513adcb7) |
| Gazette insolvency alerts | $0.01 | [0x3766…caca](https://basescan.org/tx/0x37660e7ed2b925d6a30f168db078c31cf0893ca14f1c7a3844973bd27906caca) |
| Financial statements | $0.01 | [0x06ab…bc9c](https://basescan.org/tx/0x06ab67b29725ff6d094c25d1d93a6fff4e3dca27d4c5137964c354d92b80bc9c) |

- No gazette notices and seven years of filed results. Every reason cites the fact it rests on.
- Reppo evaluation `cmwgmdihu000008jjdjz7ancx`: score 100, route `review` (the panel agreed with the decision at medium confidence).

Each transaction is a USDC transfer on Base (`0x8335…2913`) to the data provider's address `0x76a6…c8a2`, confirmed in blocks 57,413,980 to 57,416,424 (14 Nov 2026, 16:19–16:27 UTC). The first payment from the same agent, [0x7d65…ad8](https://basescan.org/tx/0x7d650588c18da24a768f1b80d25a7b8e13a9ee2996c9d4b1e5fb6c911482fad8), settled on 13 Nov 2026 at 02:42 UTC.

## The paying agent's limits

The Passport session that pays for lookups is scoped to `GET api.sirenic.eu/v1/*`, capped at $0.20 a lookup and $5 in total. A lookup outside that scope or over a cap is refused by Kite before any money moves, and the refusal is shown on the check as a receipt with its code. The service also caps what it spends per day across all free checks.

## Silent gap

French companies stop paying a median of <!-- num:gap.company.median -->144<!-- /num --> days before the gazette publishes their insolvency: <!-- num:gap.company.n -->43,438<!-- /num --> liquidations and reorganisations of companies in 2026, from the court-fixed date payments stopped to the publication date. Source: BODACC open data. Reproduce: `pnpm --filter @upfront/backtest gap`, output in [`apps/backtest/results/silent-gap.json`](apps/backtest/results/silent-gap.json).

## Tests

`pnpm test` runs the suite across the core rules, sources, payments, reasoning, review, pipeline, API and backtest packages.
