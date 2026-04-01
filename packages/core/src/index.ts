/**
 * @goalrate-app/core
 * Core business logic package for Goalrate
 *
 * This package contains platform-agnostic domain algorithms for:
 * - Focus: Today's Focus generation and scoring
 * - Health: Progress tracking and health status
 * - Prioritization: Eisenhower Matrix classification
 * - Utils: Date calculation helpers
 */

// Re-export all modules
export * from './focus';
export * from './health';
export * from './prioritization';
export * from './utils';
