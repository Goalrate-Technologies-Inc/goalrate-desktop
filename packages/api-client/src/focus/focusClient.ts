/**
 * Focus Client
 * Handles Today's Focus operations including focus days and velocity
 */

import type { HttpClient } from '../http';
import type {
  FocusDay,
  FocusCandidate,
  FocusVelocity,
  FocusItem,
} from '@goalrate-app/shared';

/**
 * Focus history query params
 */
export interface FocusHistoryParams {
  [key: string]: unknown;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

/**
 * Focus client for Today's Focus operations
 */
export class FocusClient {
  constructor(private http: HttpClient) {}

  // ========================================
  // Focus Day Operations
  // ========================================

  /**
   * Get focus day for a specific date
   */
  async getDay(date: string, vaultId?: string): Promise<FocusDay | null> {
    const response = await this.http.get<FocusDay | null>('/api/focus/day', {
      date,
      vaultId,
    });
    return response.data;
  }

  /**
   * Get today's focus day
   */
  async getToday(vaultId?: string): Promise<FocusDay | null> {
    const today = new Date().toISOString().split('T')[0];
    return this.getDay(today, vaultId);
  }

  /**
   * Save a focus day
   */
  async saveDay(focusDay: FocusDay, vaultId?: string): Promise<FocusDay> {
    const response = await this.http.post<FocusDay>('/api/focus/day', {
      ...focusDay,
      vaultId,
    });
    return response.data;
  }

  /**
   * Generate a new focus day from candidates
   */
  async generateDay(
    date: string,
    availableHours: number,
    vaultId?: string
  ): Promise<FocusDay> {
    const response = await this.http.post<FocusDay>('/api/focus/generate', {
      date,
      availableHours,
      vaultId,
    });
    return response.data;
  }

  // ========================================
  // Focus Item Operations
  // ========================================

  /**
   * Complete a focus item
   */
  async completeItem(
    date: string,
    itemSource: { type: string; id: string },
    vaultId?: string
  ): Promise<FocusDay> {
    const response = await this.http.post<FocusDay>('/api/focus/complete', {
      date,
      itemSource,
      vaultId,
    });
    return response.data;
  }

  /**
   * Defer a focus item to another date
   */
  async deferItem(
    date: string,
    itemSource: { type: string; id: string },
    deferTo: string,
    vaultId?: string
  ): Promise<FocusDay> {
    const response = await this.http.post<FocusDay>('/api/focus/defer', {
      date,
      itemSource,
      deferTo,
      vaultId,
    });
    return response.data;
  }

  /**
   * Remove an item from focus day
   */
  async removeItem(
    date: string,
    itemSource: { type: string; id: string },
    vaultId?: string
  ): Promise<FocusDay> {
    const response = await this.http.post<FocusDay>('/api/focus/remove', {
      date,
      itemSource,
      vaultId,
    });
    return response.data;
  }

  /**
   * Add an item to focus day
   */
  async addItem(
    date: string,
    item: FocusItem,
    vaultId?: string
  ): Promise<FocusDay> {
    const response = await this.http.post<FocusDay>('/api/focus/add', {
      date,
      item,
      vaultId,
    });
    return response.data;
  }

  // ========================================
  // Candidates & Analytics
  // ========================================

  /**
   * Get focus candidates for generating a focus day
   */
  async getCandidates(vaultId?: string): Promise<FocusCandidate[]> {
    const response = await this.http.get<FocusCandidate[]>(
      '/api/focus/candidates',
      { vaultId }
    );
    return response.data;
  }

  /**
   * Get focus history for a date range
   */
  async getHistory(params?: FocusHistoryParams): Promise<FocusDay[]> {
    const response = await this.http.get<FocusDay[]>(
      '/api/focus/history',
      params
    );
    return response.data;
  }

  /**
   * Get velocity metrics
   */
  async getVelocity(vaultId?: string): Promise<FocusVelocity> {
    const response = await this.http.get<FocusVelocity>('/api/focus/velocity', {
      vaultId,
    });
    return response.data;
  }

  // ========================================
  // Reflection & Summary
  // ========================================

  /**
   * Save reflection for a focus day
   */
  async saveReflection(
    date: string,
    mood?: 'great' | 'good' | 'okay' | 'low',
    reflection?: string,
    vaultId?: string
  ): Promise<FocusDay> {
    const response = await this.http.patch<FocusDay>('/api/focus/reflection', {
      date,
      mood,
      reflection,
      vaultId,
    });
    return response.data;
  }

  /**
   * Get end-of-day summary data
   */
  async getSummary(
    date: string,
    vaultId?: string
  ): Promise<{
    completedCount: number;
    completedPoints: number;
    deferredCount: number;
    completionPercentage: number;
    topCompletedItems: FocusItem[];
    insights: Array<{ type: string; message: string }>;
  }> {
    const response = await this.http.get<{
      completedCount: number;
      completedPoints: number;
      deferredCount: number;
      completionPercentage: number;
      topCompletedItems: FocusItem[];
      insights: Array<{ type: string; message: string }>;
    }>('/api/focus/summary', { date, vaultId });
    return response.data;
  }
}
