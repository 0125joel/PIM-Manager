import { describe, expect, it } from "vitest";
import {
    ACCESS_MODEL_FILE_FORMAT, MAX_FILE_ENTRIES, accessModelFileName, buildAccessModelFile, isAccessModelFile, parseAccessModelFile,
    planAccessModelImport, serializeAccessModelFile,
} from "@/utils/accessModelFile";

const CONTEXTS = [
    { id: "c1", displayName: "Phish-resistant SIF" },
    { id: "c2", displayName: "Standard" },
    { id: "c3", displayName: "Standard" },
];
const GROUPS = [{ id: "G-1", displayName: "Helpdesk" }, { id: "g-2", displayName: "Tier 0" }];
const EXPORTED = new Date("2026-10-20T09:00:00.000Z");

function sample() {
    return buildAccessModelFile({
        tenantId: "tenant-1",
        tenantName: "Contoso Ltd",
        exportedAt: EXPORTED,
        contextChoices: { "phish-resistant-sif": "c1", "unknown-one": "c9" },
        groupPlacements: { "g-1": { plane: "Management", securityLevel: "Specialized" }, "g-gone": { plane: "Data", securityLevel: "Enterprise" } },
        contexts: CONTEXTS,
        groups: GROUPS,
    });
}

describe("buildAccessModelFile", () => {
    it("writes the format, the version, the time and the tenant", () => {
        const file = sample();
        expect(file.format).toBe(ACCESS_MODEL_FILE_FORMAT);
        expect(file.formatVersion).toBe(1);
        expect(file.exportedAt).toBe("2026-10-20T09:00:00.000Z");
        expect(file.tenant).toEqual({ id: "tenant-1", name: "Contoso Ltd" });
    });

    it("writes the names next to the ids, sorted, and a missing name as null", () => {
        const file = sample();
        expect(file.labels.map((l) => l.label)).toEqual(["phish-resistant-sif", "unknown-one"]);
        expect(file.labels[0]).toEqual({ label: "phish-resistant-sif", contextId: "c1", contextName: "Phish-resistant SIF" });
        expect(file.labels[1].contextName).toBeNull();
        expect(file.groups.find((g) => g.groupId === "g-1")).toEqual({ groupId: "g-1", groupName: "Helpdesk", plane: "Management", securityLevel: "Specialized" });
        expect(file.groups.find((g) => g.groupId === "g-gone")!.groupName).toBeNull();
    });

    it("is the same file for the same choices, whatever the order they were made in", () => {
        const a = sample();
        const b = buildAccessModelFile({
            tenantId: "tenant-1",
            tenantName: "Contoso Ltd",
            exportedAt: EXPORTED,
            contextChoices: { "unknown-one": "c9", "phish-resistant-sif": "c1" },
            groupPlacements: { "g-gone": { plane: "Data", securityLevel: "Enterprise" }, "g-1": { plane: "Management", securityLevel: "Specialized" } },
            contexts: CONTEXTS,
            groups: GROUPS,
        });
        expect(serializeAccessModelFile(b)).toBe(serializeAccessModelFile(a));
    });

    it("names the file after the tenant and the day", () => {
        expect(accessModelFileName(sample())).toBe("pim-manager-access-model-contoso-ltd-2026-10-20.json");
        expect(accessModelFileName({ ...sample(), tenant: { id: "x", name: null } })).toBe("pim-manager-access-model-tenant-2026-10-20.json");
    });
});

describe("parseAccessModelFile", () => {
    it("reads what serializeAccessModelFile wrote", () => {
        const parsed = parseAccessModelFile(JSON.parse(serializeAccessModelFile(sample())));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.skipped).toBe(0);
        expect(parsed.file).toEqual(sample());
    });

    it("refuses a file of another format or version", () => {
        expect(parseAccessModelFile({ format: "something-else" }).ok).toBe(false);
        expect(parseAccessModelFile({ ...sample(), formatVersion: 2 }).ok).toBe(false);
        expect(parseAccessModelFile(null).ok).toBe(false);
    });

    it("skips an entry that is not usable and keeps the others", () => {
        const json = {
            ...sample(),
            labels: [{ label: "standard", contextId: "c2", contextName: null }, { label: 7 }],
            groups: [{ groupId: "g-1", plane: "Nowhere", securityLevel: "Enterprise" }, { groupId: "g-2", plane: "Data", securityLevel: "Enterprise" }],
        };
        const parsed = parseAccessModelFile(json);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.skipped).toBe(2);
        expect(parsed.file.labels).toHaveLength(1);
        expect(parsed.file.groups.map((g) => g.groupId)).toEqual(["g-2"]);
    });

    it("refuses a file with too many entries", () => {
        const many = Array.from({ length: MAX_FILE_ENTRIES * 2 + 1 }, (_, i) => ({ label: `l-${i}`, contextId: "c1", contextName: null }));
        expect(parseAccessModelFile({ ...sample(), labels: many }).ok).toBe(false);
    });

    it("recognises the file by its format key", () => {
        expect(isAccessModelFile(sample())).toBe(true);
        expect(isAccessModelFile({ schemaVersion: 1, roles: [] })).toBe(false);
    });
});

