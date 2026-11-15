import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { disagreements, lintProgram, OPS, OUT_OF_SCOPE, type Policy, PROBES, type Program, parseProgram, SIGNAL_NAMES, SIGNALS } from "@upfront/core";
import type OpenAI from "openai";
import { costUsd, jsonContent, MODELS, type Usage, usageOf } from "./client.ts";

const signalList = SIGNAL_NAMES.map((n) => `- ${n}: ${SIGNALS[n]}`).join("\n");

/** Fixed, so SERV compiles its reasoning graph once and reuses it for every policy. */
export const COMPILE_SYSTEM = `You translate a small business's credit policy, written in plain English, into a program of rules. Code applies the program to every client company the business checks, so the program must say exactly what the policy says, no more and no less.

Signals a rule can test, each computed from dated public records about the client:
${signalList}

A rule fires when every condition in "all" holds, at least one condition in "any" holds (when "any" is not empty), and at least "atLeast.n" of the rules named in "atLeast.rules" fire (when "atLeast" is set; name only rules that have no "atLeast" themselves). A condition compares one signal with "op": ${OPS.join(", ")}. "present" and "absent" test whether the signal exists; give them value 0. A condition on a signal that is absent does not hold.

When several rules fire, the strictest terms win: decline, then prepay, then deposit (a larger percentage is stricter), then net. "default" is what the client gets when no rule fires: the policy's default terms. When the policy describes its default client ("active, trading for 3+ years, no trouble"), that description is not a rule; only the triggers the policy lists become rules. Terms: mode "net" with netDays (and creditLimitEur when the policy names a fixed amount), "deposit" with depositPct, "prepay", or "decline"; set unused numbers to null. Set creditLimitIsInvoice to true when the policy caps credit at the invoice amount. maxNetDays is the longest net term the policy ever allows.

Rules:
- Liquidation, reorganisation, ceased trading and sanctions are already handled by fixed rules outside the program. Do not write rules for them.
- Write one rule per trigger the policy lists, so each rule's "why" names one reason. A trigger with two alternatives ("overdue or never filed") is one rule with "any".
- A policy rule that combines triggers ("two or more deposit triggers") becomes one rule with "atLeast" naming those triggers' rule ids.
- Use only thresholds the policy states. Never add a rule the policy doesn't contain, and never a rule for the default client.
- Each condition tests the warning sign itself. A range ("6 to 18 months") is two conditions in "all". When one alternative of a trigger is itself a range ("1 to 3 years old, or no figures on file"), write one rule per alternative with the same terms. A healthy, profitable client with accounts on time must not trigger any deposit, prepay or decline rule.
- Copy every part of the policy that no signal can express into "untranslated", verbatim. When a signal only approximates the wording, use it and add "Approximated: <what>" to "untranslated".
- Give each rule a short snake_case id and a "why" in the policy's own words that the business owner will recognise.

Finally, in "expected", give the terms the policy text itself gives each of these sample clients, read from the policy and not from your rules; code checks that your rules agree:
${PROBES.map((p) => `- ${p.id}: ${p.label}`).join("\n")}`;

const cond = {
  type: "object",
  additionalProperties: false,
  required: ["signal", "op", "value"],
  properties: { signal: { type: "string", enum: SIGNAL_NAMES }, op: { type: "string", enum: [...OPS] }, value: { type: "number" } },
} as const;
const terms = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "netDays", "depositPct", "creditLimitEur"],
  properties: {
    mode: { type: "string", enum: ["net", "deposit", "prepay", "decline"] },
    netDays: { type: ["integer", "null"] },
    depositPct: { type: ["integer", "null"] },
    creditLimitEur: { type: ["number", "null"] },
  },
} as const;
export const programJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["default", "creditLimitIsInvoice", "maxNetDays", "rules", "untranslated", "expected"],
  properties: {
    default: terms,
    creditLimitIsInvoice: { type: "boolean" },
    maxNetDays: { type: "integer" },
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "when", "then", "why"],
        properties: {
          id: { type: "string" },
          when: {
            type: "object",
            additionalProperties: false,
            required: ["all", "any", "atLeast"],
            properties: {
              all: { type: "array", items: cond },
              any: { type: "array", items: cond },
              atLeast: {
                anyOf: [
                  { type: "null" },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["n", "rules"],
                    properties: { n: { type: "integer" }, rules: { type: "array", items: { type: "string" } } },
                  },
                ],
              },
            },
          },
          then: terms,
          why: { type: "string" },
        },
      },
    },
    untranslated: { type: "array", items: { type: "string" } },
    expected: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["probe", "mode", "depositPct", "netDays"],
        properties: {
          probe: { type: "string", enum: PROBES.map((p) => p.id) },
          mode: { type: "string", enum: ["net", "deposit", "prepay", "decline"] },
          depositPct: { type: ["integer", "null"] },
          netDays: { type: ["integer", "null"] },
        },
      },
    },
  },
} as const;

type RawCond = { signal?: string; op?: string; value?: number };
type RawRule = { id?: string; why?: string; when?: { all?: RawCond[]; any?: RawCond[]; atLeast?: { rules?: string[] } | null } };

