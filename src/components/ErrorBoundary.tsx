"use client";

import React, { Component, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { Logger } from "@/utils/logger";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * Error Boundary Component
 *
 * Catches JavaScript errors anywhere in child component tree,
 * logs those errors, and displays a fallback UI.
 *
 * Usage:
 * <ErrorBoundary>
 *   <App />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        // Update state so next render shows fallback UI
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        // Log error details only in development to prevent stack trace exposure in production
        if (process.env.NODE_ENV === 'development') {
            Logger.error("ErrorBoundary", "Caught error:", error);
            Logger.error("ErrorBoundary", "Component stack:", errorInfo.componentStack);
        } else {
            // In production, log minimal error info (could integrate with error tracking service)
            Logger.error("ErrorBoundary", "An error occurred:", error.message);
        }
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            // Custom fallback or default
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return <ErrorFallback error={this.state.error} onReset={this.handleReset} />;
        }

        return this.props.children;
    }
}

/**
 * Default Error Fallback UI
 */
interface ErrorFallbackProps {
    error: Error | null;
    onReset: () => void;
}

export function ErrorFallback({ error, onReset }: ErrorFallbackProps) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-page p-4">
            <div role="alert" className="w-full max-w-md rounded border border-line bg-surface p-6" style={{ "--pim-icon-accent": "var(--danger-text)" } as CSSProperties}>
                <div className="flex items-start gap-3">
                    <Icon name="error" size={24} className="shrink-0 text-ink" />
                    <div className="min-w-0 flex-1">
                        <h2 className="text-xl leading-[26px] font-semibold text-ink">Something went wrong</h2>
                        <p className="mt-1 text-sm leading-5 text-body">An unexpected error occurred. This has been logged for investigation.</p>
                    </div>
                </div>

                {/* Error details (development only, never expose stack traces in production) */}
                {error && process.env.NODE_ENV === 'development' && (
                    <details className="mt-4 text-left text-sm">
                        <summary className="cursor-pointer text-muted hover:text-ink">View error details</summary>
                        <pre className="mt-2 overflow-auto rounded bg-danger-tint p-3 text-xs text-danger-text">
                            {error.message}
                            {error.stack && (
                                <>
                                    {"\n\n"}
                                    {error.stack}
                                </>
                            )}
                        </pre>
                    </details>
                )}

                <div className="mt-5 flex flex-wrap gap-3">
                    <Button variant="primary" onClick={onReset}>Try again</Button>
                    <Button onClick={() => window.location.reload()}>Reload the page</Button>
                </div>
            </div>
        </div>
    );
}

export default ErrorBoundary;
