/**
 * ARM is not Graph (src/services/AGENTS.md, "Azure Resource Manager"): an azure* service never calls ARM through the
 * Graph client or counts against graphRateLimiter, and the ARM client itself does not use either. Type-only imports
 * count too: an azure* service has no reason to know the Graph client type. Every other service that takes the ARM client
 * (such as auditWorkspaceService) follows the same rule, so the check covers each file that imports `@/utils/armClient`.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const IMPORT_RE = /^\s*(?:import|export)\b[^'"]*?(?:\sfrom\s+)?['"]([^'"]+)['"]/gm;
const GRAPH_SDK = "@microsoft/microsoft-graph-client";
const GRAPH_CLIENT_MODULE = /(^|\/)graphClient$/;
const ARM_CLIENT_IMPORT = /['"]@\/utils\/armClient['"]/;
/** The one Graph-side import an ARM service may keep: `parseRetryAfterMs` alone (the same exemption armClient.ts has) */
const PARSE_RETRY_AFTER_ONLY = /^[ \t]*import\s+(?:type\s+)?\{\s*parseRetryAfterMs\s*\}\s*from\s*['"]@\/utils\/graphClient['"];?[ \t]*$/gm;

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

/** The Graph-side imports of a service that takes the ARM client: `import { parseRetryAfterMs } from graphClient` alone is allowed */
function serviceGraphImports(text: string): string[] {
  return graphImports(text.replace(PARSE_RETRY_AFTER_ONLY, ""));
}

describe("architecture: ARM stays off the Graph client", () => {
  it("detects the forbidden imports (self-check, so an empty services folder cannot hide a broken rule)", () => {
    expect(graphImports(`import { Client } from "@microsoft/microsoft-graph-client";`)).toEqual([GRAPH_SDK]);
    expect(graphImports(`import type { Client } from '@microsoft/microsoft-graph-client';`)).toEqual([GRAPH_SDK]);
    expect(graphImports(`import { createGraphClient } from "@/utils/graphClient";`)).toEqual(["@/utils/graphClient"]);
    expect(graphImports(`import { graphRateLimiter } from "@/utils/rateLimiter";`)).toEqual(["graphRateLimiter"]);
    expect(graphImports(`import { armRateLimiter } from "@/utils/rateLimiter";\nimport { createArmClient } from "@/utils/armClient";`)).toEqual([]);
  });

  it("detects the ARM client import, and allows only parseRetryAfterMs from graphClient in a service (self-check)", () => {
    expect(ARM_CLIENT_IMPORT.test(`import type { ArmClient } from "@/utils/armClient";`)).toBe(true);
    expect(ARM_CLIENT_IMPORT.test(`import { parseRetryAfterMs } from "@/utils/graphClient";`)).toBe(false);
    expect(serviceGraphImports(`import { parseRetryAfterMs } from "@/utils/graphClient";`)).toEqual([]);
    expect(serviceGraphImports(`import { parseRetryAfterMs, createGraphClient } from "@/utils/graphClient";`)).toEqual(["@/utils/graphClient"]);
    expect(serviceGraphImports(`import type { Client } from "@microsoft/microsoft-graph-client";`)).toEqual([GRAPH_SDK]);
    expect(serviceGraphImports(`import { graphRateLimiter } from "@/utils/rateLimiter";`)).toEqual(["graphRateLimiter"]);
  });

  it("no azure* service imports the Graph client or graphRateLimiter", () => {
    const services = walk(join(SRC, "services")).filter((file) => basename(file).startsWith("azure"));
    const violations = services.flatMap((file) =>
      graphImports(readFileSync(file, "utf8")).map((what) => `${relative(SRC, file)} -> ${what}`)
    );
    expect(violations).toEqual([]);
  });

  it("no service that takes the ARM client imports the Graph client or graphRateLimiter, whatever its name", () => {
    const services = walk(join(SRC, "services")).filter((file) => ARM_CLIENT_IMPORT.test(readFileSync(file, "utf8")));
    expect(services.length).toBeGreaterThan(0);
    const violations = services.flatMap((file) =>
      serviceGraphImports(readFileSync(file, "utf8")).map((what) => `${relative(SRC, file)} -> ${what}`)
    );
    expect(violations).toEqual([]);
  });

  it("the ARM client uses neither the Graph SDK nor graphRateLimiter", () => {
    const text = readFileSync(join(SRC, "utils", "armClient.ts"), "utf8");
    expect(graphImports(text, true)).toEqual([]);
  });
});

/**
 * A worker pool never takes `armRateLimiter` itself: the ARM client already counts every request it sends (every page
 * included) on that limiter, so a second count for the same requests made large Azure estates wait for nothing (AU-23a).
 * The Activity Log pool has always followed this rule.
 */
const POOL_TAKES_ARM_LIMITER = /\brateLimiter\s*:\s*armRateLimiter\b/;
describe("architecture: ARM requests count once", () => {
  it("detects a pool that takes armRateLimiter (self-check)", () => {
    expect(POOL_TAKES_ARM_LIMITER.test("runWorkerPool({ items, rateLimiter: armRateLimiter, costPerItem: 2 })")).toBe(true);
    expect(POOL_TAKES_ARM_LIMITER.test('withRetry(fn, 3, 1000, "x", armRateLimiter)')).toBe(false);
    expect(POOL_TAKES_ARM_LIMITER.test("runWorkerPool({ rateLimiter: graphRateLimiter })")).toBe(false);
  });

  it("no worker pool passes rateLimiter: armRateLimiter, because the ARM client already counts every request", () => {
    const sources = walk(SRC).filter((file) => !relative(SRC, file).split("\\").join("/").startsWith("__tests__/"));
    const violations = sources
      .filter((file) => POOL_TAKES_ARM_LIMITER.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file).split("\\").join("/"));
    expect(violations).toEqual([]);
  });
});
