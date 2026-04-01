/**
 * Schemas Index
 * Barrel export for all Zod validation schemas
 *
 * Provides runtime validation for all shared types with
 * automatic TypeScript type inference.
 */

export const SCHEMAS_VERSION = '0.1.0';

// ============================================================================
// COMMON SCHEMAS
// ============================================================================
export {
  // Primitives
  uuidSchema,
  nonEmptyStringSchema,
  emailSchema,
  urlSchema,
  isoDateSchema,
  optionalDateSchema,

  // Priority schemas
  prioritySchema,
  extendedPrioritySchema,

  // Status schemas
  entityStatusSchema,
  projectStatusSchema,
  taskStatusSchema,
  boardStatusSchema,
  sprintStatusSchema,
  epicStatusSchema,

  // Visibility schemas
  visibilitySchema,
  projectVisibilitySchema,
  workspacePrivacyLevelSchema,

  // Timestamp schemas
  timestampsSchema,
  extendedTimestampsSchema,

  // Pagination schemas
  paginatedResponseSchema,
  paginatedListSchema,

  // Story points
  storyPointsSchema,
  optionalStoryPointsSchema,

  // Service response schemas
  userFriendlyErrorSchema,
  serviceResponseStatusSchema,
  serviceResponseSourceSchema,
  serviceResponseSchema,
  statusDisplayConfigSchema,

  // Type inference
  type PriorityInput,
  type ExtendedPriorityInput,
  type EntityStatusInput,
  type ProjectStatusInput,
  type TaskStatusInput,
  type BoardStatusInput,
  type SprintStatusInput,
  type EpicStatusInput,
  type VisibilityInput,
  type ProjectVisibilityInput,
  type TimestampsInput,
} from './common';

// ============================================================================
// USER SCHEMAS
// ============================================================================
export {
  // Enums
  planIdSchema,
  billingCycleSchema,
  subscriptionStatusSchema,

  // Plan limits
  planLimitsSchema,

  // Subscription schemas
  subscriptionSchema,
  subscriptionWithLimitsSchema,
  createSubscriptionSchema,
  updateSubscriptionSchema,
  planConfigSchema,

  // User schemas
  userSchema,
  userProfileSchema,
  achievementSchema,
  profileUserSchema,

  // Follow system schemas
  followStatusSchema,
  followStatusAltSchema,
  followUserSchema,
  paginatedUsersSchema,

  // Username schemas
  usernameLookupResponseSchema,
  usernameValidationResponseSchema,

  // Settings schemas
  settingsStateSchema,
  profileFieldsSchema,
  profileVisibilitySchema,

  // Authentication schemas
  loginSchema,
  registerSchema,
  passwordChangeSchema,

  // Type inference
  type PlanIdInput,
  type BillingCycleInput,
  type SubscriptionStatusInput,
  type PlanLimitsInput,
  type SubscriptionInput,
  type UserInput,
  type UserProfileInput,
  type AchievementInput,
  type FollowStatusInput,
  type FollowUserInput,
  type LoginInput,
  type RegisterInput,
  type PasswordChangeInput,
  type SettingsStateInput,
  type ProfileFieldsInput,

  // Validation helpers
  validateUser,
  safeValidateUser,
  validateLogin,
  safeValidateLogin,
  validateRegister,
  safeValidateRegister,
} from './user';

// ============================================================================
// GOAL SCHEMAS
// ============================================================================
export {
  // Column and subtask
  columnSchema,
  subtaskSchema,

  // SMART Goal schemas
  smartGoalSchema,
  smartGoalCreateSchema,
  smartGoalUpdateSchema,

  // Goal task schemas
  goalTaskSchema,
  goalTaskCreateSchema,
  goalTaskUpdateSchema,

  // Web app goal schemas
  goalSchema,
  goalExtendedSchema,
  activityNoteSchema,
  goalCreateSchema,
  goalUpdateSchema,

  // Daily task schemas
  taskSourceSchema,
  dailyTaskSchema,
  dailyTaskCreateSchema,
  dailyTaskUpdateSchema,

  // Type inference
  type ColumnInput,
  type SubtaskInput,
  type SmartGoalInput,
  type SmartGoalCreateInput,
  type SmartGoalUpdateInput,
  type GoalTaskInput,
  type GoalTaskCreateInput,
  type GoalInput,
  type GoalExtendedInput,
  type GoalCreateInput,
  type GoalUpdateInput,
  type DailyTaskInput,
  type DailyTaskCreateInput,

  // Validation helpers
  validateGoal,
  safeValidateGoal,
  validateGoalCreate,
  safeValidateGoalCreate,
  validateGoalUpdate,
  safeValidateGoalUpdate,
  validateSmartGoal,
  safeValidateSmartGoal,
  validateDailyTask,
  safeValidateDailyTask,
} from './goal';

