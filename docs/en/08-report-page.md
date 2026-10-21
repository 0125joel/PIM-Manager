# Report Page

The Report page shows every role and group as it is now: who holds what, how it is protected, and what is missing. It is read only. Changes are made in [Configure](./09-configure-page.md).

---

## Layout

One page with a list on the left and the detail of the selected item on the right. Below 1024 px wide the detail is a view of its own with a Back button, and the list comes back where you left it.

```
Report                                  [Refresh] [Export]
[Roles 146 | Groups 12] [Search a role, a group or a person] [Filters]
chips: Privileged only x   Has assignments x   Clear all      7 of 146 roles
+----------------------+--------------------------------------------+
| Role        Sort v   | Global Administrator [Privileged] [Copy link]
| Global Administrator | Assignments   Eligible (3)  Active (2)
| Security Administr.  | Role configuration  Activation | Assignment | Notification
| ...                  | tiles
+----------------------+--------------------------------------------+
```

The address of the page carries the state, so a link opens the same view: `view` (roles or groups), `q` (search), `f` (the filter, the same one the Dashboard uses), `role` and `group` (the selected item). "Copy link" copies it. Links from earlier versions of the Report still open and are converted.

---

## Roles

The list shows the name, a Privileged or Custom tag, "{n} eligible, {n} active", and only two warnings: "No MFA on activation" and "Permanent active". Sort by most assignments, name or most permanent.

The detail has two parts.

**Assignments.** Eligible and Active, one row per principal with tags:

| Tag | Meaning |
|-----|---------|
| User, Guest, App, Group | What the principal is |
| Direct, Via group | Whether the assignment is made to the principal or comes through a group |
| Tenant-wide, an administrative unit, an app | The scope of the assignment |
| Expires {date}, No end date | The end of the schedule |
| Permanent, Always on | Standing access that never expires |
| Activated, Assigned | How an active assignment came about |
| Emergency access | An account you marked in Settings |

Hover or focus a tag (tap it on a phone) for what it means. A group that holds the role is one row with its members behind "Show {n} members"; members are read when you open them.

**Role configuration.** Three tabs with one tile per setting:

- Activation: maximum duration, what to require (Entra MFA or an authentication context), justification and ticket, approval and approvers, and the two Custom extension tiles (Preview).
- Assignment: how long eligible and active assignments may last, and what to require on an active assignment.
- Notification: who is told about eligible assignments, active assignments and activations.

A tab with a problem has an amber dot: a privileged role without MFA or authentication context, a policy that allows permanent active assignments, or an activation that notifies nobody.

---

## Groups

The list has two sections: **Outside PIM** (role-assignable groups that hold roles but are not under PIM, shown first) and **Under PIM**.

A group outside PIM shows the roles it holds and its members; they hold those roles all the time and nothing is activated. "Bring under PIM" opens the Entra admin center.

A group under PIM shows its members and owners (eligible and active), the roles it holds, and the configuration with a **Member** or **Owner** choice: each has its own policy. An activation through a group shows under that group.

---

## Search and filters

Search finds a role, a group or a person (by name, UPN or mail). The Filters button opens a panel with the same filters the Dashboard cards set:

- Roles: privileged, role type, assignments, who holds them (user, guest, app, group), scope, direct or through a group, MFA, approval, maximum duration, custom extension.
- Groups: role-assignable, under or outside PIM, access type (member or owner), and the assignment filters.

The panel is closed by default and remembers if you opened it. Active filters show as chips; a filter that belongs to the other view is kept and marked "(groups only)" or "(roles only)". Escape closes the panel. When a filter or an assignment filter is on, the rows that match are marked in the detail.

---

## Loading and failing

- Skeletons while the first load runs; policies arrive in the background, a tile shows a placeholder until its policy is there, and the policy filters are off meanwhile.
- A role whose settings could not be read says "Not loaded", and one box lists them with Try again for those roles only.
- When nothing could be read, the box says why (the status Graph answered) and offers Try again.
- When nothing matches, the list says what you filtered on and offers Clear filters.
- PIM for Groups needs its own permission; until it is granted the Groups view says so and offers to grant it.

---

## Export

The Export button opens one dialog. Choose what the file is for:

| Purpose | Format | What you get |
|---------|--------|--------------|
| **Overview** | CSV | One row per assignment (role and group), one row per role with its settings, one row per group and Member or Owner. The first rows state the tenant, when the data was read, the filter and who exported. "Replace names" turns people into Person 1, 2, ... and leaves out the object IDs of people, the exporter and the search words. |
| **For Configure Import** | CSV | The import format of Configure Import: role policies, group policies, role assignments and group assignments, with IDs, Scope ID and End Date. Activated assignments and members through a group are left out (the dialog counts them and says why). |
| **Backup** | JSON | Everything in one file: every policy with all its rules and the settings read from them, every assignment, the authentication contexts and the custom extensions, with the schema version, tenant, when the data was read and the app version. |

Contents and scope are checkboxes: which files, directory roles, PIM for Groups, and "Apply the current filter" (roles and groups alike; a backup is always complete). Under "You get" you see each file name with its row count, and the button says how many files it downloads. They download one after another. Your last choice is remembered.

The file names are `pim-overview-assignments-{date}.csv`, `pim-overview-role-settings-{date}.csv`, `pim-overview-group-settings-{date}.csv`, `pim-bulk-role-policies-{date}.csv`, `pim-bulk-group-policies-{date}.csv`, `pim-bulk-role-assignments-{date}.csv`, `pim-bulk-group-assignments-{date}.csv` and `pim-backup-{date}.json`.

Every cell is escaped as RFC 4180 and a cell that starts with `=`, `+`, `-` or `@` gets a leading apostrophe so a spreadsheet shows text, not a formula. The PDF report stays on the Dashboard.

> [!NOTE]
> The export and the import share one column definition per file type (`src/utils/exportSchema.ts`). The tests write every file, read it back and compare it with the source, and check that Configure Import (`detectCsvKind` in `src/utils/importDetect.ts`) still recognises each bulk file.

---

## Assignment types

- **Eligible**: can activate the role through PIM.
- **Active**: has the role now. Activated means someone activated an eligibility and it ends by itself; Assigned means an administrator gave it, with or without an end.
- **Permanent**: an active assignment without an end. It bypasses activation, MFA and approval.

> [!WARNING]
> Permanent assignments should be rare. A privileged role with a permanent active assignment is one of the "Easy to miss" rows on the Dashboard.

---

## Troubleshooting

- **A role says "Not loaded".** Graph did not return its policy (throttling or a permission). Use Try again in the box above the list.
- **The Groups view asks for permission.** Grant PIM for Groups in Settings or with the button in the view.
- **The list is empty.** A filter or search is active; use Clear filters.
- **A group has no members listed.** Members of a group are read when you open the group; if Graph denies it, the row says so and offers Try again.

---

## Next steps

- [Configure page](./09-configure-page.md)
- [Data flow](./03-data-flow.md)
