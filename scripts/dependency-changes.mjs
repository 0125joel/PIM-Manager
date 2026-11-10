/**
 * Lists the dependency changes between a base commit and HEAD, for the CI job summary (.github/workflows/ci.yml).
 * Prints Markdown; exits 0 whatever changed, because the list is for a human decision, not a gate.
 *
 * Usage: node scripts/dependency-changes.mjs <base-commit>
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { directChanges, lockedChanges, summaryMarkdown } from "./lib/dependencyChanges.mjs";

const base = process.argv[2];

function atBase(file) {
    try {
        return JSON.parse(execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    } catch {
        return null; // the file did not exist at the base
    }
}

if (!base) {
    console.log("### Dependencies\n\nNo base commit to compare with.");
    process.exit(0);
}
const now = (file) => JSON.parse(readFileSync(file, "utf8"));
console.log(summaryMarkdown(directChanges(atBase("package.json"), now("package.json")), lockedChanges(atBase("package-lock.json"), now("package-lock.json"))));
