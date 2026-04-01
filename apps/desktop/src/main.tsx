import React from 'react';
import ReactDOM from 'react-dom/client';
import { StorageProvider } from '@goalrate-app/storage/react';
import { DesktopStorageAdapter } from '@goalrate-app/storage/desktop';
import { ThemeProvider } from '@goalrate-app/ui/theme';
import App from './App';
import './index.css';

// Initialize Tauri-based desktop storage adapter
const storage = new DesktopStorageAdapter();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <StorageProvider adapter={storage}>
        <App />
      </StorageProvider>
    </ThemeProvider>
  </React.StrictMode>
);
