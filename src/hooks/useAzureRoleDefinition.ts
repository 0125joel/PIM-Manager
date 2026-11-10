"use client";

import { useEffect, useState } from "react";
import { useAzureActions } from "@/contexts/AzureContext";
import { getRoleDefinition } from "@/services/azureRoleDefinitionService";
import type { ArmClient } from "@/utils/armClient";
import { Logger } from "@/utils/logger";

export interface AzureRoleDefinitionTarget {
    scopeId: string;
    /** The role GUID */
    roleDefinitionId: string;
}

/**
 * The descriptions read in this page load, per role GUID (lowercase): a role is one definition at every scope, so it
 * is read once. A failure is kept as null and not read again (Azure spec 15.4). Memory only, never storage.
 */
const descriptions = new Map<string, string | null>();

/** For tests: forget what was read */
export function resetAzureRoleDescriptions(): void {
    descriptions.clear();
}

/** The description of a role GUID, read once per page load; null when it has none or the read failed (logged, not retried) */
export async function readAzureRoleDescription(client: ArmClient, scopeId: string, roleDefinitionId: string, signal?: AbortSignal): Promise<string | null> {
    const key = roleDefinitionId.toLowerCase();
    if (descriptions.has(key)) return descriptions.get(key) ?? null;
    try {
        const definition = await getRoleDefinition(client, scopeId, key, signal);
        const description = definition.properties.description?.trim() || null;
        descriptions.set(key, description);
        return description;
    } catch (error: unknown) {
        // An abort is not a failure: the next mount reads again
        if (signal?.aborted) throw error;
        Logger.warn("Azure", "A role description could not be read");
        descriptions.set(key, null);
        return null;
    }
}

/**
 * The description of one Azure role (Azure spec 15.4), read when a target is set. Null while it reads, when the role
 * has none and when the read failed: the detail then shows no line, as Entra without a description.
 */
export function useAzureRoleDefinition(target: AzureRoleDefinitionTarget | null): { description: string | null } {
    const { getArmClient } = useAzureActions();
    const [, setVersion] = useState(0);
    const scopeId = target?.scopeId;
    const key = target ? target.roleDefinitionId.toLowerCase() : null;

    useEffect(() => {
        if (key === null || scopeId === undefined || descriptions.has(key)) return;
        const controller = new AbortController();
        readAzureRoleDescription(getArmClient(), scopeId, key, controller.signal)
            .then(() => {
                if (!controller.signal.aborted) setVersion((n) => n + 1);
            })
            .catch(() => undefined);
        return () => controller.abort();
    }, [key, scopeId, getArmClient]);

    return { description: key === null ? null : descriptions.get(key) ?? null };
}
