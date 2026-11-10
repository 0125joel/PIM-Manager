/**
 * Private files that next build copies from public/ into the static export. `public/AGENTS.md` (agent instructions)
 * would otherwise land in out/, in the public release.zip and on every self-hosted copy at /AGENTS.md. The mirror
 * filter only covers the source repository, so the build removes them from out/. Used by
 * scripts/strip-private-output.mjs and covered by src/__tests__/scripts/privateOutput.test.ts.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** File names that never belong in the static export, at any depth */
export const PRIVATE_OUTPUT_NAMES = ["AGENTS.md"];

/** Every file under `dir` whose name is in PRIVATE_OUTPUT_NAMES */
export function findPrivateFiles(dir) {
    const found = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) found.push(...findPrivateFiles(full));
        else if (PRIVATE_OUTPUT_NAMES.includes(entry)) found.push(full);
    }
    return found;
}

/** Remove the private files under `dir`; returns what it removed and what is still there afterwards */
export function stripPrivateFiles(dir) {
    const removed = findPrivateFiles(dir);
    for (const file of removed) rmSync(file);
    return { removed, remaining: findPrivateFiles(dir) };
}
