export const HELP_CONTENT = {
    gettingStarted: {
        title: "Welcome to PIM Manager",
        description: "View, analyze, and configure your Entra ID PIM policies and role assignments in one place.",
        auth: {
            title: "Authentication & permissions",
            description: "Sign in with your Microsoft account. The application uses read-only permissions:",
            tip: "All permissions follow the least privilege principle and require admin consent in Microsoft Entra Admin Center."
        },
        navigation: {
            title: "Navigation",
            dashboard: {
                title: "Dashboard",
                description: "Security posture overview with stats, charts, and alerts"
            },
            report: {
                title: "Report",
                description: "View comprehensive PIM coverage, role assignments, and policies"
            },
            configure: {
                title: "Configure",
                description: "Apply policy changes and manage assignments across roles and groups"
            }
        }
    },
    dashboard: {
        title: "💻 Security dashboard guide",
        description: "Your central hub for monitoring PIM status, security alerts, and role details.",
        viewModes: {
            title: "View modes",
            intro: "Toggle between two view modes using the switch in the top right:",
            basic: {
                title: "Basic view",
                description: "Focuses on high-level security alerts and a simplified role list. Ideal for quick status checks."
            },
            advanced: {
                title: "Advanced view",
                description: "Displays detailed assignment metrics, recent activations, configuration errors, and expiring assignments."
            }
        },
        securityAlerts: {
            title: "Security alerts",
            description: "The Security Alerts widget (visible in Basic mode) shows active PIM alerts from your directory.",
            items: [
                "Read-only view of current Entra ID security recommendations.",
                "Click 'Show passed checks' to view all evaluated policies.",
                "Alerts include \"Roles don't require MFA\", \"Potential stale accounts\", and more."
            ],
            note: "Resolving alerts must be done in the Microsoft Entra Admin Center."
        },
        roleOverview: {
            title: "Role overview & navigation",
            description: "The Role Overview list provides a quick summary of your roles.",
            drillDown: {
                title: "Drill-down navigation",
                description: "Click on any role in the list (or the arrow icon) to instantly navigate to the Report Page with that role selected. This allows you to immediately view the role's deep configuration details."
            },
            quickFilter: {
                title: "Quick filter",
                description: "Use the dropdown to filter the list by \"Privileged Only\" or \"PIM Configured\" roles."
            }
        },
        pdfExport: {
            title: "PDF export",
            description: "Export your dashboard data as a customizable PDF report.",
            sections: {
                title: "Customizable sections",
                description: "Toggle which sections (Overview, Assignments, MFA...) and Workloads (Roles/Groups) to include."
            },
            charts: {
                title: "Charts & data tables",
                description: "Include chart images and/or data tables. Data tables have selectable text for easy copy/paste."
            },
            note: "Click 'Export PDF' in the Dashboard header when all data is loaded."
        }
    },
    reports: {
        title: "📊 Report page guide",
        description: "Comprehensive view of all Entra ID roles with real-time loading and progressive rendering.",
        filtering: {
            title: "Filtering & search",
            description: "Find exactly what you need using powerful filters:",
            items: {
                search: "Find roles by name",
                user: "Filter by assigned user",
                roleType: "Built-in or Custom",
                privileged: "High-impact roles",
                assignmentType: "Permanent, Eligible, Active",
                assignmentMethod: "Direct or Group-based"
            },
            tip: "Click 'Reset Filters' to clear all selections at once."
        },
        badges: {
            title: "Understanding badges & status",
            description: "Roles display badges to indicate their status:",
            items: {
                builtIn: "Standard Entra ID roles",
                privileged: "High-impact roles requiring extra security",
                pimConfigured: "Role has an active PIM policy"
            }
        },
        details: {
            title: "Viewing role details",
            description: "Click any role card to expand and view detailed information:",
            assignments: {
                title: "Role assignments",
                description: "View all users and groups assigned to this role, including permanent, eligible, and active assignments."
            },
            config: {
                title: "Role configuration",
                description: "PIM policy settings organized into tabs:",
                activation: "Max duration, MFA, approval workflows, approvers",
                assignment: "Expiration settings for eligible and active assignments",
                notification: "Email notifications table with recipients and critical status"
            }
        },
        assignmentTypes: {
            title: "Assignment types explained",
            method: {
                title: "Assignment method",
                direct: "Role assigned directly to the user",
                group: "Role assigned via group membership (recommended for scalability)"
            },
            duration: {
                title: "Duration",
                permanent: "No expiration date",
                timeBound: "Specific start and end dates (PIM best practice)"
            }
        },
        export: {
            title: "Exporting data",
            description: "Export filtered data for external analysis:",
            json: "Full structured data including policies and rules",
            pdf: "Professional report with security alerts, charts, and executive summaries",
            csv: "Flat list with summary counts and status flags"
        }
    },
    configure: {
        title: "🔧 Configure Guide",
        description: "Apply PIM policy changes and manage assignments. Three modes are available depending on your workflow.",
        modes: {
            wizard: {
                title: "Wizard",
                description: "Step-by-step guided flow with backup, preview, and per-workload configuration."
            },
            manual: {
                title: "Manual",
                description: "Freeform editor. Select targets, adjust settings, and apply directly or via a staged queue."
            },
            bulk: {
                title: "Bulk",
                description: "CSV-based batch configuration. Upload a file, compare changes, and apply at scale."
            }
        },
        requiredPermissions: {
            title: "Required Permissions",
            description: "Configuration requires Write permissions in addition to the standard Read permissions.",
            directoryRoles: "Directory Roles (Write)",
            pimGroups: "PIM for Groups (Write)"
        },
        wizard: {
            stepsOverview: {
                title: "Wizard — Steps Overview",
                description: "The wizard guides you through dynamic steps based on your selections:",
                checkpointNote: "When configuring both Directory Roles and PIM Groups, a Checkpoint step appears between the two workloads."
            },
            scopeSelection: {
                title: "Wizard — Step 4: Scope Selection",
                description: "Choose how to initialize your configuration:",
                startFresh: {
                    title: "Start Fresh",
                    description: "Begin with Microsoft default settings."
                },
                loadCurrent: {
                    title: "Load Current",
                    description: "Load settings from selected role (single selection only)."
                },
                cloneFrom: {
                    title: "Clone From",
                    description: "Copy settings from any other role - great for standardizing!"
                },
                filteringTitle: "Filtering the list",
                filteringDescription: "Use the quick-filter pills above the search bar to narrow large role and group lists:",
                selectAllNote: "\"Select All Visible\" respects active filters — only visible items are selected."
            },
            policySettings: {
                title: "Wizard — Step 5: Policy Settings",
                activationTitle: "Activation Settings",
                assignmentTitle: "Assignment Expiration",
                notificationTitle: "Notification Settings",
                notificationDescription: "Configure email alerts for Eligible Assignment, Active Assignment, and Activation events to admins, assignees, and approvers.",
                pimGroupsTip: "For PIM Groups, toggle between Member and Owner policies."
            },
            assignments: {
                title: "Wizard — Step 6: Assignments",
                createTitle: "Create New Assignments",
                manageTitle: "Manage Existing Assignments"
            },
            applyProcess: {
                title: "Wizard — Step 8: Apply Process",
                description: "Changes are applied in three phases:",
                retryTip: "Failed operations can be retried without re-running successful ones."
            }
        },
        manual: {
            title: "Manual Mode",
            description: "A 3-column freeform editor. No fixed steps — select targets, edit settings, and apply on your terms.",
            column1: {
                title: "Column 1 — Selector",
                description: "Pick the workload (Directory Roles or PIM Groups) and select one or more targets. Current settings auto-load for single selections."
            },
            column2: {
                title: "Column 2 — Policy & Assignment tabs",
                description: "Policy tab: Full activation, assignment, and notification settings. PIM Groups shows both Member and Owner policies. Assignment tab: Create eligible/active assignments, set scope and duration, and manage existing assignments (view, remove)."
            },
            column3: {
                title: "Column 3 — Staged Queue",
                description: "Use Stage Changes to queue multiple policy edits before applying them all at once, or use Apply Now to apply immediately to the current selection."
            },
            permissionsTip: "Write permissions are requested the first time you apply changes — not when you open the page."
        },
        bulk: {
            title: "Bulk Mode",
            description: "CSV-based configuration for large-scale changes. Supports 4 CSV types: Role Policies, Group Policies, Role Assignments, and Group Assignments. Assignment CSVs handle both add and remove operations in a single file via the Action column.",
            templateTip: "Download a template, fill in your data, and upload. Or export from the Report page, change Action to \"remove\" for rows you want to delete, and re-import."
        },
        requiredEntraRoles: {
            title: "Required Entra Roles",
            importantNote: "Graph API permission consent is not enough. The signed-in user must also have the appropriate Entra role."
        },
        safetyFeatures: {
            title: "Safety Features"
        }
    },
    settings: {
        modal: {
            title: "Settings",
            workloads: {
                title: "Workloads",
                description: "Manage which Microsoft 365 workloads and features are enabled."
            },
            note: {
                title: "Note:",
                text: "Enabling workloads or features requests permissions via popup. Hiding removes from UI but keeps permissions (revoke in Entra Admin Center). These settings are persistent; they are not affected by temporaryURL filters applied during navigation."
            },
            items: {
                directoryRoles: {
                    name: "Directory roles",
                    description: "Entra ID PIM privileged role assignments",
                    securityAlerts: {
                        name: "Security alerts",
                        description: "View PIM security recommendations and alerts for Directory Roles"
                    }
                },
                pimGroups: {
                    name: "PIM for groups",
                    description: "Microsoft Entra group-based privileged access. Enabling this also allows detection of Unmanaged Groups."
                }
            },
            actions: {
                hide: {
                    label: "Hide",
                    tooltip: "Hides from UI only. Permission remains granted in Entra ID."
                },
                show: "Show",
                enable: "Enable",
                enabling: "Enabling..."
            }
        }
    }
};
