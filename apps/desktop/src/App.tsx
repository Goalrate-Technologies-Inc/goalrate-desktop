import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TooltipProvider } from '@goalrate-app/ui/overlay';
import { AuthProvider } from './context/AuthContext';
import { VaultProvider, useVault } from './context/VaultContext';
import { PreferencesProvider } from './context/PreferencesContext';
import { SubscriptionProvider } from './context/SubscriptionContext';
import { QuickCaptureDialog } from './components/QuickCaptureDialog';
import { AgendaApp } from './pages/AgendaApp';
import { attachTauriEventListener } from './lib/tauriEvents';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));

/**
 * Handles native menu `menu-action` events emitted from the Rust side.
 * Vault actions (new/open/close) close the current vault so IntakeFlow
 * takes over.
 */
function MenuActionHandler(): null {
  const { closeVault } = useVault();

  useEffect(() => {
    return attachTauriEventListener<string>(
      'menu-action',
      (event) => {
        switch (event.payload) {
          case 'file:new-vault':
          case 'file:open-vault':
          case 'file:close-vault':
            closeVault().catch((err: unknown) => {
              console.error('Failed to close vault:', err);
            });
            break;
          default:
            break;
        }
      },
      {
        onError: (err) => {
          console.error('Failed to register menu-action listener:', err);
        },
      },
    );
  }, [closeVault]);

  return null;
}

/**
 * Main application content — Agenda is the entire app
 */
function AppContent(): React.ReactElement {
  return (
    <BrowserRouter>
      <TooltipProvider>
        <MenuActionHandler />
        <QuickCaptureDialog />
        <Suspense fallback={<div className="agenda-theme flex h-screen items-center justify-center" style={{ fontFamily: "'Geist', system-ui, sans-serif", backgroundColor: 'var(--bg)' }}><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p></div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/*" element={<AgendaApp />} />
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
        <SubscriptionProvider>
          <PreferencesProvider>
            <AppContent />
          </PreferencesProvider>
        </SubscriptionProvider>
      </VaultProvider>
    </AuthProvider>
  );
}

export default App;
