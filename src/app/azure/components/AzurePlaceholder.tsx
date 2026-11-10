import Link from "next/link";
import { PAGE_TITLE_CLASS } from "@/components/ui/SectionHeader";

/** A page Azure does not have yet (Azure spec 1): its name, one line and the way to the Azure Report */
export function AzurePlaceholder({ page }: { page: "Dashboard" | "Configure" }) {
    return (
        <div data-visual-section="azure-placeholder" className="mx-auto max-w-[1376px]">
            <h1 className={PAGE_TITLE_CLASS}>{page}</h1>
            <p className="mt-2 text-sm text-body">The Azure {page} comes in a later version of PIM Manager.</p>
            <p className="mt-4 text-sm">
                <Link href="/azure/report" className="text-accent underline underline-offset-2">Open the Azure Report</Link>
            </p>
        </div>
    );
}
