import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/types/audit.types";
import { buildAzureAuditContext, isAuthorizationOperation } from "@/utils/azureAuditRead";
import { clearAuditFilter, getAuditFilterControls, readAuditFilter, writeAuditFilter } from "@/utils/auditFilterControls";
import { AUDIT_DEFAULT_KINDS, buildAuditSearch, parseAuditUrlState, type AuditUrlState } from "@/utils/auditUrlState";
import { auditDetailNote, auditFilterChips, countByKind, auditDetailRows, azureFailureMessage, filterAuditEvents, isAzureEvent } from "@/utils/auditView";

/**
 * What the Azure Audit page added to the shared Audit code: every addition is optional and leaves Entra as it was. The Entra
 * cases here only repeat what the Entra tests hold, next to the Azure case they differ from.
 */

const NOW = new Date("2026-11-05T12:00:00Z");
const FORMAT = { timeZone: "UTC", locale: "en-GB" } as const;
const STATE: AuditUrlState = { days: 30, kinds: [...AUDIT_DEFAULT_KINDS], env: "both", failed: false, q: "" };

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
    return {
        id: "e1",
        time: "2026-11-01T10:00:00.000Z",
        kind: "usage",
        environment: "role",
        sentence: "Megan Bowen activated Reader on rg-web",
        actor: { name: "Megan Bowen", id: "u-megan", kind: "person" },
        role: { name: "Reader", id: "acdd72a7-3385-48ef-bd42-f606fba81ae7" },
        scope: "rg-web",
        result: "success",
        source: "arm",
        correlationId: "c-e1",
        azure: { scopeId: "/subscriptions/s-1/resourceGroups/rg-web", scopeName: "rg-web", scopeLevel: "resourceGroup", subscriptionId: "s-1" },
        ...overrides,
    };
}

const labels = (rows: { label: string }[]) => rows.map((r) => r.label);
const value = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value;

describe("getAuditFilterControls", () => {
    it("holds Who, Environment, Roles and Result as before, and Environment can be left out", () => {
        expect(getAuditFilterControls(false, 2).map((c) => c.key)).toEqual(["who", "env", "privileged", "failed"]);
        expect(getAuditFilterControls(false, 2, true).map((c) => c.key)).toEqual(["who", "env", "privileged", "failed"]);
        expect(getAuditFilterControls(false, 2, false).map((c) => c.key)).toEqual(["who", "privileged", "failed"]);
        expect(getAuditFilterControls(true, 0, false).map((c) => c.key)).toEqual(["who", "privileged"]);
    });
});

describe("the default period of the URL state", () => {
    it("is what it was without a defaultDays", () => {
        expect(parseAuditUrlState("").days).toBe(30);
        expect(parseAuditUrlState("", 180).days).toBe(180);
        expect(buildAuditSearch({ ...STATE, days: 30 })).toBe("");
        expect(buildAuditSearch({ ...STATE, days: 180 }, "", 180)).toBe("");
    });

    it("opens on 30 of 90 days, does not write days=30, and keeps days=90", () => {
        expect(parseAuditUrlState("", 90, 30).days).toBe(30);
        expect(parseAuditUrlState("?days=90", 90, 30).days).toBe(90);
        expect(parseAuditUrlState("?days=91", 90, 30).days).toBe(30);
        expect(parseAuditUrlState("?days=abc", 90, 30).days).toBe(30);
        expect(buildAuditSearch({ ...STATE, days: 30 }, "", 90, 30)).toBe("");
        expect(buildAuditSearch({ ...STATE, days: 90 }, "", 90, 30)).toBe("days=90");
        expect(buildAuditSearch({ ...STATE, days: 7 }, "", 90, 30)).toBe("days=7");
    });

    it("keeps the parameters of the page around it", () => {
        expect(buildAuditSearch({ ...STATE, days: 90 }, "scope=%2Fsubscriptions%2Fs-1&inherited=1&delegated=0", 90, 30)).toBe("scope=%2Fsubscriptions%2Fs-1&inherited=1&delegated=0&days=90");
    });
});

