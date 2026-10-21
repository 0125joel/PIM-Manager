import { describe, expect, it } from "vitest";
import {
    CONTEXT_CHOICE_PREFIX,
    GROUP_PLACEMENT_PREFIX,
    matchContext,
    readContextChoices,
    readGroupPlacements,
    slugify,
    writeContextChoice,
    writeGroupPlacement,
} from "@/utils/authContextSlug";

function memoryStorage() {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe("slugify (PIM Monitor's Get-InventorySlug)", () => {
    it("gives exactly the four seed labels for Joël's four context names", () => {
        expect(slugify("Phish-resistant & SIF")).toBe("phish-resistant-sif");
        expect(slugify("Phish-resistant & No SIF")).toBe("phish-resistant-no-sif");
        expect(slugify("Phish-resistant & Compliant device")).toBe("phish-resistant-compliant-device");
        expect(slugify("Phish-resistant & Compliant device & SIF")).toBe("phish-resistant-compliant-device-sif");
    });

    it("keeps a prefix a tenant adds, so that name does not match", () => {
        expect(slugify("Auth Context - Phish-resistant & SIF")).toBe("auth-context-phish-resistant-sif");
        expect(slugify("  MFA   (strong)  ")).toBe("mfa-strong");
    });

    it("drops accents the way PIM Monitor does", () => {
        expect(slugify("Café")).toBe("cafe");
        expect(slugify("Phish-résistant & SIF")).toBe("phish-resistant-sif");
    });
});

describe("matchContext (spec 9.3)", () => {
    const contexts = [
        { id: "c1", displayName: "Phish-resistant & SIF" },
        { id: "c2", displayName: "Phish-resistant & No SIF" },
        { id: "c3", displayName: "phish resistant no sif" },
    ];

    it("by name first, the admin's own choice above that", () => {
        expect(matchContext("phish-resistant-sif", contexts, {})).toEqual({ kind: "byName", contextId: "c1" });
        expect(matchContext("phish-resistant-sif", contexts, { "phish-resistant-sif": "c2" })).toEqual({ kind: "chosen", contextId: "c2" });
        // A remembered choice of a context that is gone does not count
        expect(matchContext("phish-resistant-sif", contexts, { "phish-resistant-sif": "c9" })).toEqual({ kind: "byName", contextId: "c1" });
    });

    it("two names with the same slug or no match: the admin chooses, or the policy check proposes one", () => {
        expect(matchContext("phish-resistant-no-sif", contexts, {})).toEqual({ kind: "choose", candidates: ["c2", "c3"] });
        expect(matchContext("phish-resistant-compliant-device", contexts, {})).toEqual({ kind: "none" });
        expect(matchContext("phish-resistant-compliant-device", contexts, {}, ["c3"])).toEqual({ kind: "byPolicy", contextId: "c3" });
        expect(matchContext("phish-resistant-compliant-device", contexts, {}, ["c1", "c3"])).toEqual({ kind: "choose", candidates: ["c1", "c3"] });
    });
});

describe("per-tenant stores", () => {
    it("remembers a context choice per tenant and forgets it on null", () => {
        const storage = memoryStorage();
        expect(writeContextChoice(storage, "t1", "phish-resistant-sif", "c1")).toBe(true);
        expect(readContextChoices(storage, "t1")).toEqual({ "phish-resistant-sif": "c1" });
        expect(readContextChoices(storage, "t2")).toEqual({});
        expect(storage.data.has(CONTEXT_CHOICE_PREFIX + "t1")).toBe(true);
        writeContextChoice(storage, "t1", "phish-resistant-sif", null);
        expect(readContextChoices(storage, "t1")).toEqual({});
    });

    it("remembers a group placement per tenant", () => {
        const storage = memoryStorage();
        writeGroupPlacement(storage, "t1", "g1", { plane: "Control", securityLevel: "Privileged" });
        expect(readGroupPlacements(storage, "t1")).toEqual({ g1: { plane: "Control", securityLevel: "Privileged" } });
        expect(storage.data.has(GROUP_PLACEMENT_PREFIX + "t1")).toBe(true);
        writeGroupPlacement(storage, "t1", "g1", null);
        expect(readGroupPlacements(storage, "t1")).toEqual({});
    });

    it("survives broken, foreign or missing storage", () => {
        const storage = memoryStorage();
        storage.setItem(CONTEXT_CHOICE_PREFIX + "t1", "{not json");
        storage.setItem(GROUP_PLACEMENT_PREFIX + "t1", JSON.stringify({ g1: { plane: "Moon", securityLevel: "Privileged" }, g2: { plane: "Data", securityLevel: "Enterprise" } }));
        expect(readContextChoices(storage, "t1")).toEqual({});
        // One bad entry is dropped, the others stay, and a write keeps them
        expect(readGroupPlacements(storage, "t1")).toEqual({ g2: { plane: "Data", securityLevel: "Enterprise" } });
        writeGroupPlacement(storage, "t1", "g3", { plane: "Control", securityLevel: "Privileged" });
        expect(Object.keys(readGroupPlacements(storage, "t1")).sort()).toEqual(["g2", "g3"]);
        expect(readContextChoices(null, "t1")).toEqual({});
        expect(writeContextChoice(null, "t1", "x", "c1")).toBe(false);
        expect(writeContextChoice(storage, "", "x", "c1")).toBe(false);
        const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
        expect(readGroupPlacements(throwing, "t1")).toEqual({});
        expect(writeGroupPlacement(throwing, "t1", "g1", { plane: "Data", securityLevel: "Enterprise" })).toBe(false);
    });
});
