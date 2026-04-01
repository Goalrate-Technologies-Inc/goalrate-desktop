/**
 * Focus Telemetry Events
 * Canonical event names and payload contracts for Desktop Focus List telemetry.
 */

import type { FocusDayStats, FocusListDay, FocusListNavigationClickInput } from '../../types/focus';

/**
 * Event names emitted by Desktop Focus List instrumentation.
 */
export const FOCUS_TELEMETRY_EVENT_NAMES = {
  FOCUS_LIST_GENERATED: 'FocusListGenerated',
  FOCUS_DAY_CLOSED: 'FocusDayClosed',
  FOCUS_TASK_CLICKED: 'FocusTaskClicked',
} as const;

/**
 * Union of all focus telemetry event names.
 */
export type FocusTelemetryEventName =
  (typeof FOCUS_TELEMETRY_EVENT_NAMES)[keyof typeof FOCUS_TELEMETRY_EVENT_NAMES];

/**
 * Payload for FocusListGenerated.
 */
export type FocusListGeneratedTelemetryPayload = Pick<
  FocusListDay,
  'date' | 'capacitySP' | 'packedSP' | 'plannedCount'
>;

/**
 * Payload for FocusDayClosed.
 */
export type FocusDayClosedTelemetryPayload = Pick<
  FocusDayStats,
  'date' | 'completedCount' | 'completedSP' | 'allDone'
> & {
  nextCapacitySP: number;
};

/**
 * Payload for FocusTaskClicked.
 */
export type FocusTaskClickedTelemetryPayload = FocusListNavigationClickInput;

/**
 * Map event name -> payload contract.
 */
export interface FocusTelemetryEventPayloadByName {
  [FOCUS_TELEMETRY_EVENT_NAMES.FOCUS_LIST_GENERATED]: FocusListGeneratedTelemetryPayload;
  [FOCUS_TELEMETRY_EVENT_NAMES.FOCUS_DAY_CLOSED]: FocusDayClosedTelemetryPayload;
  [FOCUS_TELEMETRY_EVENT_NAMES.FOCUS_TASK_CLICKED]: FocusTaskClickedTelemetryPayload;
}

/**
 * Typed focus telemetry envelope.
 */
export type FocusTelemetryEvent<TName extends FocusTelemetryEventName = FocusTelemetryEventName> = {
  name: TName;
  payload: FocusTelemetryEventPayloadByName[TName];
};

/**
 * Helper to build a typed telemetry event payload.
 */
export const createFocusTelemetryEvent = <TName extends FocusTelemetryEventName>(
  name: TName,
  payload: FocusTelemetryEventPayloadByName[TName]
): FocusTelemetryEvent<TName> => ({
  name,
  payload,
});
