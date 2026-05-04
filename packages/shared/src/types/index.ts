/**
 * Types Index
 * Re-export all types for easy import
 */

// Common types
export type {
  Priority,
  ExtendedPriority,
  EntityStatus,
  ProjectStatus,
  TaskStatus,
  BoardStatus,
  SprintStatus,
  EpicStatus,
  Visibility,
  ProjectVisibility,
  WorkspacePrivacyLevel,
  Timestamps,
  ExtendedTimestamps,
  PaginatedResponse,
  PaginatedList,
  UserFriendlyError,
  ServiceResponse,
  ServiceError,
  StatusDisplayConfig,
} from "./common";

export {
  PROJECT_STATUSES,
  getProjectStatusConfig,
  isValidProjectStatus,
  getNextStatus,
} from "./common";

// Agenda types
export type {
  ScheduledTask,
  DailyPlan,
  Outcome,
  Deferral,
  CheckIn,
  ContextSnapshot,
  ChatRole,
  ChatMessage,
  DailyStats,
  RevisionTrigger,
  PlanRevision,
  UpdatePlanInput,
  CreateOutcomeInput,
  UpdateOutcomeInput,
  DeferTaskInput,
  CreateCheckInInput,
  SendChatInput,
  AgendaIpcCommandName,
} from "./agenda";

export { AGENDA_IPC_COMMANDS, AGENDA_AI_COMMANDS } from "./agenda";

export type {
  DeferralConfrontation,
  GeneratedPlanResponse,
  ChatReprioritizeResponse,
} from "./agenda";

// User types
export type {
  User,
  UserProfile,
  ProfileUser,
  Achievement,
  ProfileData,
  PlanId,
  BillingCycle,
  SubscriptionStatus,
  Subscription,
  PlanLimits,
  SubscriptionWithLimits,
  CreateSubscriptionData,
  UpdateSubscriptionData,
  PlanConfig,
  FollowStatus,
  FollowStatusAlt,
  FollowUser,
  PaginatedUsers,
  UsernameLookupResponse,
  UsernameValidationResponse,
  SettingsState,
  ProfileFields,
  ProfileVisibility,
  AvatarUploadState,
  DateOfBirthState,
} from "./user";

export type {
  BackendFeatureKey,
  BackendFeatureMatrix,
  LaunchPlanId,
  EntitlementKey,
  EntitlementMatrix,
  WorkspaceType,
  WorkspaceMemberRole,
  EntitlementPlanStatus,
  EntitlementPlanSource,
  EntitlementUser,
  EntitlementWorkspace,
  EntitlementEffectivePlan,
  EntitlementWorkspacePlan,
  WorkspaceFeatureMap,
  EntitlementWorkspaceMembership,
  EntitlementLimits,
  EntitlementResponse,
} from "./entitlements";

export {
  BACKEND_FEATURES,
  LAUNCH_PLANS,
  PLAN_ENTITLEMENTS,
  PLAN_BACKEND_FEATURES,
  ENTITLEMENT_FEATURE_KEYS,
  APP_STORE_LAUNCH_PLANS,
  APP_STORE_LAUNCH_ENTITLEMENTS,
  isPlanId,
  normalizePlanId,
  isLaunchPlanId,
  normalizeLaunchPlanId,
  entitlementsForPlan,
  hasEntitlement,
  planAllowsAi,
  backendFeaturesForPlan,
  backendFeatureForEntitlement,
  planHasBackendFeature,
  entitlementResponseHasFeature,
  entitlementResponseAllowsAi,
  entitlementPlanLabel,
} from "./entitlements";

// Goal types
export type {
  Column,
  Subtask,
  SmartGoal,
  GoalTask,
  Goal,
  GoalExtended,
  GoalCreate,
  GoalUpdate,
  DailyTask,
} from "./goal";

// Focus types
export type {
  FocusItemType,
  FocusCandidate,
  FocusItemStatus,
  FocusItem,
  FocusDay,
  FocusGeneratorOptions,
  FocusHistory,
  FocusVelocity,
  FocusScoringResult,
  FocusMood,
  EndOfDaySummaryData,
  SummaryInsight,
  // Velocity extended types
  VelocityPeriod,
  VelocityTrendDirection,
  VelocitySnapshot,
  VelocityTarget,
  VelocitySummary,
  VelocityExtended,
  FocusTaskStatus,
  FocusListEntryStatus,
  FocusTaskPriority,
  FocusTask,
  FocusVault,
  FocusListEntry,
  FocusListDay,
  CapacityProfile,
  FocusDayStats,
  FocusListGenerateInput,
  FocusListCloseDayInput,
  FocusListGetCurrentInput,
  FocusListNavigationClickInput,
  FocusListCloseDayResult,
  FocusListNavigationResult,
  FocusIpcCommandName,
  FocusIpcPayloadByCommand,
  FocusIpcResultByCommand,
} from "./focus";

export {
  DEFAULT_FOCUS_CAPACITY_PROFILE,
  FOCUS_ELIGIBLE_TASK_STATUSES,
  FOCUS_IPC_COMMANDS,
} from "./focus";

// Vault types
export type {
  VaultType,
  KeyDerivationAlgorithm,
  VaultEncryptionConfig,
  VaultConfig,
  Vault,
  VaultSettings,
  VaultColumn,
  VaultStructure,
  VaultFileMetadata,
  VaultCreate,
  VaultUpdate,
  VaultListItem,
  SyncStatus,
  VaultSyncState,
  VaultSyncConflict,
  VaultSearchResult,
  VaultStats,
} from "./vault";

