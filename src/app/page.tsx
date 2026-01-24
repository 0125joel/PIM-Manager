"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import {
  Shield,
  Settings,
  FileText,
  Users,
  CheckCircle,
  LogIn,
  LayoutDashboard,
  ChevronDown,
  ChevronUp,
  Lock,
  AlertTriangle,
  Activity,
  Eye
} from "lucide-react";
import { loginRequest } from "@/config/authConfig";
import { PreviewModal } from "@/components/PreviewModal";

const securityDashboardImages = [
  { src: "/previews/dashboard-basic.png", caption: "Security Dashboard - Overview of PIM health and active alerts" },
  { src: "/previews/dashboard-advanced.png", caption: "Advanced Metrics - Detail breakdown of role activation trends" },
  { src: "/previews/dashboard-export.png", caption: "Export Modal - PDF reports for management" },
  { src: "/previews/dashboard-alerts.png", caption: "Security Alerts - Real-time risk detection" },
];

const reportsImages = [
  { src: "/previews/report-filter.png", caption: "Comprehensive Reports - Advanced filtering capabilities" },
  { src: "/previews/report-assignments.png", caption: "Role Assignments - Who has access to what" },
  { src: "/previews/report-configuration.png", caption: "Role Configuration - Policies and settings" },
  { src: "/previews/report-pimgroups.png", caption: "Groups List - Managed vs Unmanaged groups" },
  { src: "/previews/report-unmanagedgroups.png", caption: "Unmanaged Groups - Identify coverage gaps" },
  { src: "/previews/report-export.png", caption: "Export Data - CSV/JSON output" },
];

export default function Home() {
  const router = useRouter();
  const { instance, accounts } = useMsal();
  const isAuthenticated = accounts.length > 0;

  const [previewFeature, setPreviewFeature] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      router.push("/dashboard");
    }
  }, [isAuthenticated, router]);

  const handleLogin = () => {
    instance.loginPopup(loginRequest).catch((e) => {
      if (process.env.NODE_ENV === 'development') {
        console.error("Login error:", e);
      }
    });
  };

  if (isAuthenticated) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-zinc-900 dark:via-zinc-900 dark:to-blue-950">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-3 mb-6">
              <img src="/logo.png" alt="PIM Manager" className="h-16 w-16" />
              <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                PIM Manager
              </h1>
            </div>
            <p className="text-xl text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto mb-8">
              Streamline your Microsoft Entra ID Privileged Identity Management.
              Configure role settings and assignments at scale with ease.
            </p>
            <button
              onClick={handleLogin}
              className="inline-flex items-center gap-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-8 py-4 rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all font-semibold shadow-xl hover:shadow-2xl transform hover:scale-105"
            >
              <LogIn className="h-5 w-5" />
              Sign In with Microsoft
            </button>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-3 gap-8 mb-16">
            <FeatureCard
              icon={<LayoutDashboard className="h-6 w-6" />}
              title="Security Dashboard"
              description="Get a visual overview of your PIM security posture. See charts, statistics, and quick insights at a glance."
              color="green"
              available={true}
              onPreview={() => setPreviewFeature("dashboard")}
            />
            <FeatureCard
              icon={<FileText className="h-6 w-6" />}
              title="Comprehensive Reports"
              description="View detailed PIM coverage, role assignments, and policies. Track who has access to privileged roles with advanced filtering."
              color="blue"
              available={true}
              onPreview={() => setPreviewFeature("reports")}
            />
            <FeatureCard
              icon={<Settings className="h-6 w-6" />}
              title="Bulk Configuration"
              description="Configure PIM settings for multiple roles simultaneously. Set activation duration, MFA requirements, and approval workflows."
              color="purple"
              available={false}
            />
          </div>

          {/* Two Column Section: Benefits & Capabilities */}
          <div className="grid lg:grid-cols-2 gap-8 mb-16">
            {/* Left: Key Benefits */}
            <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-xl p-8 border border-zinc-200 dark:border-zinc-700 h-full flex flex-col">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-8 text-center">
                Why use PIM Manager?
              </h2>
              <div className="flex-1 flex flex-col justify-center gap-6">
                <Benefit text="Visualize your security posture at a glance" />
                <Benefit text="Gain insights into privileged access patterns" />
                <Benefit text="Export detailed reports for compliance audits" />
                <Benefit text="Identify security risks before they become problems" />
              </div>
            </div>

            {/* Right: Capabilities (2x2 Grid) */}
            <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-xl p-8 border border-zinc-200 dark:border-zinc-700 h-full">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-6 text-center">
                What does it cover?
              </h2>
              <div className="grid grid-cols-2 gap-4 h-full content-start">
                <CapabilityCard
                  icon={<Shield className="h-5 w-5" />}
                  title="Directory Roles"
                  description="Built-in & Custom roles"
                  color="blue"
                  type="Core"
                  compact
                />
                <CapabilityCard
                  icon={<Users className="h-5 w-5" />}
                  title="PIM Groups"
                  description="Unified groups view"
                  color="purple"
                  type="Optional"
                  compact
                />
                <CapabilityCard
                  icon={<Lock className="h-5 w-5" />}
                  title="Assignable Groups"
                  description="Track Role-assignable groups"
                  color="amber"
                  type="Optional"
                  compact
                />
                <CapabilityCard
                  icon={<Activity className="h-5 w-5" />}
                  title="Security"
                  description="Alerts & coverage"
                  color="red"
                  type="Optional"
                  compact
                />
              </div>
            </div>
          </div>

          {/* Required Permissions (Accordion) - Styled to match cards */}
          <PermissionsAccordion />

          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400 mt-6">
            Admin consent is required • All permissions follow least privilege principle
          </p>
        </div>
      </div>

      <PreviewModal
        isOpen={!!previewFeature}
        onClose={() => setPreviewFeature(null)}
        title={previewFeature === "dashboard" ? "Security Dashboard" : "Comprehensive Reports"}
        images={previewFeature === "dashboard" ? securityDashboardImages : reportsImages}
      />

      {/* Footer */}
      <div className="text-center py-8 text-sm text-zinc-500 dark:text-zinc-400">
        <p>Crafted with passion by <a href="https://www.linkedin.com/in/jo%C3%ABl-prins-4b4655aa/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 hover:underline transition-colors">Joël</a> • Powered by Microsoft Graph API</p>
      </div>
    </div >
  );
}

