export interface AgendaTaskRow {
  id?: string;
  taskId: string;
  title: string;
  startTime?: string | null;
  durationMinutes?: number | null;
  estimateSource?: string | null;
  eisenhowerQuadrant?: string | null;
}

const MINUTES_PER_DAY = 24 * 60;
export const AGENDA_TIME_INPUT_STEP_SECONDS = 5 * 60;

export function agendaTimeToMinutes(startTime?: string | null): number | null {
  if (!startTime) {
    return null;
  }
  const match = startTime
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }
  const meridiem = match[3].toUpperCase();
  if (meridiem === "AM" && hour === 12) {
    hour = 0;
  } else if (meridiem === "PM" && hour !== 12) {
    hour += 12;
  }
  return hour * 60 + minute;
}

export function scheduleMinutes(startTime?: string | null): number {
  return agendaTimeToMinutes(startTime) ?? Number.MAX_SAFE_INTEGER;
}

export function formatScheduleMinutes(totalMinutes: number): string {
  const normalized =
    ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

export function agendaTimeToInputValue(startTime?: string | null): string {
  const minutes = agendaTimeToMinutes(startTime);
  if (minutes === null) {
    return "";
  }
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function timeInputValueToAgendaTime(value: string): string | null {
  const match = value.trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return formatScheduleMinutes(hour * 60 + minute);
}

function rowDurationMinutes(row: AgendaTaskRow): number {
  if (
    typeof row.durationMinutes === "number" &&
    Number.isInteger(row.durationMinutes) &&
    row.durationMinutes > 0
  ) {
    return row.durationMinutes;
  }
  return 30;
}

function assignExistingStartSlots(
  rows: AgendaTaskRow[],
  previousRows: AgendaTaskRow[],
): AgendaTaskRow[] {
  const startSlots = previousRows.map((row) => row.startTime || "9:00 AM");
  return rows.map((row, index) => ({
    ...row,
    startTime: startSlots[index] ?? row.startTime ?? "9:00 AM",
  }));
}

function moveAgendaRow(
  rows: AgendaTaskRow[],
  oldIndex: number,
  newIndex: number,
): AgendaTaskRow[] {
  const reordered = [...rows];
  const [moved] = reordered.splice(oldIndex, 1);
  if (!moved) {
    return rows;
  }
  reordered.splice(newIndex, 0, moved);
  return reordered;
}

export function reorderAgendaRowsByTaskId(
  rows: AgendaTaskRow[],
  activeTaskId: string,
  overTaskId: string,
): AgendaTaskRow[] {
  if (activeTaskId === overTaskId) {
    return rows;
  }
  const oldIndex = rows.findIndex((row) => row.taskId === activeTaskId);
  const newIndex = rows.findIndex((row) => row.taskId === overTaskId);
  if (oldIndex < 0 || newIndex < 0) {
    return rows;
  }
  return assignExistingStartSlots(moveAgendaRow(rows, oldIndex, newIndex), rows);
}

export function reflowAgendaRowsFromTaskId(
  rows: AgendaTaskRow[],
  taskId: string,
): AgendaTaskRow[] {
  const startIndex = rows.findIndex((row) => row.taskId === taskId);
  if (startIndex < 0) {
    return rows;
  }
  const editedRow = rows[startIndex];
  if (!editedRow) {
    return rows;
  }
  const editedStart = agendaTimeToMinutes(editedRow.startTime);
  if (editedStart === null) {
    return rows;
  }

  let nextStart = editedStart + rowDurationMinutes(editedRow);
  return rows.map((row, index) => {
    if (index <= startIndex) {
      return row;
    }
    const startTime = formatScheduleMinutes(nextStart);
    nextStart += rowDurationMinutes(row);
    return {
      ...row,
      startTime,
    };
  });
}
