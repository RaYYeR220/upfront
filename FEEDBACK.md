# Notes from building on SERV, Kite and Reppo

What we ran into while building Upfront, with the numbers we measured. Each item says what happened, how we worked around it, and what would have helped.

## SERV Reasoning

**Setup.** Upfront first sent every credit decision to `gpt-5.4-mini-serv-kronos-multipath` with the user's policy as the system prompt and Shadow Agent validation. It now asks SERV once per policy version to compile the policy into typed rules (`gpt-5.4-mini` with Prompt Guard and a strict JSON schema), and applies the rules in code on every check. Lookup planning and name resolution use `gpt-6-luna`; policy revisions use `gpt-5.4-mini`. The numbers below come from both setups.

1. **The response doesn't say what a request cost.** `usage` reports model tokens only. Graph generation, Kronos audit and Shadow Agent validations are billed but don't appear anywhere in the response, and there is no usage API, only the console. Priced from `usage`, a decision cost us $0.0026. Measured against the balance over about 390 decisions, it cost about $0.013, five times more. We ran out of credits twice mid-backtest because of this. *Would help:* a cost field (or response header) per request, or a usage endpoint we can query from a job.
2. **What a decision really costs, by configuration.** We read the balance (from a deliberately unaffordable request's 402 message) before and after batches of eight identical decisions: `gpt-6-luna` with Prompt Guard $0.0013 each (7 of 8 valid), plain `gpt-5.4-mini` $0.0025 (8 of 8 valid), `gpt-5.4-mini-serv-kronos-multipath` with Shadow Agent about $0.013. A published table like this would let builders pick features per call.
3. **Kronos, Multipath and Shadow Agent need a reserve of about $0.50.** Below it, every request using any of them returned `402 … does not cover even a 256-token completion`, even ping-sized ones on the cheapest model, while plain models kept answering. Refusing before billing is the right behaviour; stating the reserve in the error would make budgets easy to plan.
4. **Editing a system prompt is billed again on the next call.** The graph is cached by the exact system prompt, so every edit regenerates it. While we iterated on the compiler prompt, about 15 compile calls took $0.27 off the balance, against under $0.005 of upstream tokens. Once the prompt stopped changing, compiles were cheap. *Would help:* a dry-run or a cheaper graph regeneration for prompt development.
5. **Leaving the output ceiling unset can break requests.** With about $4.90 in the account and no ceiling set, calls failed with `400 max_tokens is too large: 130442. This model supports at most 128000 completion tokens`. The number went down as the balance went down, so the server seems to derive the ceiling from the balance. Setting `max_tokens` then failed with `Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.` *Fix:* we set `max_completion_tokens` on every call. *Would help:* clamp the derived ceiling to the model's limit.
6. **Latency.** A per-check decision took 22 s on a cold graph and 5–10 s once warm, with occasional 24 s calls. Compiling a policy takes 6–24 s once; the compiled decision then takes 15 ms. Planning on `gpt-6-luna` takes 2–7 s.
7. **The graph cache is keyed by the exact system prompt.** For per-check decisions this meant a one-character policy edit paid the cold start again. With compiled policies the compiler's system prompt is fixed, so its graph is shared by every user's policy.
8. **Without Kronos and Shadow Agent, a plain model makes structural mistakes we had to catch ourselves.** Compiling the same policy, `gpt-5.4-mini` sometimes wrote a decline rule that fired on any court decision, a prepay rule on any invoice amount, or a range as an "or". We now try every compiled program on ten sample clients in code and send it back with the reason when a healthy client would be asked for a deposit or a rule fires for everyone; the model fixes it on the next attempt in most cases. This is our own small Shadow Agent, specific to the task.
9. **Shadow Agent can't be combined with streaming** (the docs say 400). We stream our own step events instead.
10. **`jev-latest` isn't in `/v1/models`** (37 models listed on 13 Nov), so the typed decision nodes described for Graph Sharding weren't reachable. Compiled rules applied in code play the part of script nodes; SERV's agent calls write and revise them.

What worked well: the OpenAI SDK dropped in unchanged, and "your policy, written in plain English, compiled by SERV" is exactly the product: every user's rules become their own program, applied the same way to every client.

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