describe("the detail of an Azure event", () => {
    it("orders an Azure event What, By, Role, Scope, When, Result, Through; Entra has the same without Scope", () => {
        const azureRows = auditDetailRows(event({ viaGroup: "Azure Owners" }), false, false, FORMAT);
        expect(labels(azureRows).slice(0, 7)).toEqual(["What", "By", "Role", "Scope", "When", "Result", "Through"]);
        const entraRows = auditDetailRows(event({ azure: undefined, source: "graph" }), false, false, FORMAT);
        expect(labels(entraRows).slice(0, 6)).toEqual(["What", "By", "Role", "When", "Result", "Through"]);
    });

    it("shows on Entra the role a group gave and the group it came through", () => {
        const rows = auditDetailRows(event({ azure: undefined, source: "graph", environment: "group", viaGroup: "Contoso Admins", groupRoles: ["Global Reader", "Reports Reader"] }), false, false, FORMAT);
        expect(value(rows, "Role")).toBe("Global Reader, Reports Reader");
        expect(value(rows, "Through")).toBe("Contoso Admins");
    });

    it("shows Scope and Through, always, and no MFA or Where", () => {
        const rows = auditDetailRows(event({ viaGroup: "Azure Owners" }), false, false, FORMAT);
        expect(value(rows, "Scope")).toBe("rg-web");
        expect(value(rows, "Through")).toBe("Azure Owners");
        expect(labels(rows)).not.toContain("Where");
        expect(labels(rows)).not.toContain("Source");
    });

    it("shows Scope level and Source with details, and neither MFA nor Where", () => {
        const rows = auditDetailRows(event({ mfa: true }), true, false, FORMAT);
        expect(value(rows, "Scope level")).toBe("Resource group");
        expect(value(rows, "Source")).toBe("PIM requests");
        expect(labels(rows)).not.toContain("MFA on activation");
        expect(labels(rows)).not.toContain("Where");
    });

    it.each([
        ["graph", "Entra audit log"],
        ["arm", "PIM requests"],
        ["activity-log", "Azure activity log"],
        ["azure-workspace", "Log Analytics workspace"],
    ] as const)("names the source %s", (source, text) => {
        expect(value(auditDetailRows(event({ source }), true, false, FORMAT), "Source")).toBe(text);
    });

    it.each([
        ["root", "Root"], ["managementGroup", "Management group"], ["subscription", "Subscription"], ["resourceGroup", "Resource group"], ["resource", "Resource"],
    ] as const)("names the level %s", (scopeLevel, text) => {
        const azure = { scopeId: "/x", scopeName: "x", scopeLevel, subscriptionId: "" };
        expect(value(auditDetailRows(event({ azure }), true, false, FORMAT), "Scope level")).toBe(text);
    });

    it("counts a row with azure set as an Azure event whatever its source, so it has no Where row", () => {
        const rows = auditDetailRows(event({ source: "graph", environment: "group" }), true, false, FORMAT);
        expect(value(rows, "Scope")).toBe("rg-web");
        expect(value(rows, "Scope level")).toBe("Resource group");
        expect(labels(rows)).not.toContain("Where");
        expect(isAzureEvent(event({ source: "graph" }))).toBe(true);
        expect(isAzureEvent(event({ source: "graph", azure: undefined }))).toBe(false);
    });

    it("counts an event of an Azure source without azure as an Azure event", () => {
        const rows = auditDetailRows(event({ azure: undefined, source: "activity-log" }), true, false, FORMAT);
        expect(labels(rows)).toContain("Scope");
        expect(value(rows, "Scope level")).toBe("");
    });

    it("tells the note of a group row and of a setting, first", () => {
        expect(auditDetailNote(event({ environment: "group" }), false)).toBe("Activating the membership gives every role the group holds. This shows the role on the scope you can read.");
        expect(auditDetailNote(event({ kind: "setting" }), false)).toBe("Azure logs the rule that changed, not what it was before.");
        expect(auditDetailNote(event({ kind: "outside" }), false)).toBe("This did not go through PIM, so there is no request, reason or approval.");
        expect(auditDetailNote(event(), true)).toBe("Requested and completed are shown as one action.");
    });

    it("leaves the rows and notes of an Entra event as they were", () => {
        const entra = event({ azure: undefined, source: "graph", environment: "group", mfa: true, scope: "Directory" });
        const rows = auditDetailRows(entra, true, false, FORMAT);
        expect(labels(rows)).toEqual(["What", "By", "Role", "When", "Result", "Through", "Reason", "Ticket", "Approved by", "Old value", "Ends", "Account", "Used for", "Starts", "Approved after", "Requested duration", "MFA on activation", "Where", "Source", "New value"]);
        expect(value(rows, "Where")).toBe("Directory");
        expect(value(rows, "Source")).toBe("Entra audit log");
        expect(auditDetailNote(entra, false)).toBeNull();
        expect(auditDetailNote({ ...entra, kind: "setting" }, false)).toBe("Microsoft logs only the new value of a setting, in its own words.");
    });
});

