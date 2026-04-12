"use client";

import { useState, useEffect } from "react";

export interface UpdateInfo {
    hasUpdate: boolean;
    currentVersion: string;
    currentReleaseDate: string | null;
    latestVersion: string;
    latestReleaseDate: string;
    releaseUrl: string;
}

const GITHUB_RELEASES_URL = "https://api.github.com/repos/0125joel/PIM-manager/releases/latest";
const SESSION_KEY = "pim_update_check";

export function useUpdateCheck(): UpdateInfo | null {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

    useEffect(() => {
        // Only run on self-hosted instances — runtime config present means self-hosted
        const isSelfHosted =
            !!(window as Window & { __PIM_CONFIG__?: { clientId?: string } }).__PIM_CONFIG__?.clientId;
        if (!isSelfHosted) return;

        const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION;
        if (!currentVersion) return;

        // Check once per session to avoid hammering the GitHub API
        const cached = sessionStorage.getItem(SESSION_KEY);
        if (cached) {
            try { setUpdateInfo(JSON.parse(cached)); } catch { /* ignore */ }
            return;
        }

        fetch(GITHUB_RELEASES_URL)
            .then(r => {
                if (!r.ok) throw new Error(`GitHub API returned ${r.status}`);
                return r.json();
            })
            .then(data => {
                const info: UpdateInfo = {
                    hasUpdate: data.tag_name !== currentVersion,
                    currentVersion,
                    currentReleaseDate: process.env.NEXT_PUBLIC_APP_RELEASE_DATE ?? null,
                    latestVersion: data.tag_name,
                    latestReleaseDate: data.published_at,
                    releaseUrl: data.html_url,
                };
                sessionStorage.setItem(SESSION_KEY, JSON.stringify(info));
                setUpdateInfo(info);
            })
            .catch(() => { /* non-critical, fail silently */ });
    }, []);

    return updateInfo;
}
