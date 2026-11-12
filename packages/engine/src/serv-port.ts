import { decide, pickCandidate, planLookups } from "@upfront/serv";
import type OpenAI from "openai";
import type { ServPort } from "./pipeline.ts";

/** Wires the SERV Reasoning calls into the check graph. */
export function servPort(client: OpenAI): ServPort {
  return {
    plan: (a) => planLookups(client, a),
    decide: (a) => decide(client, a),
    pick: (a) => pickCandidate(client, a),
  };
}
