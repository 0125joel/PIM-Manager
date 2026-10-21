import { describe, expect, it } from "vitest";
import type { BasketAdd, BasketRemove, BasketUpdate, Target } from "@/types/configure.types";
import { buildScheduleRequest, requestForChange, SCHEDULE_REQUEST_PATHS } from "@/utils/assignmentRequests";

const ROLE: Target = { kind: "role", id: "role-1" };
const GROUP: Target = { kind: "group", id: "group-1", access: "owner" };
const ANNA = { id: "anna", kind: "user" as const, displayName: "Anna" };

describe("buildScheduleRequest (spec 13.1)", () => {
    it("builds every action for roles and groups, on v1.0", () => {
        for (const action of ["adminAssign", "adminUpdate", "adminExtend", "adminRenew", "adminRemove"] as const) {
            for (const type of ["eligible", "active"] as const) {
                const role = buildScheduleRequest({ action, target: ROLE, principalId: "anna", type, scope: "/administrativeUnits/au1", end: "2026-12-01T00:00:00Z", justification: "why" });
                expect(role).toMatchObject({ url: SCHEDULE_REQUEST_PATHS.role[type], version: "v1.0", body: { action, principalId: "anna", roleDefinitionId: "role-1", directoryScopeId: "/administrativeUnits/au1", justification: "why" } });
                const group = buildScheduleRequest({ action, target: GROUP, principalId: "anna", type, scope: "/", end: null });
                expect(group).toMatchObject({ url: SCHEDULE_REQUEST_PATHS.group[type], body: { action, principalId: "anna", groupId: "group-1", accessId: "owner" } });
                expect(group.body).not.toHaveProperty("directoryScopeId");
                expect("scheduleInfo" in role.body).toBe(action !== "adminRemove");
            }
        }
    });

    it("leaves the start out for 'when applied', sends a chosen start, and an end or no expiration", () => {
        expect(buildScheduleRequest({ action: "adminAssign", target: ROLE, principalId: "a", type: "eligible", scope: "/", start: null, end: "2026-12-01T00:00:00Z" }).body.scheduleInfo)
            .toEqual({ expiration: { type: "afterDateTime", endDateTime: "2026-12-01T00:00:00Z" } });
        expect(buildScheduleRequest({ action: "adminAssign", target: ROLE, principalId: "a", type: "eligible", scope: "/", start: "2026-11-01T08:00:00Z", end: null }).body.scheduleInfo)
            .toEqual({ startDateTime: "2026-11-01T08:00:00Z", expiration: { type: "noExpiration" } });
    });

    it("marks a dry run with isValidationOnly and omits it otherwise; no justification when none is given", () => {
        const dry = buildScheduleRequest({ action: "adminAssign", target: GROUP, principalId: "a", type: "active", scope: "/", end: null, isValidationOnly: true });
        expect(dry.body.isValidationOnly).toBe(true);
        const real = buildScheduleRequest({ action: "adminAssign", target: GROUP, principalId: "a", type: "active", scope: "/", end: null });
        expect(real.body).not.toHaveProperty("isValidationOnly");
        expect(real.body).not.toHaveProperty("justification");
    });
});

describe("requestForChange", () => {
    it("an add is adminAssign, an update keeps its action and the start as read, a removal is adminRemove", () => {
        const add: BasketAdd = { kind: "add", target: ROLE, principal: ANNA, type: "eligible", scope: "/", start: null, end: "2026-12-01T00:00:00Z", justification: "new", source: { from: "edit" } };
        expect(requestForChange(add, { isValidationOnly: true }).body).toMatchObject({ action: "adminAssign", principalId: "anna", justification: "new", isValidationOnly: true });
        const upd: BasketUpdate = { kind: "update", target: GROUP, schedule: { principal: ANNA, type: "active", scope: "/", end: null, start: "2026-09-01T00:00:00Z" }, end: "2026-12-31T00:00:00Z", action: "adminExtend", source: { from: "edit" } };
        expect(requestForChange(upd).body).toMatchObject({ action: "adminExtend", groupId: "group-1", accessId: "owner", scheduleInfo: { startDateTime: "2026-09-01T00:00:00Z", expiration: { type: "afterDateTime", endDateTime: "2026-12-31T00:00:00Z" } } });
        const rem: BasketRemove = { kind: "remove", target: ROLE, schedule: { principal: ANNA, type: "active", scope: "/", end: null }, source: { from: "edit" } };
        expect(requestForChange(rem)).toMatchObject({ url: SCHEDULE_REQUEST_PATHS.role.active, body: { action: "adminRemove", principalId: "anna", roleDefinitionId: "role-1", directoryScopeId: "/" } });
        expect(requestForChange(rem).body).not.toHaveProperty("scheduleInfo");
    });
});
