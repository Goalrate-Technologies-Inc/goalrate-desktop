export function normalizeGoalDocSegment(value: string, fallback: string): string {
  const words = value
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return fallback;
  }

  const merged = words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join('');

  return merged.length > 0 ? merged.slice(0, 64) : fallback;
}

export function buildGoalDocFileName(title: string): string {
  const goalDocName = normalizeGoalDocSegment(title, 'Goal') || 'Goal';
  return `${goalDocName}.md`;
}

export function buildGoalDocPath(title: string): string {
  return `/goals/${buildGoalDocFileName(title)}`;
}
