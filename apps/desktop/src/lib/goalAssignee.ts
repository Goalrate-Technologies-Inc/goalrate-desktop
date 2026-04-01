export type GoalAssignee =
  | { type: 'human' }
  | { type: 'ai'; modelId: string };

export const HUMAN_GOAL_ASSIGNEE: GoalAssignee = { type: 'human' };
export const HUMAN_GOAL_ASSIGNEE_VALUE = 'human';

export function isAiGoalAssignee(assignee: GoalAssignee): assignee is { type: 'ai'; modelId: string } {
  return assignee.type === 'ai';
}

export function goalAssigneeToSelectValue(assignee: GoalAssignee): string {
  if (assignee.type === 'human') {
    return HUMAN_GOAL_ASSIGNEE_VALUE;
  }
  return `ai:${assignee.modelId}`;
}

export function parseGoalAssigneeSelectValue(value: string): GoalAssignee {
  const trimmed = value.trim();
  if (!trimmed || trimmed === HUMAN_GOAL_ASSIGNEE_VALUE) {
    return HUMAN_GOAL_ASSIGNEE;
  }

  if (trimmed.startsWith('ai:')) {
    const modelId = trimmed.slice('ai:'.length).trim();
    if (modelId) {
      return {
        type: 'ai',
        modelId,
      };
    }
  }

  return HUMAN_GOAL_ASSIGNEE;
}
