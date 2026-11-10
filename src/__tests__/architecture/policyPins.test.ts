/**
 * Policy pins: changes that need a deliberate decision fail here until the pin, the docs and the
 * review move together (docs/ai/README.md, What needs Joël).
 *
 *   P1 permissions  every Graph or ARM scope the code names is in APPROVED_SCOPES, and every scope it
 *                   requests is documented in docs/architecture/auth-and-deployment.md
 *   P2 hosts        the external hosts of the Content Security Policy are exactly CSP_HOSTS, and each is
 *                   named in both public security guides (docs/en/05-security.md, docs/nl/05-beveiliging.md)
 *   P3 style        the mechanical rules of STYLEGUIDE.md: no raw palette classes, no `dark:` variants and
 *                   no hex colours outside the files that need them; existing drift may shrink, never grow;
 *                   icons come from the owned set, never from an icon library
 *
 * A new scope or host is a security decision (AGENTS.md, Architecture and security boundaries): change the
 * pin in the same pull request as the docs, and say why there. A lower count in STYLE_BASELINE is welcome;
 * lower the number with it.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { AZURE_SCOPES } from "@/config/authConfig";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

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

const FILES = walk(SRC).map((full) => ({ rel: relative(SRC, full).split("\\").join("/"), text: readFileSync(full, "utf8") }));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// ---------------------------------------------------------------------------------------------- P1

const APPROVED_SCOPES = [
  // Login (read)
  "User.Read", "RoleManagement.Read.Directory", "RoleAssignmentSchedule.Read.Directory", "RoleEligibilitySchedule.Read.Directory",
  "RoleManagementPolicy.Read.Directory", "Policy.Read.ConditionalAccess", "User.Read.All", "Group.Read.All",
  "AdministrativeUnit.Read.All", "Application.Read.All",
  // Optional, incremental consent
  "RoleManagementAlert.Read.Directory", "PrivilegedAccess.Read.AzureADGroup", "RoleManagementPolicy.Read.AzureADGroup",
  "PrivilegedAccess-CustomExt.Read.All", "Policy.Read.All",
  // Planned workloads, defined in WORKLOAD_SCOPES but not active in the UI
  "DeviceManagementRBAC.Read.All", "RoleManagement.Read.Exchange", "Sites.Read.All",
  // Configure writes, incremental consent
  "RoleManagementPolicy.ReadWrite.Directory", "RoleEligibilitySchedule.ReadWrite.Directory", "RoleAssignmentSchedule.ReadWrite.Directory",
  "RoleManagementPolicy.ReadWrite.AzureADGroup", "PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup",
  "PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup",
  // Declared, never requested (see DECLARED_NOT_REQUESTED)
  "PrivilegedAccess-CustomExt.ReadWrite.All",
].sort();

/** Named in the code but passed to no token request; documented only once something requests it. */
const DECLARED_NOT_REQUESTED: Record<string, string> = {
  "PrivilegedAccess-CustomExt.ReadWrite.All": "CUSTOM_EXTENSION_SCOPES.readWrite in config/constants.ts has no caller (2026-10-29); linking an extension uses the RoleManagementPolicy write scopes",
};

const ARM_SCOPES = ["https://management.azure.com/user_impersonation"];

