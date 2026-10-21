import { describe, expect, it } from "vitest";
import { convertLegacyReportParams } from "@/utils/legacyReportParams";

const convert = (search: string) => convertLegacyReportParams(search);

describe("convertLegacyReportParams", () => {
    it("leaves a search without legacy parameters exactly as it came", () => {
        expect(convert("")).toEqual({ search: "", changed: false });
        expect(convert("?view=groups&q=anna&role=abc&f=mfa:neither&utm=1")).toEqual({ search: "?view=groups&q=anna&role=abc&f=mfa:neither&utm=1", changed: false });
    });

    it("does not add a hidden default filter", () => {
        expect(convert("?search=")).toEqual({ search: "", changed: true });
    });

    it.each([
        ["privileged=yes", "f=privileged:true"],
        ["privileged=privileged", "f=privileged:true"],
        ["privileged=non-privileged", "f=privileged:false"],
        ["approval=required", "f=approval:required"],
        ["approval=yes", "f=approval:required"],
        ["approval=no", "f=approval:notRequired"],
        ["justification=yes", "f=justification:required"],
        ["justification=no", "f=justification:notRequired"],
        ["mfaType=azure-mfa", "f=mfa:entraMfa"],
        ["mfaType=ca:c1", "f=mfa:authContext"],
        ["mfaType=none", "f=mfa:neither"],
        ["maxDuration=<1h", "f=maxDuration:upTo1h"],
        ["maxDuration=2-4h", "f=maxDuration:upTo4h"],
        ["maxDuration=5-8h", "f=maxDuration:upTo8h"],
        ["maxDuration=9-12h", "f=maxDuration:upTo12h"],
        ["maxDuration=>12h", "f=maxDuration:over12h"],
        ["assignmentType=permanent", "f=assignment:permanent"],
        ["assignmentType=eligible", "f=assignment:eligible"],
        ["memberType=group", "f=via:group"],
        ["memberType=direct", "f=via:direct"],
        ["roleType=custom", "f=customRole:true"],
        ["roleType=builtin", "f=customRole:false"],
        ["hasAssignments=yes", "f=hasAssignments:true"],
    ])("%s becomes %s", (legacy, expected) => {
        expect(convert(`?${legacy}`)).toEqual({ search: expected, changed: true });
    });

    it("takes the first value of a list", () => {
        expect(convert("?mfaType=azure-mfa,ca:c1&maxDuration=5-8h,>12h").search).toBe("f=mfa:entraMfa,maxDuration:upTo8h");
    });

    it("maps search and user to q, search first", () => {
        expect(convert("?search=anna")).toEqual({ search: "q=anna", changed: true });
        expect(convert("?user=bram@contoso.com")).toEqual({ search: "q=bram%40contoso.com", changed: true });
        expect(convert("?search=anna&user=bram").search).toBe("q=anna");
    });

    it("drops parameters without a counterpart", () => {
        expect(convert("?pimConfigured=configured&assignmentCount=1-5&scopeType=rmau&groupType=security&accessType=owner&customExtension=yes&duration=permanent&hasAssignments=no&approval=na")).toEqual({ search: "", changed: true });
    });

    it("keeps parameters that are not legacy and the selection", () => {
        expect(convert("?view=groups&group=g1&privileged=yes&utm=1").search).toBe("view=groups&group=g1&utm=1&f=privileged:true");
    });

    it("lets an existing f win over a converted key with the same name and merges the rest", () => {
        expect(convert("?f=mfa:neither&mfaType=azure-mfa&approval=required").search).toBe("f=approval:required,mfa:neither");
        expect(convert("?q=keep&search=ignored").search).toBe("q=keep");
    });

    it("ignores values it does not know", () => {
        expect(convert("?privileged=maybe&approval=perhaps&mfaType=weird&maxDuration=huge&assignmentType=odd&memberType=odd&roleType=odd")).toEqual({ search: "", changed: true });
    });
});
