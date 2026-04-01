/**
 * Type declarations for @goalrate-app/storage subpath exports
 *
 * The storage package has DTS temporarily disabled. These declarations
 * provide type safety for the desktop app until DTS is re-enabled.
 */

declare module '@goalrate-app/storage/react' {
  import { ReactNode } from 'react';
  import type { StorageAdapter } from '@goalrate-app/storage';
  import type { FocusCandidate, FocusDay, FocusVelocity } from '@goalrate-app/shared';

  export interface StorageResult<T> {
    success: boolean;
    data?: T;
    error?: {
      code: string;
      message: string;
    };
  }

  export interface StorageProviderProps {
    adapter: StorageAdapter;
    children: ReactNode;
  }

  export function StorageProvider(props: StorageProviderProps): JSX.Element;
  export function useStorage(): StorageAdapter;
  export function useFocus(date?: string): UseFocusReturn;
  export function useTodayFocus(): UseFocusReturn;

  export interface UseFocusReturn {
    focusDay: FocusDay | null;
    candidates: FocusCandidate[];
    velocity: FocusVelocity | null;
    loading: boolean;
    error: string | null;
    fetchFocusDay: (date: string) => Promise<void>;
    saveFocusDay: (focusDay: FocusDay) => Promise<StorageResult<FocusDay>>;
    completeItem: (date: string, itemId: string) => Promise<StorageResult<FocusDay>>;
    deferItem: (
      date: string,
      itemId: string,
      targetDate: string
    ) => Promise<StorageResult<FocusDay>>;
    gatherCandidates: (date: string) => Promise<void>;
    fetchVelocity: () => Promise<void>;
    clearError: () => void;
  }
}

declare module '@goalrate-app/storage/desktop' {
  import type { StorageAdapter } from '@goalrate-app/storage';

  export function createDesktopStorage(): StorageAdapter;
}

declare module '@goalrate-app/storage' {
  export type { StorageAdapter } from '@goalrate-app/storage/interface';
}
