# Claims

Every public statement about Upfront, with the evidence behind it and how to check it yourself.

**Tiers:** `REPRODUCIBLE`: run the script and get the same number. `VERIFIED-LIVE`: a link you can open (a transaction, a live endpoint). `MODELED`: a calculation on stated assumptions. `NOT-CLAIMED`: things we deliberately do not say.

| Claim | Tier | Evidence | Reproduce |
|---|---|---|---|
| French companies stop paying a median of <!-- num:gap.company.median -->144<!-- /num --> days before the gazette publishes their insolvency | REPRODUCIBLE | [`apps/backtest/results/silent-gap.json`](apps/backtest/results/silent-gap.json): <!-- num:gap.company.n -->43,438<!-- /num --> companies, BODACC opening judgments <!-- num:gap.window.from -->2026-01-01<!-- /num --> to <!-- num:gap.window.to -->2026-11-12<!-- /num --> | `pnpm --filter @upfront/backtest gap` |
| <!-- num:gap.company.over180 -->46%<!-- /num --> of them were silent for more than six months | REPRODUCIBLE | same file, `byPersonType.company.shareOver180Days` | same |
| The delay is before the court, not the gazette: judgment to publication takes a median of <!-- num:gap.lag.median -->9<!-- /num --> days | REPRODUCIBLE | same file, `quality.medianPublicationLagDays` | same |
| A model's decision can never be looser than the hard-fact floor | REPRODUCIBLE | `packages/core/test/validate.test.ts`, `packages/engine/test/pipeline.test.ts` ("lets the hard-fact floor override…") | `pnpm test` |
| A decision that cites a fact that doesn't exist is thrown out and the safe default applies | REPRODUCIBLE | `packages/engine/test/pipeline.test.ts` ("falls back to a deposit…") | `pnpm test` |
| The independent reviewer never sees the client's name, number or VAT | REPRODUCIBLE | `packages/reppo/test/reppo.test.ts` ("never leaks the client's identity…") | `pnpm test` |
| Sole traders are never checked, and nothing is bought for them | REPRODUCIBLE | `packages/engine/test/pipeline.test.ts` ("stops at a sole trader's profile…") | `pnpm test` |

## Not claimed

- Upfront does not predict whether a specific company will fail. It sets payment terms from public evidence and your policy.
- The backtest measures warning signs on the day a company stopped paying; it is not a guarantee of future results.
- The silent gap is a lower bound for about a fifth of companies: French law lets a court date the cessation of payments at most 18 months before the judgment.
- The free demo pays from our own Kite Passport; your own Passport is not required to try it.
