import type { IconName } from "@/components/icons/Icon";

export interface TourGuideItem {
    text: string;
}

export interface TourStep {
    id: string;
    target: string;
    /** Used when the target is not on screen, such as a control that sits in the account menu on a phone */
    fallbackTarget?: string;
    title: string;
    description: string;
    icon: IconName;
    guides: TourGuideItem[];
    tooltipPosition?: "top" | "bottom" | "left" | "right";
}

export type TourId =
    | "app"
    | "entra-dashboard-basic"
    | "entra-dashboard-advanced"
    | "entra-report"
    | "entra-configure"
    | "entra-configure-edit"
    | "entra-configure-guided"
    | "entra-configure-import"
    | "azure-scope"
    | "azure-dashboard-basic"
    | "azure-dashboard-advanced"
    | "azure-report";

export type TourProduct = "entra" | "azure";

export interface TourDefinition {
    id: TourId;
    /** "app" is the shell, the same in both products */
    product: TourProduct | "app";
    /** The page it belongs to in the choice of Start the tour */
    section: string;
    /** Its name within that page; a page with one tour shows only the section */
    label: string;
    /** The route the tour runs on; null runs on the page of the tour after it, or where the reader is */
    page: string | null;
    /** The dashboard view the tour explains; only a run started by hand switches to it */
    view?: "basic" | "advanced";
    /** Starts only by itself, where it applies (a Configure mode): not in "All" and not in the choice of Start the tour */
    onlyInPlace?: boolean;
    steps: TourStep[];
}

/**
 * Every tour, in the order "All" runs them (tour spec 3). A tour without steps never starts and is not offered.
 * The steps are the 3.0 tour until the tour packages replace them.
 */
