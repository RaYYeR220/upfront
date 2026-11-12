import type { Fact, Reason, Receipt, Terms } from "@upfront/core";
import type { CheckResult, NodeName, NodeRecord } from "@upfront/engine";
import type { ReviewResult } from "@upfront/reppo";
import type { Candidate } from "@upfront/sources";

export type { Candidate, CheckResult, Fact, NodeName, NodeRecord, Reason, Receipt, ReviewResult, Terms };

export const NODE_ORDER: NodeName[] = ["resolve", "plan", "buy", "extract", "floors", "decide", "review", "issue"];

export type CheckStatus =
  | "starting"
  | "running"
  | "done"
  | "needs_choice"
  | "not_found"
  | "cannot_check_individual"
  | "unavailable"
  | "unsupported_jurisdiction"
  | "error";

export interface CheckRow {
  id: string;
  createdAt: string;
  query: string;
  amountEur: number;
  status: string;
  entityName: string | null;
  finalMode: string | null;
  evidenceUsd: number;
  result: CheckResult | null;
  candidates: Candidate[] | null;
  error: string | null;
}

export interface Meta {
  checks: number;
  lookups: number;
  refusedLookups: number;
  evidenceUsd: number;
  watches: number;
}
