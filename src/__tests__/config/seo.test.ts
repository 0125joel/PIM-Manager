/**
 * The public front page is described in several places that cannot import each other: `src/config/site.ts` (the page,
 * the metadata and the structured data), and the static files `public/llms.txt`, `public/robots.txt`,
 * `public/sitemap.xml` and the two header files. This keeps them in line. See `src/config/site.ts`.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COVERAGE,
  FAQ,
  OG_IMAGE_PATH,
  REPO_URL,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_TITLE,
  SITE_URL,
  STATUS_LABEL,
  softwareApplicationJsonLd,
  toJsonLdString,
} from "@/config/site";

const PUBLIC = join(process.cwd(), "public");
const read = (file: string) => readFileSync(join(PUBLIC, file), "utf8");

/** Whether a page.tsx exists in this folder or below it */
function hasPage(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some((entry) => (entry.isDirectory() ? hasPage(join(dir, entry.name)) : entry.name === "page.tsx"));
}

/**
 * The first path segment of every page under src/app except the front page, the MSAL redirect bridge (its own rules) and
 * the fixture routes: they hold a sign-in screen or the app itself and are never meant for search results. Read from
 * the folders, so a new route (such as /azure) fails here until `public/_headers` has its two noindex rules.
 */
const APP_ROUTES = readdirSync(join(process.cwd(), "src/app"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !["dev", "redirect"].includes(entry.name) && !entry.name.startsWith("_"))
  .filter((entry) => hasPage(join(process.cwd(), "src/app", entry.name)))
  .map((entry) => `/${entry.name}`);

/** AI model training crawlers: kept out in robots.txt. Search and answer bots (for example OAI-SearchBot) are not listed */
const TRAINING_BOTS = ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "Meta-ExternalAgent"];