/**
 * Fixes, in code, the slips whose intent is unambiguous: "finances_known absent"
 * means no finances on file; a rule about liquidation or sanctions, or one with no
 * condition at all, is the policy's out-of-scope line written as a rule, so it
 * moves to "untranslated" instead of deciding anything.
 */
function normalize(raw: unknown): unknown {
  const p = raw as { rules?: RawRule[]; untranslated?: string[] };
  if (!p || !Array.isArray(p.rules)) return raw;
  const fix = (c: RawCond): RawCond[] => {
    if (c.signal === "finances_known" && c.op === "absent") return [{ ...c, op: "==", value: 0 }];
    if (c.signal === "finances_known" && c.op === "present") return [{ ...c, op: "==", value: 1 }];
    if (c.signal === "invoice_eur" && c.op === "present") return [];
    return [c];
  };
  const short = (id: unknown) => String(id ?? "").slice(0, 60);
  const rules = p.rules.map((r) => ({
    ...r,
    id: short(r.id),
    when: r.when && {
      ...r.when,
      all: (r.when.all ?? []).flatMap(fix),
      any: (r.when.any ?? []).flatMap(fix),
      atLeast: r.when.atLeast && { ...r.when.atLeast, rules: (r.when.atLeast.rules ?? []).map(short) },
    },
  }));
  const moved = (r: RawRule) =>
    OUT_OF_SCOPE.test(`${r.id ?? ""} ${r.why ?? ""}`) || (!r.when?.all?.length && !r.when?.any?.length && !r.when?.atLeast);
  const gone = new Set(rules.filter(moved).map((r) => r.id));
  return {
    ...p,
    rules: rules
      .filter((r) => !moved(r))
      .map((r) => (r.when?.atLeast ? { ...r, when: { ...r.when, atLeast: { ...r.when.atLeast, rules: (r.when.atLeast.rules ?? []).filter((id) => !gone.has(id)) } } } : r)),
    untranslated: [...(p.untranslated ?? []), ...rules.filter(moved).map((r) => String(r.why ?? ""))].filter(Boolean),
  };
}

export interface Compiled {
  policyHash: string;
  program: Program;
  /** Sample clients where the rules and a direct reading of the policy disagree. */
  warnings: string[];
  model: string;
  compiledAt: string;
}

/**
 * One SERV call turns a policy into a program; up to two more attempts get the
 * problems found on sample clients back. Prompt Guard screens the policy text, which the user wrote.
 */
export async function compilePolicy(
  c: OpenAI,
  policy: Policy,
  model = MODELS.compile,
): Promise<Compiled & { usage: Usage; costUsd: number; ms: number }> {
  const t0 = Date.now();
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let cost = 0;
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await c.chat.completions.create({
      model,
      // Set explicitly: left unset, the server derives a ceiling from the account balance that can exceed the model limit.
      max_completion_tokens: 8_000,
      messages: [
        { role: "system", content: COMPILE_SYSTEM },
        { role: "user", content: `Policy:\n${policy.text}${feedback}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "program", strict: true, schema: programJsonSchema } },
      tools: [{ type: "function", function: { name: "serv_prompt_guard" } }],
    } as Parameters<typeof c.chat.completions.create>[0]);
    const u = usageOf(r as never);
    usage = { inputTokens: usage.inputTokens + u.inputTokens, outputTokens: usage.outputTokens + u.outputTokens };
    cost += costUsd(model, u);
    const parsed = parseProgram(normalize(jsonContent(r as never)));
    // Tried on sample clients before use: a healthy client asked for a deposit, or a rule that fires for everyone, sends it back.
    const problems = parsed.ok ? lintProgram(parsed.program) : parsed.errors;
    const differs = parsed.ok ? disagreements(parsed.program) : [];
    // Disagreements with its own reading of the policy get one more try; on the last attempt they are kept as warnings.
    if (parsed.ok && !problems.length && (!differs.length || attempt === 2)) {
      return { policyHash: policy.hash, program: parsed.program, warnings: differs, model, compiledAt: new Date().toISOString(), usage, costUsd: cost, ms: Date.now() - t0 };
    }
    problems.push(...differs);
    if (process.env.UPFRONT_DEBUG) console.error(problems);
    feedback = `\n\nYour previous program was tried on sample clients and rejected:\n- ${problems.slice(0, 8).join("\n- ")}\nFix these and answer again with the whole program.`;
  }
  throw new Error(`compile: no valid program for policy ${policy.hash.slice(0, 12)}`);
}

/** Compiled programs for the preset policies, committed so checks and the backtest replay without a key. */
export const PROGRAMS_DIR = join(import.meta.dirname, "programs");

export function storedProgram(hash: string, dir = PROGRAMS_DIR): Compiled | null {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => f.endsWith(`${hash.slice(0, 16)}.json`));
  if (!file) return null;
  const c = JSON.parse(readFileSync(join(dir, file), "utf8")) as Compiled;
  return c.policyHash === hash && parseProgram(c.program).ok ? c : null;
}

export const programFileName = (policy: Policy) => `${policy.id}-v${policy.version}-${policy.hash.slice(0, 16)}.json`;
