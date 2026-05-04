import { Bot, User } from 'lucide-react';
import type { ChatMessage } from '@goalrate-app/shared';

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

export function ChatMessageBubble({ message }: ChatMessageBubbleProps): React.ReactElement {
  const isAi = message.role === 'ai';

  return (
    <div className={`flex gap-2.5 ${isAi ? '' : 'flex-row-reverse'}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isAi ? 'bg-accent-goals-light' : 'bg-surface-strong'
        }`}
      >
        {isAi ? (
          <Bot className="h-3.5 w-3.5 text-accent-goals" />
        ) : (
          <User className="h-3.5 w-3.5 text-text-secondary" />
        )}
      </div>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isAi
            ? 'bg-surface text-text-primary'
            : 'bg-text-primary text-text-inverse'
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
