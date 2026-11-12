import type { Client } from "@libsql/client";
import type { Policy, Receipt } from "@upfront/core";
import type { CheckResult } from "@upfront/engine";
import { loadPolicy, makePolicy, PRESETS, type Preset } from "@upfront/serv";

const iso = () => new Date().toISOString();
const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString();

export async function insertCheck(
  db: Client,
  c: { id: string; query: string; amountEur: number; policy: Policy; ipHash: string | null; payer: string },
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO checks (id, created_at, query, amount_eur, policy_id, policy_version, ip_hash, payer, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running')`,
    args: [c.id, iso(), c.query, c.amountEur, c.policy.id, c.policy.version, c.ipHash, c.payer],
  });
}

export async function finishCheck(
  db: Client,
  id: string,
  u: { status: string; result?: CheckResult; candidates?: unknown; error?: string },
): Promise<void> {
  await db.execute({
    sql: `UPDATE checks SET status = ?, entity_id = ?, entity_name = ?, final_mode = ?, evidence_usd = ?,
          result = ?, candidates = ?, error = ? WHERE id = ?`,
    args: [
      u.status,
      u.result?.entity.id ?? null,
      u.result?.entity.name ?? null,
      u.result?.final.mode ?? null,
      u.result?.costs.evidenceUsd ?? 0,
      u.result ? JSON.stringify(u.result) : null,
      u.candidates ? JSON.stringify(u.candidates) : null,
      u.error ?? null,
      id,
    ],
  });
}

export async function insertReceipt(db: Client, r: Receipt, owner: { checkId?: string; watchId?: string }): Promise<void> {
  await db.execute({
    sql: `INSERT OR REPLACE INTO receipts (id, check_id, watch_id, merchant, url, amount_usd, tx_hash, network, status, refusal_code, paid_at, payer)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      r.id,
      owner.checkId ?? null,
      owner.watchId ?? null,
      r.merchant,
      r.url,
      r.amountUsd,
      r.txHash,
      r.network,
      r.status,
      r.refusalCode ?? null,
      r.paidAt,
      r.payer,
    ],
  });
}

export async function setReceiptTx(db: Client, id: string, txHash: string): Promise<void> {
  await db.execute({ sql: "UPDATE receipts SET tx_hash = ? WHERE id = ?", args: [txHash, id] });
}

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
  candidates: unknown;
  error: string | null;
}

function toRow(r: Record<string, unknown>): CheckRow {
  return {
    id: String(r.id),
    createdAt: String(r.created_at),
    query: String(r.query),
    amountEur: Number(r.amount_eur),
    status: String(r.status),
    entityName: (r.entity_name as string | null) ?? null,
    finalMode: (r.final_mode as string | null) ?? null,
    evidenceUsd: Number(r.evidence_usd ?? 0),
    result: r.result ? (JSON.parse(String(r.result)) as CheckResult) : null,
    candidates: r.candidates ? JSON.parse(String(r.candidates)) : null,
    error: (r.error as string | null) ?? null,
  };
}

export async function getCheck(db: Client, id: string): Promise<CheckRow | null> {
  const r = await db.execute({ sql: "SELECT * FROM checks WHERE id = ?", args: [id] });
  return r.rows[0] ? toRow(r.rows[0] as unknown as Record<string, unknown>) : null;
}

export async function listChecks(db: Client, limit: number): Promise<Omit<CheckRow, "result" | "candidates">[]> {
  const r = await db.execute({
    sql: `SELECT id, created_at, query, amount_eur, status, entity_name, final_mode, evidence_usd, error
          FROM checks WHERE status = 'done' ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return r.rows.map((x) => {
    const { result: _r, candidates: _c, ...rest } = toRow({ ...(x as unknown as Record<string, unknown>), result: null, candidates: null });
    return rest;
  });
}

export async function listReceipts(db: Client, limit: number) {
  const r = await db.execute({
    sql: `SELECT id, check_id, watch_id, merchant, url, amount_usd, tx_hash, network, status, refusal_code, paid_at, payer
          FROM receipts ORDER BY paid_at DESC LIMIT ?`,
    args: [limit],
  });
  return r.rows;
}

export async function checksByIpLastDay(db: Client, ipHash: string): Promise<number> {
  const r = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM checks WHERE ip_hash = ? AND created_at >= ?",
    args: [ipHash, dayAgo()],
  });
  return Number(r.rows[0]?.n ?? 0);
}

export async function houseSpentLastDay(db: Client): Promise<number> {
  const r = await db.execute({
    sql: "SELECT COALESCE(SUM(amount_usd), 0) AS s FROM receipts WHERE payer = 'house' AND paid_at >= ?",
    args: [dayAgo()],
  });
  return Number(r.rows[0]?.s ?? 0);
}

export async function meta(db: Client) {
  const checks = await db.execute("SELECT COUNT(*) AS n FROM checks WHERE status = 'done'");
  const spent = await db.execute(
    "SELECT COUNT(*) AS n, COALESCE(SUM(amount_usd), 0) AS s, SUM(CASE WHEN status = 'refused' THEN 1 ELSE 0 END) AS refused FROM receipts",
  );
  const watches = await db.execute("SELECT COUNT(*) AS n FROM watches WHERE status = 'active'");
  return {
    checks: Number(checks.rows[0]?.n ?? 0),
    lookups: Number(spent.rows[0]?.n ?? 0),
    refusedLookups: Number(spent.rows[0]?.refused ?? 0),
    evidenceUsd: Number(spent.rows[0]?.s ?? 0),
    watches: Number(watches.rows[0]?.n ?? 0),
  };
}

// Policies: presets ship with the product; custom ones are versioned in the database.

export async function getPolicy(db: Client, id: string, version?: number): Promise<Policy | null> {
  if ((PRESETS as readonly string[]).includes(id)) return loadPolicy(id as Preset);
  const r = version
    ? await db.execute({ sql: "SELECT * FROM policies WHERE id = ? AND version = ?", args: [id, version] })
    : await db.execute({ sql: "SELECT * FROM policies WHERE id = ? ORDER BY version DESC LIMIT 1", args: [id] });
  const row = r.rows[0];
  if (!row) return null;
  return { id: String(row.id), name: String(row.name), version: Number(row.version), text: String(row.text), hash: String(row.hash) };
}

export async function savePolicyVersion(db: Client, id: string, name: string, text: string): Promise<Policy> {
  const prev = await getPolicy(db, id);
  const version = prev && !(PRESETS as readonly string[]).includes(id) ? prev.version + 1 : 1;
  const p = makePolicy(id, name, text, version);
  await db.execute({
    sql: "INSERT INTO policies (id, version, name, text, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [p.id, p.version, p.name, p.text, p.hash, iso()],
  });
  return p;
}

export async function listPolicyVersions(db: Client, id: string): Promise<Policy[]> {
  if ((PRESETS as readonly string[]).includes(id)) return [loadPolicy(id as Preset)];
  const r = await db.execute({ sql: "SELECT * FROM policies WHERE id = ? ORDER BY version", args: [id] });
  return r.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    version: Number(row.version),
    text: String(row.text),
    hash: String(row.hash),
  }));
}
