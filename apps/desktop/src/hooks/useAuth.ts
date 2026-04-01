/**
 * Desktop Authentication Hook
 *
 * Re-exports useAuth from AuthContext for convenience.
 * This allows importing from hooks/ directory consistently.
 */

export { useAuth } from '../context/AuthContext';
export type { DesktopAuthContextValue } from '../types/auth';
