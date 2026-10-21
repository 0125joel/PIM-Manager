"use client";

interface SkeletonProps {
    className?: string;
    width?: string | number;
    height?: string | number;
}

/**
 * Placeholder for a value that is not known yet (spec 4.7). A static block in the
 * track colour, radius 4; it never shows 0 and never announces itself.
 */
export function Skeleton({ className = "", width, height }: SkeletonProps) {
    return (
        <span
            aria-hidden="true"
            className={`inline-block rounded bg-track ${className}`}
            style={{
                width: typeof width === "number" ? `${width}px` : width,
                height: typeof height === "number" ? `${height}px` : height,
            }}
        />
    );
}

export default Skeleton;
