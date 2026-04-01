/**
 * Subscriptions Client
 * Handles subscription management and Stripe integration
 */

import type { HttpClient } from '../http';
import type {
  Subscription,
  PlanLimits,
  PlanId,
  BillingCycle,
} from '@goalrate-app/shared';

/**
 * Plan pricing information
 */
export interface PlanPricing {
  id: PlanId;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  limits: PlanLimits;
  popular?: boolean;
}

/**
 * Checkout session response
 */
export interface CheckoutSession {
  url: string;
  sessionId: string;
}

/**
 * Billing portal response
 */
export interface BillingPortal {
  url: string;
}

/**
 * Subscription with invoice history
 */
export interface SubscriptionDetails extends Subscription {
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  invoices: Invoice[];
}

/**
 * Invoice information
 */
export interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: 'paid' | 'pending' | 'failed';
  created: string;
  pdfUrl?: string;
}

/**
 * Subscriptions client for subscription management
 */
export class SubscriptionClient {
  constructor(private http: HttpClient) {}

  // ========================================
  // Subscription Info
  // ========================================

  /**
   * Get the current user's subscription
   */
  async get(): Promise<Subscription | null> {
    const response = await this.http.get<Subscription | null>(
      '/api/subscriptions/me'
    );
    return response.data;
  }

  /**
   * Get subscription details with invoices
   */
  async getDetails(): Promise<SubscriptionDetails | null> {
    const response = await this.http.get<SubscriptionDetails | null>(
      '/api/subscriptions/me/details'
    );
    return response.data;
  }

  /**
   * Get the current user's plan limits
   */
  async getLimits(): Promise<PlanLimits> {
    const response = await this.http.get<PlanLimits>(
      '/api/subscriptions/me/limits'
    );
    return response.data;
  }

  /**
   * Check if a feature is available for the current plan
   */
  async checkFeature(feature: keyof PlanLimits): Promise<boolean> {
    const response = await this.http.get<{ available: boolean }>(
      `/api/subscriptions/me/features/${feature}`
    );
    return response.data.available;
  }

  // ========================================
  // Plan Information
  // ========================================

  /**
   * Get all available plans
   */
  async getPlans(): Promise<PlanPricing[]> {
    const response = await this.http.get<PlanPricing[]>('/api/plans');
    return response.data;
  }

  /**
   * Get a specific plan's details
   */
  async getPlan(planId: PlanId): Promise<PlanPricing> {
    const response = await this.http.get<PlanPricing>(`/api/plans/${planId}`);
    return response.data;
  }

  // ========================================
  // Checkout & Billing
  // ========================================

  /**
   * Create a checkout session for a new subscription
   */
  async createCheckoutSession(
    planId: PlanId,
    billingCycle: BillingCycle,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutSession> {
    const response = await this.http.post<CheckoutSession>(
      '/api/subscriptions/checkout',
      {
        planId,
        billingCycle,
        successUrl,
        cancelUrl,
      }
    );
    return response.data;
  }

  /**
   * Create a portal session for managing billing
   */
  async createPortalSession(returnUrl: string): Promise<BillingPortal> {
    const response = await this.http.post<BillingPortal>(
      '/api/subscriptions/portal',
      { returnUrl }
    );
    return response.data;
  }

  // ========================================
  // Subscription Management
  // ========================================

  /**
   * Change subscription plan
   */
  async changePlan(
    planId: PlanId,
    billingCycle?: BillingCycle
  ): Promise<Subscription> {
    const response = await this.http.post<Subscription>(
      '/api/subscriptions/change-plan',
      { planId, billingCycle }
    );
    return response.data;
  }

  /**
   * Cancel subscription at end of current period
   */
  async cancel(): Promise<Subscription> {
    const response = await this.http.post<Subscription>(
      '/api/subscriptions/cancel'
    );
    return response.data;
  }

  /**
   * Reactivate a canceled subscription
   */
  async reactivate(): Promise<Subscription> {
    const response = await this.http.post<Subscription>(
      '/api/subscriptions/reactivate'
    );
    return response.data;
  }

  // ========================================
  // Promo Codes
  // ========================================

  /**
   * Apply a promo code
   */
  async applyPromoCode(code: string): Promise<{
    discount: number;
    discountType: 'percent' | 'fixed';
    validUntil?: string;
  }> {
    const response = await this.http.post<{
      discount: number;
      discountType: 'percent' | 'fixed';
      validUntil?: string;
    }>('/api/subscriptions/promo-code', { code });
    return response.data;
  }

  /**
   * Remove applied promo code
   */
  async removePromoCode(): Promise<void> {
    await this.http.delete<void>('/api/subscriptions/promo-code');
  }
}
