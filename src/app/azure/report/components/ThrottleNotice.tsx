"use client";

import { StatusBox } from "@/components/ui/StatusBox";

/** The notice while Azure Resource Manager limits requests after a 429 */
export function ThrottleNotice() {
    return (
        <div data-visual-section="azure-throttle">
            <StatusBox variant="warn" title="Azure is limiting requests.">
                Loading continues shortly.
            </StatusBox>
        </div>
    );
}
