import type {
  DailyAgenda,
  EisenhowerQuadrant,
  Goal,
  GoalStatus,
  ScheduledAgendaTask,
  Task,
  TaskStatus,
  VaultFile,
  VaultFileKind,
  VaultLoadResult,
  VaultValidationError,
} from "./models";

export class FrontmatterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterParseError";
  }
}

const GOAL_STATUSES = new Set<GoalStatus>([
  "created",
  "active",
  "paused",
  "completed",
  "abandoned",
  "archived",
]);

const TASK_STATUSES = new Set<TaskStatus>([
  "todo",
  "pending",
  "in_progress",
  "deferred",
  "blocked",
  "completed",
  "done",
  "archived",
]);

const QUADRANTS = new Set<EisenhowerQuadrant>([
  "do",
  "schedule",
  "delegate",
  "delete",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countIndent(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

function splitKeyValue(line: string): [string, string] | null {
  const index = line.indexOf(":");
  if (index === -1) {
    return null;
  }
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "" || value === "null" || value === "~") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "[]") {
    return [];
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner.split(",").map((item) => parseScalar(item.trim()));
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && value !== "") {
    return numeric;
  }
  return value;
}

function parseObject(
  lines: string[],
  startIndex: number,
  indent: number,
): [Record<string, unknown>, number] {
  const result: Record<string, unknown> = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const currentIndent = countIndent(line);
    if (currentIndent < indent || line.trimStart().startsWith("- ")) {
      break;
    }
    if (currentIndent > indent) {
      index += 1;
      continue;
    }

    const parts = splitKeyValue(line.trim());
    if (!parts) {
      index += 1;
      continue;
    }
    const [key, rawValue] = parts;

    if (rawValue) {
      result[key] = parseScalar(rawValue);
      index += 1;
      continue;
    }

    const next = nextMeaningfulLine(lines, index + 1);
    if (!next) {
      result[key] = null;
      index += 1;
      continue;
    }

    if (next.line.trimStart().startsWith("- ")) {
      const [items, nextIndex] = parseSequence(lines, next.index, next.indent);
      result[key] = items;
      index = nextIndex;
    } else {
      const [object, nextIndex] = parseObject(lines, next.index, next.indent);
      result[key] = object;
      index = nextIndex;
    }
  }

  return [result, index];
}

function parseSequence(
  lines: string[],
  startIndex: number,
  indent: number,
): [unknown[], number] {
  const result: unknown[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const currentIndent = countIndent(line);
    const trimmed = line.trimStart();
    if (currentIndent < indent || !trimmed.startsWith("- ")) {
      break;
    }
    if (currentIndent > indent) {
      index += 1;
      continue;
    }

    const valueText = trimmed.slice(2).trim();
    if (!valueText) {
      const next = nextMeaningfulLine(lines, index + 1);
      if (!next) {
        result.push(null);
        index += 1;
      } else if (next.line.trimStart().startsWith("- ")) {
        const [items, nextIndex] = parseSequence(lines, next.index, next.indent);
        result.push(items);
        index = nextIndex;
      } else {
        const [object, nextIndex] = parseObject(lines, next.index, next.indent);
        result.push(object);
        index = nextIndex;
      }
      continue;
    }

    const parts = splitKeyValue(valueText);
    if (!parts) {
      result.push(parseScalar(valueText));
      index += 1;
      continue;
    }

    const [key, rawValue] = parts;
    const object: Record<string, unknown> = {};
    object[key] = rawValue ? parseScalar(rawValue) : null;
    index += 1;

    while (index < lines.length) {
      const nestedLine = lines[index];
      if (!nestedLine.trim()) {
        index += 1;
        continue;
      }
      const nestedIndent = countIndent(nestedLine);
      if (nestedIndent <= indent) {
        break;
      }
      if (nestedIndent !== indent + 2) {
        index += 1;
        continue;
      }
      const nestedParts = splitKeyValue(nestedLine.trim());
      if (!nestedParts) {
        index += 1;
        continue;
      }
      const [nestedKey, nestedRawValue] = nestedParts;
      if (nestedRawValue) {
        object[nestedKey] = parseScalar(nestedRawValue);
        index += 1;
        continue;
      }
      const next = nextMeaningfulLine(lines, index + 1);
      if (next?.line.trimStart().startsWith("- ")) {
        const [items, nextIndex] = parseSequence(lines, next.index, next.indent);
        object[nestedKey] = items;
        index = nextIndex;
      } else if (next) {
        const [nestedObject, nextIndex] = parseObject(
          lines,
          next.index,
          next.indent,
        );
        object[nestedKey] = nestedObject;
        index = nextIndex;
      } else {
        object[nestedKey] = null;
        index += 1;
      }
    }

    result.push(object);
  }

  return [result, index];
}

