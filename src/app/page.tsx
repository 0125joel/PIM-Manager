"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { loginRequest } from "@/config/authConfig";
import { Icon } from "@/components/icons/Icon";
import { Logger } from "@/utils/logger";
import { isDemoAvailable } from "@/demo/runtime/session";
import { DEMO_ENTRY_PATH } from "@/config/demo";
import { useRotatingRole } from "@/hooks/useRotatingRole";

const noSubscribe = () => () => undefined;

const REPO_URL = "https://github.com/0125joel/PIM-Manager";
const LINKS = {
  repo: REPO_URL,
  docs: `${REPO_URL}/blob/main/docs/en/README.md`,
  security: `${REPO_URL}/blob/main/docs/en/05-security.md`,
  dataFlow: `${REPO_URL}/blob/main/docs/en/03-data-flow.md`,
  deployment: `${REPO_URL}/blob/main/docs/en/10-deployment.md`,
  changelog: `${REPO_URL}/blob/main/CHANGELOG.md`,
  issues: `${REPO_URL}/issues`,
  deployToAzure:
    "https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2F0125joel%2FPIM-Manager%2Fmain%2Fazuredeploy.json",
  story: "https://intothecloud.eu/p/pimmanager",
  pimMonitor: "https://pimmonitor.com/",
  intoTheCloud: "https://intothecloud.eu/",
  prinsCloud: "https://prins.cloud/",
  linkedIn: "https://www.linkedin.com/in/jo%C3%ABl-prins-4b4655aa/",
};

// Palette B (globals.css): warm neutrals; light blue from the IntoTheCloud logo (#48c5fa) for decoration,
// a deeper tint of the same hue for text so it passes contrast.
const C = {
  page: "bg-[#f7f7f5] dark:bg-[#161615]",
  band: "bg-[#f0f0ec] dark:bg-[#1d1d1c]",
  ink: "text-[#1c1c1a] dark:text-[#ecebe8]",
  body: "text-[#4a4a46] dark:text-[#b7b5ae]",
  muted: "text-[#6a6a64] dark:text-[#8f8d86]",
  accent: "text-[#0a6fa8] dark:text-[#48c5fa]",
  line: "border-[#e3e3de] dark:border-[#31302d]",
  rule: "border-[#1c1c1a] dark:border-[#ecebe8]",
  link: "text-[#0a6fa8] dark:text-[#48c5fa] underline underline-offset-[3px] decoration-1 hover:text-[#075985] dark:hover:text-[#7dd3fc]",
};

const FEATURES: { key: string; route: string; title: string; text: string }[] = [
  {
    key: "dashboard",
    route: "/dashboard",
    title: "Your PIM posture on one screen",
    text: "Permanent versus eligible, MFA and approval coverage, activation durations and open PIM alerts.",
  },
  {
    key: "report",
    route: "/report",
    title: "Who has what, under which policy",
    text: "Every privileged role and PIM group with its members and settings. Filter, then export to PDF, CSV or JSON.",
  },
  {
    key: "configure",
    route: "/configure",
    title: "Change many roles at once",
    text: "Edit, follow Guided steps or import a file. Checks catch conflicting settings, and you review every change before it is written.",
  },
];

const COVERAGE = [
  { core: true, name: "Directory roles", text: "Built-in and custom roles, assignments and role policies" },
  { core: false, name: "PIM for Groups", text: "Member and owner assignments on PIM-onboarded groups" },
  { core: false, name: "Role-assignable groups", text: "Groups that can hold Entra roles but are not under PIM yet" },
  { core: false, name: "Security alerts", text: "PIM alerts, such as too many Global Admins, with the accounts involved" },
];

