"use client";

import { Button } from "@/components/ui/Button";
import { StatusBox } from "@/components/ui/StatusBox";

interface AzureLoadErrorProps {
    message: string;
    onRetry: () => void;
    isRetrying: boolean;
}

/** The error box of a failed Azure load, with Try again */
export function AzureLoadError({ message, onRetry, isRetrying }: AzureLoadErrorProps) {
    return (
        <div data-visual-section="azure-error">
            <StatusBox
                variant="error"
                title="Loading from Azure failed"
                action={
                    <Button onClick={onRetry} isLoading={isRetrying}>
                        Try again
                    </Button>
                }
            >
                {message}
            </StatusBox>
        </div>
    );
}
