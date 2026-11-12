/**
 * Numbers in the docs are never typed by hand: each one sits between
 * `<!-- num:key -->` and `<!-- /num -->` and is rewritten from results JSON.
 */
const MARKER = /<!-- num:([a-zA-Z0-9_.-]+) -->([\s\S]*?)<!-- \/num -->/g;

export function renderNumbers(doc: string, values: Record<string, string>): string {
  return doc.replace(MARKER, (_m, key: string) => {
    const v = values[key];
    if (v === undefined) throw new Error(`No value for number "${key}"`);
    return `<!-- num:${key} -->${v}<!-- /num -->`;
  });
}

export function markersIn(doc: string): string[] {
  return [...doc.matchAll(MARKER)].map((m) => m[1]!);
}

export const fmt = {
  int: (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n)),
  pct: (x: number) => `${Math.round(x * 100)}%`,
  eur: (n: number) => `€${new Intl.NumberFormat("en-US").format(Math.round(n))}`,
};
