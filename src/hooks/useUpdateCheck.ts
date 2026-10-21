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

const GITHUB_RELEASES_URL = "https://api.github.com/repos/0125joel/PIM-Manager/releases/latest";
const SESSION_KEY = "pim_update_check";
const RELEASES_PAGE_URL = "https://github.com/0125joel/PIM-Manager/releases";

/**
 * Parse a "v2.1.0" / "2.1.0" style tag into numeric parts. Returns null when the
 * tag is not a plain semver (for example a pre-release suffix), so callers can
 * fall back to "no update" instead of showing a misleading banner.
 */
function parseSemver(tag: string | undefined | null): [number, number, number] | null {
    if (!tag) return null;
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * True only when `latest` is strictly newer than `current`. A dev/test build that
 * runs ahead of the public release therefore never reports an "update" that would
 * point to an older version.
 */
export function isNewerVersion(current: string | undefined | null, latest: string | undefined | null): boolean {
    const a = parseSemver(current);
    const b = parseSemver(latest);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) {
        if (b[i] > a[i]) return true;
        if (b[i] < a[i]) return false;
    }
    return false;
}

/**
 * The release link comes from an external response and is rendered as an href, so only a link inside this
 * project's own releases page is used. Anything else falls back to the releases page.
 */
export function safeReleaseUrl(url: unknown): string {
    if (typeof url !== "string") return RELEASES_PAGE_URL;
    return url === RELEASES_PAGE_URL || url.startsWith(`${RELEASES_PAGE_URL}/`) ? url : RELEASES_PAGE_URL;
}

export function useUpdateCheck(): UpdateInfo | null {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

    useEffect(() => {
        // Only run on self-hosted instances, runtime config present means self-hosted
        const isSelfHosted =
            !!(window as Window & { __PIM_CONFIG__?: { clientId?: string } }).__PIM_CONFIG__?.clientId;
        if (!isSelfHosted) return;

        const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION;
        if (!currentVersion) return;

        // Check once per session to avoid hammering the GitHub API
        const cached = sessionStorage.getItem(SESSION_KEY);
        if (cached) {
            try {
                const info = JSON.parse(cached) as UpdateInfo;
                // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the session cache after mount
                setUpdateInfo({ ...info, releaseUrl: safeReleaseUrl(info.releaseUrl) });
            } catch { /* ignore */ }
            return;
        }

        fetch(GITHUB_RELEASES_URL)
            .then(r => {
                if (!r.ok) throw new Error(`GitHub API returned ${r.status}`);
                return r.json();
            })
            .then(data => {
                const info: UpdateInfo = {
                    hasUpdate: isNewerVersion(currentVersion, data.tag_name),
                    currentVersion,
                    currentReleaseDate: process.env.NEXT_PUBLIC_APP_RELEASE_DATE ?? null,
                    latestVersion: data.tag_name,
                    latestReleaseDate: data.published_at,
                    releaseUrl: safeReleaseUrl(data.html_url),
                };
                sessionStorage.setItem(SESSION_KEY, JSON.stringify(info));
                setUpdateInfo(info);
            })
            .catch(() => { /* non-critical, fail silently */ });
    }, []);

    return updateInfo;
}
