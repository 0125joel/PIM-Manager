"use client";

import type { PrincipalSearchFn } from "@/hooks/useUserSearch";
import type { ChangeSourceKind, GroupAccess, Target } from "@/types/configure.types";
import type { FormTarget } from "@/utils/assignmentForm";
import { AddPeopleForm, type ScopeLoaders } from "../edit/AddPeopleForm";
import { PendingAdds } from "../edit/WhoHasIt";

interface PeopleStepProps {
    /** Every ticked target, a group with both of its sides (the form chooses Member or Owner) */
    targets: FormTarget[];
    /** The targets by name (the accessible name of the step) */
    names: readonly string[];
    access: GroupAccess;
    search: PrincipalSearchFn;
    scopes: ScopeLoaders;
    now: Date;
    source: ChangeSourceKind;
    nameOf: (target: Target) => string;
    /** A key that changes with the targets, so the form starts clean for another set */
    formKey: string;
}

/** Step 4 of Guided (spec 6.4): the Add people form of Edit for every target, and the adds waiting */
export function PeopleStep(props: PeopleStepProps) {
    const all: Target[] = props.targets.flatMap((t): Target[] => (t.target.kind === "group" ? [{ ...t.target, access: "member" as const }, { ...t.target, access: "owner" as const }] : [t.target]));
    return (
        <article aria-label={`People for ${props.names.join(", ")}`} className="overflow-hidden rounded border border-line bg-surface">
            <h2 className="sr-only">People</h2>
            <div className="flex flex-col gap-5 p-4 sm:p-5">
                <AddPeopleForm key={props.formKey} targets={props.targets} access={props.access} search={props.search} scopes={props.scopes} now={props.now} source={props.source} />
                <PendingAdds targets={all} nameOf={props.nameOf} />
            </div>
        </article>
    );
}
