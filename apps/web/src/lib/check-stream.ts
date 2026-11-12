import type { Candidate, CheckResult, CheckStatus, NodeName, NodeRecord, Reason, Receipt, ReviewResult, Terms } from "./types.ts";

/** Everything the check page draws, rebuilt from the stream of graph events. */
export interface CheckView {
  checkId: string;
  status: CheckStatus;
  query: string | null;
  amountEur: number | null;
  nodes: Partial<Record<NodeName, NodeRecord>>;
  /** The node that most recently finished. */
  current: NodeName | null;
  receipts: Receipt[];
  spentUsd: number;
  refused: Receipt[];
  result: CheckResult | null;
  candidates: Candidate[] | null;
  review: ReviewResult | null;
  reviewed: boolean;
  final: Terms | null;
  finalReasons: Reason[];
  ended: boolean;
}

export function initialView(checkId: string): CheckView {
  return {
    checkId,
    status: "starting",
    query: null,
    amountEur: null,
    nodes: {},
    current: null,
    receipts: [],
    spentUsd: 0,
    refused: [],
    result: null,
    candidates: null,
    review: null,
    reviewed: false,
    final: null,
    finalReasons: [],
    ended: false,
  };
}

const micro = (x: number) => Math.round(x * 1e6) / 1e6;

export type StreamEvent = { event: string; data: unknown };

export function reduce(v: CheckView, e: StreamEvent): CheckView {
  switch (e.event) {
    case "start": {
      const d = e.data as { query: string; amountEur: number };
      return { ...v, status: "running", query: d.query, amountEur: d.amountEur };
    }
    case "node": {
      const n = e.data as NodeRecord;
      return { ...v, status: v.status === "starting" ? "running" : v.status, nodes: { ...v.nodes, [n.name]: n }, current: n.name };
    }
    case "receipt": {
      const r = e.data as Receipt;
      if (v.receipts.some((x) => x.id === r.id)) return v;
      return {
        ...v,
        receipts: [...v.receipts, r],
        spentUsd: micro(v.spentUsd + r.amountUsd),
        refused: r.status === "refused" ? [...v.refused, r] : v.refused,
      };
    }
    case "outcome": {
      const d = e.data as { kind: string; result?: CheckResult; candidates?: Candidate[] };
      if (d.kind === "done" && d.result) {
        const r = d.result;
        const nodes = Object.fromEntries(r.nodes.map((n) => [n.name, n])) as Partial<Record<NodeName, NodeRecord>>;
        return {
          ...v,
          status: "done",
          result: r,
          nodes: { ...v.nodes, ...nodes },
          receipts: r.receipts.length >= v.receipts.length ? r.receipts : v.receipts,
          spentUsd: r.costs.evidenceUsd,
          refused: r.receipts.filter((x) => x.status === "refused"),
          review: r.review,
          reviewed: r.reviewed,
          final: r.final,
          finalReasons: r.finalReasons,
        };
      }
      return { ...v, status: (d.kind as CheckStatus) ?? "error", candidates: d.candidates ?? null };
    }
    case "review": {
      const d = e.data as { review: ReviewResult; final: Terms; finalReasons: Reason[]; reviewed: boolean } | ReviewResult;
      if ("review" in d) return { ...v, review: d.review, final: d.final, finalReasons: d.finalReasons, reviewed: d.reviewed };
      return { ...v, review: d };
    }
    case "end":
      return { ...v, ended: true };
    default:
      return v;
  }
}

/** A stored check (fetched after the fact) as the same view. */
export function viewFromRow(checkId: string, row: { status: string; result: CheckResult | null; candidates: Candidate[] | null; query: string; amountEur: number }): CheckView {
  let v: CheckView = { ...initialView(checkId), query: row.query, amountEur: row.amountEur };
  if (row.result) v = reduce(v, { event: "outcome", data: { kind: "done", result: row.result } });
  else v = { ...v, status: row.status as CheckStatus, candidates: row.candidates };
  return { ...v, ended: row.status !== "running" };
}
