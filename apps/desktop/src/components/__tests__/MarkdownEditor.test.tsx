import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "../MarkdownEditor";

interface DeferredSave {
  value: string;
  resolve: () => void;
}

describe("MarkdownEditor autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("autosaves the latest edit when an earlier save resolves after newer typing", async () => {
    const saves: DeferredSave[] = [];
    const onSave = vi.fn(
      (value: string) =>
        new Promise<void>((resolve) => {
          saves.push({ value, resolve });
        }),
    );

    render(
      <MarkdownEditor
        value="Initial notes"
        onSave={onSave}
        autosaveDelayMs={100}
      />,
    );

    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "First draft" } });

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(saves[0]?.value).toBe("First draft");

    fireEvent.change(editor, { target: { value: "Second draft" } });

    await act(async () => {
      saves[0]?.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(saves[1]?.value).toBe("Second draft");
  });
});
