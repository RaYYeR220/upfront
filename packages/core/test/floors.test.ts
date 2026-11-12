import { describe, expect, it } from "vitest";
import { computeFloor } from "../src/floors.ts";
import type { Fact } from "../src/types.ts";

const fact = (id: string, kind: Fact["kind"], value: unknown, observedAt = "2026-10-14"): Fact => ({
  id,
  kind,
  value,
  observedAt,
  source: "test",
  receiptId: null,
});

describe("computeFloor", () => {
  it("declines a client in liquidation and notes the claim deadline", () => {
    const r = computeFloor([
      fact("f_1", "proceeding.open", { category: "ouverture_liquidation", publishedOn: "2026-10-14" }),
    ]);
    expect(r.floor).toBe("decline");
    expect(r.because).toEqual([{ factId: "f_1", rule: "liquidation_open" }]);
    expect(r.notes.join(" ")).toMatch(/claim/i);
  });

  it("asks for prepayment during a reorganisation or safeguard proceeding", () => {
    expect(computeFloor([fact("f_1", "proceeding.open", { category: "ouverture_redressement" })]).floor).toBe(
      "prepay",
    );
    expect(computeFloor([fact("f_2", "proceeding.open", { category: "ouverture_sauvegarde" })]).floor).toBe(
      "prepay",
    );
  });

  it("declines ceased and sanctioned companies", () => {
    expect(computeFloor([fact("f_1", "status.ceased_on", "2026-01-31")]).floor).toBe("decline");
    expect(computeFloor([fact("f_1", "sanctions.hit", { list: "EU" })]).floor).toBe("decline");
  });

  it("has no floor without hard facts", () => {
    const r = computeFloor([fact("f_1", "identity.name", "ACME"), fact("f_2", "accounts.overdue_months", 20)]);
    expect(r.floor).toBeNull();
    expect(r.because).toEqual([]);
  });

  it("keeps the strictest floor and lists every rule that fired", () => {
    const r = computeFloor([
      fact("f_1", "proceeding.open", { category: "ouverture_redressement" }),
      fact("f_2", "sanctions.hit", { list: "OFAC" }),
    ]);
    expect(r.floor).toBe("decline");
    expect(r.because).toEqual([
      { factId: "f_1", rule: "reorganisation_open" },
      { factId: "f_2", rule: "sanctioned" },
    ]);
  });
});