// ============================================================================
// PROJECT SCHEMAS
// ============================================================================
export {
  // Board configuration
  boardMethodologySchema,
  boardColumnSchema,

  // Card schemas
  cardPrioritySchema,
  cardStatusSchema,
  assignedUserSchema,
  cardCommentSchema,
  cardReactionSchema,
  cardSchema,
  cardCreateSchema,
  cardUpdateSchema,

  // List schemas
  listSchema,
  listCreateSchema,

  // Board schemas
  boardSchema,
  boardCreateSchema,
  boardUpdateSchema,

  // Project schemas
  projectTypeSchema,
  projectSchema,
  projectCreateSchema,
  projectUpdateSchema,

  // Permission schemas
  projectRoleSchema,
  projectPermissionSchema,
  projectRoleDefinitionSchema,

  // Analytics schemas
  velocityTrendSchema,
  burndownPointSchema,
  projectAnalyticsSchema,

  // Filter schemas
  projectFiltersSchema,

  // Custom field schemas
  customFieldTypeSchema,
  projectCustomFieldSchema,
  projectSettingsSchema,

  // Type inference
  type BoardMethodologyInput,
  type BoardColumnInput,
  type CardInput,
  type CardCreateInput,
  type CardUpdateInput,
  type ListInput,
  type BoardInput,
  type BoardCreateInput,
  type BoardUpdateInput,
  type ProjectTypeInput,
  type ProjectInput,
  type ProjectCreateInput,
  type ProjectUpdateInput,
  type ProjectRoleInput,
  type ProjectPermissionInput,
  type ProjectAnalyticsInput,
  type ProjectFiltersInput,
  type ProjectSettingsInput,

  // Validation helpers
  validateProject,
  safeValidateProject,
  validateProjectCreate,
  safeValidateProjectCreate,
  validateProjectUpdate,
  safeValidateProjectUpdate,
  validateBoard,
  safeValidateBoard,
  validateCard,
  safeValidateCard,
} from './project';

// ============================================================================
// EPIC SCHEMAS
// ============================================================================
export {
  // Enums
  epicPrioritySchema,
  epicBusinessValueSchema,
  epicTypeSchema,
  epicHealthStatusSchema,

  // Risk schemas
  riskImpactSchema,
  riskProbabilitySchema,
  riskStatusSchema,
  epicRiskSchema,
  epicRiskCreateSchema,

  // Epic schemas
  epicSchema,
  epicCreateSchema,
  epicUpdateSchema,

  // Filter schemas
  epicSortBySchema,
  epicFiltersSchema,

  // Analytics schemas
  epicMilestoneSchema,
  epicAnalyticsSchema,

  // Activity schemas
  epicActivityActionSchema,
  epicActivitySchema,

  // Hierarchy
  epicHierarchySchema,

  // Type inference
  type EpicPriorityInput,
  type EpicBusinessValueInput,
  type EpicTypeInput,
  type EpicHealthStatusInput,
  type RiskImpactInput,
  type RiskProbabilityInput,
  type RiskStatusInput,
  type EpicRiskInput,
  type EpicRiskCreateInput,
  type EpicInput,
  type EpicCreateInput,
  type EpicUpdateInput,
  type EpicFiltersInput,
  type EpicMilestoneInput,
  type EpicAnalyticsInput,
  type EpicActivityInput,
  type EpicHierarchyInput,

  // Validation helpers
  validateEpic,
  safeValidateEpic,
  validateEpicCreate,
  safeValidateEpicCreate,
  validateEpicUpdate,
  safeValidateEpicUpdate,
  validateEpicRisk,
  safeValidateEpicRisk,
} from './epic';

// ============================================================================
// TASK SCHEMAS
// ============================================================================
export {
  // Enums
  taskTypeSchema,
  taskSeveritySchema,

  // Attachment and comment
  taskAttachmentSchema,
  taskCommentSchema,

  // Task schemas
  taskSchema,
  subTaskSchema,
  taskCreateSchema,
  taskUpdateSchema,

  // Hierarchy
  taskHierarchySchema,

  // Progress
  taskProgressSchema,

  // Legacy schemas
  legacyTaskPrioritySchema,
  legacyTaskTypeSchema,
  legacyTaskStatusSchema,
  legacyTaskSchema,

  // Type inference
  type TaskTypeInput,
  type TaskSeverityInput,
  type TaskAttachmentInput,
  type TaskCommentInput,
  type TaskInput,
  type SubTaskInput,
  type TaskCreateInput,
  type TaskUpdateInput,
  type TaskHierarchyInput,
  type TaskProgressInput,
  type LegacyTaskInput,

  // Validation helpers
  validateTask,
  safeValidateTask,
  validateTaskCreate,
  safeValidateTaskCreate,
  validateTaskUpdate,
  safeValidateTaskUpdate,
  validateSubTask,
  safeValidateSubTask,
  validateLegacyTask,
  safeValidateLegacyTask,
} from './task';

// ============================================================================
// SPRINT SCHEMAS
// ============================================================================
export {
  // Sprint schemas
  sprintSchema,
  sprintCreateSchema,
  sprintUpdateSchema,

  // Metrics
  burndownEntrySchema,

  // Retrospective schemas
  retrospectiveActionSchema,
  retrospectiveSchema,
  retrospectiveCreateSchema,

  // Analytics schemas
  sprintVelocitySchema,
  sprintSummarySchema,

  // Capacity schemas
  sprintTeamMemberSchema,
  sprintCapacitySchema,

  // Planning schemas
  sprintPlanningSessionSchema,
  sprintKeyResultSchema,
  sprintGoalTrackingSchema,

  // Enhanced sprint
  enhancedSprintSchema,

  // Type inference
  type SprintInput,
  type SprintCreateInput,
  type SprintUpdateInput,
  type BurndownEntryInput,
  type RetrospectiveActionInput,
  type RetrospectiveInput,
  type RetrospectiveCreateInput,
  type SprintVelocityInput,
  type SprintSummaryInput,
  type SprintTeamMemberInput,
  type SprintCapacityInput,
  type SprintPlanningSessionInput,
  type SprintKeyResultInput,
  type SprintGoalTrackingInput,
  type EnhancedSprintInput,

  // Validation helpers
  validateSprint,
  safeValidateSprint,
  validateSprintCreate,
  safeValidateSprintCreate,
  validateSprintUpdate,
  safeValidateSprintUpdate,
  validateRetrospective,
  safeValidateRetrospective,
  validateBurndownEntry,
  safeValidateBurndownEntry,
  validateEnhancedSprint,
  safeValidateEnhancedSprint,
} from './sprint';
