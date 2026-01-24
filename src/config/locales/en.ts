export const HELP_CONTENT = {
    gettingStarted: {
        title: "Welcome to PIM Manager",
        description: "View and analyze your Entra ID roles, PIM policies, and role assignments in one place.",
        auth: {
            title: "Authentication & permissions",
            description: "Sign in with your Microsoft account. The application uses read-only permissions:",
            tip: "All permissions follow the least privilege principle and require admin consent in Microsoft Entra Admin Center."
        },
        navigation: {
            title: "Navigation",
            report: {
                title: "Report",
                description: "View comprehensive PIM coverage, role assignments, and policies"
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
    settings: {
        title: "⚙️ Settings guide",
        description: "Manage workloads, enable optional features, and control what data is displayed.",
        workloads: {
            title: "Workloads",
            description: "Workloads are the data sources that PIM Manager can read from your tenant.",
            directoryRoles: {
                title: "Directory roles",
                description: "Core workload. Always enabled. Shows Entra ID Directory Role assignments and PIM policies."
            },
            pimGroups: {
                title: "PIM for groups",
                description: "Optional. Shows PIM-eligible group memberships. Requires additional consent."
            }
        },
        optionalFeatures: {
            title: "Optional features",
            description: "Features that require additional permissions and are disabled by default.",
            securityAlerts: {
                title: "Security alerts",
                description: "Displays PIM security alerts (roles without MFA, stale accounts, etc.). Requires PrivilegedAccess.Read.AzureAD permission."
            },
            note: "Enabling a feature triggers a consent popup. Permissions stay until revoked in Entra ID."
        },
        hideDisable: {
            title: "Hide vs. disable",
            description: "There are two ways to control workloads and features:",
            hide: {
                title: "Hide",
                description: "Hides from UI only. Permission remains granted. Data is still fetched but not shown."
            },
            disable: {
                title: "Disable",
                description: "Stops data fetching. To fully revoke permission, visit the Entra Admin Center."
            }
        },
        viewChips: {
            title: "View chips",
            description: "The chip bar on the Dashboard lets you quickly toggle which data is visible:",
            items: [
                "Click a chip to hide/show that workload's data in all views.",
                "Grayed chips indicate hidden data (click to show again).",
                "If only one workload is active, its chip cannot be hidden.",
                "Settings icon opens the full Settings modal.",
                "Note: URL parameters (e.g. from Dashboard links) may temporarily override these toggles.",
                "PIM Groups and Unmanaged Groups can be toggled independently."
            ]
        },
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
