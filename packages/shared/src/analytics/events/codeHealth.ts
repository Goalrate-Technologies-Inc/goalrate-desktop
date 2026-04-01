/**
 * Code Health Telemetry Events
 * Canonical event names and payload contracts for CI/deploy code health telemetry.
 */

/**
 * Event names emitted by code health instrumentation.
 */
export const CODE_HEALTH_TELEMETRY_EVENT_NAMES = {
  CODE_HEALTH_LINT_DEBT: 'code_health.lint_debt',
  CODE_HEALTH_FLAKE_RATE: 'code_health.flake_rate',
  CODE_HEALTH_FAILURE_RATE: 'code_health.failure_rate',
  CODE_HEALTH_LEAD_TIME: 'code_health.lead_time',
  CODE_HEALTH_ROLLBACK_SIGNAL: 'code_health.rollback_signal',
} as const;

/**
 * Union of all code health telemetry event names.
 */
export type CodeHealthTelemetryEventName =
  (typeof CODE_HEALTH_TELEMETRY_EVENT_NAMES)[keyof typeof CODE_HEALTH_TELEMETRY_EVENT_NAMES];

type CodeHealthTelemetryStatus = 'healthy' | 'warning' | 'critical';

interface CodeHealthNumericMetricPayload {
  metric: string;
  value: number;
  unit: 'count' | 'ratio' | 'hours';
  window: 'current_run';
  threshold: number;
  status: CodeHealthTelemetryStatus;
}

interface CodeHealthBooleanMetricPayload {
  metric: 'rollback_signal';
  value: boolean;
  unit: 'boolean';
  window: 'current_run';
  threshold: false;
  status: CodeHealthTelemetryStatus;
}

export type CodeHealthLintDebtTelemetryPayload = CodeHealthNumericMetricPayload & {
  metric: 'lint_debt';
  unit: 'count';
};

export type CodeHealthFlakeRateTelemetryPayload = CodeHealthNumericMetricPayload & {
  metric: 'flake_rate';
  unit: 'ratio';
};

export type CodeHealthFailureRateTelemetryPayload = CodeHealthNumericMetricPayload & {
  metric: 'failure_rate';
  unit: 'ratio';
};

export type CodeHealthLeadTimeTelemetryPayload = CodeHealthNumericMetricPayload & {
  metric: 'lead_time_hours';
  unit: 'hours';
};

export type CodeHealthRollbackSignalTelemetryPayload = CodeHealthBooleanMetricPayload;

/**
 * Map event name -> payload contract.
 */
export interface CodeHealthTelemetryEventPayloadByName {
  [CODE_HEALTH_TELEMETRY_EVENT_NAMES.CODE_HEALTH_LINT_DEBT]: CodeHealthLintDebtTelemetryPayload;
  [CODE_HEALTH_TELEMETRY_EVENT_NAMES.CODE_HEALTH_FLAKE_RATE]: CodeHealthFlakeRateTelemetryPayload;
  [CODE_HEALTH_TELEMETRY_EVENT_NAMES.CODE_HEALTH_FAILURE_RATE]: CodeHealthFailureRateTelemetryPayload;
  [CODE_HEALTH_TELEMETRY_EVENT_NAMES.CODE_HEALTH_LEAD_TIME]: CodeHealthLeadTimeTelemetryPayload;
  [CODE_HEALTH_TELEMETRY_EVENT_NAMES.CODE_HEALTH_ROLLBACK_SIGNAL]: CodeHealthRollbackSignalTelemetryPayload;
}

/**
 * Typed code health telemetry envelope.
 */
export type CodeHealthTelemetryEvent<
  TName extends CodeHealthTelemetryEventName = CodeHealthTelemetryEventName,
> = {
  name: TName;
  payload: CodeHealthTelemetryEventPayloadByName[TName];
};

/**
 * Helper to build a typed telemetry event payload.
 */
export const createCodeHealthTelemetryEvent = <TName extends CodeHealthTelemetryEventName>(
  name: TName,
  payload: CodeHealthTelemetryEventPayloadByName[TName]
): CodeHealthTelemetryEvent<TName> => ({
  name,
  payload,
});
