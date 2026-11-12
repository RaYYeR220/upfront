"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { startLanding } from "./landing-engine";

/** Wraps the server-rendered landing markup and runs its motion once mounted. */
export function LandingRoot({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    return startLanding(root);
  }, []);
  return (
    <div ref={ref} className="lp">
      {children}
    </div>
  );
}