function FeatureCard({ icon, title, description, color, available = true, onPreview }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: "blue" | "purple" | "green";
  available?: boolean;
  onPreview?: () => void;
}) {
  const colorClasses = {
    blue: "from-blue-500 to-blue-600",
    purple: "from-purple-500 to-purple-600",
    green: "from-green-500 to-green-600",
  };

  return (
    <div className={`relative bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-lg border border-zinc-200 dark:border-zinc-700 hover:shadow-xl transition-shadow ${!available ? 'opacity-75' : ''}`}>
      {/* Preview Button (Top Right) */}
      {available && onPreview && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
          className="absolute top-4 right-4 p-2 bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors z-10 group"
          title="Preview Feature"
        >
          <Eye className="h-4 w-4" />
        </button>
      )}

      <div className="flex items-start justify-between mb-4">
        <div className={`inline-flex p-3 rounded-lg bg-gradient-to-br ${colorClasses[color]} text-white`}>
          {icon}
        </div>
        {!available && (
          <span className="px-3 py-1 text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full">
            Coming Soon
          </span>
        )}
      </div>
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
        {title}
      </h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {description}
      </p>
    </div>
  );
}

function Benefit({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3">
      <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
      <span className="text-zinc-700 dark:text-zinc-300">{text}</span>
    </div>
  );
}

