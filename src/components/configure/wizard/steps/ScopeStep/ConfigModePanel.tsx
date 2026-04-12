import React from 'react';
import { Plus, DownloadCloud, Copy, AlertCircle } from 'lucide-react';

interface ConfigModePanelProps {
    configMode: "scratch" | "load" | "clone";
    isSingleItemSelected: boolean;
    canClone: boolean;
    onSetMode: (mode: "scratch" | "load" | "clone") => void;
}

export function ConfigModePanel({ configMode, isSingleItemSelected, canClone, onSetMode }: ConfigModePanelProps) {
    return (
        <>
            {/* 3-Column Mode Selection */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {/* 1. Configure from Scratch */}
                <div
                    onClick={() => onSetMode("scratch")}
                    className={`
                        p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 flex flex-col items-center text-center gap-3
                        ${configMode === 'scratch'
                            ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 dark:border-blue-400'
                            : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 bg-white dark:bg-zinc-800'
                        }
                    `}
                >
                    <div className={`p-2 rounded-full ${configMode === 'scratch' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300' : 'bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400'} `}>
                        <Plus className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className={`font-medium text-sm ${configMode === 'scratch' ? 'text-blue-700 dark:text-blue-300' : 'text-zinc-900 dark:text-zinc-100'} `}>
                            Configure from Scratch
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                            Start from Microsoft out-of-box defaults.
                        </p>
                    </div>
                </div>

                {/* 2. Load Current Settings */}
                <div
                    onClick={() => isSingleItemSelected ? onSetMode("load") : null}
                    className={`
                        relative p-4 rounded-lg border-2 transition-all duration-200 flex flex-col items-center text-center gap-3
                        ${!isSingleItemSelected
                            ? 'opacity-60 cursor-not-allowed border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900'
                            : configMode === 'load'
                                ? 'cursor-pointer border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 dark:border-blue-400'
                                : 'cursor-pointer border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 bg-white dark:bg-zinc-800'
                        }
                    `}
                >
                    <div className={`p-2 rounded-full ${configMode === 'load' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300' : 'bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400'} `}>
                        <DownloadCloud className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className={`font-medium text-sm ${configMode === 'load' ? 'text-blue-700 dark:text-blue-300' : 'text-zinc-900 dark:text-zinc-100'} `}>
                            Load Current Settings
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                            Load existing configuration from Entra.
                        </p>
                        {!isSingleItemSelected && (
                            <p className="text-[10px] text-red-500 dark:text-red-400 mt-1 font-medium">
                                Select exactly one item to enable.
                            </p>
                        )}
                    </div>
                </div>

                {/* 3. Clone Existing Config */}
                <div
                    onClick={() => canClone && onSetMode("clone")}
                    className={`
                        relative p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 flex flex-col items-center text-center gap-3
                        ${!canClone ? 'opacity-50 cursor-not-allowed' : ''}
                        ${configMode === 'clone'
                            ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 dark:border-blue-400'
                            : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 bg-white dark:bg-zinc-800'
                        }
                    `}
                >
                    <div className={`p-2 rounded-full ${configMode === 'clone' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300' : 'bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400'} `}>
                        <Copy className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className={`font-medium text-sm ${configMode === 'clone' ? 'text-blue-700 dark:text-blue-300' : 'text-zinc-900 dark:text-zinc-100'} `}>
                            Clone Existing Config
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                            Copy settings from another role.
                        </p>
                    </div>
                    {!canClone && (
                        <div className="absolute inset-0 flex items-center justify-center bg-zinc-100/50 dark:bg-zinc-800/50 rounded-lg backdrop-blur-[1px]" title="Cloning is not available when modifying both Roles and Groups simultaneously.">
                            <AlertCircle className="w-4 h-4 text-zinc-400" />
                        </div>
                    )}
                </div>
            </div>

            {!canClone && (
                <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Cloning is disabled when multiple workloads are selected.
                </div>
            )}
        </>
    );
}
