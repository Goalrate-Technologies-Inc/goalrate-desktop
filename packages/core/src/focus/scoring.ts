/**
 * Focus Scoring
 * Enhanced focus scoring that builds on shared constants
 */

import type {
  FocusCandidate,
  FocusScoringResult,
  Priority,
} from '@goalrate-app/shared';
import {
  calculateDeadlineScore,
  calculateBlockingScore,
  calculatePriorityScore as calculatePriorityScoreBase,
  calculateStreakScore,
  calculateSprintScore,
} from '@goalrate-app/shared/constants';
import { calculateDaysUntilDue } from '../utils/dates';

/**
 * Scoring breakdown interface
 */
export interface FocusScoringBreakdown {
  deadline: number;
  blocking: number;
  priority: number;
  streak: number;
  sprint: number;
}

/**
 * Map Priority type to the expected format
 */
function mapPriority(priority: Priority): 'low' | 'medium' | 'high' | 'critical' {
  switch (priority) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
    default:
      return 'low';
  }
}

/**
 * Calculate streak status from last activity date
 *
 * @param lastActivity - Last activity date string
 * @param today - Reference date
 * @returns Object with streak information
 */
function calculateStreakStatus(
  lastActivity: string | undefined,
  today: Date
): { currentStreak: number; streakAtRisk: boolean } {
  if (!lastActivity) {
    return { currentStreak: 0, streakAtRisk: false };
  }

  const last = new Date(lastActivity);
  const daysSince = Math.floor(
    (today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)
  );

  // If activity within last day, consider it an active streak
  if (daysSince <= 1) {
    return { currentStreak: 1, streakAtRisk: false };
  }

  // If more than 7 days, streak is at risk
  if (daysSince > 7) {
    return { currentStreak: 1, streakAtRisk: true };
  }

  // Between 2-7 days - active but not at risk
  return { currentStreak: 1, streakAtRisk: false };
}

/**
 * Score a focus candidate
 *
 * Uses the scoring constants from @goalrate-app/shared to calculate
 * a total score and breakdown for a focus candidate.
 *
 * @param candidate - Focus candidate to score
 * @param today - Reference date for calculations
 * @returns FocusScoringResult with total score and breakdown
 */
export function scoreFocusCandidate(
  candidate: FocusCandidate,
  today: Date = new Date()
): FocusScoringResult {
  // Calculate days until due
  const daysUntilDue = calculateDaysUntilDue(candidate.dueDate, today);

  // Calculate streak status
  const { currentStreak, streakAtRisk } = calculateStreakStatus(
    candidate.lastActivity,
    today
  );

  // Calculate individual scores using shared functions
  const deadlineScore = calculateDeadlineScore(daysUntilDue);
  const blockingScore = calculateBlockingScore(
    candidate.blocks.length,
    candidate.blocksPeople
  );
  const priorityScore = calculatePriorityScoreBase(mapPriority(candidate.priority));
  const streakScore = calculateStreakScore(currentStreak, streakAtRisk);
  const sprintScore = calculateSprintScore(candidate.inCurrentSprint);

  // Calculate total
  const totalScore =
    deadlineScore + blockingScore + priorityScore + streakScore + sprintScore;

  return {
    candidateId: candidate.id,
    totalScore,
    breakdown: {
      deadline: deadlineScore,
      blocking: blockingScore,
      priority: priorityScore,
      streak: streakScore,
      sprint: sprintScore,
    },
    reason: '', // Will be filled by reasons.ts
  };
}

/**
 * Score multiple candidates and sort by total score
 *
 * @param candidates - Array of focus candidates
 * @param today - Reference date
 * @returns Array of scoring results sorted by total score (descending)
 */
export function scoreAllCandidates(
  candidates: FocusCandidate[],
  today: Date = new Date()
): FocusScoringResult[] {
  return candidates
    .map((candidate) => scoreFocusCandidate(candidate, today))
    .sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Get the top N candidates by score
 *
 * @param candidates - Array of focus candidates
 * @param limit - Maximum number of candidates to return
 * @param today - Reference date
 * @returns Top N scoring results
 */
export function getTopCandidates(
  candidates: FocusCandidate[],
  limit: number,
  today: Date = new Date()
): FocusScoringResult[] {
  return scoreAllCandidates(candidates, today).slice(0, limit);
}
