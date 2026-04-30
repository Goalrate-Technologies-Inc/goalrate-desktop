/**
 * User Types
 * User, profile, and authentication related types
 */

// ============================================================================
// CORE USER TYPES
// ============================================================================

/**
 * Base user interface
 */
export interface User {
  id: string;
  display_name: string;
  email: string;
  username?: string;
  avatar_url?: string;
  bio?: string;
  location?: string;
  website?: string;
  date_of_birth?: string;
  is_admin?: boolean;
  is_active?: boolean;
  created_at: string;
  last_login?: string;
  subscription?: Subscription;
  plan_limits?: PlanLimits;
  dark_mode?: boolean;
  story_points_earned?: number;
}

/**
 * User profile with additional social fields
 */
export interface UserProfile extends User {
  followers_count: number;
  following_count: number;
  goals_count: number;
  projects_count: number;
  is_following?: boolean;
  is_public: boolean;
}

/**
 * Extended profile user interface with persona-driven fields
 */
export interface ProfileUser extends User {
  bio?: string;
  followers_count: number;
  following_count: number;
  // Enhanced persona-driven fields
  role?: string;
  achievements_count?: number;
  goals_completed?: number;
  streak_days?: number;
  team_invites_sent?: number;
  mentorship_connections?: number;
  // Social goal achievement fields
  motivation_points_given?: number;
  motivation_points_received?: number;
  community_impact_score?: number;
  active_goals_count?: number;
  recent_achievements?: Achievement[];
}

/**
 * User achievement
 */
export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  earned_at: string;
  category: string;
}

/**
 * Profile data with activities
 */
export interface ProfileData {
  user: ProfileUser;
  activities: Activity[];
}

// ============================================================================
// SUBSCRIPTION TYPES
// ============================================================================

/**
 * Subscription plan identifier
 */
export type PlanId = 'free' | 'plus' | 'pro' | 'premium';

/**
 * Billing cycle options
 */
export type BillingCycle = 'monthly' | 'yearly';

/**
 * Subscription status
 */
export type SubscriptionStatus = 'active' | 'canceled' | 'expired' | 'trial';

/**
 * User subscription information
 */
export interface Subscription {
  user_id: string;
  plan_id: PlanId;
  billing_cycle: BillingCycle;
  status: SubscriptionStatus;
  trial_ends_at?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Plan feature limits
 */
export interface PlanLimits {
  max_goals?: number; // undefined means unlimited
  max_projects?: number;
  ai_task_generation: boolean;
  advanced_analytics: boolean;
  team_collaboration: boolean;
  priority_support: boolean;
  custom_integrations: boolean;
  sso_security: boolean;
  api_access: boolean;
  white_label: boolean;
}

/**
 * Subscription with limits
 */
export interface SubscriptionWithLimits {
  subscription: Subscription;
  limits: PlanLimits;
}

/**
 * Data for creating a subscription
 */
export interface CreateSubscriptionData {
  plan_id: string;
  billing_cycle: string;
}

/**
 * Data for updating a subscription
 */
export interface UpdateSubscriptionData {
  plan_id?: string;
  billing_cycle?: string;
  status?: string;
}

/**
 * Plan configuration for pricing display
 */
export interface PlanConfig {
  id: string;
  name: string;
  description: string;
  price: {
    monthly: number;
    yearly: number;
  };
  stripe_price_ids?: {
    monthly?: string;
    yearly?: string;
  };
  limits: PlanLimits;
}

// ============================================================================
// FOLLOWING SYSTEM TYPES
// ============================================================================

/**
 * Follow status between users
 */
export interface FollowStatus {
  is_following: boolean;
  is_followed_by: boolean;
  is_mutual: boolean;
  is_self: boolean;
}

/**
 * Alternative follow status format (service layer)
 */
export interface FollowStatusAlt {
  isFollowing: boolean;
  isFollowedBy: boolean;
  followedAt?: string;
}

/**
 * User in follow lists
 */
export interface FollowUser {
  id: number;
  display_name: string;
  username: string;
  avatar_url?: string;
  bio?: string;
  followers_count: number;
  following_count: number;
  is_following?: boolean;
}

/**
 * Paginated list of users
 */
export interface PaginatedUsers {
  users: FollowUser[];
  total_count: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

// ============================================================================
// USERNAME TYPES
// ============================================================================

/**
 * Username lookup response
 */
export interface UsernameLookupResponse {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  publicGoalsCount: number;
  achievementsCount: number;
  memberSince: string;
  redirectFrom?: string;
  permanent?: boolean;
  isPrivate?: boolean;
}

/**
 * Username validation response
 */
export interface UsernameValidationResponse {
  valid: boolean;
  available: boolean;
  message?: string;
}

// ============================================================================
// SETTINGS TYPES
// ============================================================================

/**
 * User settings state
 */
export interface SettingsState {
  display_name: string;
  email: string;
  notifications: boolean;
  emailUpdates: boolean;
  darkMode: boolean;
}

/**
 * Profile fields for editing
 */
export interface ProfileFields {
  bio: string;
  location: string;
  website: string;
}

/**
 * Profile visibility setting
 */
export type ProfileVisibility = 'public' | 'private';

/**
 * Avatar upload state
 */
export interface AvatarUploadState {
  preview: string | null;
  file: File | null;
  isUploading: boolean;
  updateTimestamp: number;
}

/**
 * Date of birth state
 */
export interface DateOfBirthState {
  value: string;
  isLoading: boolean;
}

// Forward declaration for Activity (defined in activity.ts)
interface Activity {
  id: string;
  [key: string]: unknown;
}
