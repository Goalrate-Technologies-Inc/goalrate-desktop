/**
 * Social Client
 * Handles social features: following, profiles, activity feed
 */

import type { HttpClient } from '../http';
import type { PaginatedResponse, ListParams } from '../types';
import type {
  UserProfile,
  FollowUser,
  FollowStatus,
  Activity,
} from '@goalrate-app/shared';

/**
 * Activity feed filters
 */
export interface ActivityFeedParams extends ListParams {
  filter?: 'all' | 'goals' | 'projects' | 'achievements';
  userId?: string;
}

/**
 * User search params
 */
export interface UserSearchParams extends ListParams {
  query: string;
}

/**
 * Social client for social features
 */
export class SocialClient {
  constructor(private http: HttpClient) {}

  // ========================================
  // Profile Operations
  // ========================================

  /**
   * Get a user's public profile
   */
  async getProfile(userId: string): Promise<UserProfile> {
    const response = await this.http.get<UserProfile>(
      `/api/users/${userId}/profile`
    );
    return response.data;
  }

  /**
   * Get a user by username
   */
  async getProfileByUsername(username: string): Promise<UserProfile> {
    const response = await this.http.get<UserProfile>(
      `/api/users/username/${username}`
    );
    return response.data;
  }

  /**
   * Search for users
   */
  async searchUsers(params: UserSearchParams): Promise<PaginatedResponse<FollowUser>> {
    const response = await this.http.get<PaginatedResponse<FollowUser>>(
      '/api/users/search',
      params
    );
    return response.data;
  }

  // ========================================
  // Following Operations
  // ========================================

  /**
   * Follow a user
   */
  async follow(userId: string): Promise<void> {
    await this.http.post<void>(`/api/users/${userId}/follow`);
  }

  /**
   * Unfollow a user
   */
  async unfollow(userId: string): Promise<void> {
    await this.http.delete<void>(`/api/users/${userId}/follow`);
  }

  /**
   * Get follow status between current user and target user
   */
  async getFollowStatus(userId: string): Promise<FollowStatus> {
    const response = await this.http.get<FollowStatus>(
      `/api/users/${userId}/follow-status`
    );
    return response.data;
  }

  /**
   * Get a user's followers
   */
  async getFollowers(
    userId: string,
    params?: ListParams
  ): Promise<PaginatedResponse<FollowUser>> {
    const response = await this.http.get<PaginatedResponse<FollowUser>>(
      `/api/users/${userId}/followers`,
      params
    );
    return response.data;
  }

  /**
   * Get users that a user is following
   */
  async getFollowing(
    userId: string,
    params?: ListParams
  ): Promise<PaginatedResponse<FollowUser>> {
    const response = await this.http.get<PaginatedResponse<FollowUser>>(
      `/api/users/${userId}/following`,
      params
    );
    return response.data;
  }

  /**
   * Get mutual followers between current user and target user
   */
  async getMutualFollowers(
    userId: string,
    params?: ListParams
  ): Promise<PaginatedResponse<FollowUser>> {
    const response = await this.http.get<PaginatedResponse<FollowUser>>(
      `/api/users/${userId}/mutual-followers`,
      params
    );
    return response.data;
  }

  // ========================================
  // Activity Feed
  // ========================================

  /**
   * Get the home activity feed (from followed users)
   */
  async getFeed(params?: ActivityFeedParams): Promise<PaginatedResponse<Activity>> {
    const response = await this.http.get<PaginatedResponse<Activity>>(
      '/api/feed',
      params
    );
    return response.data;
  }

  /**
   * Get a user's activity history
   */
  async getUserActivity(
    userId: string,
    params?: ActivityFeedParams
  ): Promise<PaginatedResponse<Activity>> {
    const response = await this.http.get<PaginatedResponse<Activity>>(
      `/api/users/${userId}/activity`,
      params
    );
    return response.data;
  }

  /**
   * Get the current user's notifications
   */
  async getNotifications(
    params?: ListParams & { unreadOnly?: boolean }
  ): Promise<PaginatedResponse<Activity>> {
    const response = await this.http.get<PaginatedResponse<Activity>>(
      '/api/notifications',
      params
    );
    return response.data;
  }

  /**
   * Mark notifications as read
   */
  async markNotificationsRead(notificationIds: string[]): Promise<void> {
    await this.http.post<void>('/api/notifications/read', { notificationIds });
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsRead(): Promise<void> {
    await this.http.post<void>('/api/notifications/read-all');
  }

  // ========================================
  // Reactions & Interactions
  // ========================================

  /**
   * React to an activity
   */
  async reactToActivity(
    activityId: string,
    reaction: string
  ): Promise<Activity> {
    const response = await this.http.post<Activity>(
      `/api/activities/${activityId}/react`,
      { reaction }
    );
    return response.data;
  }

  /**
   * Remove reaction from an activity
   */
  async removeReaction(activityId: string): Promise<Activity> {
    const response = await this.http.delete<Activity>(
      `/api/activities/${activityId}/react`
    );
    return response.data;
  }

  /**
   * Comment on an activity
   */
  async commentOnActivity(
    activityId: string,
    content: string
  ): Promise<Activity> {
    const response = await this.http.post<Activity>(
      `/api/activities/${activityId}/comments`,
      { content }
    );
    return response.data;
  }

  /**
   * Delete a comment
   */
  async deleteComment(activityId: string, commentId: string): Promise<void> {
    await this.http.delete<void>(
      `/api/activities/${activityId}/comments/${commentId}`
    );
  }

  // ========================================
  // Suggested Users
  // ========================================

  /**
   * Get suggested users to follow
   */
  async getSuggestions(limit?: number): Promise<FollowUser[]> {
    const response = await this.http.get<FollowUser[]>(
      '/api/users/suggestions',
      { limit }
    );
    return response.data;
  }
}
