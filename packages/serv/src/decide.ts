import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyProgram, type Fact, type FloorResult, type Policy } from "@upfront/core";
import type OpenAI from "openai";
import { type Compiled, compilePolicy, programFileName, storedProgram } from "./compile.ts";

export interface DecideArgs {
  policy: Policy;
  facts: Fact[];
  floor: FloorResult;
  amountEur: number;
  netDaysRequested?: number;
  today: string;
}

export interface DecideOutput {
  raw: unknown;
  costUsd: number;
  ms: number;
  model: string;
}

export interface ProgramCache {
  get(policy: Policy): Promise<{ compiled: Compiled; costUsd: number; cached: boolean }>;
  /** A program already compiled for this policy, without calling SERV. */
  peek(policy: Policy): Compiled | null;
}

/** A policy that failed to compile is not sent to SERV again for this long. */
const RETRY_FAILED_AFTER_MS = 60 * 60 * 1000;

/**
 * Compiled programs by policy hash: the committed presets first, then a cache
 * directory, then SERV, once per policy. Concurrent checks share one compile.
 */
export function programCache(client: OpenAI | null, opts: { dir?: string; compilesPerDay?: number } = {}): ProgramCache {
  let quota = { day: "", n: 0 };
  const pending = new Map<string, Promise<{ compiled: Compiled; costUsd: number; cached: boolean }>>();
  const done = new Map<string, Compiled>();
  const failed = new Map<string, number>();
  const stored = (hash: string) => storedProgram(hash) ?? (opts.dir ? storedProgram(hash, opts.dir) : null);
  return {
    peek(policy) {
      return done.get(policy.hash) ?? stored(policy.hash);
    },
    get(policy) {
      let p = pending.get(policy.hash);
      if (!p) {
        p = (async () => {
          const hit = stored(policy.hash);
          if (hit) return { compiled: hit, costUsd: 0, cached: true };
          if (!client) throw new Error("this policy has not been compiled yet");
          const lastFail = failed.get(policy.hash);
          if (lastFail && Date.now() - lastFail < RETRY_FAILED_AFTER_MS) throw new Error("this policy failed to compile recently");
          // Compiling is paid: every caller (a check or the policy page) draws on one daily allowance, reserved before the call.
          const day = new Date().toISOString().slice(0, 10);
          if (quota.day !== day) quota = { day, n: 0 };
          if (quota.n >= (opts.compilesPerDay ?? 20)) throw new Error("compile_quota");
          quota.n++;
          const c = await compilePolicy(client, policy).catch((e: unknown) => {
            failed.set(policy.hash, Date.now());
            throw e;
          });
          const compiled: Compiled = { policyHash: c.policyHash, program: c.program, warnings: c.warnings, model: c.model, compiledAt: c.compiledAt };
          done.set(policy.hash, compiled);
          if (opts.dir) {
            // The compile is paid for: a failed write must not throw it away.
            try {
              mkdirSync(opts.dir, { recursive: true });
              const file = join(opts.dir, programFileName(policy));
              writeFileSync(`${file}.tmp`, `${JSON.stringify(compiled, null, 2)}\n`);
              renameSync(`${file}.tmp`, file);
            } catch {
              /* kept in memory for this process */
            }
          }
          return { compiled, costUsd: c.costUsd, cached: false };
        })();
        pending.set(policy.hash, p);
        p.catch(() => pending.delete(policy.hash));
      }
      return p;
    },
  };
}

/**
 * The decision step: the user's policy, compiled by SERV into rules, applied to
 * the facts by code. The same facts and policy always give the same terms.
 */
export async function decide(programs: ProgramCache, a: DecideArgs): Promise<DecideOutput> {
  const t0 = Date.now();
  const { compiled, costUsd, cached } = await programs.get(a.policy);
  const r = applyProgram(compiled.program, a.facts, { today: a.today, amountEur: a.amountEur });
  return {
    raw: {
      ...r.decision,
      program: {
        policyHash: a.policy.hash,
        rules: compiled.program.rules.length,
        fired: r.fired,
        compiledBy: compiled.model,
        compiledAt: compiled.compiledAt,
        cached,
        warnings: compiled.warnings,
      },
    },
    costUsd,
    ms: Date.now() - t0,
    model: cached ? "compiled program" : compiled.model,
  };
}
