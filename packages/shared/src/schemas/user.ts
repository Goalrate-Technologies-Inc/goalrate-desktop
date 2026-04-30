/**
 * User Schemas
 * User, profile, subscription, and authentication schemas
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { z } from 'zod';
import { emailSchema } from './common';

// ============================================================================
// PLAN AND SUBSCRIPTION ENUMS
// ============================================================================

/**
 * Subscription plan identifier
 */
export const planIdSchema = z.enum(['free', 'plus', 'pro', 'premium']);

/**
 * Billing cycle options
 */
export const billingCycleSchema = z.enum(['monthly', 'yearly']);

/**
 * Subscription status
 */
export const subscriptionStatusSchema = z.enum(['active', 'canceled', 'expired', 'trial']);

// ============================================================================
// PLAN LIMITS SCHEMA
// ============================================================================

/**
 * Plan feature limits
 */
export const planLimitsSchema = z.object({
  max_goals: z.number().int().positive().optional(), // undefined means unlimited
  max_projects: z.number().int().positive().optional(),
  ai_task_generation: z.boolean(),
  advanced_analytics: z.boolean(),
  team_collaboration: z.boolean(),
  priority_support: z.boolean(),
  custom_integrations: z.boolean(),
  sso_security: z.boolean(),
  api_access: z.boolean(),
  white_label: z.boolean(),
});

// ============================================================================
// SUBSCRIPTION SCHEMAS
// ============================================================================

/**
 * User subscription information
 */
export const subscriptionSchema = z.object({
  user_id: z.string(),
  plan_id: planIdSchema,
  billing_cycle: billingCycleSchema,
  status: subscriptionStatusSchema,
  trial_ends_at: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * Subscription with limits
 */
export const subscriptionWithLimitsSchema = z.object({
  subscription: subscriptionSchema,
  limits: planLimitsSchema,
});

/**
 * Create subscription data
 */
export const createSubscriptionSchema = z.object({
  plan_id: z.string(),
  billing_cycle: z.string(),
});

/**
 * Update subscription data
 */
export const updateSubscriptionSchema = z.object({
  plan_id: z.string().optional(),
  billing_cycle: z.string().optional(),
  status: z.string().optional(),
});

/**
 * Plan configuration for pricing display
 */
export const planConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  price: z.object({
    monthly: z.number().nonnegative(),
    yearly: z.number().nonnegative(),
  }),
  stripe_price_ids: z
    .object({
      monthly: z.string().optional(),
      yearly: z.string().optional(),
    })
    .optional(),
  limits: planLimitsSchema,
});

// ============================================================================
// USER SCHEMAS
// ============================================================================

/**
 * Base user schema
 */
export const userSchema = z.object({
  id: z.string(),
  display_name: z.string().min(1).max(100),
  email: emailSchema,
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/,
    'Username can only contain letters, numbers, and underscores').optional(),
  avatar_url: z.string().url().optional(),
  bio: z.string().max(500).optional(),
  location: z.string().max(100).optional(),
  website: z.string().url().optional(),
  date_of_birth: z.string().optional(),
  is_admin: z.boolean().optional(),
  is_active: z.boolean().optional(),
  created_at: z.string(),
  last_login: z.string().optional(),
  subscription: subscriptionSchema.optional(),
  plan_limits: planLimitsSchema.optional(),
  dark_mode: z.boolean().optional(),
  story_points_earned: z.number().int().nonnegative().optional(),
});

/**
 * User profile with social fields
 */
export const userProfileSchema = userSchema.extend({
  followers_count: z.number().int().nonnegative(),
  following_count: z.number().int().nonnegative(),
  goals_count: z.number().int().nonnegative(),
  projects_count: z.number().int().nonnegative(),
  is_following: z.boolean().optional(),
  is_public: z.boolean(),
});

/**
 * Achievement schema
 */
export const achievementSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(100),
  description: z.string().max(500),
  icon: z.string(),
  earned_at: z.string(),
  category: z.string(),
});

/**
 * Extended profile user with persona-driven fields
 */
export const profileUserSchema = userSchema.extend({
  bio: z.string().max(500).optional(),
  followers_count: z.number().int().nonnegative(),
  following_count: z.number().int().nonnegative(),
  role: z.string().optional(),
  achievements_count: z.number().int().nonnegative().optional(),
  goals_completed: z.number().int().nonnegative().optional(),
  streak_days: z.number().int().nonnegative().optional(),
  team_invites_sent: z.number().int().nonnegative().optional(),
  mentorship_connections: z.number().int().nonnegative().optional(),
  motivation_points_given: z.number().int().nonnegative().optional(),
  motivation_points_received: z.number().int().nonnegative().optional(),
  community_impact_score: z.number().nonnegative().optional(),
  active_goals_count: z.number().int().nonnegative().optional(),
  recent_achievements: z.array(achievementSchema).optional(),
});

