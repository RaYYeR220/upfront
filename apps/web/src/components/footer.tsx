import Link from "next/link";
import { Logo } from "./nav";

export function Footer() {
  return (
    <footer className="mt-32 border-t border-line">
      <div className="wrap flex flex-col gap-8 py-12 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3 text-[13.5px] text-ink3">
            Payment terms for the clients you invoice, from public records bought one lookup at a time.
          </p>
          <p className="mt-6 text-[12.5px] text-ink4">
            Built on SERV Reasoning · Kite Agent Passport · Reppo
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-14 gap-y-2 text-[13.5px] text-ink2">
          <Link href="/check" className="hover:text-ink">Check a client</Link>
          <Link href="/developers" className="hover:text-ink">For agents</Link>
          <Link href="/policy" className="hover:text-ink">Your policy</Link>
          <Link href="/proof" className="hover:text-ink">Receipts</Link>
          <Link href="/backtest" className="hover:text-ink">Evidence</Link>
          <a href={process.env.NEXT_PUBLIC_REPO_URL ?? "#"} className="hover:text-ink">Source</a>
        </div>
      </div>
    </footer>
  );
}
