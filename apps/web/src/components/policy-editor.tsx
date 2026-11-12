"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { CheckForm } from "./check-form";

type Saved = { id: string; version: number; hash: string; name: string };

const KEY = "upfront.policy";

function remember(p: Saved & { editToken?: string }) {
  try {
    const prev = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(KEY, JSON.stringify({ ...prev, ...p }));
  } catch {
    /* private mode: the policy still works for this session */
  }
}
function recall(): (Saved & { editToken?: string }) | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}

export function PolicyEditor({ starter }: { starter: string }) {
  const [name, setName] = useState("My policy");
  const [text, setText] = useState(starter);
  const [saved, setSaved] = useState<(Saved & { editToken?: string }) | null>(() => (typeof window === "undefined" ? null : recall()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      if (saved?.editToken) {
        const v = await api.addPolicyVersion(saved.id, saved.editToken, name, text);
        const next = { ...saved, ...v, name };
        remember(next);
        setSaved(next);
      } else {
        const p = await api.createPolicy(name, text);
        const next = { id: p.id, version: p.version, hash: p.hash, name, editToken: p.editToken };
        remember(next);
        setSaved(next);
      }
    } catch {
      setErr("Couldn't save. A policy needs at least a sentence or two.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <input className="field h-10 max-w-xs" value={name} onChange={(e) => setName(e.target.value)} aria-label="Policy name" />
        {saved && (
          <span className="mono text-[12px] text-ink3">
            v{saved.version} · {saved.hash.slice(0, 10)}
          </span>
        )}
      </div>
      <textarea
        className="mono mt-4 h-72 w-full resize-y rounded-[14px] border border-line2 bg-black/30 p-4 text-[13px] leading-relaxed text-ink outline-none focus:border-rose-b"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Policy text"
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-rose" onClick={save} disabled={busy}>
          {saved ? `Save as v${saved.version + 1}` : "Save policy"}
        </button>
        <span className="text-[13px] text-ink3">
          Every version gets its own fingerprint. SERV compiles each one into the reasoning graph that decides your checks.
        </span>
      </div>
      {err && <p className="mt-2 text-[13px] text-rose2">{err}</p>}
      {saved && (
        <div className="mt-8 border-t border-line pt-6">
          <div className="eyebrow mb-3">Check a client with “{saved.name}” v{saved.version}</div>
          <CheckForm compact policyId={saved.id} policyLabel={`${saved.name} v${saved.version}`} />
        </div>
      )}
    </div>
  );
}
