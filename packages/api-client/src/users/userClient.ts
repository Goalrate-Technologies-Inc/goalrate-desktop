/**
 * Users Client
 * Handles user profile and settings operations
 */

import type { HttpClient } from '../http';
import type { PaginatedResponse, ListParams } from '../types';
import type { User, UserProfile, SettingsState } from '@goalrate-app/shared';

/**
 * User settings update data
 */
export interface UserSettingsUpdate {
  display_name?: string;
  email?: string;
  notifications?: boolean;
  emailUpdates?: boolean;
  darkMode?: boolean;
}

/**
 * Profile visibility options
 */
export type ProfileVisibility = 'public' | 'private';

/**
 * Avatar upload result
 */
export interface AvatarUploadResult {
  avatarUrl: string;
  thumbnailUrl?: string;
}

/**
 * Users client for user operations
 */
export class UserClient {
  constructor(private http: HttpClient) {}

  // ========================================
  // User Lookup
  // ========================================

  /**
   * Get a user by ID
   */
  async get(userId: string): Promise<User> {
    const response = await this.http.get<User>(`/api/users/${userId}`);
    return response.data;
  }

  /**
   * Get a user by username
   */
  async getByUsername(username: string): Promise<User> {
    const response = await this.http.get<User>(
      `/api/users/username/${username}`
    );
    return response.data;
  }

  /**
   * Search users
   */
  async search(
    query: string,
    params?: ListParams
  ): Promise<PaginatedResponse<UserProfile>> {
    const response = await this.http.get<PaginatedResponse<UserProfile>>(
      '/api/users/search',
      { query, ...params }
    );
    return response.data;
  }

  // ========================================
  // Settings Operations
  // ========================================

  /**
   * Get current user's settings
   */
  async getSettings(): Promise<SettingsState> {
    const response = await this.http.get<SettingsState>('/api/users/me/settings');
    return response.data;
  }

  /**
   * Update current user's settings
   */
  async updateSettings(data: UserSettingsUpdate): Promise<SettingsState> {
    const response = await this.http.patch<SettingsState>(
      '/api/users/me/settings',
      data
    );
    return response.data;
  }

  // ========================================
  // Profile Operations
  // ========================================

  /**
   * Get current user's profile visibility
   */
  async getProfileVisibility(): Promise<ProfileVisibility> {
    const response = await this.http.get<{ visibility: ProfileVisibility }>(
      '/api/users/me/visibility'
    );
    return response.data.visibility;
  }

  /**
   * Set profile visibility
   */
  async setProfileVisibility(visibility: ProfileVisibility): Promise<void> {
    await this.http.patch<void>('/api/users/me/visibility', { visibility });
  }

  // ========================================
  // Avatar Operations
  // ========================================

  /**
   * Upload a new avatar
   */
  async uploadAvatar(file: File): Promise<AvatarUploadResult> {
    const formData = new FormData();
    formData.append('avatar', file);

    // Use fetch directly for FormData (HttpClient only supports JSON)
    const response = await fetch('/api/users/me/avatar', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to upload avatar');
    }

    return response.json();
  }

  /**
   * Delete current avatar
   */
  async deleteAvatar(): Promise<void> {
    await this.http.delete<void>('/api/users/me/avatar');
  }

  // ========================================
  // Username Operations
  // ========================================

  /**
   * Check if a username is available
   */
  async checkUsername(username: string): Promise<{
    available: boolean;
    valid: boolean;
    message?: string;
  }> {
    const response = await this.http.get<{
      available: boolean;
      valid: boolean;
      message?: string;
    }>('/api/users/check-username', { username });
    return response.data;
  }

  /**
   * Change username
   */
  async changeUsername(newUsername: string): Promise<User> {
    const response = await this.http.patch<User>('/api/users/me/username', {
      username: newUsername,
    });
    return response.data;
  }

  // ========================================
  // Account Operations
  // ========================================

  /**
   * Export user data (GDPR compliance)
   */
  async exportData(): Promise<{ downloadUrl: string; expiresAt: string }> {
    const response = await this.http.post<{
      downloadUrl: string;
      expiresAt: string;
    }>('/api/users/me/export');
    return response.data;
  }

  /**
   * Request account deletion
   */
  async requestDeletion(): Promise<{ confirmationRequired: boolean }> {
    const response = await this.http.post<{ confirmationRequired: boolean }>(
      '/api/users/me/request-deletion'
    );
    return response.data;
  }

  /**
   * Confirm account deletion
   */
  async confirmDeletion(confirmationToken: string): Promise<void> {
    await this.http.post<void>('/api/users/me/confirm-deletion', {
      token: confirmationToken,
    });
  }
}
