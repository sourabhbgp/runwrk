/** Barrel exports for the generic scheduler module */

// Types
export type { ScheduledJob, JobStatus, Platform, ExecutablePaths } from "./types";

// Job registry CRUD
export {
  listJobs,
  getJob,
  addJob,
  removeJob,
  updateJob,
  ensureSchedulerDir,
  getLogsDir,
} from "./jobs";

// Platform-delegated operations
export {
  detectPlatform,
  resolveExecutablePaths,
  installJob,
  uninstallJob,
  isInstalled,
  getJobStatus,
} from "./platform";

// Log management
export { readJobLogs, clearJobLogs } from "./logs";
