# Proof

Every claim here links to something you can open: a live check, a transaction on Base, or a file in this repository with the script that produces it.

## Live

- App: https://upfront-terms.vercel.app
- API: https://45-77-62-228.sslip.io/api/health
- Telegram bot for watch alerts: [@upfrontservbot](https://t.me/upfrontservbot)

## Two production checks, end to end

Both ran on 15 Nov 2026 against the live API. The plan step (SERV) chose the lookups for the amount; each was paid through Kite Agent Passport in USDC on Base; the freelancer policy, as SERV compiled it, set the terms; Reppo reviewed the decision.

### KD SOCCER CONSULTING (841936560), €6,800 invoice → Decline

Open the check: https://upfront-terms.vercel.app/c/ce94109b-39ca-4e62-b0fb-bb713e0014b7

| Lookup | Price | Base transaction |
|---|---|---|
| Company register profile | $0.005 | [0x6e9e…4c48](https://basescan.org/tx/0x6e9ea7f38441908dc197324a3cac797a603d83233979f56f818ba2a6314e4c48) |
| Gazette insolvency alerts | $0.01 | [0xe50a…41c5](https://basescan.org/tx/0xe50ac4da9a9a55f2fc146fa7a14aa1c95f2e978be7fdb65a44c8e59b946741c5) |
| Filed accounts | $0.02 | [0xb2b8…f3cb](https://basescan.org/tx/0xb2b85e057800e5ac30aabcc3fe44d71a0d4a1f8839e959b32a30e0f77cbdf3cb) |
| Financial statements | $0.01 | [0x5914…de1c](https://basescan.org/tx/0x59145fcc1b9a4e8b3f21e582c98e6f1d8f480a3dcf87f75bc227368f7124de1c) |
| Commercial-court decisions | $0.01 | [0xcbfc…0d69](https://basescan.org/tx/0xcbfc4d231edf4cbb9b7bdcaaf4f59bb520bd838d8d9ca48f850b74e8ba710d69) |
| The data provider's own credit limit | $0.12 | [0x49f7…39c7](https://basescan.org/tx/0x49f7e1aaf06eaa0b775c66f87487de7cd7da96749c2397c96e59af69b68439c7) |

- The gazette shows a liquidation opened on 28 Sep 2026, published 14 Oct 2026, with payments stopped since 28 Mar 2025. The last accounts on file are for 2019, now 63 months overdue. The hard rule ("an open liquidation means decline") set the terms and the reason cites the gazette fact.
- Reppo evaluation `cmwh73lmz000508jyafkk15pw`: score 100, route `ship`.
- Evidence $0.175 of a $0.30 budget for this amount. The decision step took 15 ms.

### DANONE (552032534), €4,000 invoice → Net 30 up to €4,000

Open the check: https://upfront-terms.vercel.app/c/73903a1b-ab5c-4a76-9b07-b27cf06219ed

| Lookup | Price | Base transaction |
|---|---|---|
| Company register profile | $0.005 | [0x716a…4faa](https://basescan.org/tx/0x716ad000fb4100bcd3d82cb401899c99f7a5697ab6528fdf54383824c11a4faa) |
| Gazette insolvency alerts | $0.01 | [0xa385…735a](https://basescan.org/tx/0xa385f925bc53e5af17476f47e7bacf11b9267c3be851457c34d4c6fa55be735a) |
| Financial statements | $0.01 | [0x562c…1c44](https://basescan.org/tx/0x562cab88ebe8f3c59c91d11406fffd6746487d03c2e8840c8d3d73a1ff771c44) |

- No gazette notices and seven years of filed results. None of the policy's 10 rules fires, so the default applies: Net 30 with the invoice as the credit limit.
- Reppo evaluation `cmwh6vn3k000308jy8mphkn67`: score 77, route `review`. The panel agreed with Net 30 and asked for a second look at the debt ratio, which the policy doesn't mention.

Each transaction is a USDC transfer on Base (`0x8335…2913`) to the data provider's address `0x76a6…c8a2`, confirmed in blocks 57,588,713 to 57,590,594 (15 Nov 2026, about 02:02 to 02:08 UTC).

### Earlier payments by the same agent

The first payment, [0x7d65…fad8](https://basescan.org/tx/0x7d650588c18da24a768f1b80d25a7b8e13a9ee2996c9d4b1e5fb6c911482fad8), settled on 13 Nov 2026 at 02:42 UTC. Checks on 14 Nov, before the policy was compiled into rules, paid for [0xc5be…b604](https://basescan.org/tx/0xc5be567a037660f1a3bd897649e937f8858448afd192be6157635ed7014eb604), [0x0a57…e11c](https://basescan.org/tx/0x0a57b8b71bfd6b1fe548149205caccf6ad507cb583f2d5f5d8a71de84b02e11c), [0xe271…64ad](https://basescan.org/tx/0xe2716c712d7c1f9d83d15231cd9a84df3738b32b7c09d343220e581c571064ad), [0x2d9c…dcb7](https://basescan.org/tx/0x2d9cc1e51e269dd1a9656d2995f43d94ca176fa44606de7152739534513adcb7), [0x3766…caca](https://basescan.org/tx/0x37660e7ed2b925d6a30f168db078c31cf0893ca14f1c7a3844973bd27906caca) and [0x06ab…bc9c](https://basescan.org/tx/0x06ab67b29725ff6d094c25d1d93a6fff4e3dca27d4c5137964c354d92b80bc9c).

## The compiled policy

The freelancer preset as SERV compiled it, with the ten sample clients it was tried on and the two places where its rules and a plain reading of the policy disagree: [`packages/serv/src/programs/freelancer-v1-c72b9fedfe99d712.json`](packages/serv/src/programs/freelancer-v1-c72b9fedfe99d712.json), shown on https://upfront-terms.vercel.app/policy.

## The paying agent's limits

The Passport session that pays for lookups is scoped to `GET api.sirenic.eu/v1/*`, capped at $0.20 a lookup and $5 in total. A lookup outside that scope or over a cap is refused by Kite before any money moves, and the refusal is shown on the check as a receipt with its code. The service also caps what it spends per day across all free checks.

## Silent gap

French companies stop paying a median of <!-- num:gap.company.median -->144<!-- /num --> days before the gazette publishes their insolvency: <!-- num:gap.company.n -->43,438<!-- /num --> liquidations and reorganisations of companies in 2026, from the court-fixed date payments stopped to the publication date. Source: BODACC open data. Reproduce: `pnpm --filter @upfront/backtest gap`, output in [`apps/backtest/results/silent-gap.json`](apps/backtest/results/silent-gap.json).

## Tests

`pnpm test` runs the suite across the core rules, sources, payments, reasoning, review, pipeline, API and backtest packages.
