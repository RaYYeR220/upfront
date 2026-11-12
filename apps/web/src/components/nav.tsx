import Link from "next/link";

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5 font-semibold tracking-[-0.02em] text-[17px]">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r="7.5" fill="none" stroke="var(--rose)" strokeWidth="1.2" />
        <circle cx="9" cy="9" r="2.4" fill="var(--rose)" />
      </svg>
      Upfront
    </span>
  );
}

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/policy", label: "Your policy" },
  { href: "/backtest", label: "Evidence" },
  { href: "/developers", label: "For agents" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur">
      <div className="wrap flex h-16 items-center justify-between">
        <Link href="/" aria-label="Upfront home">
          <Logo />
        </Link>
        <nav className="hidden gap-8 text-[14px] text-ink2 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="transition-colors hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <Link href="/check" className="btn h-9 px-4 text-[13.5px]">
          Check a client
        </Link>
      </div>
    </header>
  );
}