// Updated CapabilityCard for better fit in 2x2
function CapabilityCard({ icon, title, description, color, type, compact = false }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: "blue" | "purple" | "amber" | "red";
  type?: "Core" | "Optional";
  compact?: boolean;
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
    purple: "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400",
    red: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400",
  };

  return (
    <div className={`relative bg-zinc-50 dark:bg-zinc-900/50 rounded-xl ${compact ? 'p-4' : 'p-6'} text-center border border-zinc-100 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors`}>
      {type && (
        <span className={`absolute top-2 right-2 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${type === 'Core'
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
          : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
          }`}>
          {type}
        </span>
      )}
      <div className={`inline-flex ${compact ? 'p-2 mb-2' : 'p-3 mb-4'} rounded-full ${colorClasses[color]}`}>
        {icon}
      </div>
      <h3 className={`font-semibold text-zinc-900 dark:text-zinc-100 ${compact ? 'text-sm mb-1' : 'mb-1'}`}>{title}</h3>
      <p className={`text-zinc-500 dark:text-zinc-400 ${compact ? 'text-xs' : 'text-sm'}`}>{description}</p>
    </div>
  );
}

function PermissionsAccordion() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden transition-all">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-6 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors"
      >
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 rounded-lg">
              <Lock className="h-5 w-5" />
            </div>
            Required Permissions
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 ml-12">
            Admin consent required to read your directory. Click to view details.
          </p>
        </div>
        {isOpen ? (
          <ChevronUp className="h-5 w-5 text-zinc-400" />
        ) : (
          <ChevronDown className="h-5 w-5 text-zinc-400" />
        )}
      </button>

      {isOpen && (
        <div className="p-8 pt-0 border-t border-zinc-100 dark:border-zinc-700 animate-in slide-in-from-top-2 duration-200">
          <div className="grid md:grid-cols-2 gap-8 mt-6">
            {/* Core Permissions */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-4 flex items-center gap-2">
                <Shield className="h-4 w-4" /> Core (Required)
              </h3>
              <div className="space-y-3">
                <PermissionItem perm="User.Read" desc="Read your profile" />
                <PermissionItem perm="RoleManagement.Read.Directory" desc="Read role definitions" />
                <PermissionItem perm="RoleAssignmentSchedule.Read.Directory" desc="Read active assignments" />
                <PermissionItem perm="RoleEligibilitySchedule.Read.Directory" desc="Read eligible assignments" />
                <PermissionItem perm="RoleManagementPolicy.Read.Directory" desc="Read PIM policies" />
                <PermissionItem perm="User.Read.All" desc="Read user names" />
                <PermissionItem perm="Policy.Read.ConditionalAccess" desc="Read Auth Contexts" />
              </div>
            </div>

            {/* Enhanced Permissions */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400 mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Optional
              </h3>

              <div className="space-y-6">
                {/* Security Alerts Group */}
                <div className="border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-4 relative bg-zinc-50/50 dark:bg-zinc-800/50">
                  <span className="absolute -top-2.5 left-4 bg-white dark:bg-zinc-800 px-2 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Security Alerts
                  </span>
                  <PermissionItem
                    perm="RoleManagementAlert.Read.Directory"
                    desc="Required for Security Alerts"
                  />
                </div>

                {/* PIM for Groups Group */}
                <div className="border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-4 relative bg-zinc-50/50 dark:bg-zinc-800/50">
                  <span className="absolute -top-2.5 left-4 bg-white dark:bg-zinc-800 px-2 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Groups & PIM for Groups
                  </span>
                  <div className="space-y-3">
                    <PermissionItem
                      perm="PrivilegedAccess.Read.AzureADGroup"
                      desc="Required for PIM Groups visibility"
                    />
                    <PermissionItem
                      perm="Group.Read.All"
                      desc="Read group names & assignable groups"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PermissionItem({ perm, desc, highlight = false }: { perm: string; desc: string; highlight?: boolean }) {
  return (
    <div className={`text-sm ${highlight ? 'bg-white/50 dark:bg-black/20 p-2 rounded-lg -mx-2' : ''}`}>
      <code className="font-mono text-zinc-800 dark:text-zinc-200 block text-xs mb-0.5">
        {perm}
      </code>
      <p className="text-zinc-500 dark:text-zinc-400 text-xs">{desc}</p>
    </div>
  );
}
