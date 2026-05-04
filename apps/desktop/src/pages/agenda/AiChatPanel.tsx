import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Clock, ArrowLeft, Loader2 } from "lucide-react";
import type { ChatMessage } from "@goalrate-app/shared";
import type { UseAgendaReturn } from "../../hooks/useAgenda";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { useVault } from "../../context/VaultContext";
import * as agendaIpc from "../../lib/agendaIpc";
import { AssistantMissedWork } from "./AssistantMissedWork";
import { useSubscription } from "../../context/SubscriptionContext";
import { PlusUpgradePanel } from "./SubscriptionPanel";

type HistoryMode = "active" | "dateList" | "viewing";

interface AiChatPanelProps {
  agenda: UseAgendaReturn;
}

function assistantActivityLabel(message: string): string {
  const lower = message.toLowerCase();

  if (
    lower.includes("break down") ||
    lower.includes("breakdown") ||
    lower.includes("subtask")
  ) {
    return "Assistant is breaking down tasks...";
  }
  if (
    lower.includes("regenerate") ||
    lower.includes("refresh") ||
    lower.includes("rebuild") ||
    lower.includes("redo")
  ) {
    return "Assistant is regenerating your Agenda...";
  }
  if (
    lower.includes("reschedule") ||
    lower.includes("move") ||
    lower.includes("time") ||
    lower.includes("duration") ||
    lower.includes("schedule")
  ) {
    return "Assistant is rescheduling...";
  }
  if (
    lower.includes("laundry") ||
    lower.includes("clothes") ||
    lower.includes("routine") ||
    lower.includes("chore")
  ) {
    return "Assistant is scheduling steps...";
  }
  if (
    lower.includes("roadmap") ||
    lower.includes("goal") ||
    lower.includes("domain")
  ) {
    return "Assistant is updating your Roadmap...";
  }
  if (
    lower.includes("add") ||
    lower.includes("create") ||
    lower.includes("new task")
  ) {
    return "Assistant is adding tasks...";
  }
  if (
    lower.includes("reprioritize") ||
    lower.includes("prioritize") ||
    lower.includes("defer") ||
    lower.includes("agenda") ||
    lower.includes("plan")
  ) {
    return "Assistant is updating your Agenda...";
  }

  return "Assistant is thinking...";
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function AssistantWorkingIndicator({
  label,
}: {
  label: string;
}): React.ReactElement {
  return (
    <div className="flex gap-2.5" role="status" aria-live="polite">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-goals-light">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-goals" />
      </div>
      <div className="max-w-[85%] rounded-lg bg-surface px-3 py-2 text-sm text-text-secondary">
        {label}
      </div>
    </div>
  );
}

export function AiChatPanel({
  agenda,
}: AiChatPanelProps): React.ReactElement {
  const { chatHistory, plan, date: todayDate } = agenda;
  const { currentVault } = useVault();
  const { allowsAi } = useSubscription();
  const vaultId = currentVault?.id ?? "";

  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState(
    "Assistant is thinking...",
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // History browsing state
  const [historyMode, setHistoryMode] = useState<HistoryMode>("active");
  const [chatDates, setChatDates] = useState<string[]>([]);
  const [viewingDate, setViewingDate] = useState<string | null>(null);
  const [viewingMessages, setViewingMessages] = useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Auto-scroll to bottom whenever chat history changes (active mode only)
  useEffect(() => {
    if (historyMode === "active") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory, historyMode, isSending]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !plan || isSending || !allowsAi) {
      return;
    }

    setInput("");
    setAssistantStatus(assistantActivityLabel(text));
    setIsSending(true);

    try {
      await agenda.sendChat(text);
    } catch {
      // Error is handled in the hook
    } finally {
      setIsSending(false);
    }
  }, [input, plan, isSending, allowsAi, agenda]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const openDateList = useCallback(async () => {
    if (!vaultId) {
      return;
    }
    setHistoryMode("dateList");
    setIsLoadingHistory(true);
    try {
      const dates = await agendaIpc.getChatDates(vaultId);
      // Exclude today's date — user can see today's chat in active mode
      setChatDates(dates.filter((d) => d !== todayDate));
    } catch {
      setChatDates([]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [vaultId, todayDate]);

  const loadPastChat = useCallback(
    async (date: string) => {
      if (!vaultId) {
        return;
      }
      setIsLoadingHistory(true);
      try {
        const pastPlan = await agendaIpc.getPlan(vaultId, date);
        if (pastPlan) {
          const messages = await agendaIpc.getChatHistory(
            vaultId,
            pastPlan.id,
          );
          setViewingMessages(messages);
          setViewingDate(date);
          setHistoryMode("viewing");
        }
      } catch {
        // Stay on date list if loading fails
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [vaultId],
  );

  const backToActive = useCallback(() => {
    setHistoryMode("active");
    setViewingDate(null);
    setViewingMessages([]);
  }, []);

  const backToDateList = useCallback(() => {
    setHistoryMode("dateList");
    setViewingDate(null);
    setViewingMessages([]);
  }, []);

  const isHistoryActive = historyMode !== "active";

  return (
    <aside
      className="flex w-[340px] shrink-0 flex-col border-l"
      style={{
        borderColor: "var(--border-light)",
        backgroundColor: "var(--bg-subtle)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--border-light)" }}
      >
        <div className="flex items-center">
          <h2
            className="font-serif text-lg font-normal"
            style={{ color: "var(--text-secondary)" }}
          >
            Assistant
          </h2>
        </div>
        <button
          onClick={isHistoryActive ? backToActive : openDateList}
          className="rounded-md p-1 transition-colors"
          style={{
            color: isHistoryActive
              ? "var(--accent-goals)"
              : "var(--text-muted)",
            backgroundColor: isHistoryActive
              ? "var(--accent-goals-light)"
              : "transparent",
          }}
          title={isHistoryActive ? "Back to Agenda" : "Assistant history"}
        >
          <Clock className="h-4 w-4" />
        </button>
      </div>

      {/* Active chat mode */}
      {historyMode === "active" && (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {allowsAi ? (
              <AssistantMissedWork agenda={agenda} />
            ) : (
              <PlusUpgradePanel compact />
            )}
            {chatHistory.length === 0 && (
              <p className="py-8 text-center text-sm text-text-muted">
                {!allowsAi
                  ? "Assistant chat is included with GoalRate Plus."
                  : plan
                  ? "Ask the Assistant to reprioritize, defer, or explain your Agenda."
                  : "Generate an Agenda first to ask the Assistant."}
              </p>
            )}
            {chatHistory.map((msg) => (
              <ChatMessageBubble key={msg.id} message={msg} />
            ))}
            {isSending && <AssistantWorkingIndicator label={assistantStatus} />}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border-light p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  !allowsAi
                    ? "Upgrade to Plus to use Assistant"
                    : plan
                    ? "Reprioritize, defer, ask..."
                    : "Generate an Agenda first"
                }
                disabled={!plan || isSending || !allowsAi}
                rows={1}
                className="flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-goals focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || !plan || isSending || !allowsAi}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-text-primary text-text-inverse transition-colors hover:bg-text-secondary disabled:opacity-30"
                title={isSending ? "Assistant is working" : "Send message"}
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Date list mode */}
      {historyMode === "dateList" && (
        <div className="flex-1 overflow-y-auto p-4">
          {isLoadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <Loader2
                className="h-5 w-5 animate-spin"
                style={{ color: "var(--text-muted)" }}
              />
            </div>
          ) : chatDates.length === 0 ? (
            <p
              className="py-8 text-center text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              No past conversations.
            </p>
          ) : (
            <div className="space-y-1">
              {chatDates.map((date) => (
                <button
                  key={date}
                  onClick={() => loadPastChat(date)}
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = "var(--hover-bg)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  <Clock
                    className="mr-2 h-3.5 w-3.5"
                    style={{ color: "var(--text-muted)" }}
                  />
                  {formatDateLabel(date)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Viewing past chat mode */}
      {historyMode === "viewing" && viewingDate && (
        <>
          <div
            className="flex items-center gap-2 border-b px-4 py-2"
            style={{
              borderColor: "var(--border-light)",
              backgroundColor: "var(--surface)",
            }}
          >
            <button
              onClick={backToDateList}
              className="rounded-md p-0.5 transition-colors"
              style={{ color: "var(--text-muted)" }}
              title="Back to date list"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              {formatDateLabel(viewingDate)}
            </span>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <Loader2
                  className="h-5 w-5 animate-spin"
                  style={{ color: "var(--text-muted)" }}
                />
              </div>
            ) : viewingMessages.length === 0 ? (
              <p
                className="py-8 text-center text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                No messages for this date.
              </p>
            ) : (
              viewingMessages.map((msg) => (
                <ChatMessageBubble key={msg.id} message={msg} />
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
}
