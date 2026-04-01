/**
 * Workspace Types
 * Multi-tenant workspace system for organizing teams, projects, and goals
 * Supports role-based access control (RBAC) with 4 tiers: Owner > Admin > Member > Viewer
 */

import type { WorkspacePrivacyLevel, Timestamps } from './common';

// ============================================================================
// WORKSPACE ROLE TYPES
// ============================================================================

/**
 * Workspace member role hierarchy (higher = more permissions)
 */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

/**
 * Role hierarchy levels for permission comparisons
 */
export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

// ============================================================================
// WORKSPACE TYPES
// ============================================================================

/**
 * Workspace settings stored as JSONB
 */
export interface WorkspaceSettings {
  // Feature toggles
  enable_goals?: boolean;
  enable_projects?: boolean;
  enable_social_feed?: boolean;
  enable_gamification?: boolean;
  enable_ai_features?: boolean;

  // Default visibility preferences
  default_goal_visibility?: 'public' | 'private' | 'workspace';
  default_project_visibility?: 'public' | 'private' | 'workspace';

  // Collaboration settings
  allow_member_invites?: boolean;
  require_invitation_approval?: boolean;
  auto_accept_email_domain?: string;

  // Notification preferences
  notify_on_new_member?: boolean;
  notify_on_goal_created?: boolean;
  notify_on_milestone?: boolean;

  // Custom fields (extensible)
  [key: string]: unknown;
}

/**
 * Complete workspace information
 */
export interface Workspace extends Timestamps {
  id: string;
  name: string;
  slug: string;
  description?: string;
  avatar_url?: string;
  privacy_level: WorkspacePrivacyLevel;
  is_personal?: boolean; // True for user's personal workspace
  created_by: string;
  deleted_at?: string;
  settings?: WorkspaceSettings;

  // Computed/enriched fields (from API joins)
  member_count?: number;
  role?: WorkspaceRole; // Current user's role
}

/**
 * Workspace creation data
 */
export interface WorkspaceCreate {
  name: string;
  description?: string;
  privacy_level?: WorkspacePrivacyLevel;
  avatar_url?: string;
}

/**
 * Workspace update data
 */
export interface WorkspaceUpdate {
  name?: string;
  description?: string;
  avatar_url?: string;
  privacy_level?: WorkspacePrivacyLevel;
  settings?: Partial<WorkspaceSettings>;
}

/**
 * Workspace list response
 */
export interface WorkspaceListResponse {
  workspaces: Workspace[];
  total: number;
}

// ============================================================================
// WORKSPACE MEMBER TYPES
// ============================================================================

/**
 * Workspace member with user information
 */
export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  joined_at: string;
  invited_by?: string;

  // Enriched user information
  user_info?: {
    id: string;
    display_name: string;
    email: string;
    avatar_url?: string;
    username?: string;
  };
}

/**
 * Email invitation creation data
 */
export interface EmailInvitationCreate {
  email: string;
  role: WorkspaceRole;
  message?: string;
}

/**
 * Member role update data
 */
export interface WorkspaceMemberUpdate {
  role: WorkspaceRole;
}

/**
 * Member list response
 */
export interface WorkspaceMemberListResponse {
  members: WorkspaceMember[];
  total: number;
}

// ============================================================================
// WORKSPACE INVITATION TYPES
// ============================================================================

/**
 * Workspace invitation with token and expiration
 */
export interface WorkspaceInvitation {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  invited_by: string;
  token: string;
  expires_at: string;
  accepted_at?: string;
  created_at: string;

  // Enriched fields
  workspace_info?: {
    id: string;
    name: string;
    slug: string;
    avatar_url?: string;
    privacy_level: WorkspacePrivacyLevel;
  };
  inviter_info?: {
    id: string;
    display_name: string;
    avatar_url?: string;
  };
}

/**
 * Invitation list response
 */
export interface WorkspaceInvitationListResponse {
  invitations: WorkspaceInvitation[];
  total: number;
}

/**
 * Invitation acceptance data
 */
export interface WorkspaceInvitationAccept {
  token: string;
}

// ============================================================================
// WORKSPACE CONTEXT TYPES (React Context)
// ============================================================================

/**
 * Workspace context state
 */
export interface WorkspaceContextState {
  currentWorkspace: Workspace | null;
  workspaces: Workspace[];
  currentRole: WorkspaceRole | null;
  isLoading: boolean;
  isLoadingWorkspaces: boolean;
  error: string | null;
}

/**
 * Workspace context actions
 */
