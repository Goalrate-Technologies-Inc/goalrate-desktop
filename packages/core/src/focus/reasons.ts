/**
 * Reason Generation
 * Generate human-readable explanations for why items were selected
 */

import type { FocusCandidate } from '@goalrate-app/shared';
import type { FocusScoringBreakdown } from './scoring';
import { calculateDaysUntilDue } from '../utils/dates';

/**
 * Generate a human-readable reason for why a candidate was selected
 *
 * The reason explains the key factors that contributed to the item's
 * high priority score, helping users understand why they should
 * focus on it.
 *
 * @param candidate - The focus candidate
 * @param breakdown - Scoring breakdown
 * @param today - Reference date
 * @returns Human-readable reason string
 */
export function generateFocusReason(
  candidate: FocusCandidate,
  breakdown: FocusScoringBreakdown,
  today: Date = new Date()
): string {
  const reasons: string[] = [];

  // Deadline-based reasons
  if (candidate.dueDate) {
    const daysUntil = calculateDaysUntilDue(candidate.dueDate, today);
    if (daysUntil !== null) {
      if (daysUntil < 0) {
        reasons.push('Overdue');
      } else if (daysUntil === 0) {
        reasons.push('Due today');
      } else if (daysUntil === 1) {
        reasons.push('Due tomorrow');
      } else if (daysUntil <= 7) {
        reasons.push(`Due in ${daysUntil} days`);
      }
    }
  }

  // Blocking-based reasons
  if (candidate.blocksPeople) {
    reasons.push('Blocking teammates');
  } else if (candidate.blocks.length > 1) {
    reasons.push(`Blocking ${candidate.blocks.length} items`);
  } else if (candidate.blocks.length === 1) {
    reasons.push('Blocking another task');
  }

  // Sprint-based reasons
  if (candidate.inCurrentSprint) {
    reasons.push('Sprint commitment');
  }

  // Priority-based reasons
  if (candidate.priority === 'critical') {
    reasons.push('Critical priority');
  } else if (candidate.priority === 'high' && reasons.length < 2) {
    reasons.push('High priority');
  }

  // Streak-based reasons (if streak score is at risk level)
  if (breakdown.streak >= 15) {
    reasons.push('Streak at risk');
  }

  // Fallback if no specific reasons
  if (reasons.length === 0) {
    reasons.push('Available task');
  }

  return reasons.join(', ');
}

/**
 * Generate a short reason (1-2 key factors)
 *
 * @param candidate - The focus candidate
 * @param breakdown - Scoring breakdown
 * @param today - Reference date
 * @returns Short reason string
 */
export function generateShortReason(
  candidate: FocusCandidate,
  breakdown: FocusScoringBreakdown,
  today: Date = new Date()
): string {
  // Find the highest scoring factor
  const factors: { name: string; score: number; reason: string }[] = [];

  // Deadline factor
  if (candidate.dueDate) {
    const daysUntil = calculateDaysUntilDue(candidate.dueDate, today);
    if (daysUntil !== null) {
      if (daysUntil < 0) {
        factors.push({ name: 'deadline', score: breakdown.deadline, reason: 'Overdue' });
      } else if (daysUntil === 0) {
        factors.push({ name: 'deadline', score: breakdown.deadline, reason: 'Due today' });
      } else if (daysUntil <= 7) {
        factors.push({
          name: 'deadline',
          score: breakdown.deadline,
          reason: `Due in ${daysUntil} days`,
        });
      }
    }
  }

  // Blocking factor
  if (candidate.blocksPeople || candidate.blocks.length > 0) {
    const reason = candidate.blocksPeople
      ? 'Blocks teammates'
      : `Blocks ${candidate.blocks.length} items`;
    factors.push({ name: 'blocking', score: breakdown.blocking, reason });
  }

  // Sprint factor
  if (candidate.inCurrentSprint) {
    factors.push({ name: 'sprint', score: breakdown.sprint, reason: 'In sprint' });
  }

  // Priority factor
  if (candidate.priority === 'critical' || candidate.priority === 'high') {
    factors.push({
      name: 'priority',
      score: breakdown.priority,
      reason: `${candidate.priority.charAt(0).toUpperCase()}${candidate.priority.slice(1)} priority`,
    });
  }

  // Sort by score and take top 1-2
  factors.sort((a, b) => b.score - a.score);
  const topFactors = factors.slice(0, 2);

  if (topFactors.length === 0) {
    return 'Available';
  }

  return topFactors.map((f) => f.reason).join(' • ');
}

/**
 * Generate a detailed reason with all contributing factors
 *
 * @param candidate - The focus candidate
 * @param breakdown - Scoring breakdown
 * @param today - Reference date
 * @returns Detailed reason with all factors
 */
export function generateDetailedReason(
  candidate: FocusCandidate,
  breakdown: FocusScoringBreakdown,
  today: Date = new Date()
): {
  summary: string;
  factors: { factor: string; contribution: number; description: string }[];
} {
  const factors: { factor: string; contribution: number; description: string }[] =
    [];

  // Deadline
  if (breakdown.deadline > 0) {
    let description = 'No urgent deadline';
    if (candidate.dueDate) {
      const daysUntil = calculateDaysUntilDue(candidate.dueDate, today);
      if (daysUntil !== null) {
        if (daysUntil < 0) {
          description = `${Math.abs(daysUntil)} days overdue`;
        } else if (daysUntil === 0) {
          description = 'Due today';
        } else {
          description = `Due in ${daysUntil} days`;
        }
      }
    }
    factors.push({
      factor: 'Deadline',
      contribution: breakdown.deadline,
      description,
    });
  }

  // Blocking
  if (breakdown.blocking > 0) {
    const description = candidate.blocksPeople
      ? 'Blocking team members'
      : candidate.blocks.length > 1
        ? `Blocking ${candidate.blocks.length} other items`
        : 'Blocking another item';
    factors.push({
      factor: 'Blocking',
      contribution: breakdown.blocking,
      description,
    });
  }

  // Priority
  factors.push({
    factor: 'Priority',
    contribution: breakdown.priority,
    description: `${candidate.priority.charAt(0).toUpperCase()}${candidate.priority.slice(1)} priority`,
  });

  // Sprint
  if (breakdown.sprint > 0) {
    factors.push({
      factor: 'Sprint',
      contribution: breakdown.sprint,
      description: 'Part of current sprint',
    });
  }

  // Streak
  if (breakdown.streak > 0) {
    factors.push({
      factor: 'Streak',
      contribution: breakdown.streak,
      description: breakdown.streak >= 15 ? 'Streak at risk' : 'Maintaining momentum',
    });
  }

  // Sort by contribution
  factors.sort((a, b) => b.contribution - a.contribution);

  // Generate summary from top factors
  const summary = generateShortReason(candidate, breakdown, today);

  return { summary, factors };
}
