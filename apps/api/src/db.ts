import { type Client, createClient } from "@libsql/client";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS checks (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    query TEXT NOT NULL,
    amount_eur INTEGER NOT NULL,
    policy_id TEXT NOT NULL,
    policy_version INTEGER NOT NULL,
    ip_hash TEXT,
    payer TEXT NOT NULL DEFAULT 'house',
    status TEXT NOT NULL,
    entity_id TEXT,
    entity_name TEXT,
    final_mode TEXT,
    evidence_usd REAL DEFAULT 0,
    result TEXT,
    candidates TEXT,
    error TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS checks_ip ON checks(ip_hash, created_at)`,
  `CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    check_id TEXT,
    watch_id TEXT,
    merchant TEXT NOT NULL,
    url TEXT NOT NULL,
    amount_usd REAL NOT NULL,
    tx_hash TEXT,
    network TEXT NOT NULL,
    status TEXT NOT NULL,
    refusal_code TEXT,
    paid_at TEXT NOT NULL,
    payer TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS receipts_paid ON receipts(paid_at)`,
  `CREATE TABLE IF NOT EXISTS policies (
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS watches (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    siren TEXT NOT NULL,
    label TEXT,
    invoice_amount_eur INTEGER NOT NULL,
    due_on TEXT,
    last_checked_on TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    telegram_chat_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_check_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS watch_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watch_id TEXT NOT NULL,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    at TEXT NOT NULL
  )`,
];

export async function openDb(url: string): Promise<Client> {
  const db = createClient({ url });
  for (const sql of SCHEMA) await db.execute(sql);
  return db;
}
