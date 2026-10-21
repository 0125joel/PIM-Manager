/**
 * Conventions from AGENTS.md, enforced in CI instead of checked by an agent.
 *
 *   B1 services/*.ts end with Service.ts
 *   B2 hooks (src/hooks, src/app/**\/hooks) start with "use"
 *   B3 contexts/*.tsx end with Context.tsx
 *   B4 types/*.ts end with .types.ts
 *   B5 component files (.tsx under components/) are PascalCase
 *   C2 runWorkerPool delayMs is at least 200
 *   C4 no hardcoded ISO 8601 duration strings outside utils/durationUtils.ts
 *   C5 no console.* outside utils/logger.ts
 *
 * Tests, fixtures and the demo tenant (src/__tests__, src/demo) are out of scope.
 * A deliberate exception goes into ALLOWED with a reason: "<rule> <path>" or "<rule> <path>:<line>".
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const ALLOWED: Record<string, string> = {
  // "C4 utils/assignmentForm.ts:42": "reason",
  "B4 types/index.ts": "Re-export barrel (export * from shared.types) zodat de import van de map @/types werkt",
  "B5 app/dashboard/components/advanced/shared.tsx": "Helperbestand met meerdere kleine gedeelde onderdelen voor de Advanced-weergave, geen losse component",
  "C4 app/dev/configure/page.fixture.tsx": "Fixture-route met testdata voor visuele controle (alleen met NEXT_PUBLIC_FIXTURES=1), geen productiecode",
};

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__" && entry !== "node_modules" && entry !== "demo") files.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const FILES = walk(SRC).map((full) => ({ full, rel: toPosix(relative(SRC, full)) }));

function report(violations: string[]): string[] {
  return violations.filter((v) => {
    const [rule = "", location = ""] = v.split(" ");
    const file = location.split(":")[0];
    return !(`${rule} ${location}` in ALLOWED) && !(`${rule} ${file}` in ALLOWED);
  });
}

/** Lines of a file with comments blanked out, so commented code does not count. */
function codeLines(text: string): string[] {
  const withoutBlock = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return withoutBlock.split("\n").map((line) => line.replace(/(^|[\s;{}(),])\/\/.*$/, "$1"));
}

describe("conventions: file names", () => {
  it("follows B1 to B5", () => {
    const violations: string[] = [];
    for (const { rel } of FILES) {
      const name = basename(rel);
      if (/^services\/[^/]+\.ts$/.test(rel) && !/Service\.ts$/.test(name)) violations.push(`B1 ${rel}`);
      if (/^(hooks\/[^/]+|app\/.+\/hooks\/[^/]+)\.tsx?$/.test(rel) && !/^use[A-Z]/.test(name)) {
        violations.push(`B2 ${rel}`);
      }
      if (/^contexts\/[^/]+\.tsx$/.test(rel) && !/Context\.tsx$/.test(name)) violations.push(`B3 ${rel}`);
      if (/^types\/[^/]+\.ts$/.test(rel) && !/\.types\.ts$/.test(name)) violations.push(`B4 ${rel}`);
      if (/(^|\/)components\/.+\.tsx$/.test(rel) && !/^[A-Z][A-Za-z0-9]*(\.[a-z]+)?\.tsx$/.test(name)) {
        violations.push(`B5 ${rel}`);
      }
    }
    expect(report(violations)).toEqual([]);
  });
});

describe("conventions: code patterns", () => {
  const DURATION = /["'`](P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?)["'`]/;

  it("C2: worker pool delays are at least 200 ms", () => {
    const violations: string[] = [];
    for (const { full, rel } of FILES) {
      codeLines(readFileSync(full, "utf8")).forEach((line, i) => {
        const match = line.match(/\bdelayMs\s*[:=]\s*(\d+)\b/);
        if (match && Number(match[1]) < 200 && rel !== "utils/workerPool.ts") {
          violations.push(`C2 ${rel}:${i + 1} (delayMs ${match[1]})`);
        }
      });
    }
    expect(report(violations)).toEqual([]);
  });

  it("C4: durations go through durationUtils", () => {
    const violations: string[] = [];
    for (const { full, rel } of FILES) {
      if (rel === "utils/durationUtils.ts") continue;
      codeLines(readFileSync(full, "utf8")).forEach((line, i) => {
        const match = line.match(DURATION);
        if (match) violations.push(`C4 ${rel}:${i + 1} (${match[1]})`);
      });
    }
    expect(report(violations)).toEqual([]);
  });

  it("C5: logging goes through Logger", () => {
    const violations: string[] = [];
    for (const { full, rel } of FILES) {
      if (rel === "utils/logger.ts") continue;
      codeLines(readFileSync(full, "utf8")).forEach((line, i) => {
        if (/\bconsole\.(log|info|warn|error|debug|trace)\s*\(/.test(line)) violations.push(`C5 ${rel}:${i + 1}`);
      });
    }
    expect(report(violations)).toEqual([]);
  });
});
