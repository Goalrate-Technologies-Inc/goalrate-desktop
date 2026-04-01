/**
 * Authentication Client
 * Handles login, registration, token management, and user profile
 */

import type { HttpClient } from '../http';
import type { User } from '@goalrate-app/shared';

/**
 * Login credentials
 */
export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * Registration data
 */
export interface RegisterData {
  email: string;
  password: string;
  display_name: string;
  username?: string;
}

/**
 * Authentication response with tokens
 */
export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

/**
 * Token refresh response
 */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Password reset request
 */
export interface PasswordResetRequest {
  email: string;
}

/**
 * Password reset confirmation
 */
export interface PasswordResetConfirm {
  token: string;
  new_password: string;
}

/**
 * Password change request
 */
export interface PasswordChangeRequest {
  current_password: string;
  new_password: string;
}

/**
 * Profile update data
 */
export interface ProfileUpdateData {
  display_name?: string;
  username?: string;
  bio?: string;
  location?: string;
  website?: string;
  avatar_url?: string;
  dark_mode?: boolean;
}

/**
 * Authentication client for login, registration, and token management
 */
export class AuthClient {
  constructor(private http: HttpClient) {}

  /**
   * Log in with email and password
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await this.http.post<AuthResponse>(
      '/api/auth/login',
      credentials
    );
    return response.data;
  }

  /**
   * Register a new user
   */
  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await this.http.post<AuthResponse>(
      '/api/auth/register',
      data
    );
    return response.data;
  }

  /**
   * Refresh the access token using a refresh token
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const response = await this.http.post<TokenResponse>(
      '/api/auth/refresh',
      { refresh_token: refreshToken }
    );
    return response.data;
  }

  /**
   * Log out the current user
   */
  async logout(): Promise<void> {
    await this.http.post<void>('/api/auth/logout');
  }

  /**
   * Get the current authenticated user
   */
  async getMe(): Promise<User> {
    const response = await this.http.get<User>('/api/auth/me');
    return response.data;
  }

  /**
   * Update the current user's profile
   */
  async updateProfile(data: ProfileUpdateData): Promise<User> {
    const response = await this.http.patch<User>('/api/auth/me', data);
    return response.data;
  }

  /**
   * Request a password reset email
   */
  async requestPasswordReset(email: string): Promise<void> {
    await this.http.post<void>('/api/auth/password-reset', { email });
  }

  /**
   * Confirm password reset with token
   */
  async confirmPasswordReset(data: PasswordResetConfirm): Promise<void> {
    await this.http.post<void>('/api/auth/password-reset/confirm', data);
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(data: PasswordChangeRequest): Promise<void> {
    await this.http.post<void>('/api/auth/change-password', data);
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<void> {
    await this.http.post<void>('/api/auth/verify-email', { token });
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(): Promise<void> {
    await this.http.post<void>('/api/auth/resend-verification');
  }

  /**
   * Delete the current user's account
   */
  async deleteAccount(_password: string): Promise<void> {
    // Note: password would be sent in the body for verification
    await this.http.delete<void>('/api/auth/me');
  }
}
