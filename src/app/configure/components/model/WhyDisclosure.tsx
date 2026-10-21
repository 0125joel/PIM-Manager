import type { CatalogRoleRow } from "@/utils/accessModelView";

/** "Why" under a role (spec 8): the role description from the tenant, the reason for the level and the note of the catalog */
export function WhyDisclosure({ why }: { why: CatalogRoleRow["why"] }) {
    return (
        <details className="mt-0.5 group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-[12px] font-semibold text-accent marker:content-none max-sm:min-h-8 [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="text-[9px] transition-transform group-open:rotate-90">&#9654;</span>
                Why
            </summary>
            <div className="mt-1 flex max-w-prose flex-col gap-1 text-[12px] leading-[18px] font-normal text-body">
                {why.description && <p>{why.description}</p>}
                <p>{why.reasonText}</p>
                {why.note && <p>{why.note}</p>}
            </div>
        </details>
    );
}
