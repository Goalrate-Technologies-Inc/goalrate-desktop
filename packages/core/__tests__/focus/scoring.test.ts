import { describe, it, expect } from 'vitest';
import {
  scoreFocusCandidate,
  scoreAllCandidates,
  getTopCandidates,
} from '../../src/focus/scoring';
import type { FocusCandidate } from '@goalrate-app/shared';

describe('scoreFocusCandidate', () => {
  const today = new Date('2024-01-15');

  it('should return score with breakdown', () => {
    const candidate: FocusCandidate = {
      id: 'task-1',
      type: 'goal_task',
      title: 'Test Task',
      points: 3,
      priority: 'high',
      dueDate: '2024-01-16', // Due tomorrow
      blocks: [],
      blocksPeople: false,
      inCurrentSprint: true,
    };

    const result = scoreFocusCandidate(candidate, today);

    expect(result.candidateId).toBe('task-1');
    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.breakdown).toHaveProperty('deadline');
    expect(result.breakdown).toHaveProperty('blocking');
    expect(result.breakdown).toHaveProperty('priority');
    expect(result.breakdown).toHaveProperty('streak');
    expect(result.breakdown).toHaveProperty('sprint');
  });

  it('should give high score to overdue items', () => {
    const overdue: FocusCandidate = {
      id: 'task-1',
      type: 'goal_task',
      title: 'Overdue',
      points: 1,
      priority: 'medium',
      dueDate: '2024-01-10', // 5 days overdue
      blocks: [],
      blocksPeople: false,
      inCurrentSprint: false,
    };

    const result = scoreFocusCandidate(overdue, today);
    expect(result.breakdown.deadline).toBe(30); // Max deadline score
  });

  it('should give high score to blocking items', () => {
    const blocking: FocusCandidate = {
      id: 'task-1',
      type: 'goal_task',
      title: 'Blocking',
      points: 1,
      priority: 'medium',
      blocks: ['task-2', 'task-3'],
      blocksPeople: false,
      inCurrentSprint: false,
    };

    const result = scoreFocusCandidate(blocking, today);
    expect(result.breakdown.blocking).toBe(20); // Multiple blocking
  });

  it('should give highest blocking score for blocking people', () => {
    const blockingPeople: FocusCandidate = {
      id: 'task-1',
      type: 'goal_task',
      title: 'Blocking People',
      points: 1,
      priority: 'medium',
      blocks: ['task-2'],
      blocksPeople: true,
      inCurrentSprint: false,
    };

    const result = scoreFocusCandidate(blockingPeople, today);
    expect(result.breakdown.blocking).toBe(25); // Max blocking score
  });

  it('should give sprint bonus', () => {
    const inSprint: FocusCandidate = {
      id: 'task-1',
      type: 'goal_task',
      title: 'In Sprint',
      points: 1,
      priority: 'medium',
      blocks: [],
      blocksPeople: false,
      inCurrentSprint: true,
    };

    const notInSprint: FocusCandidate = {
      ...inSprint,
      id: 'task-2',
      inCurrentSprint: false,
    };

    const inSprintResult = scoreFocusCandidate(inSprint, today);
    const notInSprintResult = scoreFocusCandidate(notInSprint, today);

    expect(inSprintResult.breakdown.sprint).toBe(10);
    expect(notInSprintResult.breakdown.sprint).toBe(0);
    expect(inSprintResult.totalScore).toBeGreaterThan(notInSprintResult.totalScore);
  });

  it('should score priority correctly', () => {
    const priorities: Array<FocusCandidate['priority']> = [
      'critical',
      'high',
      'medium',
      'low',
    ];

    const scores = priorities.map((priority) =>
      scoreFocusCandidate(
        {
          id: `task-${priority}`,
          type: 'goal_task',
          title: `${priority} priority`,
          points: 1,
          priority,
          blocks: [],
          blocksPeople: false,
          inCurrentSprint: false,
        },
        today
      ).breakdown.priority
    );

    // Scores should be in descending order
    for (let i = 1; i < scores.length; i++) {
      const current = scores[i];
      const previous = scores[i - 1];
      if (current !== undefined && previous !== undefined) {
        expect(previous).toBeGreaterThan(current);
      }
    }
  });
});

describe('scoreAllCandidates', () => {
  const today = new Date('2024-01-15');

  const candidates: FocusCandidate[] = [
    {
      id: 'low',
      type: 'goal_task',
      title: 'Low',
      points: 1,
      priority: 'low',
      blocks: [],
      blocksPeople: false,
      inCurrentSprint: false,
    },
    {
      id: 'urgent',
      type: 'goal_task',
      title: 'Urgent',
      points: 2,
      priority: 'high',
      dueDate: '2024-01-15',
      blocks: [],
      blocksPeople: false,
      inCurrentSprint: true,
    },
    {
      id: 'medium',
      type: 'goal_task',
      title: 'Medium',
      points: 1,
      priority: 'medium',
      blocks: ['task-1'],
      blocksPeople: false,
      inCurrentSprint: false,
    },
  ];

  it('should score all candidates', () => {
    const results = scoreAllCandidates(candidates, today);
    expect(results.length).toBe(3);
  });

  it('should sort by total score descending', () => {
    const results = scoreAllCandidates(candidates, today);

    for (let i = 1; i < results.length; i++) {
      const current = results[i];
      const previous = results[i - 1];
      if (current !== undefined && previous !== undefined) {
        expect(previous.totalScore).toBeGreaterThanOrEqual(current.totalScore);
      }
    }
  });

  it('should put urgent item first', () => {
    const results = scoreAllCandidates(candidates, today);
    expect(results[0]?.candidateId).toBe('urgent');
  });
});

describe('getTopCandidates', () => {
  const today = new Date('2024-01-15');

  const candidates: FocusCandidate[] = Array.from({ length: 10 }, (_, i) => ({
    id: `task-${i}`,
    type: 'goal_task' as const,
    title: `Task ${i}`,
    points: 1,
    priority: 'medium' as const,
    blocks: [],
    blocksPeople: false,
    inCurrentSprint: false,
  }));

  it('should return limited results', () => {
    const results = getTopCandidates(candidates, 5, today);
    expect(results.length).toBe(5);
  });

  it('should return all if limit is higher than count', () => {
    const results = getTopCandidates(candidates, 20, today);
    expect(results.length).toBe(10);
  });

  it('should return top scoring items', () => {
    // Add a high priority item
    const withPriority = [
      ...candidates,
      {
        id: 'high-priority',
        type: 'goal_task' as const,
        title: 'High Priority',
        points: 3,
        priority: 'critical' as const,
        dueDate: '2024-01-15',
        blocks: [],
        blocksPeople: false,
        inCurrentSprint: true,
      },
    ];

    const results = getTopCandidates(withPriority, 3, today);
    expect(results[0]?.candidateId).toBe('high-priority');
  });
});
