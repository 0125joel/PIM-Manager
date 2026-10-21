/**
 * Post-build step: compute SHA-256 hashes of every inline <script> in the
 * static export and write them into the CSP of out/_headers (Cloudflare Pages)
 * and out/staticwebapp.config.json (Azure Static Web Apps).
 *
 * The source files in public/ keep the placeholder __CSP_SCRIPT_HASHES__ so
 * they never drift with the build; only the exported copies carry the hashes.
 *
 * Usage: node scripts/generate-csp-hashes.mjs [outDir]   (default: out)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { collectHashes, injectHashes, extractCspValue } from "./lib/cspHashes.mjs";

// Cloudflare Pages limits a _headers line to 2000 characters
const MAX_HEADER_LINE = 2000;

const outDir = process.argv[2] || "out";

function listHtmlFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) files.push(...listHtmlFiles(full));
        else if (entry.endsWith(".html")) files.push(full);
    }
    return files;
}

const htmlFiles = listHtmlFiles(outDir);
if (htmlFiles.length === 0) {
    console.error(`generate-csp-hashes: no HTML files found under ${outDir}; run next build first`);
    process.exit(1);
}

const htmlSources = htmlFiles.map((f) => readFileSync(f, "utf8"));

// style-src is 'self' only: an inline <style> element or style="" attribute in the exported HTML would be blocked
const inlineStyles = htmlFiles.filter((_, i) => /<style[\s>]|\sstyle="/i.test(htmlSources[i]));
if (inlineStyles.length > 0) {
    console.error(`generate-csp-hashes: inline styles in ${inlineStyles.join(", ")}; style-src allows no 'unsafe-inline'`);
    process.exit(1);
}

const hashes = collectHashes(htmlSources);
console.log(`generate-csp-hashes: ${hashes.length} unique inline script hash(es) from ${htmlFiles.length} HTML file(s)`);

const targets = [join(outDir, "_headers"), join(outDir, "staticwebapp.config.json")];
const cspValues = [];
for (const target of targets) {
    const updated = injectHashes(readFileSync(target, "utf8"), hashes, target);
    writeFileSync(target, updated);
    const csp = extractCspValue(updated);
    cspValues.push(csp);
    const longest = Math.max(...updated.split("\n").map((l) => l.length));
    if (longest > MAX_HEADER_LINE) {
        console.error(`generate-csp-hashes: a line in ${target} is ${longest} characters, above the ${MAX_HEADER_LINE} limit`);
        process.exit(1);
    }
    console.log(`generate-csp-hashes: wrote ${target}`);
}

if (cspValues[0] !== cspValues[1]) {
    console.error("generate-csp-hashes: the CSP in _headers and staticwebapp.config.json differ after injection");
    process.exit(1);
}
if (cspValues[0].includes("'unsafe-inline'")) {
    console.error("generate-csp-hashes: the CSP contains 'unsafe-inline' (script-src and style-src take none)");
    process.exit(1);
}
