import { describe, it, expect } from "vitest";
import { cellLabel, classifyProbeError, customExtensionCell, readCell, rowAction, writeCell } from "@/utils/permissionStatus";

describe("classifyProbeError", () => {
    it("treats missing consent as not granted", () => {
        expect(classifyProbeError({ errorCode: "consent_required" })).toBe("notGranted");
        expect(classifyProbeError({ errorCode: "interaction_required" })).toBe("notGranted");
        expect(classifyProbeError({ errorCode: "login_required" })).toBe("notGranted");
        expect(classifyProbeError({ name: "InteractionRequiredAuthError" })).toBe("notGranted");
    });
    it("treats every other failure as unknown, never as not granted", () => {
        expect(classifyProbeError({ errorCode: "network_error" })).toBe("unknown");
        expect(classifyProbeError(new Error("boom"))).toBe("unknown");
        expect(classifyProbeError(null)).toBe("unknown");
        expect(classifyProbeError("text")).toBe("unknown");
    });
});

describe("cells", () => {
    it("read follows the probe", () => {
        expect(readCell("granted")).toBe("granted");
        expect(readCell("checking")).toBe("checking");
    });
    it("write trusts a decisive probe over the stored flag", () => {
        expect(writeCell("granted", false)).toBe("granted");
        expect(writeCell("notGranted", true)).toBe("notGranted");
    });
    it("write falls back to the stored flag only when the probe could not tell", () => {
        expect(writeCell("unknown", true)).toBe("granted");
        expect(writeCell("unknown", false)).toBe("unknown");
    });
    it("maps the custom extension status, a 403 meaning the licence is missing", () => {
        expect(customExtensionCell("granted")).toBe("granted");
        expect(customExtensionCell("forbidden")).toBe("needsLicence");
        expect(customExtensionCell("noConsent")).toBe("notGranted");
        expect(customExtensionCell("checking")).toBe("checking");
    });
});

describe("rowAction", () => {
    it("offers read first, then write", () => {
        expect(rowAction("notGranted", "notGranted")).toBe("grantRead");
        expect(rowAction("granted", "notGranted")).toBe("grantWrite");
    });
    it("offers nothing when everything is granted, read only or needs a licence", () => {
        expect(rowAction("granted", "granted")).toBeNull();
        expect(rowAction("granted", "readOnly")).toBeNull();
        expect(rowAction("needsLicence", "readOnly")).toBeNull();
        expect(rowAction("checking", "checking")).toBeNull();
    });
    it("offers a retry when a cell could not be checked", () => {
        expect(rowAction("unknown", "readOnly")).toBe("retry");
        expect(rowAction("granted", "unknown")).toBe("retry");
    });
});

describe("cellLabel", () => {
    it("uses the spec wording", () => {
        expect(cellLabel("needsLicence")).toBe("Needs Entra ID Governance or Entra Suite");
        expect(cellLabel("granted")).toBe("Granted");
        expect(cellLabel("notGranted")).toBe("Not granted");
        expect(cellLabel("readOnly")).toBe("Read only");
    });
});
