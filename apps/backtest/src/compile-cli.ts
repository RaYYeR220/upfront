// Compiles the preset policies (or a policy file) into rule programs and stores them
// next to the presets, so checks and the backtest can replay them without a key.
//
//   SERV_API_KEY=... pnpm --filter @upfront/backtest compile [-- --file path/to/policy.md --id freelancer --version 2]
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { compilePolicy, loadPolicy, makePolicy, PRESETS, PROGRAMS_DIR, programFileName, servClient } from "@upfront/serv";

const { values } = parseArgs({ options: { file: { type: "string" }, id: { type: "string" }, version: { type: "string" }, force: { type: "boolean" } } });

async function main() {
  const key = process.env.SERV_API_KEY;
  if (!key) throw new Error("SERV_API_KEY is required");
  const client = servClient(key);
  const policies = values.file
    ? [makePolicy(values.id ?? "custom", values.id ?? "custom", await readFile(values.file, "utf8"), Number(values.version ?? 1))]
    : PRESETS.map((p) => loadPolicy(p));
  await mkdir(PROGRAMS_DIR, { recursive: true });
  for (const policy of policies) {
    const file = join(PROGRAMS_DIR, programFileName(policy));
    if (existsSync(file) && !values.force) {
      console.log(`${policy.id} v${policy.version}: already compiled`);
      continue;
    }
    const c = await compilePolicy(client, policy);
    const { usage: _u, costUsd: _c, ms, ...stored } = c;
    await writeFile(file, `${JSON.stringify(stored, null, 2)}\n`);
    console.log(`${policy.id} v${policy.version}: ${c.program.rules.length} rules, ${c.program.untranslated.length} untranslated, ${ms} ms → ${file}`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
