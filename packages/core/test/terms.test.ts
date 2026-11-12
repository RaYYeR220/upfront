import { describe, expect, it } from "vitest";
import { clampToFloor, floorDefault, stricterOf, strictness, tightenOneNotch } from "../src/terms.ts";
import type { Terms } from "../src/types.ts";

const net = (netDays: number, creditLimitEur?: number): Terms => ({ mode: "net", netDays, creditLimitEur });
const deposit = (depositPct: number): Terms => ({ mode: "deposit", depositPct });

describe("floorDefault", () => {
  it("gives the default terms of each mode", () => {
    expect(floorDefault("net")).toEqual({ mode: "net", netDays: 30 });
    expect(floorDefault("deposit")).toEqual({ mode: "deposit", depositPct: 50 });
    expect(floorDefault("prepay")).toEqual({ mode: "prepay" });
    expect(floorDefault("decline")).toEqual({ mode: "decline" });
  });
});

describe("strictness", () => {
  it("orders terms from loosest to strictest", () => {
    const ordered: Terms[] = [
      net(60),
      net(30),
      net(15),
      deposit(30),
      deposit(50),
      { mode: "prepay" },
      { mode: "decline" },
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(strictness(ordered[i]!)).toBeGreaterThan(strictness(ordered[i - 1]!));
    }
  });

  it("treats a lower credit limit as stricter at equal net days", () => {
    expect(strictness(net(30, 2000))).toBeGreaterThan(strictness(net(30, 8000)));
    expect(strictness(net(30, 2000))).toBeGreaterThan(strictness(net(30)));
  });
});

describe("stricterOf", () => {
  it("returns the stricter of two terms", () => {
    expect(stricterOf(net(30), deposit(30))).toEqual(deposit(30));
    expect(stricterOf({ mode: "decline" }, net(15))).toEqual({ mode: "decline" });
  });
});

describe("clampToFloor", () => {
  it("raises terms that are looser than the floor to the floor default", () => {
    expect(clampToFloor(net(30), "prepay")).toEqual({ mode: "prepay" });
    expect(clampToFloor(net(30), "deposit")).toEqual({ mode: "deposit", depositPct: 50 });
  });
  it("keeps terms already at or above the floor", () => {
    expect(clampToFloor({ mode: "decline" }, "deposit")).toEqual({ mode: "decline" });
    expect(clampToFloor(deposit(30), "deposit")).toEqual(deposit(30));
  });
  it("is a no-op without a floor", () => {
    expect(clampToFloor(net(45), null)).toEqual(net(45));
  });
});

describe("tightenOneNotch", () => {
  it("moves one step stricter and saturates at the top", () => {
    expect(tightenOneNotch(net(30))).toEqual({ mode: "deposit", depositPct: 50 });
    expect(tightenOneNotch(deposit(50))).toEqual({ mode: "prepay" });
    expect(tightenOneNotch({ mode: "prepay" })).toEqual({ mode: "prepay" });
    expect(tightenOneNotch({ mode: "decline" })).toEqual({ mode: "decline" });
  });
});
