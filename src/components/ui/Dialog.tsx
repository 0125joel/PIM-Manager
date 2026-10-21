"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";

interface DialogProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    /** Width in px on large screens (default 560). */
    width?: number;
    className?: string;
}

/**
 * Native <dialog> opened with showModal(): focus is trapped by the browser, Escape closes,
 * and focus returns to the element that was focused when it opened (spec 3.5).
 */
export function Dialog({ isOpen, onClose, title, children, width = 560, className = "" }: DialogProps) {
    const ref = useRef<HTMLDialogElement>(null);
    const openerRef = useRef<HTMLElement | null>(null);
    const isClosingFromParent = useRef(false);
    const titleId = useId();

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (isOpen && !dialog.open) {
            openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            dialog.showModal();
        } else if (!isOpen && dialog.open) {
            isClosingFromParent.current = true;
            dialog.close();
        }
    }, [isOpen]);

    const handleClose = () => {
        // The parent already knows when it closed the dialog itself
        if (isClosingFromParent.current) {
            isClosingFromParent.current = false;
            return;
        }
        if (openerRef.current?.isConnected) openerRef.current.focus();
        onClose();
    };

    return (
        <dialog
            ref={ref}
            aria-labelledby={titleId}
            onClose={handleClose}
            onClick={(event) => {
                // A click on the backdrop lands on the dialog element itself
                if (event.target === ref.current) ref.current?.close();
            }}
            style={{ maxWidth: `min(${width}px, calc(100vw - 32px))` }}
            className={`m-auto w-full rounded-xl bg-surface p-0 text-ink shadow-dialog backdrop:bg-scrim ${className}`}
        >
            {isOpen && (
                <div className="p-6">
                    <div className="flex items-start justify-between gap-4">
                        <h2 id={titleId} className="text-xl leading-[26px] font-semibold text-ink">
                            {title}
                        </h2>
                        <button
                            type="button"
                            onClick={() => ref.current?.close()}
                            aria-label="Close"
                            className="-mr-2 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-body hover:text-ink max-sm:h-11 max-sm:w-11"
                        >
                            <Icon name="close" size={20} />
                        </button>
                    </div>
                    <div className="mt-4">{children}</div>
                </div>
            )}
        </dialog>
    );
}
