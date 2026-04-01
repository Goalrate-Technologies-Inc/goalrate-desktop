/**
 * Analytics Types
 * Analytics and reporting types for dashboards
 */

// ============================================================================
// USER ANALYTICS
// ============================================================================

/**
 * General analytics data
 */
export interface AnalyticsData {
  totalGoals: number;
  completedGoals: number;
  activeGoals: number;
  totalTasks: number;
  completedTasks: number;
  averageProgress: number;
  streakDays: number;
}

/**
 * Profile analytics data
 */
export interface ProfileAnalyticsData {
  goalsCompleted: number;
  tasksCompleted: number;
  currentStreak: number;
  longestStreak: number;
  averageCompletionTime: number;
}

/**
 * Social analytics data
 */
export interface SocialAnalyticsData {
  followersCount: number;
  followingCount: number;
  engagementRate: number;
  recentInteractions: number;
}

/**
 * User engagement data
 */
export interface UserEngagementData {
  dailyActiveTime: number;
  weeklyActiveTime: number;
  monthlyActiveTime: number;
  totalSessions: number;
}

// ============================================================================
// PRODUCTIVITY ANALYTICS
// ============================================================================

/**
 * Productivity metrics
 */
export interface ProductivityMetrics {
  dailyCompletionRate: number;
  weeklyCompletionRate: number;
  monthlyCompletionRate: number;
  averageTaskDuration: number;
  peakProductivityHours: number[];
  focusScore: number;
}

/**
 * Streak analytics
 */
export interface StreakAnalytics {
  currentStreak: number;
  longestStreak: number;
  streakHistory: StreakEntry[];
  riskOfBreaking: boolean;
  suggestedActions?: string[];
}

/**
 * Streak history entry
 */
export interface StreakEntry {
  date: string;
  maintained: boolean;
  pointsEarned: number;
  tasksCompleted: number;
}

// ============================================================================
// GOAL ANALYTICS
// ============================================================================

/**
 * Goal completion analytics
 */
export interface GoalAnalytics {
  totalGoals: number;
  activeGoals: number;
  completedGoals: number;
  archivedGoals: number;
  averageProgress: number;
  completionRate: number;
  goalsByCategory: Record<string, number>;
  goalsByPriority: Record<string, number>;
  upcomingDeadlines: GoalDeadline[];
}

/**
 * Goal deadline info
 */
export interface GoalDeadline {
  goalId: string;
  title: string;
  deadline: string;
  daysRemaining: number;
  progress: number;
  atRisk: boolean;
}

// ============================================================================
// PROJECT ANALYTICS
// ============================================================================

/**
 * Project analytics summary
 */
export interface ProjectAnalyticsSummary {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  averageVelocity: number;
  storiesCompletedThisWeek: number;
  pointsCompletedThisWeek: number;
  projectsByStatus: Record<string, number>;
}

/**
 * Team velocity analytics
 */
export interface TeamVelocityAnalytics {
  currentVelocity: number;
  averageVelocity: number;
  velocityTrend: 'increasing' | 'stable' | 'decreasing';
  velocityHistory: VelocityEntry[];
  predictedCapacity: number;
}

/**
 * Velocity history entry
 */
export interface VelocityEntry {
  sprintId: string;
  sprintName: string;
  plannedPoints: number;
  completedPoints: number;
  velocity: number;
  startDate: string;
  endDate: string;
}

// ============================================================================
// DASHBOARD ANALYTICS
// ============================================================================

/**
 * Dashboard overview data
 */
export interface DashboardOverview {
  user: {
    streakDays: number;
    pointsEarned: number;
    rank?: number;
  };
  goals: {
    active: number;
    completedThisWeek: number;
    upcomingDeadlines: number;
  };
  projects: {
    active: number;
    storiesInProgress: number;
    pointsCompletedThisWeek: number;
  };
  focus: {
    todayPlannedPoints: number;
    todayCompletedPoints: number;
    completionRate: number;
  };
}

/**
 * Activity heatmap data
 */
export interface ActivityHeatmap {
  data: HeatmapEntry[];
  totalDays: number;
  activeDays: number;
  currentStreak: number;
}

/**
 * Heatmap entry
 */
export interface HeatmapEntry {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4; // Activity intensity level
}

// ============================================================================
// EXPORT TYPES
// ============================================================================

/**
 * Analytics export format
 */
export type AnalyticsExportFormat = 'json' | 'csv' | 'pdf';

/**
 * Analytics export request
 */
export interface AnalyticsExportRequest {
  format: AnalyticsExportFormat;
  dateRange: {
    start: string;
    end: string;
  };
  includeGoals?: boolean;
  includeProjects?: boolean;
  includeActivity?: boolean;
  includeFocus?: boolean;
}

/**
 * Analytics export response
 */
export interface AnalyticsExportResponse {
  downloadUrl: string;
  expiresAt: string;
  format: AnalyticsExportFormat;
  generatedAt: string;
}
