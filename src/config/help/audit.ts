import type { HelpPage } from "./types";

export const AUDIT_HELP: HelpPage = {
    id: "audit",
    title: "Audit",
    intro: "The Audit page shows Entra role and group activations, assignment and settings changes, and role changes outside PIM. It reads the audit log for up to 30 days when you grant its optional permission, and further back from the Log Analytics workspaces you choose in Settings.",
    blocks: [
        { title: "Timeline and period", text: "The timeline covers the period shown above it: up to 30 days, or as long as your chosen workspaces keep their logs. With a chosen workspace it opens on 180 days. In Events, drag across a track to select a stretch; the list and counts follow it. No activation ignores that selection. Each track is a kind; System stays off until you switch it on with the kinds above the list. In Events, click a point to select its action. Point at one to see what it is. A dashed red ring means failed or denied, an outline marks the action in the detail. The coverage line says which source was read, how far back it goes and when it was read." },
        { title: "Events and No activation", text: "Events lists the actions in the audit log. No activation sets every assignment, eligible or active, against successful activations in the period. An assignment with no activation in that window is not proof that the role can be removed; a role used once a quarter needs a longer view." },
        { title: "Filters and details", text: "Filters holds who gets or holds the role (Users, Guests, Apps, Agents or Groups), the environment (Entra roles or PIM for Groups), Privileged only and, in Events, Failed or denied. Each active filter shows as a chip you can remove. An event without a holder, such as a changed setting, only shows while Who is on All. The log calls an app and an agent the same, so the page tells them apart by who holds a role now. One that holds no role stays under Apps and under Agents, and the page says how many. A guest is told by its user principal name. An agent's user account shows under Users and under Agents in Events. Privileged only keeps a role it cannot judge and says how many, and counts a group when it is eligible or active for a privileged role. In Events you also filter by kind and search, and the timeline selection narrows the list. Show more details adds Used for, Starts, Approved after or Denied after, Requested duration, MFA on activation, Where and Source when the log has them. In No activation, the period, Filters and search still apply; the timeline selection and the kinds do not. A person who has a role through a group counts under Users or Guests, and under Groups. When someone activates or is assigned membership of a group that holds an Entra role, the detail shows Role and Through, and you find it by searching for that role. The log names only the group, so the page compares with who holds which role today." },
        { title: "Export", text: "Export saves the current view as CSV, JSON or PDF. Under Include you choose Entra roles, PIM for Groups or both. The numbers in the file follow that choice. The event export includes all kept fields even when Show more details is off. Replace names replaces people, but leaves out reason, new value, ticket, people's object IDs, the exporter and search words; role and group names remain. Every format states its period, source and read time." },
        { title: "Permission and coverage", text: "The page reads Microsoft Graph's Entra audit log in your browser with the optional AuditLog.Read.All permission. An admin must approve it once for your tenant; the rest of the app works without it. Reading also requires the Reports Reader, Security Reader or Security Administrator role. Audit events are not stored by PIM Manager. New events can take a few minutes to appear." },
        { title: "Log Analytics workspaces", text: "In Settings, under Log Analytics workspace, you choose one or more workspaces for yourself; only their IDs stay in this browser. Audit then reads them and the last 30 days of the Entra audit log, and shows each event once. A workspace holds what the diagnostic export delivered and can miss events, so the last 30 days are checked against the Entra audit log. Older than that, nothing can check it. A workspace that cannot be read is named on the page and in every export." },
    ],
    terms: [
        { term: "Eligible", text: "An assignment that must be activated before the person can use the role." },
        { term: "No activation", text: "No successful activation was found for this eligible assignment in the period shown. It does not mean the role is unused or can be removed." },
        { term: "Outside PIM", text: "A role change made outside Privileged Identity Management." },
        { term: "System", text: "An audit event initiated by a service or an event the page cannot classify more specifically." },
    ],
    guide: [
        {
            title: "Reading the events",
            paragraphs: [
                "Each event is an action from the Entra audit log. Select one to see its details. Requested and completed records for one action can appear as a single event, also when an approver is in between. A request still waiting for approval reads as requested, not as activated. A denied request shows Denied and appears under Failed or denied. An approved or denied request names who decided it, under Approved by or Denied by. A detail always shows the same fields, so you can compare them: a field the log has no value for stays empty. The page shows the fields it can safely keep; it does not display IP addresses, user agents or token claims.",
                "The built-in source covers up to 30 days. The oldest available event, read time, time zone and source are stated on the page. A failed read has its own error state, so it is not shown as an empty audit log. More than 50,000 events is too many for the browser: the page shows no partial list and asks for a shorter period.",
            ],
        },
        {
            title: "Checking for activations",
            paragraphs: [
                "Choose No activation to compare assignments with successful activations in the selected number of days. Failed activations and requests without a completion do not count as activations. The view needs assignment data as well as a successful audit-log read.",
                "No activation is a statement about this period, not a recommendation to remove a role. A role used infrequently may need a longer history before anyone can draw a conclusion.",
            ],
        },
        {
            title: "Sharing an export",
            paragraphs: [
                "Export follows the current view and filters. CSV and JSON are useful when you need to work with the rows; PDF lays out the period and actions as a report. Show more details does not change what an export contains.",
                "Replace names substitutes person names consistently and removes their object IDs, the exporter, search words, reason, new value and ticket. Those free-text fields can contain names. Role and group names stay in the file.",
            ],
        },
    ],
};
