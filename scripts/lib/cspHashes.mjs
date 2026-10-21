/**
 * Pure helpers for the hash-based Content Security Policy of the static export.
 * Used by scripts/generate-csp-hashes.mjs and covered by src/__tests__/scripts/cspHashes.test.ts.
 */
import { createHash } from "node:crypto";

export const CSP_HASHES_TOKEN = "__CSP_SCRIPT_HASHES__";

/** Opening <script ...> tags without a src attribute, capturing the inline body */
const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc\s*=)(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;

/**
 * Return the exact text of every inline <script> body in an HTML document.
 * The body is taken verbatim (no trimming): the browser hashes the same bytes.
 */
export function extractInlineScripts(html) {
    const bodies = [];
    for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
        if (match[1].length > 0) bodies.push(match[1]);
    }
    return bodies;
}

/** CSP source expression for one inline script body: 'sha256-<base64>' */
export function hashScript(body) {
    const digest = createHash("sha256").update(body, "utf8").digest("base64");
    return `'sha256-${digest}'`;
}

/** Unique, sorted CSP hash expressions for all inline scripts in the given documents */
export function collectHashes(htmlDocuments) {
    const set = new Set();
    for (const html of htmlDocuments) {
        for (const body of extractInlineScripts(html)) set.add(hashScript(body));
    }
    return [...set].sort();
}

/**
 * Replace the placeholder token in a header file with the hash list.
 * Throws when the token is absent, so a misconfigured build fails instead of
 * shipping a policy that still contains the placeholder.
 */
export function injectHashes(content, hashes, fileLabel = "header file") {
    if (!content.includes(CSP_HASHES_TOKEN)) {
        throw new Error(`${fileLabel} does not contain ${CSP_HASHES_TOKEN}; cannot inject CSP hashes`);
    }
    return content.split(CSP_HASHES_TOKEN).join(hashes.join(" "));
}

/** The Content-Security-Policy value found in a _headers or staticwebapp.config.json text */
export function extractCspValue(content) {
    const match = /Content-Security-Policy["']?\s*:\s*["']?([^"\n]*)/.exec(content);
    return match ? match[1].trim() : null;
}
