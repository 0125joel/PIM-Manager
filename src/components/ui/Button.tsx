"use client";

import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";

type ButtonVariant = "primary" | "secondary";
type ButtonSize = "sm" | "md";

interface ButtonBaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
    variant?: ButtonVariant;
    /** sm is 30 high, md is 34 high; both grow to 44 on compact layouts. */
    size?: ButtonSize;
    /** The spinner shows inside the button that was pressed and the button is disabled. */
    isLoading?: boolean;
    ref?: Ref<HTMLButtonElement>;
}

interface LabelButtonProps extends ButtonBaseProps {
    icon?: IconName;
    children: ReactNode;
    iconOnly?: false;
    label?: never;
}

interface IconButtonProps extends ButtonBaseProps {
    icon: IconName;
    /** Required: an icon-only button has no visible text, so it needs an accessible name. */
    label: string;
    iconOnly: true;
    children?: never;
}

export type ButtonProps = LabelButtonProps | IconButtonProps;

const VARIANTS: Record<ButtonVariant, string> = {
    primary: "bg-accent text-accent-ink border border-transparent enabled:hover:opacity-90",
    secondary: "bg-surface text-ink border border-line enabled:hover:bg-page",
};

const HEIGHTS: Record<ButtonSize, string> = {
    sm: "h-[30px] max-sm:h-11",
    md: "h-[34px] max-sm:h-11",
};

const SQUARE: Record<ButtonSize, string> = {
    sm: "w-[30px] max-sm:w-11",
    md: "w-[34px] max-sm:w-11",
};

export function Button(props: ButtonProps) {
    const { variant = "secondary", size = "md", isLoading = false, icon, iconOnly, label, children, className = "", disabled, type = "button", ref, ...rest } = props;
    const iconName: IconName | undefined = isLoading ? "spinner" : icon;
    const shape = iconOnly ? `${SQUARE[size]} justify-center` : "gap-2 px-3";

    return (
        <button
            {...rest}
            ref={ref}
            type={type}
            disabled={disabled || isLoading}
            aria-label={iconOnly ? label : undefined}
            aria-busy={isLoading || undefined}
            className={`inline-flex shrink-0 items-center rounded text-[13px] leading-[18px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${HEIGHTS[size]} ${shape} ${className}`}
        >
            {iconName && <Icon name={iconName} size={16} />}
            {!iconOnly && children}
        </button>
    );
}
