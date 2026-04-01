import { describe, expect, it } from 'vitest';
import {
  FOCUS_TELEMETRY_EVENT_NAMES,
  buildFocusDayClosedEvent,
  buildFocusListGeneratedEvent,
  buildFocusTaskClickedEvent,
  toFocusTelemetryRef,
} from '../focus';

describe('focus telemetry events', () => {
  it('builds FocusListGenerated events with normalized numeric fields', () => {
    const event = buildFocusListGeneratedEvent({
      date: '2026-03-01',
      capacitySP: 12.74,
      packedSP: -4,
      plannedCount: -2.9,
    });

    expect(event.name).toBe(FOCUS_TELEMETRY_EVENT_NAMES.LIST_GENERATED);
    expect(event.payload).toEqual({
      date: '2026-03-01',
      capacitySP: 12.5,
      packedSP: 0,
      plannedCount: 0,
    });
  });

  it('builds FocusDayClosed events with normalized numeric fields', () => {
    const event = buildFocusDayClosedEvent({
      date: '2026-03-01',
      completedCount: 3.9,
      completedSP: 4.24,
      allDone: true,
      nextCapacitySP: Number.NaN,
    });

    expect(event.name).toBe(FOCUS_TELEMETRY_EVENT_NAMES.DAY_CLOSED);
    expect(event.payload).toEqual({
      date: '2026-03-01',
      completedCount: 3,
      completedSP: 4,
      allDone: true,
      nextCapacitySP: 0,
    });
  });

  it('hashes task and vault identifiers by default for FocusTaskClicked', () => {
    const event = buildFocusTaskClickedEvent({
      date: '2026-03-01',
      taskId: 'task_123',
      vaultId: 'vault_456',
    });

    expect(event.name).toBe(FOCUS_TELEMETRY_EVENT_NAMES.TASK_CLICKED);
    expect(event.payload).toEqual({
      date: '2026-03-01',
      taskRef: toFocusTelemetryRef('task_123'),
      vaultRef: toFocusTelemetryRef('vault_456'),
    });
    expect('taskId' in event.payload).toBe(false);
    expect('vaultId' in event.payload).toBe(false);
  });

  it('can include raw identifiers for local debugging when explicitly enabled', () => {
    const event = buildFocusTaskClickedEvent(
      {
        date: '2026-03-01',
        taskId: 'task_123',
        vaultId: 'vault_456',
      },
      { includeRawIdentifiers: true }
    );

    expect(event.payload).toMatchObject({
      taskId: 'task_123',
      vaultId: 'vault_456',
      taskRef: toFocusTelemetryRef('task_123'),
      vaultRef: toFocusTelemetryRef('vault_456'),
    });
  });

  it('generates stable references for repeated values', () => {
    expect(toFocusTelemetryRef('task_123')).toBe(toFocusTelemetryRef('task_123'));
    expect(toFocusTelemetryRef('task_123')).not.toBe(toFocusTelemetryRef('task_124'));
  });
});
