# Audit Page

Ask an admin whether they still need a role and the answer is yes. Always. The Audit page (`/audit`) gives you something better than that conversation: what was activated, what changed, who did it and when, for Entra roles and PIM for Groups. It only reads. Entra and Azure each have their own Audit page, and they work the same way. This guide starts with Entra; [Audit on Azure](#audit-on-azure) tells what is different.

---

## Layout

```
Audit                                                     [Refresh] [Export]
Period: last 30 days                       [timeline, one track per kind]
Source: Entra audit log. Oldest event available: ... Read ... Times in ...
[Events | No activation] [ ] Show more details     kinds, where, search
+--------------------------------+---------------------------------------+
| Today                          | What, By, Role, When, Result          |
| Megan Bowen activated ...      | Reason, Ticket, Approved by           |
+--------------------------------+---------------------------------------+
```

From 1024 px wide, the list and the detail sit side by side in equal columns. Below that the list is the page, and a row opens its detail with a Back button.

The address carries the view, so a link opens the same thing: `days`, `from` and `to` (the selection), `kinds`, `env`, `failed`, `q`, `view` and `event`. **Copy link** in the detail copies it.

---

## Where the events come from

| Source | Reaches back | What it needs |
|--------|--------------|---------------|
| Entra audit log (Microsoft Graph) | Up to 30 days | The optional `AuditLog.Read.All` permission, and the Reports Reader, Security Reader or Security Administrator role |
| Log Analytics workspaces, your choice | As long as the workspace keeps its logs | The optional `https://api.loganalytics.io/Data.Read` permission, and read access to the workspace and its `AuditLogs` table |

The permission is asked on this page, never at sign-in, and the rest of the app works without it. Events stay in memory for the session. PIM Manager does not store them, and an IP address, user agent or token claim never reaches the screen or an export, because the mapper only keeps fields it names.

**The coverage line** under the timeline names the source, the oldest event available, the read time and the time zone. A page like this is only worth something if it is honest about what it did not see. For the same reason, every failure has its own state:

| State | What it means |
|-------|---------------|
| Audit needs one more permission | Nothing has been read yet. **Grant permission** asks for it |
| Your role cannot read the audit log | The permission is there, your role is not. Activate one of the reader roles, then **Refresh** |
| The audit log could not be loaded | Microsoft did not answer. This says nothing about what happened in the period |
| More than 50,000 events | Too many for a browser. You choose a shorter period, because a part would look like the whole |
| Nothing happened in this period | Only after a read that worked |

New events can take a few minutes to appear.

---

## Events

One action is one row. Microsoft logs a request and its completion separately, and an activation with approval even under two correlation ids. The page joins them, so you read what happened and not how it was logged. A request still waiting for approval reads as requested, not as activated. A denied one shows Denied.

| Kind | What it holds |
|------|---------------|
| Activations | Activations of a role or group. Default on |
| Assignments | Eligible and active assignments added, removed or renewed. Default on |
| Settings | Changes to role settings. Microsoft logs the new value only, so the old value reads "Not in the log". Default on |
| Outside PIM | Role changes made directly, without PIM. There is no request, reason or approval to show. Default on |
| System | Events started by a service, and anything the page cannot classify. Off by default, because otherwise expiries bury the changes people made. The count stays visible |

Next to the kinds you search on person, role and ticket. **Filters** holds the rest: **Who** (Users, Guests, Apps, Agents or Groups), **Environment** (Entra roles or PIM for Groups), **Roles** (Privileged only) and **Result** (Failed or denied). An active filter shows as a chip you can remove. An event without a holder, such as a changed setting, only shows while Who is on All. The log calls an app and an agent the same, so the page goes by who holds a role now. One that holds no role stays under Apps and under Agents, and the page tells you how many. Privileged only keeps a role it cannot judge and tells you how many, because not knowing is not the same as not privileged. A group counts when it is eligible or active for a privileged role.

**Show more details** adds Used for, Requested duration, MFA on activation, Where and Source. It never filters, and it does not change an export.

Got a role through a group that holds an Entra role? Then the row shows that role, and the group under **Through**. The log itself only names the group, so the page compares with the assignments of today, and a role the group no longer holds gives no match. Search finds the row by the role name as well.

**Used for** is the time an activation really lasted. It is empty when the end is not in the log, because a running activation and a delayed event look the same from here.

---

## Timeline and period

The period is a whole number of days. Without a workspace the maximum is 30; with one, the page opens on 180 days, or less if your workspaces keep less.

The timeline has one track per kind. Drag across it to select a stretch, and the list and the counts follow. Move the handles with the arrow keys: one day at a time, seven with Shift, and Home and End for the edges. A click on a point selects its row in the list. Point at one to see its kind, result, sentence and time. A dashed red ring means failed or denied, an outline marks the action in the detail.

---

## No activation

Here is the view for the conversation from the top of this page. It puts each assignment next to the successful activations in the period.

| Activation | Meaning |
|------------|---------|
| Last activated on a date | At least one successful activation in the period |
| None in this period | Eligible, and no successful activation in the period |
| Not applicable | Permanent access, an app, or held by a group. These do not activate, so "no activation" would prove nothing |
| Not judged | The members of a group could not be read, for example |

None in this period is not a verdict. A role used once a quarter looks unused in a 30-day window, so the page and the export say the same thing: this shows a role was not activated in the period, not that it can go. Permanent access never reads as "not used".

Failed activations and requests without a completion do not count. This view also needs the assignments, so it reads those as well. The timeline selection, the kinds and Failed or denied do not apply here. Filters and search do, and a person who has a role through a group counts under Users or Guests, and under Groups.

---

## Log Analytics workspaces

Thirty days is short when you want to show that a role has not been used for a year. In [Settings](./11-settings.md), under **Log Analytics workspace**, you choose one or more workspaces for yourself. The list comes from Azure and shows what your account may see, so an empty list does not prove there are none. You can always enter a workspace ID by hand.

Each workspace gets a status per log: its dates and how long it keeps logs, no logs yet, or no access. A workspace only holds logs from the moment a diagnostic setting in Entra started sending `AuditLogs` to it. The first logs can take up to 3 days, and older logs are not added.

The page queries each workspace separately, so one that fails is named instead of quietly missing. It also merges the last 30 days of the Entra audit log, because a workspace can miss events. Older than that, nothing can check it. Each event shows once.

Only the IDs of your choice stay in this browser, per tenant, until you sign out.

---

## Audit on Azure

Switch to Azure in the top bar and you get the same page at `/azure/audit`: the same timeline, the same filters, the same export. A filter name means the same on both sides. What differs is where the events come from and what you are allowed to see.

| Source | Reaches back | What it needs |
|--------|--------------|---------------|
| Azure activity log and PIM requests | Up to 90 days. The page opens on 30 | An Azure role on the scope. Reader is enough, and no extra permission is asked |
| Entra audit log, next to them | Up to 30 days, or further with a workspace that holds `AuditLogs` | `AuditLog.Read.All`, if you already granted it on the Entra Audit page. It names the approver and tells who activated a group that holds a role |
| Log Analytics workspaces, your choice | As long as the workspace keeps its logs, up to a year | `https://api.loganalytics.io/Data.Read`, and read access to the workspace and its `AzureActivity` and `AuditLogs` tables |

Azure quietly leaves out what your roles cannot see. An empty list is therefore not proof that nothing happened, and the page says so. What it could not read, it names, here and in every export. Your own requests are the exception: they are included, also on scopes you cannot read. A narrow reader sees their own requests and nothing else there, and the coverage line says that.

**Through a group.** Activate a group that holds an Azure role, or get assigned to one, and you get a row per role and scope, the same as a direct one, with the group under **Through**. That comes from the Entra audit log and the assignments of today. So without that log, or beyond how far it reaches, those rows are missing while the direct ones are not. A notice above the list tells you, because a gap you can't see is worse than one you can. The exports have a Through group column for this.

**The detail.** Azure does not say who decided a request, so Approved by or Denied by comes from the Entra audit log too. With **Show more details** a request also shows when it Starts, if it was planned for later, and how long the decision took (Approved after or Denied after). A denied request shows Denied and sits under **Failed or denied**.

**No activation on Azure.** Each assignment is one row. An eligible group gets a row per member, each judged on their own activations. That is judged on the Entra audit log and needs `AuditLog.Read.All` and read access to PIM for Groups, so without one of them a row says what is missing and nothing is judged. The Entra audit log keeps 30 days: in a longer period a member without an activation in those 30 days reads Not judged, never None in this period. A group that is not in PIM for Groups reads Not applicable.

**With a workspace.** The page opens on 180 days and goes up to a year, or as far as your workspaces keep their logs. Three things to know:

- Older than 90 days only comes from subscriptions that send to a workspace. The diagnostic setting is per subscription, the first Azure logs can take up to 90 minutes, and older logs are not added. Entra logs take up to 3 days to arrive.
- A workspace shows what it holds, also on scopes your roles do not reach. Whoever can read the workspace can read this.
- The native reads keep running next to it, because a workspace can miss events. An event in both shows once.

If a workspace or one of its logs can't be read, the rest shows and the page names what is missing. That includes a table you have no rights on. Log Analytics then answers with an empty result instead of an error, so PIM Manager asks for your rights with every read. If your access is limited to certain rows, the page shows the rows you may see and says that events can be missing. If none can be read, you are back at 90 days, with a notice that says so. A workspace whose Entra table is empty counts as one without it, so Entra stays at 30 days.

---

## Export

**Export** saves the current view, with its filters and selection, as a file.

| Format | Use it for |
|--------|------------|
| CSV | One row per action, with reason, ticket and approver, for a spreadsheet |
| JSON | The same actions with all kept fields |
| PDF | Audit report: period, sources, totals and the actions |

On Entra, **Include** lets you choose Entra roles, PIM for Groups or both, each with its count. It starts with both every time, so no file leaves one out without you choosing that. The totals and the filter line follow your choice.

A group row carries the group in a Through group column, and on Entra the roles it holds in Roles through the group. Every export states the period, the source, the oldest event available, when it was read and anything that could not be read. It always holds all kept fields, also when Show more details is off. Times are in UTC.

**Replace names with User 1, 2, ...** also leaves out the object IDs of people, the exporter, the search words, and the reason, new value and ticket, because free text can hold names. Role and group names stay.

An export is a report of what this page read. It is not tamper-proof evidence, and it does not pretend to be.