function nextMeaningfulLine(
  lines: string[],
  startIndex: number,
): { index: number; line: string; indent: number } | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim()) {
      return { index, line, indent: countIndent(line) };
    }
  }
  return null;
}

export function parseYamlSubset(yaml: string): Record<string, unknown> {
  const [parsed] = parseObject(yaml.split(/\r?\n/), 0, 0);
  return parsed;
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const raw = String(value);
  const needsQuotes =
    !raw ||
    [":", "#", "[", "]", "{", "}", ",", '"', "\n"].some((token) =>
      raw.includes(token),
    ) ||
    /^\s|\s$/.test(raw);
  if (needsQuotes) {
    return JSON.stringify(raw);
  }
  return raw;
}

function serializeYamlValue(
  key: string,
  value: unknown,
  indent = 0,
): string[] {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${prefix}${key}: []`];
    }
    const lines = [`${prefix}${key}:`];
    for (const item of value) {
      if (isRecord(item)) {
        const entries = Object.entries(item);
        if (entries.length === 0) {
          lines.push(`${prefix}  - {}`);
          continue;
        }
        const [firstKey, firstValue] = entries[0];
        if (Array.isArray(firstValue) || isRecord(firstValue)) {
          lines.push(`${prefix}  - ${firstKey}:`);
          lines.push(...serializeNestedValue(firstValue, indent + 4));
        } else {
          lines.push(`${prefix}  - ${firstKey}: ${formatScalar(firstValue)}`);
        }
        for (const [nestedKey, nestedValue] of entries.slice(1)) {
          lines.push(...serializeYamlValue(nestedKey, nestedValue, indent + 4));
        }
      } else {
        lines.push(`${prefix}  - ${formatScalar(item)}`);
      }
    }
    return lines;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return [`${prefix}${key}: {}`];
    }
    const lines = [`${prefix}${key}:`];
    for (const [nestedKey, nestedValue] of entries) {
      lines.push(...serializeYamlValue(nestedKey, nestedValue, indent + 2));
    }
    return lines;
  }
  return [`${prefix}${key}: ${formatScalar(value)}`];
}

function serializeNestedValue(value: unknown, indent: number): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${" ".repeat(indent)}[]`];
    }
    return value.flatMap((item) => {
      if (isRecord(item)) {
        const [firstKey, firstValue] = Object.entries(item)[0] ?? ["", null];
        return [`${" ".repeat(indent)}- ${firstKey}: ${formatScalar(firstValue)}`];
      }
      return [`${" ".repeat(indent)}- ${formatScalar(item)}`];
    });
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([nestedKey, nestedValue]) =>
      serializeYamlValue(nestedKey, nestedValue, indent),
    );
  }
  return [`${" ".repeat(indent)}${formatScalar(value)}`];
}

export function serializeYamlSubset(frontmatter: Record<string, unknown>): string {
  return Object.entries(frontmatter)
    .flatMap(([key, value]) => serializeYamlValue(key, value))
    .join("\n");
}

export function parseMarkdownFrontmatter(raw: string, path: string): VaultFile {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new FrontmatterParseError(`${path} is missing YAML frontmatter`);
  }

  const frontmatter = parseYamlSubset(match[1]);
  const kind = vaultFileKind(frontmatter, path);
  return {
    path,
    kind,
    frontmatter,
    body: match[2] ?? "",
    raw,
  };
}

export function serializeVaultFile(file: VaultFile): string {
  return `---\n${serializeYamlSubset(file.frontmatter)}\n---\n\n${file.body.trim()}\n`;
}

