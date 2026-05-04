import { describe, expect, it } from 'vitest';
import {
  CODE_HEALTH_TELEMETRY_EVENT_NAMES,
  createCodeHealthTelemetryEvent,
} from '@goalrate-app/shared/analytics';

describe('code health telemetry contracts', () => {
  it('builds envelopes that match the canonical emitted schema', () => {
    const payload = {
      emitted_at: '2026-03-25T00:00:00Z',
      environment: 'staging',
      source: 'ci',
      workflow: 'quality-gates',
      run_id: '123',
      run_attempt: '1',
      commit_sha: 'abc123',
      branch: 'main',
      payload: {
        metric: 'lint_debt',
        value: 2,
        unit: 'count',
        window: 'current_run',
        threshold: 1,
        status: 'warning',
      },
    };

    const event = createCodeHealthTelemetryEvent(
      CODE_HEALTH_TELEMETRY_EVENT_NAMES.CODE_HEALTH_LINT_DEBT,
      payload,
    );

    expect(event).toEqual({
      name: CODE_HEALTH_TELEMETRY_EVENT_NAMES.CODE_HEALTH_LINT_DEBT,
      payload,
    });
  });
});
