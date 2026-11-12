import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Policy } from "@upfront/core";

export const PRESETS = ["freelancer", "agency", "wholesaler"] as const;
export type Preset = (typeof PRESETS)[number];

const NAMES: Record<Preset, string> = {
  freelancer: "Freelancer or studio",
  agency: "Agency with milestones",
  wholesaler: "Wholesaler shipping on account",
};

export const policyHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export function makePolicy(id: string, name: string, text: string, version = 1): Policy {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  return { id, name, version, text: normalized, hash: policyHash(normalized) };
}

export function loadPolicy(preset: Preset): Policy {
  const text = readFileSync(join(import.meta.dirname, "policies", `${preset}.md`), "utf8");
  return makePolicy(preset, NAMES[preset], text);
}