function stringField(
  frontmatter: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = frontmatter[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function numberField(
  frontmatter: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = frontmatter[key];
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

function vaultFileKind(
  frontmatter: Record<string, unknown>,
  path: string,
): VaultFileKind {
  const type = stringField(frontmatter, "type");
  if (type === "goal" || path.includes("/goals/")) {
    return "goal";
  }
  if (type === "agenda" || path.includes("/agenda/")) {
    return "agenda";
  }
  if (type === "memory") {
    return "memory";
  }
  if (type === "agent_mutation_log") {
    return "agent_mutation_log";
  }
  if (type === "error_log") {
    return "error_log";
  }
  if (type === "task" || path.includes("/tasks/")) {
    return "task";
  }
  return "unknown";
}

function normalizeGoalStatus(value: string | undefined): GoalStatus {
  return value && GOAL_STATUSES.has(value as GoalStatus)
    ? (value as GoalStatus)
    : "active";
}

function normalizeTaskStatus(value: string | undefined): TaskStatus {
  return value && TASK_STATUSES.has(value as TaskStatus)
    ? (value as TaskStatus)
    : "todo";
}

function normalizeQuadrant(value: string | undefined): EisenhowerQuadrant | undefined {
  return value && QUADRANTS.has(value as EisenhowerQuadrant)
    ? (value as EisenhowerQuadrant)
    : undefined;
}

function taskFromRecord(
  record: Record<string, unknown>,
  fallbackGoalId: string,
  fallbackParentTaskId?: string,
): Task | null {
  const id = stringField(record, "id");
  const title = stringField(record, "title");
  if (!id || !title) {
    return null;
  }

  const goalId =
    stringField(record, "parent_goal_id", "parentGoalId", "goal_id") ??
    fallbackGoalId;
  const subtasksValue = record.subtasks;
  const subtasks = Array.isArray(subtasksValue)
    ? subtasksValue
        .filter(isRecord)
        .map((subtask) => taskFromRecord(subtask, goalId, id))
        .filter((task): task is Task => task !== null)
    : undefined;
  const parentTaskId =
    stringField(
      record,
      "parent_id",
      "parentTaskId",
      "generated_from_task_id",
      "generatedFromTaskId",
    ) ?? fallbackParentTaskId;

  return {
    id,
    goalId,
    title,
    status: normalizeTaskStatus(stringField(record, "status", "column")),
    createdAt: stringField(record, "created_at", "created"),
    updatedAt: stringField(record, "updated_at", "updated"),
    priority: stringField(record, "priority"),
    dueDate: stringField(record, "due_date", "dueDate", "deadline"),
    scheduledFor: stringField(record, "scheduled_for", "scheduled_date"),
    completedAt: stringField(record, "completed_at", "completedAt"),
    recurring: stringField(record, "recurring", "recurrence"),
    recurrenceStart: stringField(
      record,
      "recurrence_start",
      "recurrenceStart",
    ),
    recurrenceEnd: stringField(record, "recurrence_end", "recurrenceEnd"),
    firstSeenOnAgenda: stringField(
      record,
      "first_seen_on_agenda",
      "firstSeenOnAgenda",
    ),
    deferralCount: numberField(record, "deferral_count", "deferralCount"),
    lastSeenOnAgenda: stringField(
      record,
      "last_seen_on_agenda",
      "lastSeenOnAgenda",
    ),
    lastMissedDecisionOn: stringField(
      record,
      "last_missed_decision_on",
      "lastMissedDecisionOn",
    ),
    eisenhowerQuadrant: normalizeQuadrant(
      stringField(record, "eisenhower_quadrant", "eisenhowerQuadrant"),
    ),
    parentTaskId,
    subtasks,
  };
}

export function goalFromVaultFile(file: VaultFile): Goal {
  const id = stringField(file.frontmatter, "id");
  const title = stringField(file.frontmatter, "title");
  const createdAt = stringField(file.frontmatter, "created_at", "created");
  const status = normalizeGoalStatus(stringField(file.frontmatter, "status"));

  if (!id) {
    throw new FrontmatterParseError(`${file.path} is missing required field id`);
  }
  if (!title) {
    throw new FrontmatterParseError(`${file.path} is missing required field title`);
  }
  if (!createdAt) {
    throw new FrontmatterParseError(
      `${file.path} is missing required field created_at or created`,
    );
  }

  const tasksValue = file.frontmatter.tasks;
  const tasks = Array.isArray(tasksValue)
    ? tasksValue
        .filter(isRecord)
        .map((task) => taskFromRecord(task, id))
        .filter((task): task is Task => task !== null)
    : [];

  return {
    id,
    title,
    status,
    createdAt,
    updatedAt: stringField(file.frontmatter, "updated_at", "updated"),
    domain: stringField(file.frontmatter, "domain", "goal_type"),
    deadline: stringField(file.frontmatter, "deadline"),
    priority: stringField(file.frontmatter, "priority"),
    eisenhowerQuadrant: normalizeQuadrant(
      stringField(file.frontmatter, "eisenhower_quadrant", "eisenhowerQuadrant"),
    ),
    tasks,
    filePath: file.path,
    body: file.body,
  };
}

export function agendaFromVaultFile(file: VaultFile): DailyAgenda {
  const id = stringField(file.frontmatter, "id");
  const date = stringField(file.frontmatter, "date");
  const generatedAt = stringField(file.frontmatter, "generated_at", "generatedAt");
  if (!id || !date || !generatedAt) {
    throw new FrontmatterParseError(
      `${file.path} is missing required agenda fields id, date, or generated_at`,
    );
  }

  const scheduledTasksValue = file.frontmatter.scheduled_tasks;
  const scheduledTasks: ScheduledAgendaTask[] = Array.isArray(scheduledTasksValue)
    ? scheduledTasksValue.filter(isRecord).map((task) => ({
        id: stringField(task, "id") ?? "",
        taskId: stringField(task, "task_id", "taskId") ?? "",
        title: stringField(task, "title") ?? "",
        startTime: stringField(task, "start_time", "startTime"),
        durationMinutes: numberField(task, "duration_minutes", "durationMinutes"),
        estimateSource: stringField(task, "estimate_source", "estimateSource"),
        eisenhowerQuadrant: normalizeQuadrant(
          stringField(task, "eisenhower_quadrant", "eisenhowerQuadrant"),
        ),
      }))
    : [];

  const stringList = (key: string): string[] =>
    Array.isArray(file.frontmatter[key])
      ? file.frontmatter[key].filter(
          (item): item is string => typeof item === "string",
        )
      : [];

  return {
    id,
    date,
    status:
      stringField(file.frontmatter, "status") === "completed"
        ? "completed"
        : stringField(file.frontmatter, "status") === "archived"
          ? "archived"
          : "active",
    generatedAt,
    generatedBy: stringField(file.frontmatter, "generated_by", "generatedBy"),
    scheduledTasks,
    topOutcomeIds: stringList("top_outcome_ids"),
    completedTaskIds: stringList("completed_task_ids"),
    filePath: file.path,
  };
}

function flattenTaskTree(tasks: Task[]): Task[] {
  return tasks.flatMap((task) => [
    task,
    ...flattenTaskTree(task.subtasks ?? []),
  ]);
}

function isValidAgendaTimeLabel(value: string): boolean {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return false;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59;
}

function validateScheduledTaskRows(
  file: VaultFile,
): VaultValidationError[] {
  const scheduledTasks = file.frontmatter.scheduled_tasks;
  if (!Array.isArray(scheduledTasks)) {
    return [
      {
        path: file.path,
        field: "scheduled_tasks",
        message: "Missing scheduled_tasks",
      },
    ];
  }

  const errors: VaultValidationError[] = [];
  const seenTaskIds = new Set<string>();
  scheduledTasks.forEach((row, index) => {
    if (!isRecord(row)) {
      errors.push({
        path: file.path,
        field: `scheduled_tasks[${index}]`,
        message: "Invalid scheduled task",
      });
      return;
    }

    for (const field of ["id", "task_id", "title", "start_time"]) {
      const value =
        field === "task_id"
          ? stringField(row, "task_id", "taskId")
          : field === "start_time"
            ? stringField(row, "start_time", "startTime")
            : stringField(row, field);
      if (!value) {
        errors.push({
          path: file.path,
          field: `scheduled_tasks[${index}].${field}`,
          message: `Missing ${field}`,
        });
      }
    }

    const startTime = stringField(row, "start_time", "startTime");
    if (startTime && !isValidAgendaTimeLabel(startTime)) {
      errors.push({
        path: file.path,
        field: `scheduled_tasks[${index}].start_time`,
        message: "Invalid start_time",
      });
    }

    const taskId = stringField(row, "task_id", "taskId");
    if (taskId && seenTaskIds.has(taskId)) {
      errors.push({
        path: file.path,
        field: `scheduled_tasks[${index}].task_id`,
        message: `Duplicate task_id: ${taskId}`,
      });
    }
    if (taskId) {
      seenTaskIds.add(taskId);
    }

    const duration = numberField(row, "duration_minutes", "durationMinutes");
    if (
      duration === undefined ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 1440
    ) {
      errors.push({
        path: file.path,
        field: `scheduled_tasks[${index}].duration_minutes`,
        message:
          duration === undefined
            ? "Missing duration_minutes"
            : "Invalid duration_minutes",
      });
    }
  });

  return errors;
}

function validateGoalTaskRows(file: VaultFile): VaultValidationError[] {
  const tasks = file.frontmatter.tasks;
  if (tasks === undefined || tasks === null) {
    return [];
  }
  if (!Array.isArray(tasks)) {
    return [
      {
        path: file.path,
        field: "tasks",
        message: "Invalid tasks",
      },
    ];
  }

  const errors: VaultValidationError[] = [];
  tasks.forEach((task, index) => {
    validateGoalTaskRow(file.path, task, `tasks[${index}]`, errors);
  });
  return errors;
}

function validateGoalTaskRow(
  path: string,
  value: unknown,
  fieldPrefix: string,
  errors: VaultValidationError[],
): void {
  if (!isRecord(value)) {
    errors.push({
      path,
      field: fieldPrefix,
      message: "Invalid task",
    });
    return;
  }

  for (const field of ["id", "title", "status"]) {
    if (!stringField(value, field)) {
      errors.push({
        path,
        field: `${fieldPrefix}.${field}`,
        message: `Missing ${field}`,
      });
    }
  }

  const subtasks = value.subtasks;
  if (subtasks === undefined || subtasks === null) {
    return;
  }
  if (!Array.isArray(subtasks)) {
    errors.push({
      path,
      field: `${fieldPrefix}.subtasks`,
      message: "Invalid subtasks",
    });
    return;
  }

  subtasks.forEach((subtask, index) => {
    validateGoalTaskRow(
      path,
      subtask,
      `${fieldPrefix}.subtasks[${index}]`,
      errors,
    );
  });
}

export function validateVaultFile(file: VaultFile): VaultValidationError[] {
  const errors: VaultValidationError[] = [];
  if (!stringField(file.frontmatter, "id")) {
    errors.push({ path: file.path, field: "id", message: "Missing id" });
  }
  if (!stringField(file.frontmatter, "created_at", "created")) {
    errors.push({
      path: file.path,
      field: "created_at",
      message: "Missing created_at or created",
    });
  }
  if (file.kind === "goal") {
    for (const field of ["title", "status"]) {
      if (!stringField(file.frontmatter, field)) {
        errors.push({ path: file.path, field, message: `Missing ${field}` });
      }
    }
    errors.push(...validateGoalTaskRows(file));
  }
  if (file.kind === "agenda") {
    for (const field of ["date", "status"]) {
      if (!stringField(file.frontmatter, field)) {
        errors.push({ path: file.path, field, message: `Missing ${field}` });
      }
    }
    if (!stringField(file.frontmatter, "generated_at", "generatedAt")) {
      errors.push({
        path: file.path,
        field: "generated_at",
        message: "Missing generated_at",
      });
    }
    errors.push(...validateScheduledTaskRows(file));
  }
  return errors;
}

export function loadVaultFiles(
  input: Array<{ path: string; raw: string }>,
): VaultLoadResult {
  const files: VaultFile[] = [];
  const goals: Goal[] = [];
  const agendas: DailyAgenda[] = [];
  const errors: VaultValidationError[] = [];

  for (const item of input) {
    try {
      const file = parseMarkdownFrontmatter(item.raw, item.path);
      const fileErrors = validateVaultFile(file);
      const hasTypedValidationErrors =
        fileErrors.length > 0 &&
        file.kind !== "agent_mutation_log" &&
        file.kind !== "error_log";
      if (hasTypedValidationErrors) {
        errors.push(...fileErrors);
        files.push(file);
        continue;
      }
      files.push(file);
      if (file.kind === "goal") {
        goals.push(goalFromVaultFile(file));
      }
      if (file.kind === "agenda") {
        agendas.push(agendaFromVaultFile(file));
      }
    } catch (error) {
      errors.push({
        path: item.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    files,
    goals,
    tasks: goals.flatMap((goal) => flattenTaskTree(goal.tasks)),
    agendas,
    errors,
  };
}

export function updateTaskInGoalMarkdown(
  raw: string,
  path: string,
  taskId: string,
  patch: Partial<Pick<Task, "title" | "status" | "completedAt" | "dueDate">>,
): string {
  const file = parseMarkdownFrontmatter(raw, path);
  if (!Array.isArray(file.frontmatter.tasks)) {
    throw new FrontmatterParseError(`${path} does not contain embedded tasks`);
  }

  let found = false;
  const tasks = file.frontmatter.tasks.map((task) => {
    if (!isRecord(task) || task.id !== taskId) {
      return task;
    }
    found = true;
    return {
      ...task,
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.completedAt !== undefined
        ? { completed_at: patch.completedAt }
        : {}),
      ...(patch.dueDate !== undefined ? { due_date: patch.dueDate } : {}),
    };
  });

  if (!found) {
    throw new FrontmatterParseError(`${path} does not contain task ${taskId}`);
  }

  return serializeVaultFile({
    ...file,
    frontmatter: {
      ...file.frontmatter,
      tasks,
      updated: new Date().toISOString(),
    },
  });
}

export function buildVaultErrorLogEntry(error: VaultValidationError): string {
  return [
    `## ${new Date().toISOString()}`,
    "",
    `- File: \`${error.path}\``,
    error.field ? `- Field: \`${error.field}\`` : null,
    `- Error: ${error.message}`,
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
