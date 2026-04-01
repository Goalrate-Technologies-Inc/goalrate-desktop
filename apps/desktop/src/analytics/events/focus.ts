export const FOCUS_TELEMETRY_EVENT_NAMES = {
  LIST_GENERATED: 'FocusListGenerated',
  DAY_CLOSED: 'FocusDayClosed',
  TASK_CLICKED: 'FocusTaskClicked',
} as const;

export type FocusTelemetryEventName =
  (typeof FOCUS_TELEMETRY_EVENT_NAMES)[keyof typeof FOCUS_TELEMETRY_EVENT_NAMES];

export interface FocusListGeneratedEventPayload {
  date: string;
  capacitySP: number;
  packedSP: number;
  plannedCount: number;
}

export interface FocusDayClosedEventPayload {
  date: string;
  completedCount: number;
  completedSP: number;
  allDone: boolean;
  nextCapacitySP: number;
}

export interface FocusTaskClickedEventPayload {
  date: string;
  taskRef: string;
  vaultRef: string;
  taskId?: string;
  vaultId?: string;
}

export interface FocusTelemetryPayloadByEventName {
  FocusListGenerated: FocusListGeneratedEventPayload;
  FocusDayClosed: FocusDayClosedEventPayload;
  FocusTaskClicked: FocusTaskClickedEventPayload;
}

export type FocusTelemetryEvent<K extends FocusTelemetryEventName = FocusTelemetryEventName> = {
  name: K;
  payload: FocusTelemetryPayloadByEventName[K];
};

export interface FocusTaskClickedEventInput {
  date: string;
  taskId: string;
  vaultId: string;
}

export interface FocusTaskClickedEventOptions {
  includeRawIdentifiers?: boolean;
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function normalizeStoryPoints(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const roundedToHalfPoint = Math.round(value * 2) / 2;
  return Math.max(0, roundedToHalfPoint);
}

export function toFocusTelemetryRef(value: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return `h_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildFocusListGeneratedEvent(
  payload: FocusListGeneratedEventPayload
): FocusTelemetryEvent<'FocusListGenerated'> {
  return {
    name: FOCUS_TELEMETRY_EVENT_NAMES.LIST_GENERATED,
    payload: {
      date: payload.date,
      capacitySP: normalizeStoryPoints(payload.capacitySP),
      packedSP: normalizeStoryPoints(payload.packedSP),
      plannedCount: normalizeNonNegativeInteger(payload.plannedCount),
    },
  };
}

export function buildFocusDayClosedEvent(
  payload: FocusDayClosedEventPayload
): FocusTelemetryEvent<'FocusDayClosed'> {
  return {
    name: FOCUS_TELEMETRY_EVENT_NAMES.DAY_CLOSED,
    payload: {
      date: payload.date,
      completedCount: normalizeNonNegativeInteger(payload.completedCount),
      completedSP: normalizeStoryPoints(payload.completedSP),
      allDone: payload.allDone,
      nextCapacitySP: normalizeStoryPoints(payload.nextCapacitySP),
    },
  };
}

export function buildFocusTaskClickedEvent(
  payload: FocusTaskClickedEventInput,
  options: FocusTaskClickedEventOptions = {}
): FocusTelemetryEvent<'FocusTaskClicked'> {
  const telemetryPayload: FocusTaskClickedEventPayload = {
    date: payload.date,
    taskRef: toFocusTelemetryRef(payload.taskId),
    vaultRef: toFocusTelemetryRef(payload.vaultId),
  };

  if (options.includeRawIdentifiers) {
    telemetryPayload.taskId = payload.taskId;
    telemetryPayload.vaultId = payload.vaultId;
  }

  return {
    name: FOCUS_TELEMETRY_EVENT_NAMES.TASK_CLICKED,
    payload: telemetryPayload,
  };
}
