import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@goalrate-app/ui/primitives';
import { Alert, AlertDescription } from '@goalrate-app/ui/feedback';

export default function IntegrationCallbackPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState<string>('Connecting integration...');
  const [isOAuthWindow, setIsOAuthWindow] = useState(false);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const hasTauri =
    typeof window !== 'undefined' &&
    Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
  const syncError = !code || !state
    ? 'Missing integration callback data. Please try again.'
    : !hasTauri
      ? 'Finish connecting inside the GoalRate app window. This page cannot complete the setup.'
      : null;

  const formatInvokeError = useCallback((err: unknown): string => {
    if (!err) {
      return 'Unknown error.';
    }

    if (typeof err === 'string') {
      try {
        const parsed = JSON.parse(err) as { code?: string; message?: string };
        if (parsed?.message) {
          return parsed.code ? `[${parsed.code}] ${parsed.message}` : parsed.message;
        }
      } catch {
        // Not JSON, keep original string.
      }
      return err;
    }

    if (err instanceof Error) {
      return err.message;
    }

    if (typeof err === 'object') {
      const data = err as { code?: string; message?: string };
      if (data?.message) {
        return data.code ? `[${data.code}] ${data.message}` : data.message;
      }
      try {
        return JSON.stringify(err);
      } catch {
        return 'Unknown error.';
      }
    }

    return String(err);
  }, []);

  useEffect(() => {
    if (syncError) {
      return;
    }

    const run = async (): Promise<void> => {
      try {
        const currentWindow = getCurrentWebviewWindow();
        setIsOAuthWindow(currentWindow.label.startsWith('integration-oauth-'));

        await invoke('complete_integration_oauth', {
          code,
          state,
        });
        await emit('integration-connected');
        const mainWindow = await WebviewWindow.getByLabel('main');
        if (mainWindow) {
          await mainWindow.setFocus();
        }
        setStatus('success');
        setMessage('Integration connected. You can close this window.');
      } catch (err) {
        console.error('Integration callback failed:', err);
        setStatus('error');
        setMessage(formatInvokeError(err));
      }
    };

    run();
  }, [code, formatInvokeError, hasTauri, state, syncError]);

  const displayStatus = syncError ? 'error' : status;
  const displayMessage = syncError ?? message;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Integration Setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {displayStatus === 'error' && (
            <Alert variant="destructive">
              <AlertDescription>{displayMessage}</AlertDescription>
            </Alert>
          )}
          {displayStatus !== 'error' && (
            <p className="text-sm text-muted-foreground">{displayMessage}</p>
          )}
          {!isOAuthWindow && (
            <Button onClick={() => navigate('/focus')} className="w-full">
              Return to Focus
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
