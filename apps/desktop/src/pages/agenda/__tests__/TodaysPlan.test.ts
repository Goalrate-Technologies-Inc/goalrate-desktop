import { describe, expect, it } from "vitest";
import {
  agendaTimeToInputValue,
  reflowAgendaRowsFromTaskId,
  reorderAgendaRowsByTaskId,
  timeInputValueToAgendaTime,
  type AgendaTaskRow,
} from "../agendaRows";

describe("TodaysPlan drag reorder", () => {
  it("moves a task over another task while preserving the visible time slots", () => {
    const rows: AgendaTaskRow[] = [
      {
        taskId: "task_alpha",
        title: "Alpha task",
        startTime: "9:00 AM",
        durationMinutes: 30,
      },
      {
        taskId: "task_beta",
        title: "Beta task",
        startTime: "9:30 AM",
        durationMinutes: 45,
      },
      {
        taskId: "task_gamma",
        title: "Gamma task",
        startTime: "10:15 AM",
        durationMinutes: 15,
      },
    ];

    const reordered = reorderAgendaRowsByTaskId(
      rows,
      "task_beta",
      "task_alpha",
    );

    expect(reordered.map((row) => row.taskId)).toEqual([
      "task_beta",
      "task_alpha",
      "task_gamma",
    ]);
    expect(reordered.map((row) => row.startTime)).toEqual([
      "9:00 AM",
      "9:30 AM",
      "10:15 AM",
    ]);
  });

  it("reflows tasks below an edited task from its new start time", () => {
    const rows: AgendaTaskRow[] = [
      {
        taskId: "task_alpha",
        title: "Alpha task",
        startTime: "9:00 AM",
        durationMinutes: 30,
      },
      {
        taskId: "task_beta",
        title: "Beta task",
        startTime: "10:00 AM",
        durationMinutes: 45,
      },
      {
        taskId: "task_gamma",
        title: "Gamma task",
        startTime: "10:15 AM",
        durationMinutes: 15,
      },
    ];

    const reflowed = reflowAgendaRowsFromTaskId(rows, "task_beta");

    expect(reflowed.map((row) => row.startTime)).toEqual([
      "9:00 AM",
      "10:00 AM",
      "10:45 AM",
    ]);
  });

  it("converts between persisted Agenda labels and native time input values", () => {
    expect(agendaTimeToInputValue("9:00 AM")).toBe("09:00");
    expect(agendaTimeToInputValue("12:30 PM")).toBe("12:30");
    expect(agendaTimeToInputValue("12:05 AM")).toBe("00:05");
    expect(timeInputValueToAgendaTime("00:05")).toBe("12:05 AM");
    expect(timeInputValueToAgendaTime("13:45")).toBe("1:45 PM");
    expect(timeInputValueToAgendaTime("25:00")).toBeNull();
  });
});
