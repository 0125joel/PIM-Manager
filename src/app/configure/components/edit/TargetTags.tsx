import { Tag } from "@/components/ui/Tag";
import { TAG_LABELS, type TargetTag } from "@/utils/configureTargets";

/** The tags of a role or group in Configure (spec 5.2, 5.3): Privileged in red with its icon, as the renders */
export function TargetTags({ tags }: { tags: readonly TargetTag[] }) {
    return (
        <>
            {tags.map((tag) => {
                if (tag === "privileged") return <Tag key={tag} variant="danger" icon="privileged">{TAG_LABELS[tag]}</Tag>;
                if (tag === "custom") return <Tag key={tag} className="border-dashed">{TAG_LABELS[tag]}</Tag>;
                if (tag === "notUnderPim") return <Tag key={tag} variant="warn">{TAG_LABELS[tag]}</Tag>;
                return <Tag key={tag}>{TAG_LABELS[tag]}</Tag>;
            })}
        </>
    );
}
