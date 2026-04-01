/**
 * Types for the auto-update functionality
 */

/**
 * Information about an available update
 */
export interface UpdateInfo {
  /** The version of the available update */
  version: string;
  /** The release date of the update */
  date: string;
  /** Release notes or changelog */
  body: string;
  /** The currently installed version */
  currentVersion: string;
}

/**
 * Download progress information
 */
export interface DownloadProgress {
  /** Size of the current chunk being downloaded */
  chunkLength: number;
  /** Total content length (may be null if unknown) */
  contentLength: number | null;
}

/**
 * Possible states of the update process
 */
export type UpdateStatus =
  | 'idle'           // No update check in progress
  | 'checking'       // Checking for updates
  | 'available'      // Update is available
  | 'not-available'  // No update available (already on latest)
  | 'downloading'    // Downloading update
  | 'ready'          // Update downloaded and ready to install
  | 'error';         // An error occurred

/**
 * Complete state of the update system
 */
export interface UpdateState {
  /** Current status of the update process */
  status: UpdateStatus;
  /** Information about the available update (null if no update) */
  info: UpdateInfo | null;
  /** Download progress percentage (0-100) */
  progress: number;
  /** Error message if status is 'error' */
  error: string | null;
}