describe("the failure of an Azure event", () => {
    const failed = (reason: string | undefined, extra: Partial<AuditEvent> = {}) => event({ result: "failure", failureReason: reason, ...extra });

    it("shows the code in Result and the whole failure in the note, first", () => {
        const text = "RoleAssignmentExists: The role assignment already exists.";
        const e = failed(text);
        expect(value(auditDetailRows(e, false, false, FORMAT), "Result")).toBe("Failed: RoleAssignmentExists");
        expect(azureFailureMessage(e)).toBe(text);
        expect(auditDetailNote(e, false)).toBe(text);
        expect(auditDetailNote(failed(text, { environment: "group" }), false)).toBe(text);
        expect(auditDetailNote(failed(text, { kind: "setting" }), false)).toBe(text);
    });

    it("shows a reason without a message as it is, and has no note of its own", () => {
        const e = failed("TimedOut");
        expect(value(auditDetailRows(e, false, false, FORMAT), "Result")).toBe("Failed: TimedOut");
        expect(azureFailureMessage(e)).toBeNull();
        expect(auditDetailNote(e, false)).toBeNull();
        expect(value(auditDetailRows(failed(undefined), false, false, FORMAT), "Result")).toBe("Failed");
    });

    it("leaves a denial and a success without a failure note", () => {
        expect(azureFailureMessage(failed("A: b", { denied: true }))).toBeNull();
        expect(azureFailureMessage(event({ failureReason: "A: b" }))).toBeNull();
    });

    it("leaves the Result text of an Entra event as it was, whole", () => {
        const entra = event({ azure: undefined, source: "graph", result: "failure", failureReason: "Some code: some message" });
        expect(value(auditDetailRows(entra, false, false, FORMAT), "Result")).toBe("Failed: Some code: some message");
        expect(azureFailureMessage(entra)).toBeNull();
        expect(auditDetailNote(entra, false)).toBeNull();
    });
});

describe("the search over the scope", () => {
    const search = (events: AuditEvent[], q: string) => filterAuditEvents(events, { ...STATE, q }, NOW).map((e) => e.id);
    const azure = event({ id: "az", sentence: "Megan Bowen activated Reader", scope: "rg-web", azure: { scopeId: "/subscriptions/s-1/resourceGroups/rg-web", scopeName: "Web Resource Group", scopeLevel: "resourceGroup", subscriptionId: "s-1" } });
    const entra = event({ id: "en", source: "graph", azure: undefined, sentence: "Megan Bowen activated Reader", scope: "Web Resource Group" });

    it("finds an Azure event by the name of its scope, and an Entra event by what it did before", () => {
        expect(search([azure, entra], "web resource")).toEqual(["az"]);
        expect(search([azure, entra], "megan")).toEqual(["az", "en"]);
        expect(search([entra], "rg-web")).toEqual([]);
    });
});

describe("buildAzureAuditContext: the id of a sign-in name", () => {
    it("takes it from the assignments, without case, and knows nobody else", () => {
        const context = buildAzureAuditContext([], [
            { id: "a1", scopeId: "/subscriptions/s-1", principalId: "u-bg", principalName: "Break Glass 01", principalType: "User", principalUpn: "BG01@contoso.example", roleDefinitionId: "r1", roleName: "Owner", state: "active", memberType: "direct", endDateTime: null },
        ]);
        expect(context.principalIdOfUpn?.("bg01@Contoso.example")).toBe("u-bg");
        expect(context.principalIdOfUpn?.("someone@contoso.example")).toBeUndefined();
    });
});

