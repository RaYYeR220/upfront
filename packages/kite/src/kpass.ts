import { execFile } from "node:child_process";
import { parseExecute } from "./receipt.ts";
import type { ExecuteRequest, ExecuteResult, KiteExecutor, PayerRef } from "./types.ts";

interface RunResult {
  code: number;
  stdout: string;
}

function run(bin: string, args: string[], home: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { env: { ...process.env, HOME: home, USERPROFILE: home }, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
        resolve({ code, stdout: String(stdout ?? "") });
      },
    );
  });
}

/**
 * Pays through Kite Agent Passport by driving the `kpass` CLI (Kite has no HTTP
 * API for agents). Each payer keeps its own Passport login in its own home folder.
 */
export function createKpassExecutor(opts: { bin?: string; timeoutMs?: number } = {}): KiteExecutor {
  const bin = opts.bin ?? "kpass";
  // Kite allows up to 5 minutes for a routed settlement.
  const timeoutMs = opts.timeoutMs ?? 300_000;
  return {
    async execute(req: ExecuteRequest, payer: PayerRef): Promise<ExecuteResult> {
      const args = ["session", "execute", "--url", req.url, "--method", req.method ?? "GET"];
      if (req.headers) args.push("--headers", JSON.stringify(req.headers));
      if (req.body) args.push("--body", req.body);
      args.push("--idempotency-key", req.idempotencyKey, "--output", "json", "--no-interactive");
      const { code, stdout } = await run(bin, args, payer.home, timeoutMs);
      return parseExecute(stdout, code, req, { payer: payer.payer, now: new Date().toISOString() });
    },
    async activity(payer: PayerRef, limit = 50): Promise<unknown> {
      const { stdout } = await run(bin, ["activity", "--limit", String(limit), "--output", "json", "--no-interactive"], payer.home, 60_000);
      try {
        return JSON.parse(stdout);
      } catch {
        return { events: [] };
      }
    },
  };
}
