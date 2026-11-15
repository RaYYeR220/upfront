import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProgram, probeProgram } from "@upfront/core";
import { CompiledPolicy, type CompiledView } from "@/components/compiled-policy";
import { PolicyEditor } from "@/components/policy-editor";

export const metadata = { title: "Your policy · Upfront" };

const SERV_DIR = join(process.cwd(), "../../packages/serv/src");
const PRESETS = [
  { id: "freelancer", name: "Freelancer or studio" },
  { id: "agency", name: "Agency with milestones" },
  { id: "wholesaler", name: "Wholesaler shipping on account" },
];

const presetText = (id: string) => readFileSync(join(SERV_DIR, "policies", `${id}.md`), "utf8").trim();

/** The committed program for the preset's first version, if it has been compiled. */
function presetProgram(id: string): CompiledView | null {
  const file = readdirSync(join(SERV_DIR, "programs")).find((f) => f.startsWith(`${id}-v1-`));
  if (!file) return null;
  const c = JSON.parse(readFileSync(join(SERV_DIR, "programs", file), "utf8"));
  const parsed = parseProgram(c.program);
  if (!parsed.ok) return null;
  return {
    compiledBy: c.model,
    rules: parsed.program.rules.map((r) => ({ id: r.id, why: r.why, then: r.then })),
    untranslated: parsed.program.untranslated,
    warnings: c.warnings ?? [],
    samples: probeProgram(parsed.program),
  };
}

export default function PolicyPage() {
  const presets = PRESETS.map((p) => ({ ...p, text: presetText(p.id), program: presetProgram(p.id) }));
  const [main, ...others] = presets;
  return (
    <div className="wrap py-16 md:py-24">
      <div className="eyebrow">Your policy</div>
      <h1 className="display mt-3 max-w-4xl text-[48px] md:text-[72px]">Your rules, in plain English.</h1>
      <p className="mt-5 max-w-2xl text-[17px] text-ink2">
        Write how you decide once. SERV Reasoning compiles it into rules, Upfront tries them on ten sample clients before use, and
        every check applies the same rules the same way, so you can always see which one set the terms. Hard rules (an open
        liquidation, a sanctions listing) sit underneath and can only make the terms stricter.
      </p>

      <section className="mt-14 grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <div className="text-[17px] font-medium">{main!.name}</div>
          <p className="mt-3 whitespace-pre-line text-[13.5px] leading-relaxed text-ink2">{main!.text}</p>
        </div>
        <div className="card p-6">{main!.program ? <CompiledPolicy view={main!.program} /> : null}</div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        {others.map((p) => (
          <div key={p.id} className="card p-6">
            <div className="text-[17px] font-medium">{p.name}</div>
            <p className="mt-3 whitespace-pre-line text-[13.5px] leading-relaxed text-ink2">{p.text}</p>
            <div className="mt-5 border-t border-line pt-4">
              {p.program ? <CompiledPolicy view={p.program} compact /> : <p className="text-[13px] text-ink3">Compiled the first time someone checks a client with it.</p>}
            </div>
          </div>
        ))}
      </section>

      <section className="mt-14">
        <div className="eyebrow mb-3">Write your own</div>
        <PolicyEditor starter={main!.text} />
      </section>
    </div>
  );
}
