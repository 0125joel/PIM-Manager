/**
 * Hard architecture rules from AGENTS.md, enforced in CI instead of only described.
 *
 * Layer rules (the same A1 to A4 the validate-architecture skill reports):
 *   A1 pages (src/app/**\/page.tsx) do not import services, except src/app/configure/**
 *   A2 shared components (src/components/**) do not import services
 *   A3 services do not import components, hooks or contexts
 *   A4 utils do not import components, hooks, services or contexts
 * CSP rule: no 'unsafe-inline' in script-src or style-src of the header files.
 *
 * Type-only imports are allowed. A deliberate exception goes into ALLOWED with a reason.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** "importer -> imported layer" pairs that are accepted on purpose, with the reason. */
const ALLOWED: Record<string, string> = {
  // "app/report/page.tsx -> services": "reason",
};

type Layer = "page" | "configure" | "components" | "services" | "utils" | "hooks" | "contexts" | "other";

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__" && entry !== "node_modules") files.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

function layerOf(srcRelative: string): Layer {
  if (srcRelative.startsWith("app/configure/")) return "configure";
  if (srcRelative.startsWith("app/") && /\/page\.tsx$/.test(srcRelative)) return "page";
  const top = srcRelative.split("/")[0];
  if (top === "components" || top === "services" || top === "utils" || top === "hooks" || top === "contexts") {
    return top;
  }
  return "other";
}

const IMPORT_RE =
  /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

function importedTopFolder(file: string, specifier: string): string | null {
  let target: string;
  if (specifier.startsWith("@/")) target = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) target = resolve(dirname(file), specifier);
  else return null;
  const rel = toPosix(relative(SRC, target));
  if (rel.startsWith("..")) return null;
  return rel.split("/")[0];
}

const FORBIDDEN: Partial<Record<Layer, { rule: string; targets: string[] }>> = {
  page: { rule: "A1", targets: ["services"] },
  components: { rule: "A2", targets: ["services"] },
  services: { rule: "A3", targets: ["components", "hooks", "contexts"] },
  utils: { rule: "A4", targets: ["components", "hooks", "services", "contexts"] },
};

describe("architecture: layer imports", () => {
  it("follows rules A1 to A4", () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const srcRelative = toPosix(relative(SRC, file));
      const forbidden = FORBIDDEN[layerOf(srcRelative)];
      if (!forbidden) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(IMPORT_RE)) {
        const top = importedTopFolder(file, match[1]);
        if (top && forbidden.targets.includes(top)) {
          const key = `${srcRelative} -> ${top}`;
          if (!(key in ALLOWED)) violations.push(`${forbidden.rule} ${key} (${match[1]})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("architecture: content security policy", () => {
  const headerFiles = ["public/_headers", "public/staticwebapp.config.json"];

  it.each(headerFiles)("%s has no 'unsafe-inline' in script-src or style-src", (path) => {
    const full = join(ROOT, path);
    expect(existsSync(full)).toBe(true);
    const text = readFileSync(full, "utf8");
    expect(text).not.toMatch(/(script-src|style-src)[^;"\n]*'unsafe-inline'/);
  });
});
