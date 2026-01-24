"use client";

import html2canvas from "html2canvas";

/**
 * Sanitizes colors in an element tree to avoid html2canvas parsing errors
 * with modern CSS color functions like lab(), oklch(), etc.
 */
function sanitizeColorsInElement(element: HTMLElement): void {
    const processElement = (el: HTMLElement) => {
        const computed = window.getComputedStyle(el);

        // Check and fix color
        if (computed.color.includes("lab(") || computed.color.includes("oklch(") || computed.color.includes("lch(")) {
            el.style.color = "#000000";
        }

        // Check and fix background-color
        if (computed.backgroundColor.includes("lab(") || computed.backgroundColor.includes("oklch(") || computed.backgroundColor.includes("lch(")) {
            el.style.backgroundColor = "#ffffff";
        }

        // Check and fix border-color
        if (computed.borderColor.includes("lab(") || computed.borderColor.includes("oklch(") || computed.borderColor.includes("lch(")) {
            el.style.borderColor = "#e5e7eb";
        }
    };

    processElement(element);
    element.querySelectorAll("*").forEach((child) => {
        if (child instanceof HTMLElement) {
            processElement(child);
        }
    });
}

/**
 * Captures a DOM element (like a chart container) as a base64 PNG image.
 * @param element - The DOM element to capture
 * @returns Promise<string> - Base64 data URL of the captured image
 */
export async function captureElementAsImage(element: HTMLElement): Promise<string> {
    // Get original element dimensions
    const rect = element.getBoundingClientRect();

    // Clone the element to avoid modifying the original
    const clone = element.cloneNode(true) as HTMLElement;

    // Position clone off-screen but still in DOM for proper rendering
    // CRITICAL: Set explicit dimensions to match original (ResponsiveContainer needs this)
    clone.style.position = "absolute";
    clone.style.left = "-9999px";
    clone.style.top = "-9999px";
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.backgroundColor = "#ffffff";
    clone.style.overflow = "visible"; // Ensure nothing is clipped
    document.body.appendChild(clone);

    // Sanitize modern CSS colors that html2canvas doesn't support
    sanitizeColorsInElement(clone);

    try {
        const canvas = await html2canvas(clone, {
            backgroundColor: "#ffffff",
            scale: 2,
            useCORS: true,
            logging: false,
        });
        return canvas.toDataURL("image/png");
    } finally {
        // Always clean up the clone
        document.body.removeChild(clone);
    }
}

/**
 * Captures multiple chart elements by their IDs
 * @param chartIds - Array of element IDs to capture
 * @returns Promise<Record<string, string>> - Map of ID to base64 image
 */
export async function captureChartsAsImages(
    chartIds: string[]
): Promise<Record<string, string>> {
    const images: Record<string, string> = {};

    for (const id of chartIds) {
        const element = document.getElementById(id);
        if (element) {
            try {
                images[id] = await captureElementAsImage(element);
            } catch (error) {
                console.error(`Failed to capture chart ${id}:`, error);
            }
        }
    }

    return images;
}
