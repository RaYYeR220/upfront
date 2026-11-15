/** Small date helpers on ISO `YYYY-MM-DD` strings, in UTC. */

function parts(d: string): [number, number, number] {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return [y ?? 0, m ?? 1, day ?? 1];
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Adds calendar months, clamping to the end of the month (Dec 31 + 2 → Feb 28). */
export function addMonths(d: string, months: number): string {
  const [y, m, day] = parts(d);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(day, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Whole months from a to b (negative if b is before a). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  let m = (by - ay) * 12 + (bm - am);
  if (m > 0 && bd < ad) m -= 1;
  if (m < 0 && bd > ad) m += 1;
  return m;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}
