import type { HelpPage } from "./types";
import { CONFIGURE_HELP_TERM_KEYS, CONFIGURE_TERMS } from "./configureTerms";

/** The seven blocks of the help panel (spec 18); the full guide has a section with the same title for each */
export const CONFIGURE_BLOCK_TITLES = ["Start page and access", "Edit", "Guided", "Import", "Access model", "Review and checks", "Apply and undo"] as const;

export const CONFIGURE_HELP: HelpPage = {
    id: "configure",
    title: "Configure",
    intro: "Change PIM settings and assignments of roles and groups. Every change waits in a basket, you review it, and only then is anything written to your tenant.",
    blocks: [
        { title: "Start page and access", text: "The access row says what you may change: roles, groups or nothing yet. Writing needs an Entra role (or group ownership) and the app's write permission, asked once when you need it." },
        { title: "Edit", text: "Pick a role or group, or Select several. Activation, Assignment and Notification settings show the value now and what you change it to; Who has it adds, ends and removes people. Copy settings to... carries one target's settings to others." },
        { title: "Guided", text: "The same rules on several roles or groups in five steps: what to change, which targets, the settings, the people and the review. It can start from a copy or from the access model." },
        { title: "Import", text: "Choose a CSV or an access model file. PIM Manager recognises it from its columns, checks every row or value against your tenant and shows what it would change. Files the Report exports for Configure open here unchanged." },
        { title: "Access model", text: "How PIM Monitor sorts all Entra roles into planes and levels and which settings it recommends per level. Use it as a template in Guided." },
        { title: "Review and checks", text: "Before anything is written, PIM Manager checks what Microsoft would reject, what changes for the people who activate and your own access. Fix what blocks, look at what warns, leave out what you do not want." },
        { title: "Apply and undo", text: "Apply writes change by change and shows the result of each. A snapshot is saved first, so Undo this apply can build the opposite changes, and the changes that failed can be tried again." },
    ],
    terms: CONFIGURE_HELP_TERM_KEYS.map((key) => ({ term: CONFIGURE_TERMS[key].label, text: CONFIGURE_TERMS[key].text })),
    guide: [
        {
            title: "Start page and access",
            paragraphs: ["Configure reads what you may change after the data has loaded. The access row names the role or group ownership that opens it, or what to activate first, or says Configure is closed. The three cards open Edit, Guided and Import; a card you cannot use says why."],
            items: [
                { label: "Open", text: "you hold a fitting role or own the groups shown." },
                { label: "Activate first", text: "you are eligible for the role: activate it in Entra, then use Refresh." },
                { label: "Closed", text: "no role or ownership that may change PIM settings." },
                { label: "Last applies", text: "the last ten applies of this tenant in this browser, each with Undo while its snapshot is there. Signing out clears them." },
            ],
        },
        {
            title: "Edit",
            paragraphs: ["The list on the left has roles and groups (groups not under PIM yet in their own section). A target with changes waiting has a violet dot; a locked one says why. The tabs are Activation, Assignment, Notification and Who has it."],
            items: [
                { label: "Now and the change", text: "every row shows the value read from the tenant. A change shows the old value struck through, and Undo on the row takes it back." },
                { label: "Select several", text: "Keep or Set to per setting; Add n to changes only adds the targets that differ." },
                { label: "Who has it", text: "Remove and Change end per row, and Add people with the end defaulting to the policy maximum. A group keeps at least one owner." },
                { label: "Custom extensions", text: "link or switch an extension before or after approval; an extension cannot be unlinked from a file." },
            ],
        },
        {
            title: "Guided",
            paragraphs: ["Start chooses roles or groups, the settings to follow (the current settings, a copy of one target or the access model) and which parts to change. Targets, Settings, People and Review follow; changing a choice in Start clears what depended on it."],
            items: [
                { label: "Copy", text: "the settings of one target become the starting values for the others, which you can still change per setting." },
                { label: "Access model", text: "one block per level with the catalog's values; a label with no authentication context in your tenant leaves the requirement as it is until you choose a context." },
            ],
        },
        {
            title: "Import",
            paragraphs: ["What can I import? lists every column of every file type, generated from the same definition the Report export uses, with a template to download. Excel files saved as CSV with semicolons are recognised too."],
            items: [
                { label: "Assignments", text: "each row is New, Changes the end date, Will be removed, Already there, Not there any more or needs a fix. Activations and schedules through a group never count as already there." },
                { label: "Settings", text: "each filled cell that differs from the tenant is one change; an empty cell keeps the current value. Require On Activation wins over the older MFA Required column." },
                { label: "Access model file", text: "its expectedConfig per role or group becomes the same kind of changes, with a note where a label has no authentication context yet or the file takes the activation requirement down to None (Weaker than now)." },
                { label: "Left alone", text: "values already in your changes from Edit or Guided are not replaced." },
            ],
        },
        {
            title: "Access model",
            paragraphs: ["The page shows the catalog as read from pimmonitor.com after sign-in, or the copy that ships with PIM Manager when it could not be reached. Plane, level and recommended settings are PIM Monitor's interpretation. Place your groups so Guided can use them."],
        },
        {
            title: "Review and checks",
            paragraphs: ["The verdict says Ready to apply, Ready with things to look at, or what to fix first. Settings are grouped by value; every new assignment is sent once to Microsoft as a validation, which writes nothing. Removals need a confirmation by name. Conditional Access is checked only when you allow reading it."],
        },
        {
            title: "Apply and undo",
            paragraphs: ["Settings are written first, then assignments, in the order that avoids conflicts, four at a time. Stop finishes the write in flight. The result lists every change as Done or Not written (a failed change says why), then reads the targets again and says whether they match. A reload shows the same result and never writes again."],
            items: [
                { label: "Try the failed ones again", text: "puts the failed changes back in the basket and opens the review." },
                { label: "Undo this apply", text: "needs the snapshot in this browser, reads the targets again and warns about values changed by someone else since." },
                { label: "Results as CSV", text: "three columns, safe to open in Excel." },
            ],
        },
    ],
};
