import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, MessageSquare, Clock, ArrowLeft, Loader2 } from 'lucide-react';
import type { ChatMessage } from '@goalrate-app/shared';
import type { UseDailyLoopReturn } from '../../hooks/useDailyLoop';
import { ChatMessageBubble } from './ChatMessageBubble';
import { useVault } from '../../context/VaultContext';
import * as dailyLoopIpc from '../../lib/dailyLoopIpc';

type HistoryMode = 'active' | 'dateList' | 'viewing';

interface AiChatPanelProps {
  dailyLoop: UseDailyLoopReturn;
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function AiChatPanel({ dailyLoop }: AiChatPanelProps): React.ReactElement {
  const { chatHistory, plan, date: todayDate } = dailyLoop;
  const { currentVault } = useVault();
  const vaultId = currentVault?.id ?? '';

  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // History browsing state
  const [historyMode, setHistoryMode] = useState<HistoryMode>('active');
  const [chatDates, setChatDates] = useState<string[]>([]);
  const [viewingDate, setViewingDate] = useState<string | null>(null);
  const [viewingMessages, setViewingMessages] = useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Auto-scroll to bottom whenever chat history changes (active mode only)
  useEffect(() => {
    if (historyMode === 'active') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, historyMode]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !plan || isSending) {return;}

    setInput('');
    setIsSending(true);

    try {
      await dailyLoop.sendChat(text);
    } catch {
      // Error is handled in the hook
    } finally {
      setIsSending(false);
    }
  }, [input, plan, isSending, dailyLoop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const openDateList = useCallback(async () => {
    if (!vaultId) {return;}
    setHistoryMode('dateList');
    setIsLoadingHistory(true);
    try {
      const dates = await dailyLoopIpc.getChatDates(vaultId);
      // Exclude today's date — user can see today's chat in active mode
      setChatDates(dates.filter((d) => d !== todayDate));
    } catch {
      setChatDates([]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [vaultId, todayDate]);

  const loadPastChat = useCallback(async (date: string) => {
    if (!vaultId) {return;}
    setIsLoadingHistory(true);
    try {
      const pastPlan = await dailyLoopIpc.getPlan(vaultId, date);
      if (pastPlan) {
        const messages = await dailyLoopIpc.getChatHistory(vaultId, pastPlan.id);
        setViewingMessages(messages);
        setViewingDate(date);
        setHistoryMode('viewing');
      }
    } catch {
      // Stay on date list if loading fails
    } finally {
      setIsLoadingHistory(false);
    }
  }, [vaultId]);

  const backToActive = useCallback(() => {
    setHistoryMode('active');
    setViewingDate(null);
    setViewingMessages([]);
  }, []);

  const backToDateList = useCallback(() => {
    setHistoryMode('dateList');
    setViewingDate(null);
    setViewingMessages([]);
  }, []);

  const isHistoryActive = historyMode !== 'active';

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l" style={{ borderColor: 'var(--border-light)', backgroundColor: 'var(--bg-subtle)' }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-light)' }}>
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" style={{ color: 'var(--accent-goals)' }} />
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>AI Chat</h2>
        </div>
        <button
          onClick={isHistoryActive ? backToActive : openDateList}
          className="rounded-md p-1 transition-colors"
          style={{
            color: isHistoryActive ? 'var(--accent-goals)' : 'var(--text-muted)',
            backgroundColor: isHistoryActive ? 'var(--accent-goals-light)' : 'transparent',
          }}
          title={isHistoryActive ? 'Back to today' : 'Chat history'}
        >
          <Clock className="h-4 w-4" />
        </button>
      </div>

      {/* Active chat mode */}
      {historyMode === 'active' && (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {chatHistory.length === 0 && (
              <p className="py-8 text-center text-sm text-text-muted">
                {plan
                  ? 'Ask your AI Chief of Staff to reprioritize, defer, or explain your plan.'
                  : 'Generate a plan first to start chatting.'}
              </p>
            )}
            {chatHistory.map((msg) => (
              <ChatMessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border-light p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={plan ? 'Reprioritize, defer, ask...' : 'Generate a plan first'}
                disabled={!plan || isSending}
                rows={1}
                className="flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-goals focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || !plan || isSending}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-text-primary text-text-inverse transition-colors hover:bg-text-secondary disabled:opacity-30"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Date list mode */}
      {historyMode === 'dateList' && (
        <div className="flex-1 overflow-y-auto p-4">
          {isLoadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : chatDates.length === 0 ? (
            <p className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              No past conversations.
            </p>
          ) : (
            <div className="space-y-1">
              {chatDates.map((date) => (
                <button
                  key={date}
                  onClick={() => loadPastChat(date)}
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <Clock className="mr-2 h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                  {formatDateLabel(date)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Viewing past chat mode */}
      {historyMode === 'viewing' && viewingDate && (
        <>
          <div
            className="flex items-center gap-2 border-b px-4 py-2"
            style={{ borderColor: 'var(--border-light)', backgroundColor: 'var(--surface)' }}
          >
            <button
              onClick={backToDateList}
              className="rounded-md p-0.5 transition-colors"
              style={{ color: 'var(--text-muted)' }}
              title="Back to date list"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {formatDateLabel(viewingDate)}
            </span>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
              </div>
            ) : viewingMessages.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
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
