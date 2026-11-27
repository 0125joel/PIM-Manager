import { describe, expect, it } from "vitest";
import { alertsForExport } from "@/utils/alertSummary";
import type { SecurityAlert } from "@/types/securityAlerts.types";

const read = [{ id: "a1" }] as unknown as SecurityAlert[];

describe("alertsForExport (audit run-4: an unread alert list is not 'No active alerts')", () => {
    it("gives the list only when it was read with consent", () => {
        expect(alertsForExport({ hasPermission: true, loading: false, error: null, alerts: read })).toBe(read);
        expect(alertsForExport({ hasPermission: true, loading: false, error: null, alerts: [] })).toEqual([]);
    });

    it("gives null when the read failed, still runs, or has no consent, so the report says the alerts could not be read", () => {
        expect(alertsForExport({ hasPermission: true, loading: false, error: "Microsoft Graph answered 503 after 3 tries.", alerts: [] })).toBeNull();
        expect(alertsForExport({ hasPermission: true, loading: true, error: null, alerts: [] })).toBeNull();
        expect(alertsForExport({ hasPermission: false, loading: false, error: null, alerts: [] })).toBeNull();
        expect(alertsForExport({ hasPermission: null, loading: false, error: null, alerts: [] })).toBeNull();
    });
});
