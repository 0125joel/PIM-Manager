import type { RoleDetailData } from "@/types/directoryRole.types";
import { buildAuditPrivilege } from "@/utils/auditPrivilege";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuditView, type AuditViewProps } from "@/app/audit/components/AuditView";
import type { AuditStatus } from "@/hooks/useAuditData";
import type { AuditUrlActions } from "@/hooks/useAuditUrlState";
import type { AuditEvent } from "@/types/audit.types";
import { AUDIT_DEFAULT_KINDS, type AuditUrlState } from "@/utils/auditUrlState";

/**
 * The Audit page body rendered to static markup (no DOM here): which state shows for which status, and that the states
 * never mix. A failed reload keeps the events of the same tenant in memory; the page must still say it failed, and an
 * empty list is only ever told as "nothing happened" after a read that worked. Invented data only.
 */

const NOW = new Date("2026-11-05T12:00:00Z");
const STATE: AuditUrlState = { days: 30, kinds: [...AUDIT_DEFAULT_KINDS], env: "both", failed: false, q: "" };

const EVENTS: AuditEvent[] = [
    {
        id: "ev-1",
        time: "2026-11-05T09:42:00Z",
        kind: "usage",
        environment: "role",
        sentence: "Megan Bowen activated Security Administrator",
        actor: { name: "Megan Bowen", id: "u-megan", kind: "person" },
        role: { name: "Security Administrator", id: "r-sec" },
        scope: "Contoso",
        result: "success",
        source: "graph",
        correlationId: "c-1",
    },
    {
        id: "ev-2",
        time: "2026-11-04T16:05:00Z",
        kind: "assignment",
        environment: "role",
        sentence: "Lidia Holloway made eligible for Exchange Administrator",
        actor: { name: "Alex Wilber", id: "u-alex", kind: "person" },
        role: { name: "Exchange Administrator", id: "r-ex" },
        scope: "Contoso",
        result: "success",
        source: "graph",
        correlationId: "c-2",
    },
];

function urlActions(state: Partial<AuditUrlState> = {}): AuditUrlActions {
    const noop = () => undefined;
    return { state: { ...STATE, ...state }, setDays: noop, setKinds: noop, setFilter: noop, removeFilter: noop, clearPanelFilters: noop, setQuery: noop, setRange: noop, clearFilters: noop, setView: noop, select: noop, clearSelection: noop, getShareUrl: () => "https://example.test/audit" };
}

function render(overrides: Partial<AuditViewProps> & { state?: Partial<AuditUrlState> } = {}): string {
    const { state, ...rest } = overrides;
    const props: AuditViewProps = {
        status: "ready",
        events: EVENTS,
        windowStart: "2026-10-06T11:58:00Z",
        readAt: "2026-11-05T11:58:00Z",
        loadedCount: 0,
        requestedDays: 30,
        isRequestingPermission: false,
        now: NOW,
        emergencyIds: new Set<string>(),
        url: urlActions(state),
        details: { isDetailed: false },
        refresh: createElement("button", { type: "button" }, "Refresh"),
        onGrant: () => undefined,
        onRetry: () => undefined,
        onLoadDays: () => undefined,
        format: { timeZone: "UTC", locale: "en-GB" },
        ...rest,
    };
    return renderToStaticMarkup(createElement(AuditView, props));
}

const TITLES = {
    permission: "Audit needs one more permission",
    roleMissing: "Your role cannot read the audit log",
    reading: "Reading the audit log",
    failed: "The audit log could not be loaded",
    tooMany: "More than 50,000 events in the last 30 days",
    empty: "Nothing happened in this period",
    noMatch: "No events match these filters in this stretch of time.",
    list: "Megan Bowen activated Security Administrator",
};

function titlesIn(markup: string): string[] {
    return Object.entries(TITLES).filter(([, text]) => markup.includes(text)).map(([name]) => name);
}

describe("the Audit page states", () => {
    const cases: Array<[AuditStatus, keyof typeof TITLES]> = [
        ["permission", "permission"],
        ["role-missing", "roleMissing"],
        ["loading", "reading"],
        ["idle", "reading"],
        ["failed", "failed"],
        ["too-many", "tooMany"],
        ["ready", "list"],
    ];

    it.each(cases)("shows one state for the status %s", (status, expected) => {
        // Events are in memory in every case: a status other than ready must not show them
        expect(titlesIn(render({ status }))).toEqual([expected]);
    });

    it("keeps the page head in every state", () => {
        for (const [status] of cases) expect(render({ status })).toContain("<h1");
    });
});