describe("isAuthorizationOperation", () => {
    it("holds for the operations of the authorization provider, without case", () => {
        expect(isAuthorizationOperation("Microsoft.Authorization/roleAssignments/write")).toBe(true);
        expect(isAuthorizationOperation("MICROSOFT.AUTHORIZATION/roleDefinitions/delete")).toBe(true);
    });
    it("does not hold for other providers, an empty operation or none", () => {
        expect(isAuthorizationOperation("Microsoft.Web/sites/write")).toBe(false);
        expect(isAuthorizationOperation("Microsoft.AuthorizationX/roleAssignments/write")).toBe(false);
        expect(isAuthorizationOperation("")).toBe(false);
        expect(isAuthorizationOperation(undefined)).toBe(false);
        expect(isAuthorizationOperation(null)).toBe(false);
    });
});

describe("the Scope level filter", () => {
    const azureControls = getAuditFilterControls(false, 0, false, true);

    it("is the Azure control in the place of Environment, and Entra never has it", () => {
        expect(azureControls.map((c) => c.key)).toEqual(["who", "level", "privileged", "failed"]);
        const level = azureControls.find((c) => c.key === "level");
        expect(level?.group).toBe("Role");
        expect(level?.label).toBe("Scope level");
        expect(level?.neutral).toBe("all");
        expect(level?.options.map((o) => o.label)).toEqual(["All", "Management group", "Subscription", "Resource group", "Resource"]);
        expect(getAuditFilterControls(false, 0).map((c) => c.key)).toEqual(["who", "env", "privileged", "failed"]);
        expect(getAuditFilterControls(true, 0).map((c) => c.key)).toEqual(["who", "env", "privileged"]);
    });

    it("round trips through the URL, ignores an unknown value and is not written when neutral", () => {
        expect(parseAuditUrlState("?level=subscription").level).toBe("subscription");
        expect(parseAuditUrlState("?level=resourceGroup").level).toBe("resourceGroup");
        expect(parseAuditUrlState("?level=planet").level).toBeUndefined();
        expect(parseAuditUrlState("?level=root").level).toBeUndefined();
        expect(parseAuditUrlState("").level).toBeUndefined();
        expect(buildAuditSearch({ ...STATE, level: "managementGroup" })).toBe("level=managementGroup");
        expect(buildAuditSearch(STATE)).toBe("");
        expect(parseAuditUrlState(`?${buildAuditSearch({ ...STATE, level: "resource" })}`).level).toBe("resource");
    });

    it("is read, written and cleared like the other controls", () => {
        const set = writeAuditFilter(STATE, "level", "subscription");
        expect(readAuditFilter("level", set)).toBe("subscription");
        expect(readAuditFilter("level", STATE)).toBe("all");
        expect(writeAuditFilter(set, "level", "planet")).toBe(set);
        expect(writeAuditFilter(set, "level", "all").level).toBeUndefined();
        expect(clearAuditFilter(set, "level").level).toBeUndefined();
        expect(auditFilterChips(set)).toEqual([{ key: "level", label: "Scope level: Subscription" }]);
        expect(auditFilterChips(STATE)).toEqual([]);
    });

    it("keeps only the events at that level, and an event without azure only on All", () => {
        const sub = event({ id: "sub", azure: { scopeId: "/subscriptions/s-1", scopeName: "s-1", scopeLevel: "subscription", subscriptionId: "s-1" } });
        const rg = event({ id: "rg" });
        const entra = event({ id: "entra", azure: undefined });
        const all = [sub, rg, entra];
        const ids = (state: AuditUrlState) => filterAuditEvents(all, state, NOW).map((e) => e.id);
        expect(ids(STATE)).toEqual(["sub", "rg", "entra"]);
        expect(ids({ ...STATE, level: "subscription" })).toEqual(["sub"]);
        expect(ids({ ...STATE, level: "resourceGroup" })).toEqual(["rg"]);
        expect(ids({ ...STATE, level: "resource" })).toEqual([]);
        expect(countByKind(all, { ...STATE, level: "subscription" }, NOW).usage).toBe(1);
    });
});