describe("duplicates", () => {
    it("keeps the first entry of a label or group that appears twice, and counts the second", () => {
        const parsed = parseAccessModelFile({
            ...sample(),
            labels: [{ label: "standard", contextId: "c2", contextName: null }, { label: "standard", contextId: "c3", contextName: null }],
            groups: [{ groupId: "G-1", plane: "Data", securityLevel: "Enterprise" }, { groupId: "g-1", plane: "Control", securityLevel: "Privileged" }],
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.file.labels).toHaveLength(1);
        expect(parsed.file.labels[0].contextId).toBe("c2");
        expect(parsed.file.groups).toHaveLength(1);
        expect(parsed.file.groups[0].plane).toBe("Data");
        expect(parsed.skipped).toBe(2);
    });
});

describe("planAccessModelImport", () => {
    const parsed = parseAccessModelFile(JSON.parse(serializeAccessModelFile(sample())));
    if (!parsed.ok) throw new Error("the sample must parse");

    const tenantOf = (tenantId: string) => ({ tenantId, contexts: CONTEXTS, groups: GROUPS, contextChoices: {}, groupPlacements: {} });

    it("matches a context by its name first, even when the id is another context", () => {
        const plan = planAccessModelImport(parsed.file, { ...tenantOf("tenant-1"), contexts: [{ id: "c7", displayName: "Phish-resistant SIF" }] });
        expect(plan.labels[0].match).toEqual({ status: "byName", contextId: "c7", contextName: "Phish-resistant SIF" });
    });

    it("matches by id when the name is not unique, and reports a context that is not there", () => {
        const plan = planAccessModelImport(parsed.file, tenantOf("tenant-1"));
        expect(plan.labels[0].match.status).toBe("byName");
        const standard = planAccessModelImport({ ...parsed.file, labels: [{ label: "standard", contextId: "c3", contextName: "Standard" }] }, tenantOf("tenant-1"));
        expect(standard.labels[0].match).toEqual({ status: "byId", contextId: "c3", contextName: "Standard" });
        expect(plan.labels[1].match).toEqual({ status: "missing" });
    });

    it("does not match a context by its id from another tenant, only by its name", () => {
        const other = planAccessModelImport(parsed.file, { ...tenantOf("tenant-2"), contexts: [{ id: "c1", displayName: "Compliant device" }] });
        expect(other.sameTenant).toBe(false);
        expect(other.labels[0].match).toEqual({ status: "missing" });
        const sameName = planAccessModelImport(parsed.file, { ...tenantOf("tenant-2"), contexts: [{ id: "c8", displayName: "Phish-resistant SIF" }] });
        expect(sameName.labels[0].match).toEqual({ status: "byName", contextId: "c8", contextName: "Phish-resistant SIF" });
    });

    it("matches a group by its id only, and shows what is there now", () => {
        const plan = planAccessModelImport(parsed.file, {
            tenantId: "tenant-1",
            contexts: CONTEXTS,
            groups: GROUPS,
            contextChoices: { "phish-resistant-sif": "c2" },
            groupPlacements: { "g-1": { plane: "Control", securityLevel: "Privileged" } },
        });
        expect(plan.labels[0].current).toBe("c2");
        expect(plan.labels[1].current).toBeNull();
        const helpdesk = plan.groups.find((g) => g.entry.groupId === "g-1")!;
        const gone = plan.groups.find((g) => g.entry.groupId === "g-gone")!;
        expect(helpdesk.match).toEqual({ status: "byId", groupId: "G-1", groupName: "Helpdesk" });
        expect(helpdesk.current).toEqual({ plane: "Control", securityLevel: "Privileged" });
        expect(gone.match).toEqual({ status: "missing" });
        expect(gone.current).toBeNull();
    });
});
