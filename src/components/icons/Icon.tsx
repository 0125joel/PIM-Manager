import { createElement, type CSSProperties } from "react";
import { ICON_DATA, type IconElement, type IconName } from "./iconData";

export type { IconName } from "./iconData";

export type IconSize = 16 | 20 | 24;

export interface IconProps {
    name: IconName;
    size?: IconSize;
    className?: string;
    /** When set the SVG is exposed to assistive technology; otherwise it is aria-hidden. */
    label?: string;
}

/** SVG attribute names that React spells in camelCase. */
const ATTRIBUTE_NAMES: Record<string, string> = {
    "stroke-width": "strokeWidth",
    "stroke-dasharray": "strokeDasharray",
};

function renderElement([tag, attrs]: IconElement, key: number) {
    const props: Record<string, unknown> = { key };
    for (const [name, value] of Object.entries(attrs)) {
        props[ATTRIBUTE_NAMES[name] ?? name] = value as string | CSSProperties;
    }
    return createElement(tag, props);
}

/**
 * The NextGen icon set (docs/Assets/next-gen/icons). The line takes the text colour;
 * the one accent element reads --pim-icon-accent or --pim-icon-warn.
 * Always place it next to a visible label, or give the button an aria-label.
 */
export function Icon({ name, size = 20, className, label }: IconProps) {
    const elements: readonly IconElement[] = ICON_DATA[name];
    const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
    const spin = name === "spinner" ? " motion-safe:animate-spin" : "";
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0${spin}${className ? ` ${className}` : ""}`}
            {...a11y}
        >
            {elements.map(renderElement)}
        </svg>
    );
}
