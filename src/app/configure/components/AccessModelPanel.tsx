import { Button } from "@/components/ui/Button";

interface AccessModelPanelProps {
    /** Roles in the catalog; null while it is read */
    roleCount: number | null;
    onOpen: () => void;
}

/** The access model panel of the start page (spec 4); the page itself is always readable (3.4) */
export function AccessModelPanel({ roleCount, onOpen }: AccessModelPanelProps) {
    return (
        <section aria-labelledby="access-model-title" className="rounded border border-line bg-surface p-4">
            <h2 id="access-model-title" className="text-sm font-semibold text-ink">Access model</h2>
            <p className="mt-1 text-xs leading-5 text-body">
                {`How PIM Monitor sorts all ${roleCount !== null ? `${roleCount} ` : ""}Entra roles into planes and levels, and the settings it recommends per level. An interpretation of Microsoft's Enterprise Access Model.`}
            </p>
            <Button size="sm" className="mt-2" onClick={onOpen}>Open the access model</Button>
        </section>
    );
}