// Project types
export type {
  BoardMethodology,
  BoardColumn,
  Board,
  List,
  Card,
  CardComment,
  CardReaction,
  BoardCreate,
  ProjectType,
  Project,
  ProjectCreate,
  ProjectUpdate,
  ProjectHierarchy,
  ProjectRole,
  ProjectPermission,
  ProjectRoleDefinition,
  VelocityTrend,
  BurndownPoint,
  ProjectAnalytics,
  WorkflowTransition,
  ProjectTemplate,
  ProjectFilters,
  ProjectCustomField,
  ProjectSettings,
} from "./project";

export { DEFAULT_BOARD_COLUMNS } from "./project";

// Epic types
export type {
  EpicPriority,
  EpicBusinessValue,
  EpicType,
  EpicHealthStatus,
  RiskImpact,
  RiskProbability,
  RiskStatus,
  EpicRisk,
  Epic,
  EpicCreate,
  EpicUpdate,
  EpicSortBy,
  EpicFilters,
  EpicMilestone,
  EpicAnalytics,
  EpicActivityAction,
  EpicActivity,
  EpicHierarchy,
} from "./epic";

// Task types
export type {
  TaskType,
  TaskSeverity,
  TaskAttachment,
  TaskComment,
  Task,
  SubTask,
  TaskCreate,
  TaskUpdate,
  TaskHierarchy,
  TaskProgress,
  LegacyTask,
} from "./task";

export { TASK_STATUSES, TASK_PRIORITIES, TASK_TYPES } from "./task";

// Sprint types
export type {
  Sprint,
  SprintCreate,
  SprintUpdate,
  BurndownEntry,
  Retrospective,
  RetrospectiveAction,
  SprintVelocity,
  SprintSummary,
  SprintCapacity,
  SprintTeamMember,
  SprintPlanningSession,
  SprintGoalTracking,
  SprintKeyResult,
  EnhancedSprint,
} from "./sprint";

// Workspace types
export type {
  WorkspaceRole,
  WorkspaceSettings,
  Workspace,
  WorkspaceCreate,
  WorkspaceUpdate,
  WorkspaceListResponse,
  WorkspaceMember,
  EmailInvitationCreate,
  WorkspaceMemberUpdate,
  WorkspaceMemberListResponse,
  WorkspaceInvitation,
  WorkspaceInvitationListResponse,
  WorkspaceInvitationAccept,
  WorkspaceContextState,
  WorkspaceContextActions,
  WorkspaceContext,
  PermissionCheckResult,
  WorkspacePermissions,
  WorkspaceStats,
  WorkspaceMemberActivity,
  WorkspaceLeaderboardEntry,
  WorkspaceNavItem,
  WorkspaceQuickAction,
  WorkspaceFilters,
  WorkspaceSearchResult,
} from "./workspace";

export {
  ROLE_HIERARCHY,
  hasRoleOrHigher,
  isWorkspaceDeleted,
  isInvitationExpired,
  isInvitationAccepted,
} from "./workspace";

// Activity types
export type {
  ActivityAction,
  ActivityTargetType,
  ActivityUserNote,
  ActivityDetails,
  ActivityReaction,
  ActivityComment,
  CommentData,
  Activity,
  CuratedActivity,
  ActivityFeedOptions,
  ActivityFilter,
  ActivityFeed,
  ActivityFeedServiceOptions,
  BackendActivityData,
  ActivityFeedService,
  SystemReports,
} from "./activity";

// WebSocket types
export { ConnectionState, MessageType, TOPICS } from "./websocket";

export type {
  WebSocketMessage,
  SubscribePayload,
  ActivityUpdatePayload,
  GoalUpdatePayload,
  ProjectUpdatePayload,
  PresencePayload,
  NotificationPayload,
  WebSocketConfig,
  WebSocketState,
  // Sync payload types
  SyncableEntityType,
  DataSyncPayload,
  SyncAckPayload,
  SyncRejectReason,
  SyncRejectPayload,
  EntityChangedPayload,
} from "./websocket";

// Analytics types
export type {
  AnalyticsData,
  ProfileAnalyticsData,
  SocialAnalyticsData,
  UserEngagementData,
  ProductivityMetrics,
  StreakAnalytics,
  StreakEntry,
  GoalAnalytics,
  GoalDeadline,
  ProjectAnalyticsSummary,
  TeamVelocityAnalytics,
  VelocityEntry,
  DashboardOverview,
  ActivityHeatmap,
  HeatmapEntry,
  AnalyticsExportFormat,
  AnalyticsExportRequest,
  AnalyticsExportResponse,
} from "./analytics";

// Health types
export type {
  HealthStatus,
  HealthStatusColorKey,
  ProgressDisplayInfo,
  HealthStatusInfo,
  GoalHealthStatusInfo,
  ProjectHealthStatusInfo,
  HealthStatusConfig,
} from "./health";

export { DEFAULT_HEALTH_CONFIG } from "./health";

// Prioritization types
export type {
  EisenhowerQuadrant,
  UrgencyLevel,
  ImportanceLevel,
  PrioritizableItem,
  ClassifiedItem,
  QuadrantMetadata,
  ClassifyOptions,
  UrgencyThresholds,
} from "./prioritization";

export {
  QUADRANT_METADATA,
  DEFAULT_URGENCY_THRESHOLDS,
  PRIORITY_IMPORTANCE_SCORES,
} from "./prioritization";
