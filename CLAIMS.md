# Claims

Every public statement about Upfront, with the evidence behind it and how to check it yourself.

**Tiers:** `REPRODUCIBLE`: run the script and get the same number. `VERIFIED-LIVE`: a link you can open (a transaction, a live endpoint). `MODELED`: a calculation on stated assumptions. `NOT-CLAIMED`: things we deliberately do not say.

| Claim | Tier | Evidence | Reproduce |
|---|---|---|---|
| French companies stop paying a median of <!-- num:gap.company.median -->144<!-- /num --> days before the gazette publishes their insolvency | REPRODUCIBLE | [`apps/backtest/results/silent-gap.json`](apps/backtest/results/silent-gap.json): <!-- num:gap.company.n -->43,438<!-- /num --> companies, BODACC opening judgments <!-- num:gap.window.from -->2026-01-01<!-- /num --> to <!-- num:gap.window.to -->2026-11-12<!-- /num --> | `pnpm --filter @upfront/backtest gap` |
| <!-- num:gap.company.over180 -->46%<!-- /num --> of them were silent for more than six months | REPRODUCIBLE | same file, `byPersonType.company.shareOver180Days` | same |
| The delay is before the court, not the gazette: judgment to publication takes a median of <!-- num:gap.lag.median -->9<!-- /num --> days | REPRODUCIBLE | same file, `quality.medianPublicationLagDays` | same |
| On the day they stopped paying, the freelancer policy asks a deposit or more from <!-- num:bt.upfront.caught -->58%<!-- /num --> of failing companies and <!-- num:bt.upfront.falseAlarm -->41%<!-- /num --> of their healthy twins; a rule of thumb: <!-- num:bt.rule.caught -->27%<!-- /num --> and <!-- num:bt.rule.falseAlarm -->17%<!-- /num --> | REPRODUCIBLE | [`apps/backtest/results/backtest.json`](apps/backtest/results/backtest.json), 300 companies, point-in-time public records | `pnpm --filter @upfront/backtest run` (no key: the compiled policy is stored in `packages/serv/src/programs`) |
| Only late or missing accounts separate failing companies from healthy ones in the public record on that day | REPRODUCIBLE | same file, `signs` | same |
| No policy revision has beaten the starting policy yet; the held-out companies agree with the rejection | REPRODUCIBLE | [`apps/backtest/results/tuning.json`](apps/backtest/results/tuning.json) | replay any stored program with `decideWith` in `apps/backtest/src/run.ts` |
| Each lookup in a live check is paid in USDC on Base through Kite Agent Passport, with a transaction you can open | VERIFIED-LIVE | [PROOF.md](PROOF.md): transactions for two production checks | open the Basescan links |
| Every live decision is reviewed by Reppo's panel, and a block makes the terms stricter | VERIFIED-LIVE / REPRODUCIBLE | evaluation ids in [PROOF.md](PROOF.md); `packages/engine/test/pipeline.test.ts` ("tightens the terms one notch…") | `pnpm test` |
| SERV compiles a policy into rules once; checks apply them by code, so the same facts and policy always give the same terms | REPRODUCIBLE | `packages/core/test/program.test.ts`, `packages/serv/test/serv.test.ts` ("applies the compiled program…") | `pnpm test` |
| A compiled policy that asks a healthy client for a deposit, or has a rule that fires for everyone, is sent back to SERV and never used | REPRODUCIBLE | `packages/core/test/program.test.ts` ("lintProgram"), `packages/serv/test/serv.test.ts` ("sends a program that asks a healthy client…") | `pnpm test` |
| A decision can never be looser than the hard-fact floor | REPRODUCIBLE | `packages/core/test/validate.test.ts`, `packages/engine/test/pipeline.test.ts` ("lets the hard-fact floor override…") | `pnpm test` |
| A decision that cites a fact that doesn't exist is thrown out and the safe default applies | REPRODUCIBLE | `packages/engine/test/pipeline.test.ts` ("falls back to a deposit…") | `pnpm test` |
| The independent reviewer never sees the client's name, number or VAT | REPRODUCIBLE | `packages/reppo/test/reppo.test.ts` ("never leaks the client's identity…") | `pnpm test` |
| Sole traders are never checked, and nothing is bought for them | REPRODUCIBLE | `packages/engine/test/pipeline.test.ts` ("stops at a sole trader's profile…") | `pnpm test` |
| Average loss on a €5,000 invoice to a company that stopped paying: Upfront <!-- num:bt.upfront.loss -->€3,180<!-- /num -->, rule <!-- num:bt.rule.loss -->€4,233<!-- /num -->, Net 30 <!-- num:bt.net30.loss -->€5,000<!-- /num --> | MODELED | assumes the failing client pays nothing and a deposit is paid upfront | `apps/backtest/src/metrics.ts` |

## Not claimed

- Upfront does not predict whether a specific company will fail. It sets payment terms from public evidence and your policy.
- The backtest measures warning signs on the day a company stopped paying; it is not a guarantee of future results, and its false-alarm rate on public records alone is high.
- The policy-revision loop has not yet produced a better policy. We report the revisions it tried and why each was dropped.
- The silent gap is a lower bound for about a fifth of companies: French law lets a court date the cessation of payments at most 18 months before the judgment.
- The x402 endpoint for agents is built and tested; a paid call from an outside agent has not been recorded yet.
- The free demo pays from our own Kite Passport; your own Passport is not required to try it.