describe("front page metadata", () => {
  it("keeps the description within what a search result shows", () => {
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it("names Microsoft Entra and admin roles in the title, and PIM in the keywords", () => {
    expect(SITE_TITLE).toContain("Microsoft Entra");
    expect(SITE_TITLE).toContain("admin roles");
    expect(SITE_KEYWORDS).toContain("Microsoft Entra PIM");
  });

  it("names the principal types and the admin posture in the description and the keywords", () => {
    for (const word of ["guests", "apps", "AI agents"]) expect(SITE_DESCRIPTION).toContain(word);
    for (const keyword of ["Entra RBAC", "admin role posture", "guest admin roles", "service principal roles", "AI agent identities"]) {
      expect(SITE_KEYWORDS).toContain(keyword);
    }
  });

  it("leaves the Azure terms out of the description and the keywords until Azure is available", () => {
    const azure = COVERAGE.find((item) => item.key === "azure-resource-roles");
    const text = `${SITE_DESCRIPTION} ${SITE_KEYWORDS.join(" ")}`;
    expect(/azure/i.test(text)).toBe(azure?.status === "available");
  });

  it("serves the structured data as a SoftwareApplication that lists only available coverage", () => {
    const data = softwareApplicationJsonLd();
    expect(data["@type"]).toBe("SoftwareApplication");
    expect(data.url).toBe(SITE_URL);
    expect(data.featureList).toEqual(COVERAGE.filter((item) => item.status === "available").map((item) => item.name));
  });

  it("escapes `<` in the JSON-LD string so the data cannot close the script element", () => {
    const text = toJsonLdString({ name: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("<");
    expect(JSON.parse(text).name).toBe("</script><script>alert(1)</script>");
  });

  it("has an answer for every question", () => {
    for (const item of FAQ) {
      expect(item.question.trim()).not.toBe("");
      expect(item.answer.trim()).not.toBe("");
    }
  });

  it("ships the social image at the size the Open Graph tags state (1200 x 630 PNG)", () => {
    const file = join(PUBLIC, OG_IMAGE_PATH.replace(/^\//, ""));
    expect(existsSync(file)).toBe(true);
    const png = readFileSync(file);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});

describe("public/llms.txt", () => {
  const llms = read("llms.txt");

  it("starts with the project name and a one-line summary", () => {
    expect(llms.startsWith("# PIM Manager\n")).toBe(true);
    expect(llms).toMatch(/^> .+/m);
  });

  it("states every coverage item with the same status words as the site", () => {
    for (const item of COVERAGE) {
      const line = llms.split("\n").find((l) => l.startsWith("- ") && l.includes(`: ${STATUS_LABEL[item.status]}`) && l.toLowerCase().includes(item.name.toLowerCase().replace(" (entra roles)", "")));
      expect(line, `${item.name} (${item.status})`).toBeDefined();
    }
  });

  it("says which principal types hold roles and which posture risks it points out", () => {
    for (const word of ["guests", "service principals", "AI agents", "Permanent Global Administrators", "without an end date"]) {
      expect(llms).toContain(word);
    }
  });

  it("points at the hosted site and the repository", () => {
    expect(llms).toContain(SITE_URL);
    expect(llms).toContain(REPO_URL);
  });

  it("does not claim Azure is available while it is in development", () => {
    const azure = COVERAGE.find((item) => item.key === "azure-resource-roles");
    if (azure?.status === "available") return;
    const line = llms.split("\n").find((l) => l.startsWith("- Azure resource roles")) ?? "";
    expect(line).toContain(STATUS_LABEL.planned);
    expect(line).toContain("not available yet");
  });
});

describe("public/robots.txt", () => {
  const robots = read("robots.txt");
  const groups = robots
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").filter((l) => l.trim() && !l.startsWith("#")))
    .filter((lines) => lines.length > 0);

  it("points at the sitemap on the canonical host", () => {
    expect(robots).toMatch(new RegExp(`^Sitemap: ${SITE_URL}/sitemap\\.xml$`, "m"));
  });

  it("keeps the AI training crawlers out and does not block everyone else", () => {
    const blocked = groups.find((lines) => lines.includes("Disallow: /"));
    expect(blocked).toBeDefined();
    for (const bot of TRAINING_BOTS) expect(blocked).toContain(`User-agent: ${bot}`);

    const everyone = groups.find((lines) => lines.includes("User-agent: *"));
    expect(everyone).toBeDefined();
    expect(everyone).not.toContain("Disallow: /");
  });

  it("allows search and AI answers and refuses training in the content signal", () => {
    expect(robots).toMatch(/^Content-Signal: search=yes, ai-input=yes, ai-train=no$/m);
  });

  it("does not name the search and answer bots, so they follow the group for everyone", () => {
    for (const bot of ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Claude-SearchBot", "Googlebot", "Bingbot"]) {
      expect(robots).not.toContain(`User-agent: ${bot}`);
    }
  });

  it("does not block the app routes: crawlers must be able to read their noindex header", () => {
    for (const route of APP_ROUTES) expect(robots).not.toContain(`Disallow: ${route}`);
  });
});

describe("public/sitemap.xml", () => {
  const sitemap = read("sitemap.xml");
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it("lists only the front page", () => {
    expect(locations).toEqual([`${SITE_URL}/`]);
  });
});

describe("noindex headers", () => {
  const headers = read("_headers");
  const swa = JSON.parse(read("staticwebapp.config.json")) as { globalHeaders: Record<string, string> };

  /** The header lines of one `_headers` rule, by its path line */
  const rule = (path: string): string[] => {
    const lines = headers.split("\n");
    const start = lines.findIndex((l) => l === path);
    if (start === -1) return [];
    const out: string[] = [];
    for (let i = start + 1; i < lines.length && lines[i].startsWith("  "); i++) out.push(lines[i].trim());
    return out;
  };

  it("finds the app routes from the folders of src/app", () => {
    expect(APP_ROUTES).toEqual(expect.arrayContaining(["/dashboard", "/report", "/configure", "/settings", "/help", "/demo"]));
    expect(APP_ROUTES).not.toContain("/redirect");
    expect(APP_ROUTES).not.toContain("/dev");
  });

  it("keeps every app route and its sub paths out of search results on Cloudflare Pages", () => {
    for (const route of APP_ROUTES) {
      expect(rule(route), route).toContain("X-Robots-Tag: noindex, nofollow");
      expect(rule(`${route}/*`), `${route}/*`).toContain("X-Robots-Tag: noindex, nofollow");
    }
  });

  it("keeps the pages.dev and preview addresses out of search results", () => {
    expect(rule("https://:project.pages.dev/*")).toContain("X-Robots-Tag: noindex");
    expect(rule("https://:version.:project.pages.dev/*")).toContain("X-Robots-Tag: noindex");
  });

  it("leaves the front page indexable: no rule for `/` and no catch-all noindex", () => {
    expect(rule("/")).toEqual([]);
    expect(rule("/*").some((line) => line.toLowerCase().startsWith("x-robots-tag"))).toBe(false);
  });

  it("keeps a self-hosted copy (Azure Static Web Apps) out of search results", () => {
    expect(swa.globalHeaders["X-Robots-Tag"]).toBe("noindex, nofollow");
  });
});

describe("front page social tags", () => {
  it("repeats the image and the large card in the page metadata, which replaces the layout's openGraph and twitter objects", async () => {
    const { metadata } = await import("@/app/page");
    const images = (metadata.openGraph as { images?: { url: string }[] }).images;
    expect(images?.[0].url).toBe(OG_IMAGE_PATH);
    expect((metadata.twitter as { card?: string }).card).toBe("summary_large_image");
    expect((metadata.twitter as { images?: string[] }).images).toEqual([OG_IMAGE_PATH]);
  });
});
