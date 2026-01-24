"use client";

import React, { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

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
            console.error("[ErrorBoundary] Caught error:", error);
            console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);
        } else {
            // In production, log minimal error info (could integrate with error tracking service)
            console.error("[ErrorBoundary] An error occurred:", error.message);
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
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 p-4">
            <div className="max-w-md w-full bg-white dark:bg-zinc-800 rounded-xl shadow-lg p-6 text-center">
                {/* Icon */}
                <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                    <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
                </div>

                {/* Title */}
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                    Something went wrong
                </h2>

                {/* Description */}
                <p className="text-zinc-600 dark:text-zinc-400 mb-4">
                    An unexpected error occurred. This has been logged for investigation.
                </p>

                {/* Error details (collapsed by default in production) */}
                {error && (
                    <details className="text-left mb-4 text-sm">
                        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                            View error details
                        </summary>
                        <pre className="mt-2 p-3 bg-zinc-100 dark:bg-zinc-900 rounded-lg overflow-auto text-xs text-red-600 dark:text-red-400">
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

                {/* Actions */}
                <div className="flex gap-3 justify-center">
                    <button
                        onClick={onReset}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Try Again
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-900 dark:text-zinc-100 rounded-lg font-medium transition-colors"
                    >
                        Refresh Page
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ErrorBoundary;
