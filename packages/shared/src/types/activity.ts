/**
 * Activity Types
 * Activity feed and social interaction types
 */

import type { User } from './user';

// ============================================================================
// ACTIVITY ACTION TYPES
// ============================================================================

/**
 * Activity action types
 */
export type ActivityAction =
  | 'created'
  | 'updated'
  | 'completed'
  | 'deleted'
  | 'joined'
  | 'shared'
  | string;

/**
 * Activity target types
 */
export type ActivityTargetType =
  | 'goal'
  | 'project'
  | 'epic'
  | 'task'
  | 'board'
  | 'card'
  | string;

// ============================================================================
// ACTIVITY DETAILS
// ============================================================================

/**
 * User-added content for activity feed posts
 */
export interface ActivityUserNote {
  text: string;
  media_urls?: string[];
  created_at?: string;
}

/**
 * Activity details/metadata
 */
export interface ActivityDetails {
  title?: string;
  card_title?: string;
  board_title?: string;
  project_name?: string;
  epic_title?: string;
  task_title?: string;
  category?: string;
  project_type?: string;
  project_id?: string;
  epic_id?: string;
  emoji?: string;
  message?: string;
  milestone?: string;
  user_note?: ActivityUserNote;
  // Privacy information
  is_private?: boolean;
  owner_id?: string;
  members?: string[];
  can_user_access?: boolean;
  [key: string]: unknown;
}

// ============================================================================
// ACTIVITY REACTIONS AND COMMENTS
// ============================================================================

/**
 * Activity reaction
 */
export interface ActivityReaction {
  id: string;
  user_id: string;
  user_display_name: string;
  user_avatar?: string;
  type: string;
  created_at: string;
}

/**
 * Activity comment
 */
export interface ActivityComment {
  id: string;
  user_id: string;
  user_display_name: string;
  user_avatar?: string;
  content: string;
  created_at: string;
}

/**
 * Comment data structure for API responses
 */
export interface CommentData {
  id: string | number;
  user?: { avatar_url?: string };
  user_info?: { name?: string; username?: string; id?: string | number };
  user_id?: string;
  created_at: string;
  content: string;
  is_edited?: boolean;
}

// ============================================================================
// ACTIVITY TYPES
// ============================================================================

/**
 * Activity feed item
 */
export interface Activity {
  id: string;
  user_id: string;
  action: ActivityAction;
  target_type: ActivityTargetType;
  target_id: string;
  details: ActivityDetails;
  created_at: string;
  user?: {
    id: string;
    display_name: string;
    avatar_url?: string;
  };
  // New backend format
  actor_info?: {
    id: string;
    email: string;
    username: string;
    display_name: string;
    avatar_url?: string;
  };
  // Social features
  reactions?: ActivityReaction[];
  comments?: ActivityComment[];
  reaction_count?: number;
  comment_count?: number;
  user_reaction?: string | null;
}

/**
 * Curated activity with social context
 */
export interface CuratedActivity extends Activity {
  is_from_following: boolean;
  shared_by?: User;
}

// ============================================================================
// ACTIVITY FEED TYPES
// ============================================================================

/**
 * Activity feed options
 */
export interface ActivityFeedOptions {
  workspace_id?: string;
  page?: number;
  per_page?: number;
  filter_type?: 'following' | 'discover' | 'all';
  activity_types?: string[];
  time_range?: 'today' | 'week' | 'month' | 'all';
  actor_user_id?: string; // Filter by specific user
  entity_id?: string; // Filter by entity
  project_id?: string; // Filter by project hierarchy
}

/**
 * Activity filter configuration
 */
export interface ActivityFilter {
  type: 'following' | 'discover' | 'all';
  activity_types: string[];
  time_range: 'today' | 'week' | 'month' | 'all';
  search_query?: string;
}

/**
 * Activity feed response
 */
export interface ActivityFeed {
  activities: Activity[];
  total_count: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

// ============================================================================
// SERVICE LAYER ACTIVITY TYPES
// ============================================================================

/**
 * Activity feed options (service layer format)
 */
export interface ActivityFeedServiceOptions {
  page?: number;
  pageSize?: number;
  filter?: 'all' | 'goals' | 'projects' | 'social';
  userId?: string;
}

/**
 * Backend activity data format
 */
export interface BackendActivityData {
  id: string;
  user_id: string;
  activity_type: string;
  entity_type: string;
  entity_id: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/**
 * Activity feed (service layer format)
 */
export interface ActivityFeedService {
  items: Activity[];
  total: number;
  page: number;
  hasMore: boolean;
}

// ============================================================================
// SYSTEM REPORTS
// ============================================================================

/**
 * System-wide reports
 */
export interface SystemReports {
  total_users: number;
  total_boards: number;
  total_cards: number;
  total_activities: number;
  recent_activities: Activity[];
}
