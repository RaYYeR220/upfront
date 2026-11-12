import { describe, expect, it } from "vitest";
import { addMonths, daysBetween, monthsBetween } from "../src/dates.ts";

describe("dates", () => {
  it("adds months with an end-of-month clamp", () => {
    expect(addMonths("2026-10-14", 2)).toBe("2026-12-14");
    expect(addMonths("2026-12-31", 2)).toBe("2027-02-28");
    expect(addMonths("2023-12-31", 19)).toBe("2025-07-31");
  });
  it("counts whole months and days", () => {
    expect(monthsBetween("2025-07-31", "2026-11-12")).toBe(15);
    expect(monthsBetween("2026-11-12", "2025-07-31")).toBe(-15);
    expect(daysBetween("2025-03-28", "2026-10-14")).toBe(565);
  });
});
