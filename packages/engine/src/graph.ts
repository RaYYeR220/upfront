export type NodeName = "resolve" | "plan" | "buy" | "extract" | "floors" | "decide" | "review" | "issue";

/**
 * Node types follow a sharded-graph vocabulary: deterministic code ("script"),
 * typed choices ("decision"), model judgment ("agent") and outside parties
 * that are paid or consulted ("external").
 */
export type NodeType = "script" | "decision" | "agent" | "external";

export interface NodeRecord {
  checkId: string;
  name: NodeName;
  type: NodeType;
  startedAt: string;
  ms: number;
  costUsd: number;
  model?: string;
  input: unknown;
  output: unknown;
  status: "ok" | "error" | "skipped";
  error?: string;
  receiptIds?: string[];
}

export interface NodeResult<T> {
  value: T;
  output?: unknown;
  costUsd?: number;
  model?: string;
  receiptIds?: string[];
  status?: "ok" | "error" | "skipped";
  error?: string;
}

/** Runs one step, times it, records it and hands the record to `emit`. Never swallows a throw. */
export async function runNode<T>(
  meta: { checkId: string; name: NodeName; type: NodeType; input: unknown },
  emit: (n: NodeRecord) => void,
  record: NodeRecord[],
  fn: () => Promise<NodeResult<T>>,
): Promise<T> {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const r = await fn();
  const node: NodeRecord = {
    checkId: meta.checkId,
    name: meta.name,
    type: meta.type,
    startedAt,
    ms: Math.round(performance.now() - t0),
    costUsd: r.costUsd ?? 0,
    model: r.model,
    input: meta.input,
    output: r.output ?? r.value,
    status: r.status ?? "ok",
    error: r.error,
    receiptIds: r.receiptIds,
  };
  record.push(node);
  emit(node);
  return r.value;
}
