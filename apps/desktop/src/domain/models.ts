export type VaultFileKind =
  | "goal"
  | "task"
  | "agenda"
  | "memory"
  | "agent_mutation_log"
  | "error_log"
  | "unknown";

export type GoalStatus =
  | "created"
  | "active"
  | "paused"
  | "completed"
  | "abandoned"
  | "archived";

export type TaskStatus =
  | "todo"
  | "pending"
  | "in_progress"
  | "deferred"
  | "blocked"
  | "completed"
  | "done"
  | "archived";

export type EisenhowerQuadrant = "do" | "schedule" | "delegate" | "delete";

export interface VaultFile {
  path: string;
  kind: VaultFileKind;
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
}

export interface Goal {
  id: string;
  title: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt?: string;
  domain?: string;
  deadline?: string;
  priority?: "critical" | "high" | "medium" | "low" | string;
  eisenhowerQuadrant?: EisenhowerQuadrant;
  tasks: Task[];
  filePath?: string;
  body?: string;
}

export interface Task {
  id: string;
  goalId: string;
  title: string;
  status: TaskStatus;
  createdAt?: string;
  updatedAt?: string;
  priority?: "critical" | "high" | "medium" | "low" | string;
  dueDate?: string;
  scheduledFor?: string;
  completedAt?: string;
  recurring?: string;
  recurrenceStart?: string;
  recurrenceEnd?: string;
  firstSeenOnAgenda?: string;
  deferralCount?: number;
  lastSeenOnAgenda?: string;
  lastMissedDecisionOn?: string;
  eisenhowerQuadrant?: EisenhowerQuadrant;
  parentTaskId?: string;
  subtasks?: Task[];
}

export interface ScheduledAgendaTask {
  id: string;
  taskId: string;
  title: string;
  startTime?: string;
  durationMinutes?: number;
  estimateSource?: "user" | "ai" | "inferred" | "manual" | string;
  eisenhowerQuadrant?: EisenhowerQuadrant;
  score?: number;
}

export interface DailyAgenda {
  id: string;
  date: string;
  status: "active" | "completed" | "archived";
  generatedAt: string;
  scheduledTasks: ScheduledAgendaTask[];
  topOutcomeIds: string[];
  completedTaskIds: string[];
  generatedBy?: "user" | "ai" | "heuristic" | "manual" | "indexed" | string;
  filePath?: string;
}

export interface AgentMutationLog {
  id: string;
  timestamp: string;
  actor: "user" | "assistant" | "system";
  action: string;
  filePath: string;
  entityId?: string;
  snapshotPath?: string;
  summary?: string;
}

export interface VaultValidationError {
  path: string;
  message: string;
  field?: string;
}

export interface VaultLoadResult {
  files: VaultFile[];
  goals: Goal[];
  tasks: Task[];
  agendas: DailyAgenda[];
  errors: VaultValidationError[];
}
