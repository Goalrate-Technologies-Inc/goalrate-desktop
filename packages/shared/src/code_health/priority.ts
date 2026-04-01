export const PRIORITY_RANKS: Readonly<Record<string, number>> = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
});

export function normalizePriority(
  priority: string | null | undefined,
  fallback: string = 'medium'
): string {
  if (!priority) {
    return fallback;
  }

  const normalized = priority.toLowerCase();
  return PRIORITY_RANKS[normalized] !== undefined ? normalized : fallback;
}

export function getPriorityRank(
  priority: string | null | undefined,
  fallback: string = 'medium'
): number {
  const normalized = normalizePriority(priority, fallback);
  return PRIORITY_RANKS[normalized] ?? PRIORITY_RANKS[fallback] ?? PRIORITY_RANKS.medium;
}

export function comparePriority(
  left: string | null | undefined,
  right: string | null | undefined,
  fallback: string = 'medium'
): number {
  return getPriorityRank(left, fallback) - getPriorityRank(right, fallback);
}