// ============================================================================
// FOLLOW SYSTEM SCHEMAS
// ============================================================================

/**
 * Follow status between users
 */
export const followStatusSchema = z.object({
  is_following: z.boolean(),
  is_followed_by: z.boolean(),
  is_mutual: z.boolean(),
  is_self: z.boolean(),
});

/**
 * Alternative follow status (service layer format)
 */
export const followStatusAltSchema = z.object({
  isFollowing: z.boolean(),
  isFollowedBy: z.boolean(),
  followedAt: z.string().optional(),
});

/**
 * User in follow lists
 */
export const followUserSchema = z.object({
  id: z.number().int(),
  display_name: z.string(),
  username: z.string(),
  avatar_url: z.string().url().optional(),
  bio: z.string().optional(),
  followers_count: z.number().int().nonnegative(),
  following_count: z.number().int().nonnegative(),
  is_following: z.boolean().optional(),
});

/**
 * Paginated users
 */
export const paginatedUsersSchema = z.object({
  users: z.array(followUserSchema),
  total_count: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  per_page: z.number().int().positive(),
  has_more: z.boolean(),
});

// ============================================================================
// USERNAME SCHEMAS
// ============================================================================

/**
 * Username lookup response
 */
export const usernameLookupResponseSchema = z.object({
  userId: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().url().optional(),
  bio: z.string().optional(),
  publicGoalsCount: z.number().int().nonnegative(),
  achievementsCount: z.number().int().nonnegative(),
  memberSince: z.string(),
  redirectFrom: z.string().optional(),
  permanent: z.boolean().optional(),
  isPrivate: z.boolean().optional(),
});

/**
 * Username validation response
 */
export const usernameValidationResponseSchema = z.object({
  valid: z.boolean(),
  available: z.boolean(),
  message: z.string().optional(),
});

// ============================================================================
// SETTINGS SCHEMAS
// ============================================================================

/**
 * User settings state
 */
export const settingsStateSchema = z.object({
  display_name: z.string().min(1).max(100),
  email: emailSchema,
  notifications: z.boolean(),
  emailUpdates: z.boolean(),
  darkMode: z.boolean(),
});

/**
 * Profile fields for editing
 */
export const profileFieldsSchema = z.object({
  bio: z.string().max(500),
  location: z.string().max(100),
  website: z.string().url().or(z.literal('')),
});

/**
 * Profile visibility setting
 */
export const profileVisibilitySchema = z.enum(['public', 'private']);

// ============================================================================
// AUTHENTICATION SCHEMAS
// ============================================================================

/**
 * Login request
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
});

/**
 * Registration request
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  display_name: z.string().min(1).max(100),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).optional(),
});

/**
 * Password change request
 */
export const passwordChangeSchema = z.object({
  current_password: z.string().min(8),
  new_password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
}).refine(
  (data) => data.current_password !== data.new_password,
  { message: 'New password must be different from current password', path: ['new_password'] }
);

// ============================================================================
// TYPE INFERENCE
// ============================================================================

export type PlanIdInput = z.infer<typeof planIdSchema>;
export type BillingCycleInput = z.infer<typeof billingCycleSchema>;
export type SubscriptionStatusInput = z.infer<typeof subscriptionStatusSchema>;
export type PlanLimitsInput = z.infer<typeof planLimitsSchema>;
export type SubscriptionInput = z.infer<typeof subscriptionSchema>;
export type UserInput = z.infer<typeof userSchema>;
export type UserProfileInput = z.infer<typeof userProfileSchema>;
export type AchievementInput = z.infer<typeof achievementSchema>;
export type FollowStatusInput = z.infer<typeof followStatusSchema>;
export type FollowUserInput = z.infer<typeof followUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
export type SettingsStateInput = z.infer<typeof settingsStateSchema>;
export type ProfileFieldsInput = z.infer<typeof profileFieldsSchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export function validateUser(data: unknown) {
  return userSchema.parse(data);
}

export function safeValidateUser(data: unknown) {
  return userSchema.safeParse(data);
}

export function validateLogin(data: unknown) {
  return loginSchema.parse(data);
}

export function safeValidateLogin(data: unknown) {
  return loginSchema.safeParse(data);
}

export function validateRegister(data: unknown) {
  return registerSchema.parse(data);
}

export function safeValidateRegister(data: unknown) {
  return registerSchema.safeParse(data);
}
