// One-off: regenerate the legacy raw-TSX skills as genomes so they get
// distinct, category-driven, per-skill-accented UIs (not the shared fallback).
// Run: bun run regen.ts
import { generateUi } from "./generator";

const SKILLS = [
  "gstack-review",
  "gstack-ship",
  "gstack-investigate",
  "gstack-office-hours",
  "gstack-browse",
  "gstack-canary",
  "gstack-design-consultation",
  "gstack-plan-ceo-review",
  "gstack-retro",
];

for (const skillId of SKILLS) {
  process.stdout.write(`\n=== ${skillId} ===\n`);
  const res = await generateUi(skillId, (u) => {
    if (u.phase === "planning" || u.phase === "compiling" || u.phase === "done" || u.phase === "error") {
      process.stdout.write(`  [${u.phase}] ${u.detail ?? ""}\n`);
    }
  });
  process.stdout.write(res.ok ? `  ✓ ${skillId} generated\n` : `  ✗ ${skillId}: ${res.error}\n`);
}
process.stdout.write("\nregen complete\n");