export default function Home() {
  const router = useRouter();
  const headlineRole = useRotatingRole();
  const { instance, accounts } = useMsal();
  const isAuthenticated = accounts.length > 0;
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  const versionLabel = appVersion ? `${appVersion} · GPLv3` : "GPLv3";

  // The live demo is part of the hosted version only (src/demo); a self-hosted install has no link to it
  const hasDemo = useSyncExternalStore(noSubscribe, isDemoAvailable, () => false);

  useEffect(() => {
    if (isAuthenticated) {
      router.push("/dashboard");
    }
  }, [isAuthenticated, router]);

  const handleLogin = () => {
    instance.loginPopup(loginRequest).catch((e) => {
      Logger.error("Home", "Login error:", e);
    });
  };

  if (isAuthenticated) {
    return null; // Will redirect
  }

  return (
    <div className={`min-h-screen flex flex-col font-sans ${C.page} ${C.ink}`}>
      {/* Nav */}
      <header className={`border-b ${C.line}`}>
        <div className="mx-auto max-w-7xl h-16 px-4 sm:px-8 lg:px-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="" width={28} height={28} className="h-7 w-7" priority />
            <span className="text-[17px] font-semibold">PIM Manager</span>
          </Link>
          <nav className="flex items-center gap-4 sm:gap-7 text-sm text-[#3f3e3a] dark:text-[#cfcdc6]">
            {hasDemo && (
              // A full page load on purpose: the demo installs its own sign-in and Graph at page start
              <a href={DEMO_ENTRY_PATH} className="flex items-center min-h-11 font-medium text-[#0a6fa8] dark:text-[#48c5fa] hover:underline">Live demo</a>
            )}
            <a href={LINKS.docs} target="_blank" rel="noopener noreferrer" className="hidden sm:inline hover:underline">Docs</a>
            <a href={LINKS.changelog} target="_blank" rel="noopener noreferrer" className="hidden sm:inline hover:underline">Changelog</a>
            <a href={LINKS.repo} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 min-h-11 hover:underline" aria-label="PIM Manager on GitHub">
              <GitHubMark className="h-4 w-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-20 pt-10 pb-12 lg:pt-20 lg:pb-22 grid gap-10 lg:gap-14 lg:grid-cols-[470px_minmax(0,1fr)] items-center">
          <div className="flex flex-col gap-6">
            <Eyebrow muted>
              every role · every policy
            </Eyebrow>
            <h1 className="text-[31px] leading-[38px] lg:text-[46px] lg:leading-[54px] font-semibold tracking-tight">
              Who can become{" "}
              <span className="relative mr-[0.25em] inline-block whitespace-nowrap">
                {headlineRole}
                <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="absolute -left-[5%] -top-2 h-[calc(100%+16px)] w-[110%] overflow-visible text-[#1a9fd8] dark:text-[#48c5fa]" fill="none" aria-hidden="true">
                  <path d="M24 6 C70 -3, 150 -1, 188 12 C206 24, 150 40, 96 38 C40 38, -4 28, 8 14 C14 8, 24 5, 40 3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </svg>
              </span>{" "}
              in your tenant, and on what terms?
            </h1>
            <p className={`text-base lg:text-lg leading-7 ${C.body}`}>
              PIM Manager reads your Entra ID PIM setup through Microsoft Graph and lays it out as a dashboard and
              reports. When you want to change it, it applies policies and assignments in bulk.
            </p>
            <p className="font-mono text-sm lg:text-[15px] leading-[22px] font-medium">
              No backend. No agent.
              <br />
              Just your browser and Graph.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <button type="button" onClick={handleLogin} aria-label="Sign in with Microsoft" className="cursor-pointer">
                {/* Official Microsoft sign-in button assets (identity platform branding guidelines) */}
                {/* eslint-disable-next-line @next/next/no-img-element -- static SVG asset, one per theme */}
                <img src="/assets/ms-signin-light.svg" alt="" width={215} height={41} className="block dark:hidden" />
                {/* eslint-disable-next-line @next/next/no-img-element -- static SVG asset, one per theme */}
                <img src="/assets/ms-signin-dark.svg" alt="" width={215} height={41} className="hidden dark:block" />
              </button>
              {hasDemo && (
                // A full page load, see the nav link
                <a
                  href={DEMO_ENTRY_PATH}
                  className="h-[41px] px-4 inline-flex items-center rounded-sm border border-[#b7b5ae] dark:border-[#5a5852] text-[15px] font-medium hover:bg-white/60 dark:hover:bg-white/5"
                >
                  Try the live demo
                </a>
              )}
              <a
                href={LINKS.repo}
                target="_blank"
                rel="noopener noreferrer"
                className="h-[41px] px-4 inline-flex items-center rounded-sm border border-[#b7b5ae] dark:border-[#5a5852] text-[15px] font-medium hover:bg-white/60 dark:hover:bg-white/5"
              >
                View on GitHub
              </a>
              <span className={`font-mono text-xs ${C.muted}`}>{versionLabel}</span>
            </div>
            <p className={`text-[13px] leading-5 ${C.muted}`}>
              Admin consent once per tenant. Read-only until you open Configure.
              {hasDemo && " The demo runs on Contoso, a made-up tenant, without sign-in."}
            </p>
          </div>

          {hasDemo && <AnnotatedScreenshot demoHref={DEMO_ENTRY_PATH} />}
        </section>

        {/* What it does */}
        <section className={`border-t ${C.line}`}>
          <div className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-20 py-12 lg:py-18 flex flex-col gap-9">
            <SectionTitle eyebrow="what it does" title="Look first. Change when you're sure." />
            <div className="grid gap-8 lg:gap-12 md:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.key} className={`flex flex-col gap-2.5 border-t-2 pt-4 ${C.rule}`}>
                  <div className={`font-mono text-[13px] font-medium ${C.accent}`}>{f.route}</div>
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <p className={`text-[15px] leading-6 ${C.body}`}>{f.text}</p>
                  {hasDemo && (
                    // Full page load, see the nav link
                    <a href={`${DEMO_ENTRY_PATH}?to=${f.route}`} className={`self-start text-sm ${C.link}`}>
                      Try it in the live demo
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Coverage */}
        <section className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-20 pt-2 pb-12 lg:pt-6 lg:pb-18 grid gap-6 lg:gap-16 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="flex flex-col gap-2.5">
            <Eyebrow>what it covers</Eyebrow>
            <p className={`text-[15px] leading-6 ${C.body}`}>
              Optional workloads ask for their own permissions when you switch them on. Not before.
            </p>
          </div>
          <div className={`border-t ${C.rule} text-[15px]`}>
            {COVERAGE.map((c) => (
              <div key={c.name} className={`grid grid-cols-[64px_minmax(0,1fr)] md:grid-cols-[80px_220px_minmax(0,1fr)] gap-x-4 gap-y-1 items-baseline py-3.5 border-b ${C.line}`}>
                <span className={`font-mono text-xs ${c.core ? `font-semibold ${C.accent}` : `font-medium ${C.muted}`}`}>
                  {c.core ? "[core]" : "[opt]"}
                </span>
                <span className="font-semibold">{c.name}</span>
                <span className={`col-start-2 md:col-start-auto ${C.body}`}>{c.text}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Why I built this */}
        <section className={C.band}>
          <div className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-20 py-12 lg:py-20 grid gap-6 lg:gap-20 lg:grid-cols-[560px_minmax(0,1fr)] items-start">
            <div className="flex flex-col gap-5">
              <Eyebrow>why I built this</Eyebrow>
              <div className="h-[3px] w-12 bg-[#48c5fa]" />
              <p className="text-[25px] leading-[33px] lg:text-[34px] lg:leading-[44px] font-medium tracking-tight">
                &ldquo;PIM Manager started as a way to save my own sanity.&rdquo;
              </p>
            </div>
            <div className="flex flex-col gap-4 lg:pt-10 text-base leading-[26px] text-[#3f3e3a] dark:text-[#cfcdc6]">
              <p>
                Microsoft does not offer a single-pane-of-glass dashboard or reporting function for Entra ID role management. If you want to
                understand your role configuration at scale, your options are clickops or scripting.
              </p>
              <p className={`font-semibold ${C.ink}`}>Neither is pleasant.</p>
              <p>
                Role by role, blade by blade, copying settings into a spreadsheet. Getting answers should not
                require a day&apos;s worth of work.
              </p>
              <a href={LINKS.story} target="_blank" rel="noopener noreferrer" className={`self-start text-[15px] ${C.link}`}>
                Read the full story on IntoTheCloud
              </a>
            </div>
          </div>
        </section>

        {/* Where your data goes */}
        <section className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-20 py-12 lg:py-22 flex flex-col gap-8">
          <SectionTitle eyebrow="where your data goes" title="Security is part of the design, not a chapter at the end." />
          <DataFlowPanel />
          <p className={`text-[15px] leading-6 ${C.body}`}>
            It&apos;s GPLv3. Don&apos;t take my word for it, read the{" "}
            <a href={LINKS.security} target="_blank" rel="noopener noreferrer" className={C.link}>security model</a>{" "}
            and the{" "}
            <a href={LINKS.dataFlow} target="_blank" rel="noopener noreferrer" className={C.link}>data flow</a>.
          </p>
        </section>

        {/* Hosting */}
        <section className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-20 pt-2 pb-12 lg:pt-4 lg:pb-18 flex flex-col gap-8">
          <SectionTitle eyebrow="two ways to run it" title="Use it here, or host it in your own tenant." />
          <div className="grid gap-8 lg:gap-12 md:grid-cols-2">
            <div className={`flex flex-col gap-2.5 border-t-2 pt-4 ${C.rule}`}>
              <div className={`font-mono text-[13px] font-medium ${C.accent}`}>pimmanager.com</div>
              <p className={`text-[15px] leading-6 ${C.body}`}>
                Nothing to install. Sign in, have an admin grant consent once, and you are in. Always the latest release.
              </p>
            </div>
            <div className={`flex flex-col gap-3 border-t-2 pt-4 ${C.rule}`}>
              <div className={`font-mono text-[13px] font-medium ${C.accent}`}>self-hosted</div>
              <p className={`text-[15px] leading-6 ${C.body}`}>
                Azure Static Web Apps (free tier) with your own App Registration.
              </p>
              <div className="flex flex-col sm:flex-row gap-1 sm:gap-6 font-mono text-[13px]">
                <span><span className={C.accent}>1</span> App Registration</span>
                <span><span className={C.accent}>2</span> Deploy to Azure</span>
                <span><span className={C.accent}>3</span> Redirect URI</span>
              </div>
              <div className="flex items-center gap-4 mt-1">
                <a
                  href={LINKS.deployToAzure}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-11 sm:h-9 px-3.5 inline-flex items-center rounded-sm text-sm font-semibold bg-[#0a6fa8] text-white hover:bg-[#075985] dark:bg-[#48c5fa] dark:text-[#0b1a2b] dark:hover:bg-[#7dd3fc]"
                >
                  Deploy to Azure
                </a>
                <a href={LINKS.deployment} target="_blank" rel="noopener noreferrer" className={`text-sm ${C.link}`}>
                  Deployment guide
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Permissions */}
        <section className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-20 pb-12 lg:pb-22">
          <PermissionsAccordion />
        </section>
      </main>


      {/* Footer: dark in both themes */}
      <footer className="bg-[#191918] dark:bg-[#121211] text-[#d6d5cf]">
        <div className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-20 pt-10 lg:pt-14 pb-8 flex flex-col gap-10">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-7 lg:gap-10 text-sm">
            <FooterColumn title="DOCS" links={[["Documentation", LINKS.docs], ["Security model", LINKS.security], ["Self-hosting", LINKS.deployment]]} />
            <FooterColumn title="PROJECT" links={[["GitHub", LINKS.repo], ["Changelog", LINKS.changelog], ["Report an issue", LINKS.issues]]} />
            <FooterColumn title="ALSO BY JOËL" links={[["PIM Monitor", LINKS.pimMonitor], ["IntoTheCloud", LINKS.intoTheCloud]]} />
            <FooterColumn title="AUTHOR" links={[["prins.cloud", LINKS.prinsCloud], ["Joël Prins on LinkedIn", LINKS.linkedIn]]} />
          </div>
          <div className="border-t border-[#31302d] pt-6 flex flex-col sm:flex-row sm:justify-between gap-2 text-[13px] text-[#8f8d86]">
            <span>
              Crafted with passion by{" "}
              <a href={LINKS.linkedIn} target="_blank" rel="noopener noreferrer" className="text-[#48c5fa] underline underline-offset-[3px]">
                Joël
              </a>{" "}
              · Powered by Microsoft Graph API
            </span>
            <span className="font-mono text-xs">{versionLabel}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Eyebrow({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 font-mono text-[12px] tracking-[0.04em] ${
        muted ? `font-medium text-xs ${C.muted}` : `font-semibold ${C.accent}`
      }`}
    >
      {children}
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="text-2xl lg:text-[30px] lg:leading-[38px] font-semibold tracking-tight">{title}</h2>
    </div>
  );
}

function AnnotatedScreenshot({ demoHref }: { demoHref?: string }) {
  // Coordinates are in a 594 x 580 box; the screenshot sits at y 80..480.
  return (
    <div className="relative w-full aspect-[594/580]">
      {demoHref && (
        <a href={demoHref} aria-label="Open the live demo" className="absolute left-0 top-[13.8%] z-10 block w-full h-[69%] rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a9fd8]" />
      )}
      <div className="absolute left-0 top-[13.8%] w-full h-[69%] overflow-hidden rounded-md border border-[#31302d] bg-[#0a0a0a] shadow-[0_24px_50px_rgba(16,40,70,0.18)] dark:shadow-[0_24px_50px_rgba(0,0,0,0.5)]">
        {/* Both screenshots come from the live demo (Contoso, Advanced view); regenerate them when the dashboard changes */}
        {/* eslint-disable-next-line @next/next/no-img-element -- static export with images.unoptimized */}
        <img
          src="/previews/dashboard-advanced.png"
          alt="PIM Manager dashboard with stat cards and charts"
          className="h-full w-full object-cover object-left-top dark:hidden"
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- static export with images.unoptimized */}
        <img
          src="/previews/dashboard-advanced-dark.png"
          alt=""
          aria-hidden="true"
          className="hidden h-full w-full object-cover object-left-top dark:block"
        />
      </div>
      <svg viewBox="0 0 594 580" className="absolute inset-0 h-full w-full overflow-visible text-[#1a9fd8] dark:text-[#48c5fa]" fill="none" aria-hidden="true">
        <defs>
          <marker id="pm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <path d="M 292 48 C 292 90, 322 104, 336 144" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" markerEnd="url(#pm-arrow)" />
        <path className="hidden sm:block" d="M 320 516 C 280 500, 180 470, 152 408" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" markerEnd="url(#pm-arrow)" />
      </svg>
      <p className={`absolute left-[33%] top-[0.7%] font-mono text-[11px] sm:text-xs leading-[17px] font-medium ${C.accent}`}>
        14 permanent. The number you
        <br />
        want to see go down.
      </p>
      <p className={`hidden sm:block absolute left-[30.3%] top-[90.3%] w-[50.5%] text-right font-mono text-xs leading-[17px] font-medium ${C.accent}`}>
        Orange: roles you can activate
        <br />
        without MFA. Worth a look.
      </p>
    </div>
  );
}

function DataFlowPanel() {
  const node = "border border-[#45433e] px-4 py-3.5 lg:px-[18px] lg:py-4 flex flex-col gap-1";
  return (
    <div className="relative mx-2 lg:mx-0 bg-[#191918] border border-[#31302d] text-[#e3e3de] px-5 py-6 lg:px-12 lg:py-10 flex flex-col gap-6 lg:gap-9">
      <div className="flex justify-between font-mono text-[10px] lg:text-[11px] tracking-[0.12em] text-[#8f8d86]">
        <span><span className="text-[#48c5fa]">browser</span>{" // graph.microsoft.com"}</span>
        <span className="hidden sm:inline">data flow</span>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-[18px] font-mono text-[13px]">
        <div className={`${node} lg:min-w-[200px]`}>
          <span className="font-semibold text-white">your browser</span>
          <span className="text-[11px] text-[#8f8d86]">PIM Manager runs here</span>
        </div>
        <Connector />
        <div className={`${node} lg:min-w-[230px]`}>
          <span className="font-semibold text-white">login.microsoftonline.com</span>
          <span className="text-[11px] text-[#8f8d86]">MSAL token, delegated scopes</span>
        </div>
        <Connector />
        <div className={`${node} lg:min-w-[200px]`}>
          <span className="font-semibold text-white">graph.microsoft.com</span>
          <span className="text-[11px] text-[#8f8d86]">your tenant data</span>
        </div>
        <div className="mt-2 lg:mt-0 lg:ml-auto border border-dashed border-[#45433e] px-4 py-3.5 lg:px-[18px] lg:py-4 flex lg:flex-col justify-between gap-1 lg:min-w-[150px]">
          <span className="text-[#8f8d86] line-through">our server</span>
          <span className="text-[11px] text-[#d97706]">no backend</span>
        </div>
      </div>

      <div className="h-px bg-[#31302d]" />

      <div className="grid gap-5 lg:gap-10 md:grid-cols-2">
        <FlowPoint title="Nowhere but your browser">
          Graph calls go straight to Microsoft. Cached data lives in session storage and is gone when you close the tab.
        </FlowPoint>
        <FlowPoint title="Read first, write on request">
          Sign-in asks for read scopes only. Write scopes are requested the moment you open Configure.
        </FlowPoint>
      </div>
    </div>
  );
}

function Connector() {
  return (
    <span className="text-[#d97706] pl-4 lg:pl-0" aria-hidden="true">
      <span className="lg:hidden">│</span>
      <span className="hidden lg:inline">──▶</span>
    </span>
  );
}

function FlowPoint({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 lg:gap-2">
      <div className="text-[15px] lg:text-base font-semibold text-white">{title}</div>
      <p className="text-sm leading-[22px] text-[#b7b5ae]">{children}</p>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[10px] lg:text-[11px] font-semibold tracking-[0.04em] text-[#8f8d86]">{title}</div>
      {links.map(([label, href]) => (
        <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="text-[#e3e3de] hover:underline">
          {label}
        </a>
      ))}
    </div>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

const CORE_SCOPES: [string, string][] = [
  ["User.Read", "Read your profile"],
  ["RoleManagement.Read.Directory", "Read role definitions"],
  ["RoleAssignmentSchedule.Read.Directory", "Read active assignments"],
  ["RoleEligibilitySchedule.Read.Directory", "Read eligible assignments"],
  ["RoleManagementPolicy.Read.Directory", "Read PIM policies"],
  ["User.Read.All", "Read user names"],
  ["Group.Read.All", "Read group names"],
  ["AdministrativeUnit.Read.All", "Read admin units"],
  ["Application.Read.All", "Read applications and agent blueprints"],
  ["Policy.Read.ConditionalAccess", "Read auth contexts"],
];

const OPTIONAL_SCOPES: { group: string; scopes: [string, string][] }[] = [
  { group: "Security alerts", scopes: [["RoleManagementAlert.Read.Directory", "Read PIM security alerts"]] },
  {
    group: "PIM for Groups",
    scopes: [
      ["PrivilegedAccess.Read.AzureADGroup", "Read PIM for Groups assignments"],
      ["RoleManagementPolicy.Read.AzureADGroup", "Read PIM for Groups policies"],
    ],
  },
  { group: "Custom extensions (Preview)", scopes: [["PrivilegedAccess-CustomExt.Read.All", "Read PIM custom extensions"]] },
  { group: "Configure, Conditional Access check", scopes: [["Policy.Read.All", "Check Conditional Access policies before you apply"]] },
  {
    group: "Configure, directory roles (write)",
    scopes: [
      ["RoleManagementPolicy.ReadWrite.Directory", "Update role policies"],
      ["RoleEligibilitySchedule.ReadWrite.Directory", "Create eligible assignments"],
      ["RoleAssignmentSchedule.ReadWrite.Directory", "Create active assignments"],
    ],
  },
  {
    group: "Configure, PIM for Groups (write)",
    scopes: [
      ["RoleManagementPolicy.ReadWrite.AzureADGroup", "Update group policies"],
      ["PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup", "Create eligible group assignments"],
      ["PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup", "Create active group assignments"],
    ],
  },
];

function PermissionsAccordion() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`border rounded-sm bg-white dark:bg-[#1d1d1c] border-[#d6d5cf] dark:border-[#45433e]`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="w-full cursor-pointer px-4 py-4 lg:px-[22px] lg:py-[18px] flex items-center justify-between gap-4 text-left"
      >
        <span className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[15px] lg:text-base font-semibold">
            Required permissions: {CORE_SCOPES.length} delegated read scopes on sign-in
          </span>
          <span className={`hidden md:block font-mono text-xs truncate ${C.muted}`}>
            RoleManagement.Read.Directory · RoleManagementPolicy.Read.Directory · User.Read.All · +{CORE_SCOPES.length - 3}
          </span>
        </span>
        <span className={`flex items-center gap-1.5 text-sm whitespace-nowrap ${C.accent}`}>
          <span className="hidden sm:inline">{isOpen ? "Hide scopes" : "Show all scopes"}</span>
          <Icon name={isOpen ? "chevron-up" : "chevron-down"} size={16} />
        </span>
      </button>

      {isOpen && (
        <div className={`border-t ${C.line} px-4 py-6 lg:px-[22px] grid gap-8 md:grid-cols-2`}>
          <div className="flex flex-col gap-3">
            <Eyebrow>on sign-in</Eyebrow>
            <ScopeList scopes={CORE_SCOPES} />
          </div>
          <div className="flex flex-col gap-6">
            {OPTIONAL_SCOPES.map((g) => (
              <div key={g.group} className="flex flex-col gap-3">
                <Eyebrow muted>{g.group.toLowerCase()}</Eyebrow>
                <ScopeList scopes={g.scopes} />
              </div>
            ))}
            <p className={`text-[13px] leading-5 ${C.muted}`}>
              Optional scopes are requested when you switch on the feature that needs them. Admin consent is required.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ScopeList({ scopes }: { scopes: [string, string][] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {scopes.map(([scope, desc]) => (
        <li key={scope} className="text-sm">
          <code className="block font-mono text-xs">{scope}</code>
          <span className={`text-xs ${C.muted}`}>{desc}</span>
        </li>
      ))}
    </ul>
  );
}
