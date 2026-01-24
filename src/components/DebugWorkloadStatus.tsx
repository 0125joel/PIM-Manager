"use client";

import React from "react";
import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";
import { WorkloadType } from "@/types/workload";

export function DebugWorkloadStatus() {
    const {
        initialized,
        activeWorkloads,
        workloads,
        isWorkloadLoading,
        isWorkloadConsented
    } = useUnifiedPimData();

    if (process.env.NODE_ENV === "production") return null;

    return (
        <div className="fixed bottom-4 right-4 z-[9999] p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl max-w-sm overflow-hidden text-xs font-mono">
            <h3 className="font-bold mb-2 flex items-center gap-2">
                <span className={initialized ? "text-green-500" : "text-amber-500"}>●</span>
                Unified PIM Context
                <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1 rounded uppercase">debug</span>
            </h3>

            <div className="space-y-2">
                <div>
                    <span className="text-zinc-500">Initialized:</span> {initialized ? "✅" : "❌"}
                </div>
                <div>
                    <span className="text-zinc-500">Active Workloads:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                        {activeWorkloads.map(w => (
                            <span key={w} className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px]">
                                {w}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-2">
                    <span className="text-zinc-500">Workload States:</span>
                    <div className="mt-1 space-y-1">
                        {(Object.keys(workloads) as WorkloadType[]).map(wId => {
                            const ws = workloads[wId];
                            const loading = isWorkloadLoading(wId);
                            const consented = isWorkloadConsented(wId);

                            return (
                                <div key={wId} className="flex items-center justify-between gap-4 py-0.5">
                                    <span className={consented ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400"}>
                                        {wId}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <span title="Consented">{consented ? "🔒" : "🚫"}</span>
                                        <span title="Data Count" className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
                                            {ws.data.length}
                                        </span>
                                        <span title="Phase" className={`text-[9px] uppercase ${ws.loading.phase === "complete" ? "text-green-600" : "text-amber-600"}`}>
                                            {ws.loading.phase}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[10px] text-zinc-400">
                Alt+D to toggle (impl pending)
            </div>
        </div>
    );
}
