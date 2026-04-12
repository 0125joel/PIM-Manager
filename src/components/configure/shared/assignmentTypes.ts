import { Principal } from '@/types/shared.types';

// UI-friendly state interface for local form state
export interface LocalAssignmentState {
    members: Principal[];
    type: "eligible" | "active";
    duration: "permanent" | "bounded";
    startDate: string;
    endDate: string;
    justification: string;
    groupRole: "member" | "owner";
    scopeId: string;
}

// Type for existing assignments fetched from Graph
export interface ExistingAssignment {
    id: string;
    principalId: string;
    principalDisplayName: string;
    roleDefinitionId: string;
    roleDisplayName?: string;
    assignmentType: "eligible" | "active";
    memberType?: "Direct" | "Group";
    startDateTime?: string;
    endDateTime?: string;
    status?: string;
    directoryScopeId: string;
    scopeDisplayName?: string;
}

// Administrative Unit type
export interface AdminUnit {
    id: string;
    displayName: string;
    description?: string;
}

// Scope detail info (for display headers)
export interface ScopeDetail {
    id: string;
    displayName: string;
    description?: string;
}

// Scope info returned from useAssignmentData
export interface ScopeInfo {
    roleId?: string;
    roleName?: string;
    groupId?: string;
    groupName?: string;
}