export const TOURS: readonly TourDefinition[] = [
    {
        id: "app",
        product: "app",
        section: "The app",
        label: "The app",
        page: null,
        steps: [
            {
                id: "welcome",
                target: "app-title",
                title: "Welcome to PIM Manager",
                description: "Privileged Identity Management for Entra ID and Azure, in one place.",
                icon: "shield",
                guides: [
                    { text: "It runs in your browser. Your tenant data stays in this session, not on a server" },
                    { text: "It reads with your own sign-in, so you see what your roles let you see" },
                    { text: "Nothing changes in your tenant until you apply it in *Configure*, after a review" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "environment",
                target: "environment-switcher",
                fallbackTarget: "account-menu",
                title: "Entra ID or Azure",
                description: "Two sides of PIM: roles and groups in *Entra ID*, Azure roles on your resources in *Azure*.",
                icon: "layers",
                guides: [
                    { text: "The switch keeps you on the same page, if the other side has one" },
                    { text: "The first time you open *Azure*, it asks for its own consent. Once" },
                    { text: "On a phone the switch sits in the account menu" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "pages",
                target: "main-nav",
                title: "Three pages",
                description: "Each side has the same three pages, each with its own question.",
                icon: "dashboard",
                guides: [
                    { text: "*Dashboard*: how are we doing, and where should I look first" },
                    { text: "*Report*: who has which role or group, and on which terms" },
                    { text: "*Configure*: change settings and assignments, with a review before anything is written" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "refresh",
                target: "refresh",
                title: "Refresh and the sync time",
                description: "Every page shows what was read last. The time next to *Refresh* tells you how old that is.",
                icon: "refresh",
                guides: [
                    { text: "What was read stays for this session, so a page opens without reading it all again" },
                    { text: "Changed something in Entra or Azure? You see it here after a refresh" },
                    { text: "*Refresh* reads new and removed assignments again" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "help",
                target: "sidebar-help",
                fallbackTarget: "account-menu",
                title: "Help on every page",
                description: "*Help* explains the page you are on: its blocks and its terms. On a phone it sits in the account menu.",
                icon: "help",
                guides: [
                    { text: "Each page has its own help, so open it where the question comes up" },
                    { text: "*Open the full guide* for the long version" },
                    { text: "*Start the tour* brings these tours back, per product and per page" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "settings",
                target: "settings-link",
                fallbackTarget: "account-menu",
                title: "Settings",
                description: "What the app may read and write, how it looks, and your emergency access accounts. On a phone it sits in the account menu.",
                icon: "settings",
                guides: [
                    { text: "*Workloads and permissions*: grant PIM for Groups, security alerts or write access once you need them, not before" },
                    { text: "*Emergency access accounts*: mark yours, so every page counts them apart" },
                    { text: "*Display*: the theme, the view the dashboard and the Azure Report open in, Details and Tours" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "account",
                target: "account-menu",
                title: "Your account",
                description: "Who you are signed in as, and in which tenant.",
                icon: "user",
                guides: [
                    { text: "Copy the tenant ID, change the theme or sign out" },
                    { text: "*What's new* and the documentation are here too" },
                ],
                tooltipPosition: "bottom",
            },
        ],
    },
    {
        id: "entra-dashboard-basic",
        product: "entra",
        section: "Dashboard",
        label: "Basic",
        page: "/dashboard",
        view: "basic",
        steps: [
            {
                id: "view-mode",
                target: "view-mode",
                title: "Basic and Advanced",
                description: "*Basic* answers the first two questions: who has access, and on which terms.",
                icon: "dashboard",
                guides: [
                    { text: "*Advanced* goes a level deeper: access through groups, what each role asks at activation, and the accounts that hold the most" },
                    { text: "Start in Basic. Switch when a number makes you ask how, or who" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "details",
                target: "details-toggle",
                title: "Show more details",
                description: "The page starts calm, with what you act on. This checkbox shows the rest.",
                icon: "show",
                guides: [
                    { text: "It adds *Easy to miss*, *From Microsoft*, every group outside PIM and the counting chips" },
                    { text: "Details adds blocks and rows. It never changes a count" },
                    { text: "Turn it on when the totals look fine and you want to know what hides behind them" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "workloads",
                target: "workload-chips",
                title: "What is counted",
                description: "The chips decide which workloads count, in every number on this page.",
                icon: "extension",
                guides: [
                    { text: "Switch one off to see the picture without it, for example without *Agents*" },
                    { text: "A dashed chip is not granted yet. Select it to grant read access" },
                    { text: "A chip that is off stays in view, so nobody reads a lower number as the whole tenant" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "cards",
                target: "dashboard-cards",
                title: "The cards",
                description: "Eight totals for the tenant, each with its breakdown.",
                icon: "view-grid",
                guides: [
                    { text: "*Permanent* is on without an end date. *Eligible* has to be activated first" },
                    { text: "A card with a filter icon filters the whole page. Click it again to clear" },
                    { text: "A dash means the number is not known. It never stands for zero" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "who",
                target: "dashboard-who",
                title: "Has access",
                description: "Every assignment, by how it is held.",
                icon: "privileged",
                guides: [
                    { text: "_Permanent_ is always on. _Eligible_ has to be switched on first. _Active, time-bound_ ends by itself" },
                    { text: "Watch _Permanent_. The line under the chart says how many of those are your emergency accounts" },
                    { text: "Click a type or its number to filter the page. *Open in report with this filter* then shows who it is" },
                ],
                tooltipPosition: "top",
            },
            {
                id: "terms",
                target: "dashboard-terms",
                title: "On activation",
                description: "What a privileged role asks when someone switches it on.",
                icon: "activation-requirement",
                guides: [
                    { text: "_Entra MFA_: it asks for MFA. _Auth context_: it asks what your Conditional Access requires. _Neither_: no check at all" },
                    { text: "Below that: how many roles want _approval_ or a _justification_, and how many may stay on _over 8\u00a0h_" },
                    { text: "Watch _Neither_ and _over 8\u00a0h_. Click one to filter the page on those roles" },
                ],
                tooltipPosition: "top",
            },
            {
                id: "groups-outside-pim",
                target: "groups-outside-pim",
                title: "Groups outside PIM",
                description: "Role-assignable groups that PIM does not manage. Every member holds the group's roles permanently.",
                icon: "group-outside-pim",
                guides: [
                    { text: "_Holds_ names the roles the members get. Groups with a role come first, _no role yet_ can wait" },
                    { text: "*Bring under PIM* opens the group in the Microsoft Entra admin center, where you hand it to PIM" },
                    { text: "*Change in Configure* opens who has the group. It shows when the app may write" },
                ],
                tooltipPosition: "top",
            },
            {
                id: "dashboard-export",
                target: "dashboard-export-pdf",
                title: "Export, and where to start",
                description: "Share the picture as a PDF report, or a CSV of every assignment.",
                icon: "export",
                guides: [
                    { text: "Pick an _Admin_ or _Management_ audience. The header says what was counted, and when" },
                    { text: "Where to start: _Permanent_ beyond your emergency accounts, then _Neither_ in *On activation*" },
                    { text: "Click it to filter, then open the Report to see who it is" },
                ],
                tooltipPosition: "bottom",
            },
        ],
    },
    {
        id: "entra-dashboard-advanced",
        product: "entra",
        section: "Dashboard",
        label: "Advanced",
        page: "/dashboard",
        view: "advanced",
        steps: [
            {
                id: "scope",
                target: "scope-control",
                title: "Privileged roles or All roles",
                description: "Advanced counts the privileged roles. *All roles* counts every role instead.",
                icon: "privileged",
                guides: [
                    { text: "It changes every role number on this page. Groups always count in full" },
                    { text: "*Privileged roles* shows the risk. *All roles* shows how far PIM reaches" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "more",
                target: "details-toggle",
                title: "More in Advanced",
                description: "*Show more details* adds *Custom extensions* and *Right now*: activations running, and eligibility that ends within 7 days.",
                icon: "show",
                guides: [
                    { text: "With details off, lists stop at five rows and link to the Report" },
                    { text: "*Right now* is where you see who is active at this moment" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "has-access",
                target: "advanced-has-access",
                title: "Has access, and how",
                description: "The split of Basic, per workload and by route: _Direct_ or _Through a group_.",
                icon: "roles-and-groups",
                guides: [
                    { text: "Each workload gets its own bar. Watch _permanent_, for group members and owners too" },
                    { text: "_Through a group_: whoever joins the group gets the role, without activating anything" },
                    { text: "Click a type, its number or a route to filter the page" },
                ],
                tooltipPosition: "top",
            },
            {
                id: "activation",
                target: "advanced-activation",
                title: "On activation",
                description: "What each privileged role asks before someone can use it.",
                icon: "activation-requirement",
                guides: [
                    { text: "_Neither_: the role switches on without MFA or an authentication context" },
                    { text: "_Approval_ and _Justification_ count the roles that want an approver or a reason. Durations over 8 hours are marked" },
                    { text: "Click a requirement or a duration to filter the page on those roles" },
                ],
                tooltipPosition: "top",
            },
            {
                id: "pim-groups",
                target: "advanced-pim-groups",
                title: "PIM for Groups",
                description: "The groups outside PIM, and the busiest groups that PIM does manage.",
                icon: "groups-under-pim",
                guides: [
                    { text: "Outside PIM, members hold the group's roles permanently, without activating" },
                    { text: "In the table, watch _Permanent_: those members and owners never activate" },
                    { text: "*All in report* opens every managed group" },
                ],
                tooltipPosition: "top",
            },
            {
                id: "accounts",
                target: "advanced-accounts",
                title: "Most privileged, and who approves",
                description: "The accounts with the most privileged roles, and who approves activations.",
                icon: "approval",
                guides: [
                    { text: "The top of the list is where a stolen account would hurt most" },
                    { text: "A role with one approver is named. When that person is on holiday, nobody can approve it" },
                    { text: "Next: open the Report and filter on what you found here" },
                ],
                tooltipPosition: "top",
            },
        ],
    },
    {
        id: "entra-report",
        product: "entra",
        section: "Report",
        label: "Report",
        page: "/report",
        steps: [
            {
                id: "report-views",
                target: "report-toolbar",
                title: "Roles and groups, as they are now",
                description: "Every role and group as it is now: who holds it, how, until when, and how PIM is set up for it.",
                icon: "report",
                guides: [
                    { text: "*Roles* and *Groups* are two lists of the same tenant. *Groups* needs read access to PIM for Groups" },
                    { text: "Search finds a role, a group or a person" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "details",
                target: "details-toggle",
                title: "Show more details",
                description: "The Report starts calm: a row shows only what deviates from the usual.",
                icon: "show",
                guides: [
                    { text: "It adds every tag, the warnings in the list and the count" },
                    { text: "Turn it on when you want the full picture of one role" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "report-filters",
                target: "report-filters",
                title: "Filters",
                description: "Filters per view, in three groups: properties, assignments and PIM configuration.",
                icon: "filter",
                guides: [
                    { text: "Active filters show as chips. *Clear all* keeps the search" },
                    { text: "A link from the Dashboard lands here with its filter already set" },
                    { text: "Everything is in the address. Send the link and the other person sees the same list" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "report-list",
                target: "report-list",
                title: "The list",
                description: "Each row is a role or a group, with its tags and counts.",
                icon: "view-list",
                guides: [
                    { text: "_Privileged_ roles can change security settings or grant access. _Custom_ roles are your own" },
                    { text: "Watch the warnings that *Show more details* adds: _Permanent active_, _No MFA on activation_, _Outside PIM_" },
                    { text: "*Sort* by most assignments, by name or by most permanent. Click a row to open it" },
                ],
                tooltipPosition: "right",
            },
            {
                id: "report-detail",
                target: "report-detail",
                fallbackTarget: "report-list",
                title: "Who holds it, and how",
                description: "Open a role or group for its assignments and its PIM settings.",
                icon: "user",
                guides: [
                    { text: "Tags show what deviates, such as _Permanent_, _Via group_ or _Emergency access_" },
                    { text: "The settings sit in three tabs: *Activation*, *Assignment* and *Notification*. An amber dot needs a look" },
                    { text: "Hover or focus a tag for what it means. *Copy link* shares this selection" },
                ],
                tooltipPosition: "left",
            },
            {
                id: "report-export",
                target: "report-export",
                title: "Export, and what next",
                description: "An overview for Excel, a file for Configure's *Import*, or a complete JSON backup.",
                icon: "export",
                guides: [
                    { text: "Make a backup before you change anything in Configure" },
                    { text: "Apply the current filter, or replace names with Person 1, 2 and so on" },
                    { text: "Next: *Change in Configure* on a role or group you want to fix" },
                ],
                tooltipPosition: "bottom",
            },
        ],
    },
    {
        id: "entra-configure",
        product: "entra",
        section: "Configure",
        label: "Configure",
        page: "/configure",
        steps: [
            {
                id: "configure-access",
                target: "configure-access",
                title: "What you may change",
                description: "This row says what you may change: roles, groups, or nothing yet.",
                icon: "key",
                guides: [
                    { text: "The app also needs permission to write. Microsoft asks for it once" },
                    { text: "Eligible for the role? Activate it in Entra first, then *Refresh*" },
                    { text: "*Details* shows per area which role or ownership gives access" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "configure-modes",
                target: "configure-modes",
                title: "Three ways to change",
                description: "Pick the way that fits the job.",
                icon: "configure",
                guides: [
                    { text: "*Edit*: open a role or group and change any setting, or *Select several*" },
                    { text: "*Guided*: the same rules on several roles or groups, step by step" },
                    { text: "*Import*: a CSV or an access model file, checked against your tenant first" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "configure-apply",
                target: "configure-last-applies",
                title: "Review, apply and undo",
                description: "Nothing is written until you review and apply. Every apply keeps a snapshot.",
                icon: "undo",
                guides: [
                    { text: "Changes wait in a bar at the bottom until you review them" },
                    { text: "The review checks what Microsoft would reject, and what you would lose yourself" },
                    { text: "*Undo* brings back one of the last ten applies from this browser, as long as its snapshot is there" },
                ],
                tooltipPosition: "top",
            },
            {
                id: "configure-access-model",
                target: "configure-access-model",
                title: "The access model",
                description: "How PIM Monitor sorts all Entra roles into planes and levels, with the settings it recommends per level.",
                icon: "layers",
                guides: [
                    { text: "You can read it without write access" },
                    { text: "Use it as a template in *Guided*. You still review everything" },
                    { text: "Next: open *Edit* on one privileged role and look at its settings" },
                ],
                tooltipPosition: "top",
            },
        ],
    },
    { id: "entra-configure-edit", product: "entra", section: "Configure", label: "Edit", page: "/configure", onlyInPlace: true, steps: [
        {
            id: "edit-list",
            target: "configure-edit-list",
            title: "Pick a role or group",
            description: "Every role or group with its settings in one line.",
            icon: "view-list",
            guides: [
                { text: "A grey row is locked, and says why" },
                { text: "A dot means changes are waiting for it" },
                { text: "Filter on _Privileged_, _Custom_, or with or without assignments" },
            ],
            tooltipPosition: "right",
        },
        {
            id: "edit-several",
            target: "configure-select-several",
            title: "Select several",
            description: "Tick several roles or groups to change the same settings on all of them.",
            icon: "check",
            guides: [
                { text: "The _Now_ column shows the value each one has today" },
            ],
            tooltipPosition: "bottom",
        },
        {
            id: "edit-detail",
            target: "configure-edit-detail",
            fallbackTarget: "configure-edit-list",
            title: "Settings and people",
            description: "Open a role or group: its tabs hold the activation, assignment and notification settings, and who has it.",
            icon: "settings",
            guides: [
                { text: "Every change goes to the bar at the bottom first" },
                { text: "Done? *Review and apply* in that bar" },
            ],
            tooltipPosition: "left",
        },
    ] },
    { id: "entra-configure-guided", product: "entra", section: "Configure", label: "Guided", page: "/configure", onlyInPlace: true, steps: [
        {
            id: "guided-steps",
            target: "configure-guided-steps",
            title: "Five steps",
            description: "*Start*, *Targets*, *Settings*, *People*, and then the review.",
            icon: "wizard",
            guides: [
                { text: "Start from the current settings, a copy of another role or group, or the access model" },
                { text: "Each setting is _Keep_ or _Set to_. _Keep_ leaves the current value alone" },
                { text: "A step you finished opens again from this bar" },
            ],
            tooltipPosition: "bottom",
        },
    ] },
    { id: "entra-configure-import", product: "entra", section: "Configure", label: "Import", page: "/configure", onlyInPlace: true, steps: [
        {
            id: "import-drop",
            target: "configure-import-drop",
            title: "Bring a file",
            description: "A CSV or an access model JSON, up to 5 MB. PIM Manager recognises what is in it from the columns.",
            icon: "upload",
            guides: [
                { text: "The files of the Report's *Export* open here as they are" },
                { text: "Every row is checked against your tenant before it becomes a change" },
                { text: "*What can I import?* lists every column, with a template to download" },
            ],
            tooltipPosition: "bottom",
        },
    ] },
    {
        id: "azure-scope",
        product: "azure",
        section: "Scopes",
        label: "Scopes",
        page: null,
        steps: [
            {
                id: "azure-scope",
                target: "azure-scope",
                title: "The scope decides what is counted",
                description: "Every number on the Azure side is about the chosen scope and what is below it.",
                icon: "scope",
                guides: [
                    { text: "Pick a scope, and *Include inherited* also counts what is assigned above it" },
                    { text: "Subscriptions of other tenants, through Azure Lighthouse, are counted and marked" },
                    { text: "Pick all you can read, or one management group, subscription, resource group or resource. Switch Lighthouse off to leave those out" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "azure-readability",
                target: "azure-readability",
                title: "What you can read",
                description: "You see the scopes your Azure roles let you read. This sentence says how complete the numbers are.",
                icon: "info",
                guides: [
                    { text: "A subscription can be readable completely, in part, or not at all" },
                    { text: "*What you can read* names each one, and the role settings you cannot read" },
                    { text: "Activate a role that may read more, then *Refresh*" },
                    { text: "*Read the rest* reads what a large tenant left for later, about a minute at a time" },
                ],
                tooltipPosition: "bottom",
            },
        ],
    },
    {
        id: "azure-dashboard-basic",
        product: "azure",
        section: "Dashboard",
        label: "Basic",
        page: "/azure",
        view: "basic",
        steps: [
            {
                id: "view-mode",
                target: "view-mode",
                title: "Basic and Advanced",
                description: "*Basic* answers the first questions: who has access to your Azure resources, and on which terms.",
                icon: "dashboard",
                guides: [
                    { text: "*Advanced* shows where in the tree access is granted, and the accounts and approvers" },
                    { text: "Start in Basic. Switch when a number makes you ask where, or who" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "details",
                target: "details-toggle",
                title: "Show more details",
                description: "The page starts calm, with what you act on. This checkbox shows the rest.",
                icon: "show",
                guides: [
                    { text: "It adds *From Microsoft*, the explanations and empty rows in *Easy to miss*, and the counts in the scope bar" },
                    { text: "Details adds blocks and rows. It never changes a count" },
                    { text: "Turn it on when the totals look fine and you want to know what hides behind them" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "cards",
                target: "dashboard-cards",
                title: "The cards",
                description: "Eight totals for the chosen scope, each with its breakdown.",
                icon: "view-grid",
                guides: [
                    { text: "Azure counts a role once for every scope where it is assigned: role \u00d7 scope" },
                    { text: "*Inherited* counts what is assigned above the scope you chose" },
                    { text: "A card with a filter icon filters the whole page. Click it again to clear" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "who",
                target: "dashboard-who",
                title: "Has access",
                description: "Every assignment in the chosen scope, by how it is held.",
                icon: "privileged",
                guides: [
                    { text: "_Permanent_ is always on. _Eligible_ has to be switched on first. _Active, time-bound_ ends by itself" },
                    { text: "Watch _Permanent_, apart from your emergency access accounts" },
                    { text: "Click a type or its number to filter the page" },
                ],
                tooltipPosition: "top",
            },
            {
                id: "terms",
                target: "dashboard-terms",
                title: "On activation",
                description: "What a privileged role asks when someone switches it on, for the role settings you can read.",
                icon: "activation-requirement",
                guides: [
                    { text: "_Entra MFA_: it asks for MFA. _Auth context_: it asks what your Conditional Access requires. _Neither_: no check at all" },
                    { text: "Below that: how many roles want _approval_ or a _justification_, and how many may stay on _over 8\u00a0h_" },
                    { text: "Watch _Neither_ and _over 8\u00a0h_. Click one to filter the page on those roles" },
                ],
                tooltipPosition: "top",
            },
            {
                id: "easy-to-miss",
                target: "azure-easy-to-miss",
                title: "Easy to miss",
                description: "Where the Azure risks hide: access without an end, accounts you may not expect, and roles set up halfway.",
                icon: "alert",
                guides: [
                    { text: "Think permanent _Owner_ at subscription level or above, or deleted accounts that still hold a role" },
                    { text: "With details off, only the rows that count something show" },
                    { text: "Click a row to filter the page on it" },
                ],
                tooltipPosition: "top",
            },
            {
                id: "dashboard-export",
                target: "dashboard-export-pdf",
                title: "Export, and where to start",
                description: "A PDF report or a CSV of all assignments in the chosen scope.",
                icon: "export",
                guides: [
                    { text: "Where to start: permanent _Owner_, then _Neither_ in *On activation*" },
                    { text: "Click it to filter, then open the Report to see who it is, per scope" },
                ],
                tooltipPosition: "bottom",
            },
        ],
    },
    {
        id: "azure-dashboard-advanced",
        product: "azure",
        section: "Dashboard",
        label: "Advanced",
        page: "/azure",
        view: "advanced",
        steps: [
            {
                id: "scope",
                target: "scope-control",
                title: "Privileged roles or All roles",
                description: "Advanced counts the privileged roles. *All roles* counts every role instead.",
                icon: "privileged",
                guides: [
                    { text: "It changes what the sections below count. The cards stay as they are" },
                    { text: "*Privileged roles* shows the risk. *All roles* shows how far PIM reaches" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "more",
                target: "details-toggle",
                title: "More in Advanced",
                description: "*Show more details* adds *Right now*: activations running, and eligibility that ends within 7 days.",
                icon: "show",
                guides: [
                    { text: "With details off, the list of accounts stops at five and links to the Report" },
                    { text: "*Right now* is where you see who is active at this moment" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "has-access",
                target: "advanced-has-access",
                title: "Has access, and how",
                description: "Per level of the tree: management group, subscription, resource group and resource.",
                icon: "layers",
                guides: [
                    { text: "Each level gets its own bar. Watch _permanent_ high in the tree: it reaches everything below" },
                    { text: "_Through a group_: whoever joins the group gets the role, without activating anything" },
                    { text: "Click a type, its number or a route to filter the page" },
                ],
                tooltipPosition: "top",
            },
            {
                id: "activation",
                target: "advanced-activation",
                title: "On activation, per role × scope",
                description: "What each privileged role asks for on activation, at every scope where it is assigned.",
                icon: "activation-requirement",
                guides: [
                    { text: "_Neither_: the role switches on without MFA or an authentication context" },
                    { text: "Settings do not inherit. Every scope has its own, so one role can ask different things in two places" },
                    { text: "Click a requirement or a duration to filter the page on those roles" },
                ],
                tooltipPosition: "top",
            },
            {
                id: "accounts",
                target: "advanced-accounts",
                title: "Most privileged, and who approves",
                description: "The accounts with the widest access, and who approves activations.",
                icon: "approval",
                guides: [
                    { text: "The top of the list is where a stolen account would hurt most" },
                    { text: "A role with one approver is named. When that person is on holiday, nobody can approve it" },
                    { text: "Next: open the Report to see each assignment per scope" },
                ],
                tooltipPosition: "top",
            },
        ],
    },
    {
        id: "azure-report",
        product: "azure",
        section: "Report",
        label: "Report",
        page: "/azure/report",
        steps: [
            {
                id: "report-views",
                target: "report-toolbar",
                title: "Roles or assignments",
                description: "*Roles* lists each role on the chosen scope. *Assignments* lists every assignment with its scope.",
                icon: "report",
                guides: [
                    { text: "In *Assignments*, select a role to see its PIM settings at that scope" },
                    { text: "Search finds a principal or a role" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "details",
                target: "details-toggle",
                title: "Show more details",
                description: "The Report starts calm: a row shows only what deviates from the usual.",
                icon: "show",
                guides: [
                    { text: "It adds every tag, the warnings in the list and the count" },
                    { text: "Turn it on when you want the full picture of one role" },
                    { text: "In *Assignments* it also adds the *Origin* column, which shows anyway when the *Origin* filter includes inherited" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "report-filters",
                target: "report-filters",
                title: "Filters",
                description: "Three groups: assignments, role properties and scope.",
                icon: "filter",
                guides: [
                    { text: "*Origin*: this scope, inherited from above, or all" },
                    { text: "*Held by* also finds managed identities, foreign groups and deleted accounts" },
                    { text: "Everything is in the address. A link keeps the scope and the filters" },
                ],
                tooltipPosition: "bottom",
            },
            {
                id: "report-list",
                target: "report-list",
                title: "Roles on this scope",
                description: "Each role with its tags and counts.",
                icon: "view-list",
                guides: [
                    { text: "_Privileged_: one of the five Azure roles Microsoft lists as privileged administrator roles" },
                    { text: "Watch the warnings that *Show more details* adds: _Permanent active_ and _No MFA on activation_" },
                    { text: "Click a role to open it" },
                ],
                tooltipPosition: "right",
            },
            {
                id: "report-detail",
                target: "report-detail",
                fallbackTarget: "report-list",
                title: "Who has it, and the settings here",
                description: "Open a role for its assignments and its PIM settings at this scope.",
                icon: "user",
                guides: [
                    { text: "_Inherited_ means assigned on a scope above. Change it where it is assigned" },
                    { text: "A row on another scope has its own *Settings*, because settings do not inherit" },
                    { text: "Hover or focus a tag for what it means" },
                ],
                tooltipPosition: "left",
            },
            {
                id: "report-export",
                target: "report-export",
                title: "Export, and what next",
                description: "An overview as CSV: the assignments, and the role settings per scope.",
                icon: "export",
                guides: [
                    { text: "Apply the current scope and filter, or replace names with Person 1, 2 and so on" },
                    { text: "Next: under *Filters*, set *Ends* to _Permanent_ and *Level* to _Subscription_ or above" },
                ],
                tooltipPosition: "bottom",
            },
        ],
    },
];
