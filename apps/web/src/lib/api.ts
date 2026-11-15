import type { CheckRow, Meta } from "./types.ts";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new ApiError(r.status, body.error ?? `http_${r.status}`);
  return body as T;
}

export const api = {
  startCheck: (b: { query: string; amountEur: number; netDaysRequested?: number; policyId?: string; policyVersion?: number }) =>
    call<{ checkId: string }>("/api/checks", { method: "POST", body: JSON.stringify(b) }),
  getCheck: (id: string) => call<CheckRow>(`/api/checks/${encodeURIComponent(id)}`),
  recentChecks: (limit = 12) => call<{ checks: Omit<CheckRow, "result" | "candidates">[] }>(`/api/checks?limit=${limit}`),
  meta: () => call<Meta>("/api/meta"),
  receipts: (limit = 50) => call<{ receipts: Record<string, unknown>[] }>(`/api/receipts?limit=${limit}`),
  policies: () => call<{ presets: { id: string; name: string; version: number; text: string; hash: string }[] }>("/api/policies"),
  createPolicy: (name: string, text: string) =>
    call<{ id: string; version: number; hash: string; editToken: string }>("/api/policies", { method: "POST", body: JSON.stringify({ name, text }) }),
  policyVersions: (id: string) => call<{ versions: { id: string; name: string; version: number; text: string; hash: string }[] }>(`/api/policies/${id}`),
  addPolicyVersion: (id: string, token: string, name: string, text: string) =>
    call<{ id: string; version: number; hash: string }>(`/api/policies/${id}/versions`, {
      method: "POST",
      headers: { "x-policy-token": token },
      body: JSON.stringify({ name, text }),
    }),
  compilePolicy: (id: string, version: number) =>
    call<import("@/components/compiled-policy").CompiledView>(`/api/policies/${encodeURIComponent(id)}/compile?version=${version}`, { method: "POST" }),
  createWatch: (b: { checkId?: string; siren?: string; invoiceAmountEur: number; dueOn?: string; label?: string }) =>
    call<{ token: string; watchUrl: string; telegramLink: string | null }>("/api/watch", { method: "POST", body: JSON.stringify(b) }),
  getWatch: (token: string) => call<Record<string, unknown>>(`/api/watch/${encodeURIComponent(token)}`),
};

export const streamUrl = (checkId: string) => `${API_BASE}/api/checks/${encodeURIComponent(checkId)}/stream`;

export const ERROR_TEXT: Record<string, string> = {
  demo_quota: "You've used today's free checks. They reset in 24 hours.",
  house_budget: "Today's free evidence budget is spent. Try again tomorrow, or call the paid API.",
  busy: "A few checks are running right now. Try again in a minute.",
  unknown_policy: "That policy doesn't exist any more.",
  invalid_request: "Check the company and the amount.",
  compile_quota: "Today's policy compiles are used up. Your policy is saved; it compiles the first time you check a client with it.",
  compile_failed: "SERV couldn't compile this policy right now. It is saved; try again later or make each rule a single condition.",
};