export interface WorkspaceContextActions {
  switchWorkspace: (workspaceId: string) => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  createWorkspace: (data: WorkspaceCreate) => Promise<Workspace>;
  updateWorkspace: (workspaceId: string, data: WorkspaceUpdate) => Promise<Workspace>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  inviteMember: (workspaceId: string, data: EmailInvitationCreate) => Promise<WorkspaceInvitation>;
  updateMemberRole: (
    workspaceId: string,
    userId: string,
    role: WorkspaceRole
  ) => Promise<WorkspaceMember>;
  removeMember: (workspaceId: string, userId: string) => Promise<void>;
  canUpdateWorkspace: () => boolean;
  canDeleteWorkspace: () => boolean;
  canInviteMembers: () => boolean;
  canCreateGoal: () => boolean;
  canCreateProject: () => boolean;
}

/**
 * Complete workspace context
 */
export interface WorkspaceContext extends WorkspaceContextState, WorkspaceContextActions {}

// ============================================================================
// PERMISSION TYPES
// ============================================================================

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requiredRole?: WorkspaceRole;
  currentRole?: WorkspaceRole;
}

/**
 * Workspace permissions map
 */
export interface WorkspacePermissions {
  // Workspace management
  canUpdateWorkspace: boolean;
  canDeleteWorkspace: boolean;
  canManageSettings: boolean;

  // Member management
  canInviteMembers: boolean;
  canRemoveMembers: boolean;
  canUpdateRoles: boolean;

  // Content creation
  canCreateGoals: boolean;
  canCreateProjects: boolean;
  canCreateEpics: boolean;
  canCreateStories: boolean;

  // Content management
  canEditAnyGoal: boolean;
  canEditOwnGoal: boolean;
  canDeleteAnyGoal: boolean;
  canDeleteOwnGoal: boolean;

  // Social features
  canPostToFeed: boolean;
  canModerateContent: boolean;
  canManageLeaderboard: boolean;
}

// ============================================================================
// WORKSPACE ANALYTICS TYPES
// ============================================================================

/**
 * Workspace activity statistics
 */
export interface WorkspaceStats {
  member_count: number;
  active_members_30d: number;
  total_goals: number;
  completed_goals: number;
  total_projects: number;
  active_projects: number;
  total_epics: number;
  total_stories: number;
  total_tasks: number;
  workspace_velocity: number;
  goal_completion_rate: number;
  average_goal_progress: number;
  created_at: string;
  last_activity_at?: string;
}

/**
 * Workspace member activity summary
 */
export interface WorkspaceMemberActivity {
  user_id: string;
  user_display_name: string;
  user_avatar?: string;
  goals_created: number;
  goals_completed: number;
  projects_created: number;
  tasks_completed: number;
  feed_posts: number;
  last_active_at: string;
  activity_score: number;
}

/**
 * Workspace leaderboard entry
 */
export interface WorkspaceLeaderboardEntry {
  rank: number;
  user_id: string;
  user_display_name: string;
  user_avatar?: string;
  score: number;
  goals_completed: number;
  projects_completed: number;
  streak_days: number;
  goalcoins_earned: number;
}

/**
 * Workspace navigation item
 */
export interface WorkspaceNavItem {
  id: string;
  name: string;
  slug: string;
  avatar_url?: string;
  role: WorkspaceRole;
  member_count: number;
  unread_count?: number;
  is_active: boolean;
}

/**
 * Workspace quick action
 */
export interface WorkspaceQuickAction {
  id: string;
  label: string;
  icon: string;
  action: () => void;
  requiresPermission?: boolean;
  permissionCheck?: () => boolean;
}

// ============================================================================
// WORKSPACE FILTER TYPES
// ============================================================================

/**
 * Workspace filter options
 */
export interface WorkspaceFilters {
  search?: string;
  privacy_level?: WorkspacePrivacyLevel;
  my_role?: WorkspaceRole;
  sort_by?: 'name' | 'created_at' | 'updated_at' | 'member_count';
  sort_order?: 'asc' | 'desc';
}

/**
 * Workspace search result
 */
export interface WorkspaceSearchResult extends Workspace {
  relevance_score: number;
  match_fields: string[];
  highlight?: {
    name?: string;
    description?: string;
  };
}

// ============================================================================
// TYPE GUARDS & VALIDATION
// ============================================================================

/**
 * Check if user has specific role or higher
 */
export function hasRoleOrHigher(
  userRole: WorkspaceRole | null,
  requiredRole: WorkspaceRole
): boolean {
  if (!userRole) {
    return false;
  }
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Check if workspace is deleted
 */
export function isWorkspaceDeleted(workspace: Workspace): boolean {
  return !!workspace.deleted_at;
}

/**
 * Check if invitation is expired
 */
export function isInvitationExpired(invitation: WorkspaceInvitation): boolean {
  return new Date(invitation.expires_at) < new Date();
}

/**
 * Check if invitation is accepted
 */
export function isInvitationAccepted(invitation: WorkspaceInvitation): boolean {
  return !!invitation.accepted_at;
}
