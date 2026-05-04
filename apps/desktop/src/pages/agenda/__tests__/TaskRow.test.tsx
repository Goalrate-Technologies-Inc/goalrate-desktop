import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskRow } from "../TaskRow";

describe("TaskRow manual Agenda controls", () => {
  it("edits a scheduled row title, time, and duration", () => {
    const onEdit = vi.fn();

    render(
      <TaskRow
        taskId="task_alpha"
        title="Alpha task"
        startTime="9:00 AM"
        durationMinutes={30}
        onEdit={onEdit}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: 'Edit "Alpha task"' }),
    );
    expect(screen.getByLabelText("Agenda item start time")).toHaveAttribute(
      "type",
      "time",
    );
    expect(screen.getByLabelText("Agenda item start time")).toHaveValue(
      "09:00",
    );
    fireEvent.change(screen.getByLabelText("Agenda item title"), {
      target: { value: "Beta task" },
    });
    fireEvent.change(screen.getByLabelText("Agenda item start time"), {
      target: { value: "10:15" },
    });
    fireEvent.change(screen.getByLabelText("Agenda item duration minutes"), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Agenda item" }));

    expect(onEdit).toHaveBeenCalledWith({
      taskId: "task_alpha",
      title: "Beta task",
      startTime: "10:15 AM",
      durationMinutes: 45,
    });
  });

  it("exposes drag and remove controls without arrow reorder buttons", () => {
    const onRemove = vi.fn();

    render(
      <TaskRow
        taskId="task_alpha"
        title="Alpha task"
        startTime="9:00 AM"
        durationMinutes={30}
        dragHandle={
          <button type="button" aria-label='Drag "Alpha task" to reorder'>
            Drag
          </button>
        }
        onRemove={onRemove}
      />,
    );

    expect(
      screen.getByRole("button", { name: 'Drag "Alpha task" to reorder' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: 'Move "Alpha task" earlier' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: 'Move "Alpha task" later' }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: 'Remove "Alpha task" from Agenda' }),
    );
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("flags delegate tasks on the Agenda row", () => {
    render(
      <TaskRow
        taskId="task_delegate"
        title="Ask vendor for updated quote"
        startTime="9:00 AM"
        durationMinutes={15}
        eisenhowerQuadrant="delegate"
      />,
    );

    expect(screen.getByLabelText("Delegate task")).toBeInTheDocument();
  });
});
