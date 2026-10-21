import type { IconName } from "@/components/icons/Icon";
import type { ConfigureMode } from "@/utils/configureUrlState";

/** The modes of Configure (spec 2, 4): name, icon and the classes of their colour token (written out for Tailwind) */
export interface ModeInfo {
    name: string;
    icon: IconName;
    /** Icon tile: tint background, mode colour */
    tile: string;
    /** The mode bar: the tint as background and the 2px line under it in the mode colour */
    bar: string;
    /** The icon in the white tile of the mode bar */
    text: string;
}

export const MODES: Record<Exclude<ConfigureMode, "model">, ModeInfo> = {
    guided: { name: "Guided", icon: "wizard", tile: "bg-mode-guided-tint text-mode-guided", bar: "bg-mode-guided-tint border-mode-guided", text: "text-mode-guided" },
    edit: { name: "Edit roles and groups", icon: "manual", tile: "bg-mode-edit-tint text-mode-edit", bar: "bg-mode-edit-tint border-mode-edit", text: "text-mode-edit" },
    import: { name: "Import a file", icon: "upload", tile: "bg-mode-import-tint text-mode-import", bar: "bg-mode-import-tint border-mode-import", text: "text-mode-import" },
};
