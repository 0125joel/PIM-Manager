/**
 * ARM is not Graph (src/services/AGENTS.md, "Azure Resource Manager"): an azure* service never calls ARM through the
 * Graph client or counts against graphRateLimiter, and the ARM client itself does not use either. Type-only imports
 * count too: an azure* service has no reason to know the Graph client type.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const IMPORT_RE = /^\s*(?:import|export)\b[^'"]*?(?:\sfrom\s+)?['"]([^'"]+)['"]/gm;
const GRAPH_SDK = "@microsoft/microsoft-graph-client";
const GRAPH_CLIENT_MODULE = /(^|\/)graphClient$/;

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) files.push(full);
  }
  return files;
}

/** The Graph-side imports of one file's source; `allowGraphClientModule` lets armClient take parseRetryAfterMs */
function graphImports(text: string, allowGraphClientModule = false): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(IMPORT_RE)) {
    const specifier = match[1];
    if (specifier === GRAPH_SDK || specifier.startsWith(`${GRAPH_SDK}/`)) found.push(specifier);
    else if (!allowGraphClientModule && GRAPH_CLIENT_MODULE.test(specifier)) found.push(specifier);
  }
  if (/\bgraphRateLimiter\b/.test(text)) found.push("graphRateLimiter");
  return found;
}

describe("architecture: ARM stays off the Graph client", () => {
  it("detects the forbidden imports (self-check, so an empty services folder cannot hide a broken rule)", () => {
    expect(graphImports(`import { Client } from "@microsoft/microsoft-graph-client";`)).toEqual([GRAPH_SDK]);
    expect(graphImports(`import type { Client } from '@microsoft/microsoft-graph-client';`)).toEqual([GRAPH_SDK]);
    expect(graphImports(`import { createGraphClient } from "@/utils/graphClient";`)).toEqual(["@/utils/graphClient"]);
    expect(graphImports(`import { graphRateLimiter } from "@/utils/rateLimiter";`)).toEqual(["graphRateLimiter"]);
    expect(graphImports(`import { armRateLimiter } from "@/utils/rateLimiter";\nimport { createArmClient } from "@/utils/armClient";`)).toEqual([]);
  });

  it("no azure* service imports the Graph client or graphRateLimiter", () => {
    const services = walk(join(SRC, "services")).filter((file) => basename(file).startsWith("azure"));
    const violations = services.flatMap((file) =>
      graphImports(readFileSync(file, "utf8")).map((what) => `${relative(SRC, file)} -> ${what}`)
    );
    expect(violations).toEqual([]);
  });

  it("the ARM client uses neither the Graph SDK nor graphRateLimiter", () => {
    const text = readFileSync(join(SRC, "utils", "armClient.ts"), "utf8");
    expect(graphImports(text, true)).toEqual([]);
  });
});
