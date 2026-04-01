import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { TooltipProvider } from '@goalrate-app/ui/overlay';
import { UpdateProvider, useUpdate } from './context/UpdateContext';
import { AuthProvider } from './context/AuthContext';
import { VaultProvider, useVault } from './context/VaultContext';
import { PreferencesProvider } from './context/PreferencesContext';
import { QuickCaptureDialog } from './components/QuickCaptureDialog';
import { DailyLoopApp } from './pages/DailyLoopApp';

const IntegrationCallbackPage = lazy(() => import('./pages/IntegrationCallbackPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));

/**
 * Handles native menu `menu-action` events emitted from the Rust side.
 * Vault actions (new/open/close) close the current vault so IntakeFlow
 * takes over; check-updates delegates to UpdateContext.
 */
function MenuActionHandler(): null {
  const { closeVault } = useVault();
  const { checkForUpdates } = useUpdate();

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setup = async (): Promise<void> => {
      unlisten = await listen<string>('menu-action', (event) => {
        switch (event.payload) {
          case 'file:new-vault':
          case 'file:open-vault':
          case 'file:close-vault':
            closeVault().catch((err: unknown) => {
              console.error('Failed to close vault:', err);
            });
            break;
          case 'help:check-updates':
            checkForUpdates({ showError: true });
            break;
          default:
            break;
        }
      });
    };

    setup().catch((err: unknown) => {
      console.error('Failed to register menu-action listener:', err);
    });

    return (): void => {
      unlisten?.();
    };
  }, [closeVault, checkForUpdates]);

  return null;
}

/**
 * Main application content — Daily Loop is the entire app
 */
function AppContent(): React.ReactElement {
  return (
    <BrowserRouter>
      <TooltipProvider>
        <MenuActionHandler />
        <QuickCaptureDialog />
        <Suspense fallback={<div className="daily-loop-theme flex h-screen items-center justify-center" style={{ fontFamily: "'Geist', system-ui, sans-serif", backgroundColor: 'var(--bg)' }}><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p></div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/integrations/callback" element={<IntegrationCallbackPage />} />
            <Route path="/*" element={<DailyLoopApp />} />
          </Routes>
        </Suspense>
      </TooltipProvider>
    </BrowserRouter>
  );
}

/**
 * Root application component with providers
 */
function App(): React.ReactElement {
  return (
    <AuthProvider>
      <VaultProvider>
        <PreferencesProvider>
          <UpdateProvider>
            <AppContent />
          </UpdateProvider>
        </PreferencesProvider>
      </VaultProvider>
    </AuthProvider>
  );
}

export default App;
