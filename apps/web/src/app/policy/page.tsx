import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PolicyEditor } from "@/components/policy-editor";

export const metadata = { title: "Your policy · Upfront" };

const PRESETS = [
  { id: "freelancer", name: "Freelancer or studio" },
  { id: "agency", name: "Agency with milestones" },
  { id: "wholesaler", name: "Wholesaler shipping on account" },
];

function presetText(id: string): string {
  return readFileSync(join(process.cwd(), "../../packages/serv/src/policies", `${id}.md`), "utf8").trim();
}

export default function PolicyPage() {
  const presets = PRESETS.map((p) => ({ ...p, text: presetText(p.id) }));
  return (
    <div className="wrap py-16 md:py-24">
      <div className="eyebrow">Your policy</div>
      <h1 className="display mt-3 max-w-4xl text-[48px] md:text-[72px]">Your rules, in plain English.</h1>
      <p className="mt-5 max-w-2xl text-[17px] text-ink2">
        Upfront decides the way you would, written down once. SERV Reasoning compiles the policy into a reasoning graph and
        applies it to every check; hard rules (an open liquidation, a sanctions listing) sit underneath and can only make the
        terms stricter.
      </p>

      <section className="mt-14 grid gap-6 lg:grid-cols-3">
        {presets.map((p) => (
          <div key={p.id} className="card p-6">
            <div className="text-[17px] font-medium">{p.name}</div>
            <p className="mt-3 whitespace-pre-line text-[13.5px] leading-relaxed text-ink2">{p.text}</p>
          </div>
        ))}
      </section>

      <section className="mt-14">
        <div className="eyebrow mb-3">Write your own</div>
        <PolicyEditor starter={presets[0]!.text} />
      </section>
    </div>
  );
}
