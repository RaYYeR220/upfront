# Notes from building on SERV, Kite and Reppo

What we ran into while building Upfront, with the numbers we measured. Each item says what happened, how we worked around it, and what would have helped.

## SERV Reasoning

**Setup.** Every credit decision is a `chat.completions` call to `gpt-5.4-mini-serv-kronos-multipath` with the user's policy as the system prompt, a strict JSON schema, and Shadow Agent validation. Lookup planning and name resolution use `gpt-6-luna`; policy tuning uses `gpt-6.1-sol`.

1. **The response doesn't say what a request cost.** `usage` reports model tokens only. Graph generation, Kronos audit and Shadow Agent validations are billed but don't appear anywhere in the response, and there is no usage API, only the console. Priced from `usage`, a decision cost us $0.0026. Measured against the balance over about 390 decisions, it cost about $0.013, five times more. We ran out of credits twice mid-backtest because of this. *Would help:* a cost field (or response header) per request, or a usage endpoint we can query from a job.
2. **Leaving the output ceiling unset can break requests.** With about $4.90 in the account and no ceiling set, calls failed with `400 max_tokens is too large: 130442. This model supports at most 128000 completion tokens`. The number went down as the balance went down, so the server seems to derive the ceiling from the balance. Setting `max_tokens` then failed with `Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.` *Fix:* we set `max_completion_tokens` on every call. *Would help:* clamp the derived ceiling to the model's limit.
3. **The minimum balance is far above the real cost.** At $0.44, every request with Kronos and Shadow Agent returned `402 … does not cover even a 256-token completion`, even on the cheapest model, though a whole decision costs about a cent. Refusing before billing is the right behaviour. Stating the reserve amount in the error would make budgets easy to plan.
4. **Latency.** A decision takes 22 s on a cold graph (first call with a new policy) and 5–10 s once warm, with occasional 24 s calls on a warm graph. Planning on `gpt-6-luna` takes 2–7 s. We stream every step to the user so the wait reads as work in progress.
5. **The graph cache is keyed by the exact system prompt.** A one-character edit to a policy compiles a new graph and pays the cold start again. This worked in our favour: we hash the policy text, show the hash and version on every check, and a decision can always be traced to the exact rules that produced it.
6. **Shadow Agent can't be combined with streaming** (the docs say 400). We stream our own step events instead.
7. **`jev-latest` isn't in `/v1/models`** (37 models listed on 13 Nov), so the typed decision nodes described for Graph Sharding weren't reachable. The policy decision runs as an agent node with code-side validation.

What worked well: the OpenAI SDK dropped in unchanged, and "your policy is the system prompt, SERV compiles it" is exactly the product: every user's rules become their own reasoning graph, applied the same way to every client.

## Kite Agent Passport

**Setup.** The API container runs `kpass session execute` for each paid lookup, with `HOME` pointed at a volume that holds the paying agent's login. The session is scoped to `GET api.sirenic.eu/v1/*`, capped at $0.20 a lookup and $5 in total.

1. **The settlement chain and hash live in the `payment` block.** `kpass session execute --output json` returns `payment.transaction_hash` and `payment.network: "eip155:8453"`, while `x402.chain_id` is `2366` even though the payment settles on Base. Our first parser read `chain_id` and labelled receipts with the wrong network. A sample of the full output in the docs would have prevented it. Our test fixture is a real output: [`packages/kite/test/fixtures/real-execute-session-success.json`](packages/kite/test/fixtures/real-execute-session-success.json).
2. **Two payments at once from one session: the second is refused with `insufficient_balance`**, though the wallet held $3 and each lookup cost at most $0.01. The balance appears to be reserved for each payment in flight. Paying lookups one after another fixed it, at the cost of time: a three-lookup check takes about 10 s instead of about 4 s. *Would help:* allowing concurrent spends within the balance, or documenting the reservation.
3. **CLI only.** There is no HTTP API, so a server shells out to `kpass`. It works and the JSON output is stable; a server SDK would remove the subprocess.

What worked well: the scoped session (host, method and path allowlist, per-transaction and total caps) is exactly the guardrail a paying agent needs, and refusals come back as typed codes, so we can show every refused lookup as a receipt instead of hiding it.

## Reppo

**Setup.** Every decision is sent to the Eval API as an `action` evaluation: the policy, the facts and the decision, with the client renamed "Company A". A `block` verdict tightens the terms by one notch; a review can never loosen them. In policy tuning, each proposed policy change is reviewed before it is tested.

1. **An evaluation takes 30–90 s**, so the review runs after the terms are shown and its verdict arrives on the same page as it lands.
2. **`score` and `route` can disagree on the surface.** We got score 100 with route `review` because the panel's confidence was medium. The reason text says so; a separate confidence field would let an integrator act on it without parsing prose.
3. **The evaluation feed is public**, so the packet sent for review keeps an allowlist of fact kinds and strips names, company numbers and VAT numbers.
4. **docs.reppo.ai still documents the previous API** (`/agents/eval-requests/submit`, 1,000 signup credits). The current one is at eval.reppo.xyz/agents.md. We read the credit balance through the MCP tool `get_credit_balance`.

What worked well: one call with plain-text input and a verdict with a reason was the easiest independent check to wire in.
