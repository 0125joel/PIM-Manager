"use client";

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Logger } from '@/utils/logger';

interface ErrorBoundaryProps {
    children: ReactNode;
    stepName?: string;
    onReset?: () => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary for Wizard Steps
 * Catches JavaScript errors in child components and displays a fallback UI
 */
export class WizardErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null
        };
    }

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.setState({ errorInfo });

        Logger.error('WizardErrorBoundary', 'Caught error', error);
        if (process.env.NODE_ENV === 'development') {
            Logger.error('WizardErrorBoundary', 'Error info', errorInfo);
        }
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
        this.props.onReset?.();
    };

    render() {
        if (this.state.hasError) {
            const { stepName } = this.props;
            const errorMessage = this.state.error?.message || 'An unexpected error occurred';

            return (
                <div className="p-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
                    <div className="flex items-start gap-4">
                        <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/40">
                            <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-lg font-semibold text-red-800 dark:text-red-200">
                                {stepName ? `Error in ${stepName}` : 'Something went wrong'}
                            </h3>
                            <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                                {errorMessage}
                            </p>

                            {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
                                <details className="mt-4">
                                    <summary className="text-xs text-red-600 dark:text-red-400 cursor-pointer hover:underline">
                                        View technical details
                                    </summary>
                                    <pre className="mt-2 p-3 text-xs bg-red-100 dark:bg-red-900/40 rounded overflow-auto max-h-40">
                                        {this.state.errorInfo.componentStack}
                                    </pre>
                                </details>
                            )}

                            <button
                                onClick={this.handleReset}
                                className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                            >
                                <RefreshCw className="w-4 h-4" />
                                Try Again
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default WizardErrorBoundary;
