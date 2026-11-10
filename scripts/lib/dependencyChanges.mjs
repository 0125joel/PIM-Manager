/**
 * Dependency changes between two versions of package.json and package-lock.json: the direct dependencies added,
 * removed or changed per section, and the locked packages whose version changed. Pure functions; the caller reads
 * the files from git. Used by scripts/dependency-changes.mjs (the CI job summary) and covered by
 * src/__tests__/scripts/dependencyChanges.test.ts.
 */

const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides"];

/** The direct dependency changes of package.json, per section, sorted by name */
export function directChanges(before, after) {
    const changes = [];
    for (const section of SECTIONS) {
        const old = before?.[section] ?? {};
        const now = after?.[section] ?? {};
        for (const name of [...new Set([...Object.keys(old), ...Object.keys(now)])].sort()) {
            const from = old[name] === undefined ? null : JSON.stringify(old[name]).replace(/^"|"$/g, "");
            const to = now[name] === undefined ? null : JSON.stringify(now[name]).replace(/^"|"$/g, "");
            if (from !== to) changes.push({ section, name, from, to });
        }
    }
    return changes;
}

/** The locked packages (lockfile version 2 or 3) added, removed or at another version, by install path */
export function lockedChanges(before, after) {
    const old = before?.packages ?? {};
    const now = after?.packages ?? {};
    const changes = [];
    for (const path of [...new Set([...Object.keys(old), ...Object.keys(now)])].sort()) {
        if (path === "") continue; // the root project itself
        const from = old[path]?.version ?? null;
        const to = now[path]?.version ?? null;
        if (from !== to) changes.push({ name: path.replace(/^(.*\/)?node_modules\//, ""), path, from, to });
    }
    return changes;
}

function describe({ from, to }) {
    if (from === null) return `added ${to}`;
    if (to === null) return `removed (was ${from})`;
    return `${from} to ${to}`;
}

/** The job summary in Markdown; an empty change list says so in one line */
export function summaryMarkdown(direct, locked) {
    if (direct.length === 0 && locked.length === 0) return "### Dependencies\n\nNo dependency changes.\n";
    const lines = ["### Dependencies", "", "A dependency change needs the maintainer's approval before it is merged.", ""];
    if (direct.length > 0) {
        lines.push("| Section | Package | Change |", "|---|---|---|");
        for (const c of direct) lines.push(`| ${c.section} | \`${c.name}\` | ${describe(c)} |`);
        lines.push("");
    }
    lines.push(`${locked.length} locked package(s) changed in package-lock.json${locked.length > 0 ? ":" : "."}`);
    for (const c of locked.slice(0, 50)) lines.push(`- \`${c.path}\`: ${describe(c)}`);
    if (locked.length > 50) lines.push(`- and ${locked.length - 50} more`);
    return lines.join("\n") + "\n";
}
