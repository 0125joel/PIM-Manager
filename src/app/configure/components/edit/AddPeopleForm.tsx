"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useConfigureBasketActions } from "@/contexts/ConfigureBasketContext";
import type { PrincipalSearchFn } from "@/hooks/useUserSearch";
import type { ChangeSourceKind, GroupAccess } from "@/types/configure.types";
import type { RoleDefinition } from "@/types/directoryRole.types";
import type { ScopeObject } from "@/services/scopeOptionsService";
import {
    EMPTY_FORM,
    allowsOnlyNoEnd,
    buildAdds,
    checkForm,
    describeMaxChoice,
    describePolicySentence,
    hasProblems,
    latestEnd,
    maxEndFrom,
    onSide,
    policyLimits,
    scopeOptions,
    supportsAdministrativeUnit,
    supportsApplication,
    type AddForm,
    type FormTarget,
} from "@/utils/assignmentForm";
import type { ApproverRef } from "@/utils/policyRules";
import { ApproverPicker } from "./ApproverPicker";

export interface ScopeLoaders {
    /** The tenant's administrative units; read once, when a role that supports them is shown */
    loadAdministrativeUnits: () => Promise<ScopeObject[]>;
    /** App registrations by name */
    searchApplications: (term: string) => Promise<ScopeObject[]>;
}

interface AddPeopleFormProps {
    /** One target, or every selected target in Select several (the same people on each) */
    targets: readonly FormTarget[];
    /** Roles: the definition of the one role, for its scopes; undefined for groups and several roles */
    role?: RoleDefinition;
    /** Groups: the side the form starts on */
    access?: GroupAccess;
    search: PrincipalSearchFn;
    scopes: ScopeLoaders;
    /** "now" for the policy maximum and the date checks */
    now: Date;
    /** Where the adds come from (Guided passes its own) */
    source?: ChangeSourceKind;
}

const FIELD = "flex flex-col gap-1";
const LABEL = "text-[13px] font-semibold text-ink";
const HINT = "text-xs leading-4 text-body";
const ERROR = "flex items-start gap-1 text-xs leading-4 text-danger-text";
const INPUT = "h-[34px] w-full rounded border border-line bg-surface px-2 text-sm text-ink placeholder:text-muted disabled:opacity-50 max-sm:h-11";

const toDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Add people (spec 5.7): people and groups, Eligible | Active, Member | Owner for groups, the scope for one role, when it
 * starts and ends, the justification. What is allowed comes from the policy of each target as read from the tenant;
 * "Add to changes" puts one add per person and target in the basket, nothing is written until the review.
 */
