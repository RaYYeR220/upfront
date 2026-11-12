import type { Receipt } from "@upfront/core";

export interface ExecuteRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Required by Kite for allowance payments; reused on any retry of the same payment. */
  idempotencyKey: string;
}

export interface ExecuteResult {
  /** HTTP status of the merchant, or null when Kite refused before paying. */
  httpStatus: number | null;
  body: unknown;
  receipt: Receipt;
}

export interface PayerRef {
  payer: "house" | "user";
  /** Home folder that holds this payer's Passport login. */
  home: string;
}

export interface KiteExecutor {
  execute(req: ExecuteRequest, payer: PayerRef): Promise<ExecuteResult>;
  /** Recent account activity, used to attach settlement hashes to receipts. */
  activity(payer: PayerRef, limit?: number): Promise<unknown>;
}