describe("a failed reload", () => {
    it("says it failed and does not show the events of the earlier read", () => {
        const markup = render({ status: "failed", events: EVENTS });
        expect(markup).toContain(TITLES.failed);
        expect(markup).toContain("Try again");
        expect(markup).not.toContain(TITLES.list);
        expect(markup).not.toContain(TITLES.empty);
        expect(markup).not.toContain("Source: Entra audit log");
    });
});

describe("empty versus failed", () => {
    it("tells nothing happened only after a read that worked", () => {
        expect(render({ status: "ready", events: [] })).toContain(TITLES.empty);
    });

    it("never tells nothing happened after a failed read with no events", () => {
        for (const status of ["failed", "permission", "role-missing", "too-many", "loading", "idle"] as const) {
            expect(render({ status, events: [] }), status).not.toContain(TITLES.empty);
        }
    });

    it("tells no match, not empty, when events exist in the period but the filters hide them", () => {
        const markup = render({ state: { q: "nobody-has-this-term" } });
        expect(markup).toContain(TITLES.noMatch);
        expect(markup).toContain("Clear filters");
        expect(markup).not.toContain(TITLES.empty);
    });

    it("tells empty, not no match, when the period holds nothing", () => {
        const markup = render({ events: EVENTS, state: { days: 1 }, now: new Date("2026-12-24T12:00:00Z") });
        expect(markup).toContain(TITLES.empty);
        expect(markup).toContain("in the last 1 days");
        expect(markup).not.toContain(TITLES.noMatch);
        // A shorter period keeps the filter bar, so it can be lengthened again
        expect(markup).toContain('id="audit-days"');
    });

    it("leaves the filter bar out of the empty state of the full period", () => {
        expect(render({ events: [] })).not.toContain('id="audit-days"');
    });
});

describe("the ready state", () => {
    it("shows the coverage line, the list, the first event in the detail and the filter bar", () => {
        const markup = render();
        expect(markup).toContain("Source: Entra audit log. Oldest event available: 6 Oct 2026. Read 11:58. Times in UTC. New events can take a few minutes to appear.");
        expect(markup).toContain("Lidia Holloway made eligible for Exchange Administrator");
        expect(markup).toContain(">Filters");
        expect(markup).toContain('aria-label="Kind"');
        expect(markup).toContain("All actions");
        // The first row is shown in the detail
        expect(markup).toContain('<h2 class="min-w-0 text-xl leading-7 font-semibold text-ink lg:h-14 lg:flex-1 lg:overflow-y-auto">Megan Bowen activated Security Administrator</h2>');
    });

    it("shows the event of the URL in the detail", () => {
        const markup = render({ state: { event: "ev-2" } });
        expect(markup).toContain('<h2 class="min-w-0 text-xl leading-7 font-semibold text-ink lg:h-14 lg:flex-1 lg:overflow-y-auto">Lidia Holloway made eligible for Exchange Administrator</h2>');
    });

    it("says plainly that an event outside the data is not in this period", () => {
        const markup = render({ state: { event: "unknown-id" } });
        expect(markup).toContain("This event is not in this period.");
    });

    it("hides the details of the detail until the toggle is on", () => {
        const calm = render({ state: { event: "ev-1" } });
        const more = render({ state: { event: "ev-1" }, details: { isDetailed: true } });
        expect(calm).not.toContain('>Source</dt>');
        expect(more).toContain('>Source</dt>');
        expect(more).toContain("Requested and completed are shown as one action.");
    });

    it("shows the banner only when it is given and a read worked", () => {
        expect(render({ banner: { onDismiss: () => undefined } })).toContain("/settings#workspace");
        expect(render()).not.toContain("/settings#workspace");
        expect(render({ status: "failed", banner: { onDismiss: () => undefined } })).not.toContain("/settings#workspace");
    });

    it("shows the Refresh button only after a read that worked", () => {
        expect(render()).toContain(">Refresh<");
        expect(render({ status: "failed" })).not.toContain(">Refresh<");
    });
});

describe("the too-many state", () => {
    it("names the period that was asked for and offers a shorter one", () => {
        const markup = render({ status: "too-many", requestedDays: 14 });
        expect(markup).toContain("More than 50,000 events in the last 14 days");
        expect(markup).toContain('value="7"');
        expect(markup).toContain('max="13"');
    });

    it("offers no shorter period when one day is already too many", () => {
        const markup = render({ status: "too-many", requestedDays: 1 });
        expect(markup).toContain("in the last 1 days");
        expect(markup).not.toContain('id="audit-shorter-days"');
    });
});