const SCOPE = /["'`]([A-Z][A-Za-z]+(?:-[A-Za-z]+)?\.(?:Read|ReadWrite)(?:\.[A-Za-z]+)*)["'`]/g;

function scopesInCode(): string[] {
  const found = new Set<string>();
  for (const { text } of FILES) for (const m of text.matchAll(SCOPE)) found.add(m[1]);
  return [...found].sort();
}

describe("policy pins: permissions (P1)", () => {
  it("the code names exactly the approved Graph scopes", () => {
    const found = scopesInCode();
    expect({ added: found.filter((s) => !APPROVED_SCOPES.includes(s)), removed: APPROVED_SCOPES.filter((s) => !found.includes(s)) })
      .toEqual({ added: [], removed: [] });
  });

  it("the Azure Resource Manager scope is the one approved scope", () => {
    expect(AZURE_SCOPES).toEqual(ARM_SCOPES);
  });

  it("every requested scope is documented in docs/architecture/auth-and-deployment.md", () => {
    const doc = read("docs/architecture/auth-and-deployment.md");
    const requested = [...APPROVED_SCOPES.filter((s) => !(s in DECLARED_NOT_REQUESTED)), ...ARM_SCOPES];
    expect(requested.filter((s) => !doc.includes(s.replace("https://management.azure.com/", "")))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------- P2

const CSP_HOSTS: Record<string, string[]> = {
  "script-src": ["https://aadcdn.msauth.net", "https://aadcdn.msftauth.net", "https://alcdn.msauth.net", "https://static.cloudflareinsights.com"],
  "img-src": ["https://graph.microsoft.com"],
  "connect-src": [
    "https://api.github.com", "https://cloudflareinsights.com", "https://graph.microsoft.com", "https://login.microsoft.com",
    "https://login.microsoftonline.com", "https://management.azure.com", "https://pimmonitor.com",
  ],
  "frame-src": ["https://login.microsoftonline.com"],
};

function cspHosts(): Record<string, string[]> {
  const line = read("public/_headers").split("\n").find((l) => l.trim().startsWith("Content-Security-Policy:"));
  if (!line) throw new Error("no Content-Security-Policy in public/_headers");
  const hosts: Record<string, string[]> = {};
  for (const part of line.split(":").slice(1).join(":").split(";")) {
    const [directive, ...sources] = part.trim().split(/\s+/);
    const external = sources.filter((s) => s.startsWith("https://")).sort();
    if (directive && external.length) hosts[directive] = external;
  }
  return hosts;
}

describe("policy pins: outbound hosts (P2)", () => {
  it("the Content Security Policy allows exactly the approved external hosts", () => {
    // headers.test.ts already keeps public/staticwebapp.config.json equal to public/_headers
    expect(cspHosts()).toEqual(CSP_HOSTS);
  });

  it("both public security guides name every allowed host", () => {
    const hosts = [...new Set(Object.values(CSP_HOSTS).flat())];
    for (const guide of ["docs/en/05-security.md", "docs/nl/05-beveiliging.md"]) {
      const text = read(guide);
      expect({ guide, missing: hosts.filter((h) => !text.includes(h)) }).toEqual({ guide, missing: [] });
    }
  });
});

// ---------------------------------------------------------------------------------------------- P3

const RAW_PALETTE = /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|shadow|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
const DARK_VARIANT = /(?<![\w-])dark:[\w:/[\]#.-]+/g;
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const ICON_LIBRARY = /from\s+["'](lucide-react|react-icons[^"']*|@heroicons\/[^"']+|@fortawesome\/[^"']+|@mui\/icons-material[^"']*|@phosphor-icons\/[^"']+|@tabler\/icons[^"']*)["']/;

/** Files that cannot use the CSS tokens: generated icon paths and the PDF and export renderers, which draw outside the DOM. */
const HEX_EXEMPT: Record<string, string> = {
  "components/icons/iconData.ts": "generated from docs/Assets/icons/ by scripts/generate-icon-data.mjs",
  "components/pdf/ReportDocument.tsx": "@react-pdf/renderer has no CSS variables",
  "utils/exportChartData.ts": "chart colours for the PDF export",
  "utils/azureDashboardExport.ts": "chart colours for the Azure dashboard PDF",
  "utils/exportReport.ts": "colours for the PDF export",
};

/**
 * Drift measured 2026-10-29, reported to Joël rather than changed (STYLEGUIDE.md, Authority and updates).
 * A count may go down, never up.
 */
const STYLE_BASELINE: Record<string, { palette?: number; dark?: number; hex?: number }> = {
  "utils/scopeUtils.ts": { palette: 24, dark: 12 },
  "app/redirect/page.tsx": { palette: 3, dark: 2 },
  "app/home/components/HomePage.tsx": { dark: 30, hex: 70 },
  "types/securityAlerts.types.ts": { hex: 5 },
};

const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;

describe("policy pins: style rules of STYLEGUIDE.md (P3)", () => {
  it("raw palette classes, dark: variants and hex colours do not spread", () => {
    const grown: string[] = [];
    for (const { rel, text } of FILES) {
      const base = STYLE_BASELINE[rel] ?? {};
      const found = { palette: count(text, RAW_PALETTE), dark: count(text, DARK_VARIANT), hex: rel in HEX_EXEMPT ? 0 : count(text, HEX) };
      for (const key of ["palette", "dark", "hex"] as const) {
        if (found[key] > (base[key] ?? 0)) grown.push(`${rel}: ${key} ${found[key]} (allowed ${base[key] ?? 0})`);
      }
    }
    expect(grown).toEqual([]);
  });

  it("the baseline names only files that exist", () => {
    const names = new Set(FILES.map((f) => f.rel));
    expect([...Object.keys(STYLE_BASELINE), ...Object.keys(HEX_EXEMPT)].filter((f) => !names.has(f))).toEqual([]);
  });

  it("icons come from the owned set, never from an icon library", () => {
    expect(FILES.filter(({ text }) => ICON_LIBRARY.test(text)).map((f) => f.rel)).toEqual([]);
  });

  it("the patterns catch what they should (self-check)", () => {
    expect(count('className="bg-blue-100 hover:text-red-500 dark:bg-zinc-900"', RAW_PALETTE)).toBe(3);
    expect(count('className="bg-surface text-ink"', RAW_PALETTE)).toBe(0);
    expect(count('className="dark:text-[#48c5fa] dark:hidden"', DARK_VARIANT)).toBe(2);
    expect(count('fill="#ef4444" stroke="#fff"', HEX)).toBe(2);
    expect(ICON_LIBRARY.test('import { X } from "lucide-react";')).toBe(true);
  });
});
