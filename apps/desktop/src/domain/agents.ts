import type {
  AgentMutationLog,
  DailyAgenda,
  Goal,
  Task,
  VaultFile,
  VaultValidationError,
} from "./models";
import { serializeVaultFile, validateVaultFile } from "./vaultMarkdown";

export interface AgentReadContext {
  vaultId: string;
  files: VaultFile[];
  goals: Goal[];
  tasks: Task[];
  todayAgenda?: DailyAgenda;
}

export interface AgentWriteRequest {
  vaultId: string;
  actor: "assistant" | "system";
  action: string;
  filePath: string;
  nextFile: VaultFile;
  reason: string;
  destructive?: boolean;
  explicitConfirmation?: boolean;
}

export interface AgentWriteResult {
  ok: boolean;
  validationErrors: VaultValidationError[];
  mutationLog?: AgentMutationLog;
}

export interface GoalAgent {
  validateGoal(goal: Goal, context: AgentReadContext): VaultValidationError[];
  suggestTasks(goal: Goal, context: AgentReadContext): Promise<Task[]>;
  challengeUnrealisticGoal(goal: Goal, context: AgentReadContext): Promise<string | null>;
}

export interface PlanningAgent {
  generateDailyAgenda(context: AgentReadContext, date: string): Promise<DailyAgenda>;
  explainAgenda(agenda: DailyAgenda, context: AgentReadContext): Promise<string>;
  repairMissedWork(task: Task, context: AgentReadContext): Promise<Task[]>;
}

export interface VaultMutationAgent {
  validateBeforeWrite(request: AgentWriteRequest): VaultValidationError[];
  writeVaultFile(request: AgentWriteRequest): Promise<AgentWriteResult>;
  logMutation(result: AgentWriteResult): Promise<void>;
}

export interface VaultMutationAgentStorage {
  readFile(path: string): Promise<string | null | undefined>;
  writeFile(path: string, contents: string): Promise<void>;
  writeSnapshot(path: string, contents: string): Promise<string>;
  appendMutationLog(entry: string): Promise<void>;
}

export interface VaultMutationAgentOptions {
  storage: VaultMutationAgentStorage;
  now?: () => Date;
  createId?: () => string;
}

export function assertAgentWriteAllowed(request: AgentWriteRequest): void {
  if (request.actor !== "assistant" && request.actor !== "system") {
    throw new Error("VaultMutationAgent only accepts assistant or system actors");
  }
  if (request.destructive && !request.explicitConfirmation) {
    throw new Error("Assistant vault mutations cannot delete or destroy data without explicit confirmation");
  }
}

function defaultCreateMutationId(): string {
  return `mutation_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function formatAgentMutationLogEntry(log: AgentMutationLog): string {
  return [
    `## ${log.timestamp}`,
    "",
    `- Actor: ${log.actor}`,
    `- Action: ${log.action}`,
    `- File: \`${log.filePath}\``,
    log.entityId ? `- Entity: \`${log.entityId}\`` : null,
    log.snapshotPath ? `- Snapshot: \`${log.snapshotPath}\`` : null,
    log.summary ? `- Summary: ${log.summary}` : null,
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function createVaultMutationAgent(
  options: VaultMutationAgentOptions,
): VaultMutationAgent {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? defaultCreateMutationId;

  const agent: VaultMutationAgent = {
    validateBeforeWrite(request) {
      assertAgentWriteAllowed(request);
      return validateVaultFile(request.nextFile);
    },

    async writeVaultFile(request) {
      const validationErrors = agent.validateBeforeWrite(request);
      if (validationErrors.length > 0) {
        return { ok: false, validationErrors };
      }

      const previousContents = await options.storage.readFile(request.filePath);
      const snapshotPath =
        previousContents === null || previousContents === undefined
          ? undefined
          : await options.storage.writeSnapshot(
              request.filePath,
              previousContents,
            );

      await options.storage.writeFile(
        request.filePath,
        serializeVaultFile(request.nextFile),
      );

      const timestamp = now().toISOString();
      const entityId = request.nextFile.frontmatter.id;
      const result: AgentWriteResult = {
        ok: true,
        validationErrors: [],
        mutationLog: {
          id: createId(),
          timestamp,
          actor: request.actor,
          action: request.action,
          filePath: request.filePath,
          entityId: typeof entityId === "string" ? entityId : undefined,
          snapshotPath,
          summary: request.reason,
        },
      };
      await agent.logMutation(result);
      return result;
    },

    async logMutation(result) {
      if (!result.mutationLog) {
        return;
      }
      await options.storage.appendMutationLog(
        formatAgentMutationLogEntry(result.mutationLog),
      );
    },
  };

  return agent;
}