describe("the timeline card", () => {
    it("shows after a read, with the period, a row and a button per point, and the selection text", () => {
        const markup = render();
        expect(markup).toContain('aria-label="Timeline"');
        expect(markup).toContain('id="audit-days"');
        expect(markup).toContain("Source: Entra audit log.");
        expect(markup).toContain("5 Nov, 09:42: Megan Bowen activated Security Administrator");
        expect(markup).toContain('aria-label="Start of the selection"');
        expect(markup).toContain('aria-label="End of the selection"');
        expect(markup).toContain('aria-label="Move the selection"');
        expect(markup).toContain("Drag across the timeline to select a stretch of time.");
        expect(markup).not.toContain("Whole period");
    });

    it("keeps the points out of the tab order, one row per visible kind and no System row by default", () => {
        const markup = render();
        expect(markup).toContain('data-timeline-point="" tabindex="-1"');
        expect(markup).not.toContain('tabindex="0" aria-label=');
        expect(markup).not.toContain("audit-kind-system relative h-7");
        expect(render({ state: { kinds: ["usage", "system"] } })).toContain("audit-kind-system relative h-7");
    });

    it("has no timeline before a read, and the coverage line stays", () => {
        const markup = render({ readAt: null });
        expect(markup).not.toContain('aria-label="Timeline"');
        expect(markup).toContain("Source: Entra audit log.");
    });

    it("follows a selection of the URL: only its events in the list, the count and the way back", () => {
        const markup = render({ state: { from: "2026-11-05T09:00:00.000Z", to: "2026-11-05T11:00:00.000Z" } });
        expect(markup).toContain("1 action<");
        expect(markup).toContain("Whole period");
        // The point of the other event stays: selecting dims nothing but the bands
        expect(markup).toContain("4 Nov, 16:05: Lidia Holloway made eligible for Exchange Administrator");
    });

    it("ignores a selection that lies outside the window", () => {
        const markup = render({ state: { from: "2025-01-01T00:00:00.000Z", to: "2025-01-02T00:00:00.000Z" } });
        expect(markup).not.toContain("Whole period");
        expect(markup).toContain("2 actions");
    });

    it("tells a selection that holds nothing in the list, not as a no-match state", () => {
        const markup = render({ state: { from: "2026-10-10T00:00:00.000Z", to: "2026-10-11T00:00:00.000Z" } });
        // The list (its header says 0 actions) tells it, the filters' own no-match state does not take over
        expect(markup).toContain(TITLES.noMatch);
        expect(markup).toContain("0 actions");
        expect(markup).toContain("audit-kind-usage relative h-7");
    });
});

