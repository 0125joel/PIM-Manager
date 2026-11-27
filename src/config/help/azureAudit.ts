import type { HelpPage } from "./types";

export const AZURE_AUDIT_HELP: HelpPage = {
    id: "azure-audit",
    title: "Azure Audit",
    intro: "The Azure Audit page shows who activated which Azure role, and which PIM assignments and settings changed, on the scopes you can read. It reads the Azure activity log and PIM requests for up to 90 days, and opens on the last 30.",
    blocks: [
        { title: "Chosen workspaces", text: "With a Log Analytics workspace chosen in Settings, the page reads its Azure activity log and its Entra audit log as well, for up to a year, or as far back as the workspace keeps them. A workspace reaches further than the native logs: older than 90 days, the Azure activity log comes only from the subscriptions that send to a workspace. A workspace shows what it holds, also on scopes your roles do not reach, and it can miss events, so the list and the export say what is missing. Events that the native read and a workspace both hold are shown once. A group that holds a role is judged on the Entra audit log of the workspace too, beyond the 30 days of Graph. If a workspace cannot be read, the others still show and the page names it; if every one fails, the page shows up to 90 days from the native logs instead and says so." },
        { title: "Timeline and period", text: "The timeline covers the period shown above it: from 1 to 90 days, 30 when you open the page. With a chosen workspace it opens on 180 days and goes up to a year, or as far as the workspace keeps its logs. Each track is a kind: Activations, Assignments, Settings, Outside PIM and, once you switch it on with the kinds above the list, System. In Events, drag across a track to select a stretch; the list and counts follow it. No activation ignores that selection. In Events, click a point to select its action. Point at one to see what it is. A dashed red ring means failed or denied, an outline marks the action in the detail. The coverage line says which logs were read, how far back they go and when they were read. A shorter period filters what was already read, so it does not start a new read." },
        { title: "Scope bar", text: "The scope bar decides which events are shown, as on the Azure dashboard. All you can read shows every scope. Choose a scope to see its events and those below it; Include inherited also shows events from the scopes above it. Delegated subscriptions are shown by default; with details on, the bar marks them Lighthouse. Switch them off to leave them out. With a scope chosen, an event that has no scope in your tree is left out." },
        { title: "Filters and details", text: "Filters holds who gets or holds the role (Users, Guests, Apps, Agents or Groups), the Scope level of the event (Management group, Subscription, Resource group or Resource), Privileged only and, in Events, Failed or denied. Each active filter shows as a chip you can remove. You can also filter by kind and search for a person, role, ticket or scope. Select an event to see its details: the Scope it happened on and, when an activation came through a group, the group it came through. Show more details adds Used for, Requested duration, Scope level and Source when the log has them, and for an approved or denied request how long the decision took (Approved after or Denied after). An activation planned for later also shows Starts; the event itself stays at the time of the request. In No activation, the period, the scope bar, Filters and search still apply; the timeline selection and the kinds do not. A person who has a role through a group counts under Users or Guests, and under Groups." },
        { title: "Events and No activation", text: "Events lists the actions in the Azure activity log and the PIM requests. No activation compares each eligible or active assignment on the scopes you can read with successful activations in the period. An activation counts when it is for the same role and person, on the scope of the assignment or below it; the row then names that narrower scope. Failed activations and requests without a completion do not count. None in this period is about this window, not proof that a role is unused or can be removed; a role used once a quarter needs a longer view." },
        { title: "No activation and groups", text: "An eligible group gets one row per member, each judged on their own activations. When its members cannot be read, one row says so. A group that holds a role actively gets one row per person who can activate membership of it in PIM for Groups, judged by the group events in the Entra audit log. That needs AuditLog.Read.All and read access to PIM for Groups; without one of them, one row says which is missing and nothing is judged. A person who activated before the group got its role, or a role the group no longer holds, gives no match, because the page compares with the assignments of today. The Entra audit log keeps 30 days, so in a longer period a member without an activation in those 30 days reads Not judged, never None in this period. A group that is not in PIM for Groups, or has no eligible members there, reads Not applicable." },
        { title: "Privileged only", text: "Privileged only keeps the five roles Microsoft lists as privileged administrator roles, and every role whose actions let it change access. The role definitions it needs are read the first time you turn it on, or earlier when an event names a role nobody holds any more." },
        { title: "Export", text: "Export saves the current view as CSV, JSON or PDF. The file follows the period, the filters, the selection and the scope bar, and says so in its heading. A file with Azure events adds the columns Scope level and Subscription next to Scope and Scope id. Replace names replaces people, but leaves out reason, new value, ticket, people's object IDs, scope and subscription ids, the exporter and search words; role and group names remain. Every format states its period, sources and read time, and which subscriptions could not be read." },
        { title: "What you can see", text: "You see what your Azure roles let you read, so the page is never a total for the tenant. Azure leaves out what your roles cannot see without saying so, which means an empty list does not prove that nothing happened. Your own requests are included, also on scopes you cannot read. Changes above the subscriptions, on management groups, only show when your roles reach them. A subscription that could not be read is named above the list, with the reason. Who activated or was assigned to a group that holds a role is only in the Entra audit log, which keeps 30 days: without that log, or further back, it is not in the list, and a notice above the list says so. A role you hold through a PIM group shows once you activate your membership, and Azure can take a few minutes before it appears. With read access to PIM for Groups, the page also lists the groups you are an eligible member of; without it, the page says so." },
        { title: "Approvers", text: "Azure does not say who decided an approval request. That comes from the Entra audit log, which keeps 30 days. When it cannot be read, or the request is older, the detail says so instead of leaving a blank." },
    ],
    terms: [
        { term: "Scope level", text: "Where an event happened in the Azure tree: a management group, subscription, resource group or resource." },
        { term: "Include inherited", text: "Also shows events on the scopes above the one you chose." },
        { term: "Delegated subscription", text: "A subscription of another tenant that you manage through Azure Lighthouse." },
        { term: "Eligible", text: "An assignment that must be activated before the person can use the role." },
        { term: "No activation", text: "No successful activation was found for this assignment in the period shown. It does not mean the role is unused or can be removed." },
        { term: "Outside PIM", text: "A role change made outside Privileged Identity Management." },
        { term: "System", text: "An audit event initiated by a service or an event the page cannot classify more specifically." },
    ],
    guide: [
        {
            title: "Reading the events",
            paragraphs: [
                "Each event is an action from the Azure activity log or a PIM request. Select one to see its details. A detail always shows the same fields, so you can compare them: a field the log has no value for stays empty. A denied request shows Denied and appears under Failed or denied. A request still waiting for a decision reads as requested, not as activated.",
                "The page starts reading once your Azure assignments are in, because the names of people and scopes, and most role names, come from them. A role nobody holds any more is named by its definition or by the log; when neither has it, you see its ID. While it reads, it says how many scopes are done. A failed read has its own error state with Try again, so it is not shown as an empty audit log.",
            ],
        },
        {
            title: "When you can read little or nothing",
            paragraphs: [
                "When some subscriptions could not be read, a notice names them and says their events are missing from the list. When your account can read none of it, the page says so and shows your own Azure roles. Reader on a subscription or a resource group is enough to see what happened there. Activate a role that may read more, then choose Refresh.",
            ],
        },
        {
            title: "Checking for activations",
            paragraphs: [
                "Choose No activation to compare assignments with successful activations in the selected number of days. It follows the scope bar. An active assignment and an app or agent read Not applicable, because they do not activate. A row that says Not judged could not be checked, and the row says why; it is not the same as None in this period.",
                "No activation is a statement about this period and about what your roles can read, not a recommendation to remove a role. A subscription that could not be read has no activations to compare with, and the page names it. Azure can also keep listing an inherited assignment after it was removed, so a row can name an assignment that no longer exists: check it on the scope itself before you act on it.",
            ],
        },
        {
            title: "Sharing a view",
            paragraphs: [
                "The period, the scope, Include inherited, Delegated subscriptions, the filters and the selected event are in the address, so you can send the link. The other person sees the same view, as far as their Azure roles allow.",
            ],
        },
        {
            title: "Sharing an export",
            paragraphs: [
                "Export follows the current view, including the scope bar. CSV and JSON are useful when you need to work with the rows; PDF lays out the period and actions as a report. Show more details does not change what an export contains.",
                "Replace names substitutes person names consistently and removes their object IDs, the exporter, search words, reason, new value, ticket, and the scope and subscription ids. Those fields can contain names. Role and group names stay in the file.",
            ],
        },
    ],
};
