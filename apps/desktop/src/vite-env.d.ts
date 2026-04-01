/// <reference types="vite/client" />
import './types/canvas-confetti.d.ts';
import './types/dnd-kit-core.d.ts';

declare global {
  interface ImportMetaEnv {
    readonly VITE_FEATURE_FOCUS_LIST_ENABLED?: string;
    readonly VITE_FOCUS_LIST_ENABLED?: string;
  }
}

export {};
