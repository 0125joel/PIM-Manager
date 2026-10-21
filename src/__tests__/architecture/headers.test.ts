/**
 * The two header files (Cloudflare Pages and Azure Static Web Apps) must carry the same
 * Content Security Policy. Directive order and source order do not matter; a host that is
 * in one file and not in the other fails the test. See public/AGENTS.md.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Normalise Content-Security-Policy values: directives sorted, sources per directive sorted. */
function cspPolicies(values: string[]): string[] {
  return values
    .map((value) =>
      value
        .split(";")
        .map((part) => part.trim().split(/\s+/).filter(Boolean))
        .filter((tokens) => tokens.length > 0)
        .map(([directive, ...sources]) => `${directive} ${[...sources].sort().join(" ")}`.trim())
        .sort()
        .join("; "),
    )
    .sort();
}

function collectCspFromJson(node: unknown, found: string[]): string[] {
  if (Array.isArray(node)) node.forEach((item) => collectCspFromJson(item, found));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.toLowerCase() === "content-security-policy" && typeof value === "string") found.push(value);
      else collectCspFromJson(value, found);
    }
  }
  return found;
}

describe("architecture: header parity", () => {
  it("public/_headers and public/staticwebapp.config.json carry the same CSP", () => {
    const headers = readFileSync(join(ROOT, "public/_headers"), "utf8");
    const fromHeaders = [...headers.matchAll(/^\s*Content-Security-Policy:\s*(.+)$/gim)].map((m) => m[1] ?? "");
    const swa = JSON.parse(readFileSync(join(ROOT, "public/staticwebapp.config.json"), "utf8")) as unknown;
    const fromSwa = collectCspFromJson(swa, []);
    expect(fromHeaders.length).toBeGreaterThan(0);
    expect(cspPolicies(fromSwa)).toEqual(cspPolicies(fromHeaders));
  });
});
