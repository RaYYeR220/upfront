import { decide, pickCandidate, planLookups, type ProgramCache, programCache } from "@upfront/serv";
import type OpenAI from "openai";
import type { ServPort } from "./pipeline.ts";

/** Wires the SERV Reasoning calls into the check graph. `programsDir` keeps compiled custom policies across restarts. */
export function servPort(client: OpenAI, opts: { programsDir?: string; programs?: ProgramCache } = {}): ServPort {
  const programs = opts.programs ?? programCache(client, { dir: opts.programsDir });
  return {
    plan: (a) => planLookups(client, a),
    decide: (a) => decide(programs, a),
    pick: (a) => pickCandidate(client, a),
  };
}
