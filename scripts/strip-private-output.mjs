/**
 * Post-build step: remove private files (agent instructions such as AGENTS.md) from the static export, so they never
 * reach release.zip, a test deployment or a self-hosted copy. Exits non-zero when one is still there afterwards.
 *
 * Usage: node scripts/strip-private-output.mjs [outDir]   (default: out)
 */
import { existsSync } from "node:fs";
import { stripPrivateFiles } from "./lib/privateOutput.mjs";

const outDir = process.argv[2] || "out";

if (!existsSync(outDir)) {
    console.error(`strip-private-output: ${outDir} does not exist; run next build first`);
    process.exit(1);
}

const { removed, remaining } = stripPrivateFiles(outDir);
for (const file of removed) console.log(`strip-private-output: removed ${file}`);
if (remaining.length > 0) {
    console.error(`strip-private-output: still in the export: ${remaining.join(", ")}`);
    process.exit(1);
}
console.log(`strip-private-output: no private files left in ${outDir}`);