describe("the No activation view", () => {
    const person = { id: "p1", displayName: "Anna Test", "@odata.type": "#microsoft.graph.user" };
    const assignments = {
        roles: [{
            definition: { id: "r-sec", displayName: "Security Administrator", description: "", isBuiltIn: true },
            assignments: {
                permanent: [],
                eligible: [{ id: "s1", principalId: "p1", roleDefinitionId: "r-sec", directoryScopeId: "/", memberType: "Direct", status: "Provisioned", principal: person, scheduleInfo: { startDateTime: "2026-08-01T00:00:00Z", expiration: { type: "noExpiration" } } }],
                active: [],
            },
        }],
        groups: [],
        isLoading: false,
        error: null,
        groupsNotIncluded: "read access to PIM for Groups has not been granted",
        onRetry: () => undefined,
    };

    it("shows the sentence that names every row, the warning and the one block of limits", () => {
        const markup = render({ state: { view: "idle" }, assignments });
        expect(markup).toContain("1 assignment: 1 with no activation. This shows a role was not activated in the period, not that it can go: a role used once a quarter needs a longer period.");
        expect(markup).toContain("None in this period");
        expect(markup).toContain("PIM for Groups is not included: read access to PIM for Groups has not been granted");
        expect(markup).toContain("Assignments and their activation in the last 30 days");
    });

    it("hides the kinds, Result and the details toggle, and keeps Who and the environment", () => {
        const markup = render({ state: { view: "idle", failed: true }, assignments, startFiltersOpen: true, details: { isDetailed: false, toggle: createElement("span", null, "Show more details") } });
        expect(markup).not.toContain("Failed or denied");
        expect(markup).not.toContain("Show more details");
        expect(markup).not.toContain('aria-label="Kind"');
        expect(markup).toContain("PIM for Groups");
        expect(markup).toContain("Assignments");
    });

    it("says the selection does not apply when one is set", () => {
        const withSelection = render({ state: { view: "idle", from: "2026-10-28T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" }, assignments });
        expect(withSelection).toContain("The selection does not apply to this view.");
        expect(render({ state: { view: "idle" }, assignments })).not.toContain("The selection does not apply to this view.");
    });

    it("shows the audit state and no table when the audit read failed", () => {
        for (const status of ["failed", "permission", "role-missing", "too-many", "loading"] as const) {
            const markup = render({ status, state: { view: "idle" }, assignments });
            expect(markup, status).not.toContain("None in this period");
            expect(markup, status).not.toContain("eligible assignments had no activation");
        }
    });

    it("shows the assignments when a read that worked holds nothing in the period (AU-17, P12)", () => {
        const empty = render({ events: [], state: { view: "idle" }, assignments });
        expect(empty).toContain("None in this period");
        expect(empty).not.toContain("Nothing happened in this period");
        // Events keeps its own empty state
        expect(render({ events: [] })).toContain("Nothing happened in this period");
    });

    it("shows the Report's error state when the assignments failed, and a skeleton while they load", () => {
        const failed = render({ state: { view: "idle" }, assignments: { ...assignments, roles: [], error: "Request failed with 503" } });
        expect(failed).toContain("The roles could not be loaded");
        expect(failed).not.toContain("eligible assignments had no activation");
        const loading = render({ state: { view: "idle" }, assignments: { ...assignments, roles: [], isLoading: true } });
        expect(loading).toContain("Reading the assignments");
        expect(loading).not.toContain("eligible assignments had no activation");
    });
});

describe("the Filters panel and Privileged only", () => {
    const roles = (isPrivileged: boolean | undefined): RoleDetailData[] => [{
        definition: { id: "role-1", displayName: "Security Administrator", description: "", isBuiltIn: true, isPrivileged },
        assignments: { permanent: [], eligible: [], active: [] },
    }];
    const withRoles = (isPrivileged: boolean | undefined) => ({ lookup: buildAuditPrivilege(roles(isPrivileged)), error: null, onRetry: () => undefined });

    it("names Who, the environment, Roles and Result in the panel, closed by default", () => {
        expect(render()).not.toContain("All results");
        const open = render({ startFiltersOpen: true });
        for (const text of ["Assignments", "Environment", "Entra roles", "PIM for Groups", "Privileged only", "Failed or denied (0)"]) expect(open).toContain(text);
    });

    it("shows the active filters as chips with their number on Filters", () => {
        const markup = render({ state: { who: "user", env: "group", failed: true } });
        for (const text of ["Users only", "PIM for Groups only", "Failed or denied", "Clear all"]) expect(markup).toContain(text);
        expect(markup).toContain(">3</span>");
    });

    it("reads the roles first and shows no result under the filter until then", () => {
        const markup = render({ state: { privileged: true }, privilege: { lookup: null, error: null, onRetry: () => undefined }, exportContext: { tenant: { id: "t", name: "Contoso" }, appVersion: "v1" } });
        expect(markup).toContain("Reading the roles, to tell which are privileged");
        expect(markup).not.toContain("data-audit-event");
        expect(markup).toContain("Available when the roles are read");
    });

    it("shows the error with Try again when the roles cannot be read, never an empty list", () => {
        const markup = render({ state: { privileged: true }, privilege: { lookup: null, error: "Microsoft Graph did not return the roles", onRetry: () => undefined } });
        expect(markup).toContain("Try again");
        expect(markup).not.toContain("data-audit-event");
    });

    it("says it is not applied and turns the choice off when Graph gives no flag at all", () => {
        const markup = render({ state: { privileged: true }, privilege: withRoles(undefined), startFiltersOpen: true });
        expect(markup).toContain("Privileged only is not applied. Microsoft Graph did not say which roles are privileged.");
        expect(markup).toContain("data-audit-event");
        expect(markup).toMatch(/<select[^>]*disabled/);
    });

    it("keeps a role it cannot judge and says how many", () => {
        // Security Administrator is privileged; the role of the other event is not in the role data
        const markup = render({ state: { privileged: true }, privilege: withRoles(true) });
        expect(markup).toContain("1 event kept because its role could not be judged.");
        expect(markup).toContain("Lidia Holloway made eligible for Exchange Administrator");
    });
});
