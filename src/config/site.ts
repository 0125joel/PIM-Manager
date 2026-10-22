/**
 * Public site facts: the single source for the front page, the page metadata and the structured data (JSON-LD).
 * `public/llms.txt`, `public/robots.txt` and `public/sitemap.xml` are static files; `src/__tests__/config/seo.test.ts`
 * keeps them in line with this file.
 *
 * Azure resource roles (Azure RBAC through PIM) are tracked here as a coverage item with a status. Set it to
 * "available" when the Azure workload ships: the coverage list, the FAQ answer, the descriptions and the structured
 * data follow, and the test then fails until `public/llms.txt` says the same.
 */

export const SITE_URL = "https://pimmanager.com";
export const SITE_NAME = "PIM Manager";
export const REPO_URL = "https://github.com/0125joel/PIM-Manager";
export const AUTHOR = { name: "Joël Prins", url: "https://www.linkedin.com/in/jo%C3%ABl-prins-4b4655aa/" };
export const OG_IMAGE_PATH = "/og-image.png";
export const OG_IMAGE_ALT = "PIM Manager dashboard: who has privileged access in an Entra ID tenant, and on which terms";

export type CoverageStatus = "available" | "planned";

export interface CoverageItem {
  key: string;
  /** Part of the sign-in scope set, as opposed to an optional workload */
  core: boolean;
  name: string;
  text: string;
  status: CoverageStatus;
}

export const COVERAGE: CoverageItem[] = [
  { key: "directory-roles", core: true, name: "Directory roles", text: "Built-in and custom roles, assignments and role policies", status: "available" },
  { key: "pim-for-groups", core: false, name: "PIM for Groups", text: "Member and owner assignments on PIM-onboarded groups", status: "available" },
  { key: "role-assignable-groups", core: false, name: "Role-assignable groups", text: "Groups that can hold Entra roles but are not under PIM yet", status: "available" },
  { key: "security-alerts", core: false, name: "Security alerts", text: "PIM alerts, such as too many Global Admins, with the accounts involved", status: "available" },
  {
    key: "azure-resource-roles",
    core: false,
    name: "Azure resource roles",
    text: "Azure RBAC role eligibility and assignments on management groups, subscriptions, resource groups and resources",
    status: "planned",
  },
];

/** Words used for a status wherever the site states it; the test checks `public/llms.txt` for the same words */
export const STATUS_LABEL: Record<CoverageStatus, string> = {
  available: "available",
  planned: "in development",
};

export function coverageMarker(item: CoverageItem): string {
  if (item.status === "planned") return "[soon]";
  return item.core ? "[core]" : "[opt]";
}

const azureItem = COVERAGE.find((item) => item.key === "azure-resource-roles") as CoverageItem;
export const AZURE_AVAILABLE = azureItem.status === "available";

/** Who and what can hold an Entra role, as the dashboard and the report show them (the principal types of the app) */
export const PRINCIPALS = ["users", "guests", "apps and managed identities", "groups", "AI agents (Microsoft Entra Agent ID)"];

export const SITE_TITLE = "PIM Manager: who holds admin roles in Microsoft Entra, and on what terms";

const BASE_DESCRIPTION =
  "See who holds Microsoft Entra admin roles, from users and guests to apps and AI agents, and change PIM policies in bulk. Open source, runs in your browser.";
export const SITE_DESCRIPTION = AZURE_AVAILABLE
  ? "See who holds admin roles in Microsoft Entra and Azure RBAC, from users and guests to apps and AI agents, and change PIM in bulk. Open source, in your browser."
  : BASE_DESCRIPTION;

export const SITE_KEYWORDS = [
  "Microsoft Entra PIM",
  "Privileged Identity Management",
  "PIM report",
  "PIM bulk configuration",
  "Entra ID roles",
  "Entra role assignments",
  "Entra RBAC",
  "admin role posture",
  "privileged access",
  "guest admin roles",
  "service principal roles",
  "AI agent identities",
  "Microsoft Entra Agent ID",
  "PIM for Groups",
  ...(AZURE_AVAILABLE ? ["Azure RBAC PIM", "Azure resource roles PIM"] : []),
];

export interface FaqItem {
  question: string;
  answer: string;
}

const azureAnswer = AZURE_AVAILABLE
  ? "Yes. Besides Entra directory roles and PIM for Groups, PIM Manager covers PIM for Azure resources: Azure RBAC role eligibility and assignments on management groups, subscriptions, resource groups and resources. These come from Azure Resource Manager, a separate API from Microsoft Graph."
  : "Not yet. Azure resource roles (Azure RBAC through PIM, on management groups, subscriptions, resource groups and resources) are in development. Today PIM Manager covers Entra directory roles and PIM for Groups. Azure resources come from Azure Resource Manager, a separate API from Microsoft Graph, and are built on the same report and configuration model.";

export const FAQ: FaqItem[] = [
  {
    question: "What is PIM Manager?",
    answer:
      "An open-source (GPLv3) web app that shows who holds which Microsoft Entra admin role, and under which Privileged Identity Management (PIM) policy: eligible, active or permanent. It also applies policy and assignment changes in bulk, after a review.",
  },
  {
    question: "Who and what does it show holding admin roles?",
    answer: `${PRINCIPALS.join(", ")}. Each one is labelled by type, so you can filter for guests, apps or AI agents that hold a role, and see whether they hold it directly or through a group.`,
  },
  {
    question: "Which risks does it point out?",
    answer:
      "The dashboard's Easy to miss list: permanent Global Administrators (emergency access accounts counted apart), eligible assignments without an end date, apps, AI agents and guests that hold roles, roles that notify nobody, and roles that only have permanent assignments. It also shows role-assignable groups outside PIM, whose members hold the role all the time.",
  },
  {
    question: "Does my tenant data leave the browser?",
    answer:
      "No. There is no backend. Every Microsoft Graph call runs in your browser with your own token, and tenant data is not sent to a server of ours.",
  },
  {
    question: "Which PIM scopes are covered?",
    answer: `${COVERAGE.filter((item) => item.status === "available").map((item) => item.name).join(", ")}.`,
  },
  {
    question: "Does PIM Manager support Azure RBAC and PIM for Azure resources?",
    answer: azureAnswer,
  },
  {
    question: "Which permissions does it need?",
    answer:
      "Read permissions on sign-in. Write permissions are only requested when you choose to grant them in Configure, per workload. An admin consents once per tenant.",
  },
  {
    question: "How is it different from the Entra admin center?",
    answer:
      "The admin center shows one role at a time. PIM Manager shows every role and its policy side by side, filters and exports them, and changes the same setting on many roles at once.",
  },
  {
    question: "Can I host it myself?",
    answer:
      "Yes. Deploy it to Azure Static Web Apps (free tier) from the Azure portal with your own app registration. The hosted version at pimmanager.com is the same code.",
  },
];

/** schema.org structured data for the front page */
export function softwareApplicationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    applicationCategory: "SecurityApplication",
    operatingSystem: "Web",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    license: "https://www.gnu.org/licenses/gpl-3.0.html",
    codeRepository: REPO_URL,
    sameAs: [REPO_URL],
    featureList: COVERAGE.filter((item) => item.status === "available").map((item) => item.name),
    author: { "@type": "Person", name: AUTHOR.name, url: AUTHOR.url },
  };
}

/** JSON for an inline script element: `<` is escaped so the data cannot close the element */
export function toJsonLdString(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