export function AddPeopleForm({ targets, role, access = "member", search, scopes, now, source = "edit" }: AddPeopleFormProps) {
    const { add } = useConfigureBasketActions();
    const [form, setForm] = useState<AddForm>(() => EMPTY_FORM(access));
    const [tried, setTried] = useState(false);
    const [status, setStatus] = useState("");
    const [units, setUnits] = useState<ScopeObject[] | null>(null);
    const [unitsFailed, setUnitsFailed] = useState(false);
    const [applications, setApplications] = useState<ScopeObject[]>([]);
    const [appTerm, setAppTerm] = useState("");
    const id = useId();
    const isRoles = targets.every((t) => t.target.kind === "role");
    const isSeveral = targets.length > 1;
    // Roles: Graph is asked for role-assignable groups only, so they are not crowded out of the top results
    const searchPeople = useCallback((term: string) => search(term, isRoles ? { onlyRoleAssignableGroups: true } : undefined), [search, isRoles]);
    const [chosenApp, setChosenApp] = useState<ScopeObject | null>(null);
    const wantsUnits = role ? supportsAdministrativeUnit(role) : false;
    const wantsApps = role ? supportsApplication(role) : false;

    // The units are read once, when a role that may be assigned at one is shown
    const loadUnits = scopes.loadAdministrativeUnits;
    useEffect(() => {
        if (!wantsUnits || units !== null) return;
        let isCurrent = true;
        loadUnits().then((list) => { if (isCurrent) setUnits(list); }, () => { if (isCurrent) setUnitsFailed(true); });
        return () => { isCurrent = false; };
    }, [wantsUnits, units, loadUnits]);

    // App registrations by name, 3 characters, the last answer wins
    const searchApps = scopes.searchApplications;
    useEffect(() => {
        if (!wantsApps || appTerm.trim().length < 3) return;
        let isCurrent = true;
        const timer = setTimeout(() => {
            searchApps(appTerm).then((list) => { if (isCurrent) setApplications(list); }, () => undefined);
        }, 400);
        return () => { isCurrent = false; clearTimeout(timer); };
    }, [wantsApps, appTerm, searchApps]);

    // The side the targets are read on: the form's own choice for groups
    const sided = useMemo(() => onSide(targets, form.access), [targets, form.access]);
    const problems = checkForm(form, sided, now);
    const shown = tried ? problems : {};
    const limits = sided.map((t) => policyLimits(t.settings, form.type));
    const noEndAllowed = limits.every((l) => l.permanentAllowed !== false);
    // A PT0S policy accepts no dated end (allowsOnlyNoEnd); with several targets checkForm names the ones
    const onlyNoEnd = limits.length === 1 && allowsOnlyNoEnd(limits[0]);
    const start = form.start.kind === "date" ? new Date(`${form.start.date}T00:00:00`) : now;
    const from = Number.isNaN(start.getTime()) ? now : start;
    const latest = sided.length === 1 ? latestEnd(limits[0], from) : null;
    const maxEnd = sided.length === 1 ? maxEndFrom(limits[0], from) : null;
    const needsJustification = limits.some((l) => l.justificationRequired);
    // The application chosen keeps its name when a new search replaces the list
    const options = role ? scopeOptions(role, units ?? [], chosenApp && !applications.some((a) => a.id === chosenApp.id) ? [chosenApp, ...applications] : applications) : [];
    const isScheduled = form.start.kind === "date" && start.getTime() > now.getTime();
    const sentence = sided.length === 1 ? describePolicySentence(sided[0].settings) : null;
    const set = (patch: Partial<AddForm>) => { setForm((f) => ({ ...f, ...patch })); setStatus(""); };

    const submit = () => {
        setTried(true);
        if (hasProblems(problems)) return;
        const scopeName = form.scope !== "/" ? options.find((o) => o.value === form.scope)?.label : undefined;
        const adds = buildAdds(form, sided, now, { from: source }).map((a) => (scopeName && a.scope === form.scope ? { ...a, scopeName } : a));
        add(adds);
        setStatus(`Added ${adds.length} ${adds.length === 1 ? "assignment" : "assignments"} to changes.`);
        setForm(EMPTY_FORM(form.access));
        setTried(false);
    };

    const people: ApproverRef[] = form.principals.map((p) => ({ id: p.id, type: p.kind === "group" ? "group" : "user", displayName: p.displayName }));
    const count = form.principals.length * Math.max(1, targets.length);

    return (
        <form
            noValidate
            aria-labelledby={`${id}-title`}
            onSubmit={(event) => { event.preventDefault(); submit(); }}
            className="flex flex-col gap-4 rounded border border-line bg-page p-4"
        >
            <h3 id={`${id}-title`} className="text-[15px] font-semibold text-ink">{isSeveral ? `Add people to all ${targets.length} selected` : "Add people"}</h3>
            <div className={FIELD}>
                <span className={LABEL}>People and groups</span>
                <ApproverPicker
                    approvers={people}
                    search={searchPeople}
                    accept={isRoles ? (found) => found.kind === "user" || found.isAssignableToRole === true : undefined}
                    listLabel="People and groups to add"
                    addLabel="Find users or groups"
                    onChange={(list) => set({ principals: list.map((a) => ({ id: a.id, kind: a.type === "group" ? "group" : "user", displayName: a.displayName ?? a.id })) })}
                />
                {shown.principals ? <p id={`${id}-people-error`} role="alert" className={ERROR}><Icon name="error" size={16} className="shrink-0" />{shown.principals}</p> : <p className={HINT}>{isRoles ? "Only role-assignable groups can hold a directory role." : "Users and groups."}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div className={FIELD}>
                    <span className={LABEL}>Type</span>
                    <SegmentedControl
                        ariaLabel="Type"
                        variant="pill"
                        value={form.type}
                        onChange={(type) => set({ type })}
                        className="w-fit"
                        options={[{ value: "eligible", label: "Eligible" }, { value: "active", label: "Active" }]}
                    />
                    <p className={HINT}>{form.type === "eligible" ? "They activate it when they need it." : "Active right away, without activation."}</p>
                </div>
                {!isRoles ? (
                    <div className={FIELD}>
                        <span className={LABEL}>Access</span>
                        <SegmentedControl
                            ariaLabel="Access"
                            variant="pill"
                            value={form.access}
                            onChange={(value) => set({ access: value })}
                            className="w-fit"
                            options={[{ value: "member", label: "Member" }, { value: "owner", label: "Owner" }]}
                        />
                        <p className={HINT}>Owners can manage the group.</p>
                    </div>
                ) : role ? (
                    <div className={FIELD}>
                        <label htmlFor={`${id}-scope`} className={LABEL}>Scope</label>
                        <select
                            id={`${id}-scope`}
                            value={form.scope}
                            onChange={(e) => {
                                const value = e.target.value;
                                setChosenApp(applications.find((a) => `/${a.id}` === value) ?? (value === `/${chosenApp?.id}` ? chosenApp : null));
                                set({ scope: value });
                            }}
                            className={INPUT}
                        >
                            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            {!options.some((o) => o.value === form.scope) && <option value={form.scope}>{form.scope}</option>}
                        </select>
                        {wantsApps && (
                            <input type="search" aria-label="Find an application" value={appTerm} onChange={(e) => setAppTerm(e.target.value)} placeholder="Find an application by name" className={INPUT} />
                        )}
                        <p className={HINT}>
                            Where the role applies.
                            {wantsUnits && units === null && !unitsFailed && " Reading the administrative units…"}
                            {unitsFailed && " The administrative units could not be read."}
                        </p>
                    </div>
                ) : (
                    <div className={FIELD}>
                        <span className={LABEL}>Scope</span>
                        <p className="text-sm text-ink">Tenant-wide</p>
                        <p className={HINT}>Several roles are added tenant-wide. Open one role to add it at an administrative unit or an application.</p>
                    </div>
                )}
                <div className={FIELD}>
                    <label htmlFor={`${id}-start`} className={LABEL}>Starts</label>
                    <select id={`${id}-start`} value={form.start.kind} onChange={(e) => set({ start: e.target.value === "date" ? { kind: "date", date: toDateInput(now) } : { kind: "now" } })} className={INPUT}>
                        <option value="now">When applied</option>
                        <option value="date">On a date</option>
                    </select>
                    {form.start.kind === "date" && (
                        <input type="date" aria-label="Start date" aria-describedby={shown.start ? `${id}-start-error` : undefined} aria-invalid={shown.start ? true : undefined} min={toDateInput(now)} value={form.start.date} onChange={(e) => set({ start: { kind: "date", date: e.target.value } })} className={INPUT} />
                    )}
                    {shown.start ? <p id={`${id}-start-error`} className={ERROR}><Icon name="error" size={16} className="shrink-0" />{shown.start}</p> : isScheduled && <p className={HINT}>Scheduled: PIM blocks changes to it until it starts.</p>}
                </div>
                <div className={FIELD}>
                    <label htmlFor={`${id}-end`} className={LABEL}>Ends</label>
                    <select
                        id={`${id}-end`}
                        value={form.end.kind}
                        onChange={(e) => set({ end: e.target.value === "date" ? { kind: "date", date: toDateInput(maxEnd ?? new Date(start.getTime() + 30 * 864e5)) } : e.target.value === "none" ? { kind: "none" } : { kind: "max" } })}
                        className={INPUT}
                    >
                        <option value="max">{describeMaxChoice(sided, form.type, Number.isNaN(start.getTime()) ? now : start)}</option>
                        <option value="date" disabled={onlyNoEnd}>{onlyNoEnd ? "On a date (not allowed by the policy)" : "On a date"}</option>
                        {/* With only no end allowed, the first choice is already "No end date" */}
                        {!onlyNoEnd && <option value="none" disabled={!noEndAllowed}>{noEndAllowed ? "No end date" : "No end date (not allowed by the policy)"}</option>}
                    </select>
                    {form.end.kind === "date" && (
                        <input type="date" aria-label="End date" aria-describedby={shown.end ? `${id}-end-error` : undefined} aria-invalid={shown.end ? true : undefined} min={toDateInput(now)} max={latest ? toDateInput(latest) : undefined} value={form.end.date} onChange={(e) => set({ end: { kind: "date", date: e.target.value } })} className={INPUT} />
                    )}
                    {shown.end ? <p id={`${id}-end-error`} className={ERROR}><Icon name="error" size={16} className="shrink-0" />{shown.end}</p> : form.end.kind === "date" && latest && <p className={HINT}>{`Up to ${latest.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, the policy maximum.`}</p>}
                </div>
                <div className={`${FIELD} sm:col-span-2`}>
                    <label htmlFor={`${id}-why`} className={LABEL}>{`Justification ${needsJustification && form.type === "active" ? "(required by the policy)" : "(optional)"}`}</label>
                    <input id={`${id}-why`} type="text" value={form.justification} onChange={(e) => set({ justification: e.target.value })} placeholder="Why they need it, for the audit log" className={INPUT} aria-invalid={shown.justification ? true : undefined} aria-describedby={shown.justification ? `${id}-why-error` : undefined} />
                    {shown.justification ? <p id={`${id}-why-error`} className={ERROR}><Icon name="error" size={16} className="shrink-0" />{shown.justification}</p> : <p className={HINT}>Stored with the assignment request.</p>}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="secondary">{count > 1 ? `Add ${count} assignments to changes` : "Add to changes"}</Button>
                <span className={HINT}>Nothing is written until you review and apply.</span>
            </div>
            <p role="status" className="text-[13px] text-body empty:sr-only">{status}</p>
            {sentence && <p className={HINT}>{sentence}</p>}
            {targets.some((t) => t.settings === null) && <p className={HINT}>The policy of some targets is not read (or the group is not under PIM yet): Microsoft checks those assignments against it when you apply, and the review tries them first.</p>}
        </form>
    );
}
