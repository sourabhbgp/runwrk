/**
 * timeout.ts — Generic timeout utility for wrapping async operations.
 *
 * Provides a reusable `withTimeout` function that races a promise against
 * a timer, preventing indefinite hangs on network calls or async generators.
 */

// --- TimeoutError ---

/** Custom error class for timeout failures, includes the operation label for debugging */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`Operation "${label}" timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

// --- withTimeout ---

/** Race a promise against a timeout. Resolves with the promise result if it
 *  settles in time, otherwise rejects with a TimeoutError.
 *
 *  @param promise  — the async operation to wrap
 *  @param ms       — maximum time to wait in milliseconds
 *  @param label    — human-readable name for error messages (e.g. "getNotifications")
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    // Always clear the timer to avoid dangling handles
    clearTimeout(timer);
  }
}
