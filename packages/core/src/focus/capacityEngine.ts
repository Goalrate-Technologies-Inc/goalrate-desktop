/**
 * Desktop Focus List adaptive capacity engine.
 *
 * Applies the canonical rule set:
 * - Increase/decrease by configured percentages (default: +/-10%)
 * - Round to configured step size (default: 0.5 SP)
 * - Clamp to min/max bounds (default: 3..40 SP)
 */

import {
  DEFAULT_FOCUS_CAPACITY_PROFILE,
  type CapacityProfile,
  type FocusDayStats,
} from '@goalrate-app/shared';

type CapacityProfileConfig = Pick<
  CapacityProfile,
  'baselineSP' | 'minSP' | 'maxSP' | 'stepUpPct' | 'stepDownPct' | 'rounding'
>;

/**
 * Input payload for capacity adjustment.
 */
export interface CapacityEngineInput {
  currentCapacitySP: number;
  stats: Pick<FocusDayStats, 'allDone'>;
  profile?: Partial<CapacityProfileConfig>;
}

/**
 * Admin/debug controls for capacity behavior during development/testing.
 */
export interface CapacityDebugInput {
  /**
   * Reset to profile baseline and bypass adjustment for this calculation.
   */
  resetToBaseline?: boolean;
  /**
   * Freeze capacity (skip +/- adjustment) and return the frozen value.
   */
  freezeCapacity?: boolean;
  /**
   * Optional explicit frozen value. Falls back to current capacity when omitted.
   */
  frozenCapacitySP?: number;
}

/**
 * Input payload for debug-aware capacity adjustment.
 */
export interface CapacityEngineDebugControlsInput extends CapacityEngineInput {
  debug?: CapacityDebugInput;
}

/**
 * Normalized profile values used by the engine.
 */
export type CapacityEngineConfig = CapacityProfileConfig;

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function normalizePositive(value: number, fallback: number): number {
  if (!isFiniteNumber(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function normalizeNonNegative(value: number, fallback: number): number {
  if (!isFiniteNumber(value) || value < 0) {
    return fallback;
  }

  return value;
}

function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const valueAsString = value.toString();
  const decimalIndex = valueAsString.indexOf('.');
  if (decimalIndex === -1) {
    return 0;
  }

  return valueAsString.length - decimalIndex - 1;
}

/**
 * Round a value to the nearest increment while controlling floating precision.
 */
export function roundToIncrement(value: number, increment: number): number {
  const normalizedIncrement = normalizePositive(increment, 1);
  const rounded = Math.round(value / normalizedIncrement) * normalizedIncrement;

  return Number(rounded.toFixed(decimalPlaces(normalizedIncrement)));
}

/**
 * Clamp a numeric value to [min, max].
 */
export function clampCapacity(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalize profile settings and apply defaults.
 */
export function normalizeCapacityEngineConfig(
  profile: Partial<CapacityProfileConfig> = {}
): CapacityEngineConfig {
  const baselineSP = normalizePositive(
    profile.baselineSP ?? DEFAULT_FOCUS_CAPACITY_PROFILE.baselineSP,
    DEFAULT_FOCUS_CAPACITY_PROFILE.baselineSP
  );
  const minSP = normalizePositive(
    profile.minSP ?? DEFAULT_FOCUS_CAPACITY_PROFILE.minSP,
    DEFAULT_FOCUS_CAPACITY_PROFILE.minSP
  );
  const requestedMaxSP = normalizePositive(
    profile.maxSP ?? DEFAULT_FOCUS_CAPACITY_PROFILE.maxSP,
    DEFAULT_FOCUS_CAPACITY_PROFILE.maxSP
  );
  const maxSP = Math.max(minSP, requestedMaxSP);
  const stepUpPct = normalizeNonNegative(
    profile.stepUpPct ?? DEFAULT_FOCUS_CAPACITY_PROFILE.stepUpPct,
    DEFAULT_FOCUS_CAPACITY_PROFILE.stepUpPct
  );
  const stepDownPct = normalizeNonNegative(
    profile.stepDownPct ?? DEFAULT_FOCUS_CAPACITY_PROFILE.stepDownPct,
    DEFAULT_FOCUS_CAPACITY_PROFILE.stepDownPct
  );
  const rounding = normalizePositive(
    profile.rounding ?? DEFAULT_FOCUS_CAPACITY_PROFILE.rounding,
    DEFAULT_FOCUS_CAPACITY_PROFILE.rounding
  );

  return {
    baselineSP: clampCapacity(baselineSP, minSP, maxSP),
    minSP,
    maxSP,
    stepUpPct,
    stepDownPct,
    rounding,
  };
}

function resolveCurrentCapacitySP(
  currentCapacitySP: number,
  config: CapacityEngineConfig
): number {
  const resolvedCurrentCapacitySP = isFiniteNumber(currentCapacitySP)
    ? currentCapacitySP
    : config.baselineSP;

  return clampCapacity(resolvedCurrentCapacitySP, config.minSP, config.maxSP);
}

function applyCapacityAdjustment(
  currentCapacitySP: number,
  allDone: boolean,
  config: CapacityEngineConfig
): number {
  const multiplier = allDone ? 1 + config.stepUpPct : 1 - config.stepDownPct;
  const adjustedCapacitySP = currentCapacitySP * multiplier;
  const roundedCapacitySP = roundToIncrement(adjustedCapacitySP, config.rounding);

  return clampCapacity(roundedCapacitySP, config.minSP, config.maxSP);
}

/**
 * Reset the capacity to baseline (useful for admin/debug flows).
 */
export function resetCapacityToBaseline(
  profile: Partial<CapacityProfileConfig> = {}
): number {
  const config = normalizeCapacityEngineConfig(profile);
  return config.baselineSP;
}

/**
 * Compute next-day capacity according to Focus List adaptive rules.
 */
export function calculateNextCapacitySP(input: CapacityEngineInput): number {
  const config = normalizeCapacityEngineConfig(input.profile);
  const normalizedCurrentCapacitySP = resolveCurrentCapacitySP(
    input.currentCapacitySP,
    config
  );

  return applyCapacityAdjustment(
    normalizedCurrentCapacitySP,
    input.stats.allDone,
    config
  );
}

/**
 * Compute next-day capacity with optional admin/debug controls.
 */
export function calculateNextCapacitySPWithDebug(
  input: CapacityEngineDebugControlsInput
): number {
  const config = normalizeCapacityEngineConfig(input.profile);

  if (input.debug?.resetToBaseline) {
    return resetCapacityToBaseline(input.profile);
  }

  const normalizedCurrentCapacitySP = resolveCurrentCapacitySP(
    input.currentCapacitySP,
    config
  );

  if (input.debug?.freezeCapacity) {
    const frozenCapacitySP = isFiniteNumber(input.debug.frozenCapacitySP ?? Number.NaN)
      ? (input.debug.frozenCapacitySP as number)
      : normalizedCurrentCapacitySP;

    return clampCapacity(frozenCapacitySP, config.minSP, config.maxSP);
  }

  return applyCapacityAdjustment(
    normalizedCurrentCapacitySP,
    input.stats.allDone,
    config
  );
}
