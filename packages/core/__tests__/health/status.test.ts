import { describe, it, expect } from 'vitest';
import {
  determineHealthStatus,
  getHealthStatusLabel,
  getHealthStatusDescription,
  getHealthStatusColor,
  getProgressDisplayInfo,
} from '../../src/health/status';
import type { HealthStatus } from '@goalrate-app/shared';

describe('determineHealthStatus', () => {
  const today = new Date('2024-01-15');

  it('should return completed for 100% progress', () => {
    expect(determineHealthStatus(100, 50, '2024-01-20', today)).toBe('completed');
  });

  it('should return overdue for past deadline with low progress', () => {
    // Deadline more than 7 days ago (Jan 5, today is Jan 15 = 10 days past)
    expect(determineHealthStatus(25, 100, '2024-01-05', today)).toBe('overdue');
  });

  it('should return overdueLight for recently past deadline', () => {
    expect(determineHealthStatus(75, 100, '2024-01-12', today)).toBe('overdueLight');
  });

  it('should return notStarted for 0 progress and early timeline', () => {
    expect(determineHealthStatus(0, 5, '2024-02-15', today)).toBe('notStarted');
  });

  it('should return aheadStrong for > 20% ahead', () => {
    expect(determineHealthStatus(75, 50, '2024-02-15', today)).toBe('aheadStrong');
  });

  it('should return ahead for 5-20% ahead', () => {
    expect(determineHealthStatus(60, 50, '2024-02-15', today)).toBe('ahead');
  });

  it('should return onTrack for within 5%', () => {
    expect(determineHealthStatus(48, 50, '2024-02-15', today)).toBe('onTrack');
  });

  it('should return onTrackSlipping for 5-15% behind', () => {
    expect(determineHealthStatus(40, 50, '2024-02-15', today)).toBe('onTrackSlipping');
  });

  it('should return atRiskLight for 15-30% behind', () => {
    expect(determineHealthStatus(25, 50, '2024-02-15', today)).toBe('atRiskLight');
  });

  it('should return atRisk for > 30% behind', () => {
    expect(determineHealthStatus(10, 50, '2024-02-15', today)).toBe('atRisk');
  });
});

describe('getHealthStatusLabel', () => {
  it('should return correct labels for each status', () => {
    expect(getHealthStatusLabel('completed', 100)).toBe('100% Complete');
    expect(getHealthStatusLabel('aheadStrong', 75)).toBe('75% - Way ahead!');
    expect(getHealthStatusLabel('ahead', 60)).toBe('60% - Ahead');
    expect(getHealthStatusLabel('onTrack', 50)).toBe('50% - On track');
    expect(getHealthStatusLabel('onTrackSlipping', 40)).toBe('40% - Slipping');
    expect(getHealthStatusLabel('atRiskLight', 30)).toBe('30% - At risk');
    expect(getHealthStatusLabel('atRisk', 20)).toBe('20% - High risk');
    expect(getHealthStatusLabel('overdueLight', 80)).toBe('80% - Just past due');
    expect(getHealthStatusLabel('overdue', 50)).toBe('50% - Overdue');
    expect(getHealthStatusLabel('notStarted', 0)).toBe('Not started');
  });
});

describe('getHealthStatusDescription', () => {
  it('should return descriptions for each status', () => {
    const statuses: HealthStatus[] = [
      'completed',
      'aheadStrong',
      'ahead',
      'onTrack',
      'onTrackSlipping',
      'atRiskLight',
      'atRisk',
      'overdueLight',
      'overdue',
      'notStarted',
    ];

    statuses.forEach((status) => {
      expect(getHealthStatusDescription(status)).toBeTruthy();
      expect(typeof getHealthStatusDescription(status)).toBe('string');
    });
  });
});

describe('getHealthStatusColor', () => {
  it('should return semantic color keys', () => {
    expect(getHealthStatusColor('completed')).toBe('success');
    expect(getHealthStatusColor('aheadStrong')).toBe('info');
    expect(getHealthStatusColor('ahead')).toBe('infoLight');
    expect(getHealthStatusColor('onTrack')).toBe('success');
    expect(getHealthStatusColor('onTrackSlipping')).toBe('warningLight');
    expect(getHealthStatusColor('atRiskLight')).toBe('warning');
    expect(getHealthStatusColor('atRisk')).toBe('dangerLight');
    expect(getHealthStatusColor('overdueLight')).toBe('dangerLight');
    expect(getHealthStatusColor('overdue')).toBe('danger');
    expect(getHealthStatusColor('notStarted')).toBe('neutral');
  });
});

describe('getProgressDisplayInfo', () => {
  const today = new Date('2024-01-15');

  it('should return complete info object', () => {
    const info = getProgressDisplayInfo(50, '2024-02-01', '2024-01-01', today);

    expect(info).toHaveProperty('healthStatus');
    expect(info).toHaveProperty('label');
    expect(info).toHaveProperty('expectedProgress');
    expect(info).toHaveProperty('actualProgress');
    expect(info).toHaveProperty('variance');
  });

  it('should clamp actual progress to 0-100', () => {
    const lowInfo = getProgressDisplayInfo(-10, '2024-02-01', '2024-01-01', today);
    expect(lowInfo.actualProgress).toBe(0);

    const highInfo = getProgressDisplayInfo(150, '2024-02-01', '2024-01-01', today);
    expect(highInfo.actualProgress).toBe(100);
  });

  it('should calculate variance correctly', () => {
    const info = getProgressDisplayInfo(75, '2024-02-01', '2024-01-01', today);
    expect(info.variance).toBe(info.actualProgress - info.expectedProgress);
  });

  it('should handle no deadline', () => {
    const info = getProgressDisplayInfo(50, null, null, today);
    expect(info.expectedProgress).toBe(0);
  });
});
