/**
 * Global test setup — runs before every test file.
 *
 * Silences console output so tests stay clean. Individual tests can still
 * assert via spy.mock.calls when needed.
 */

import { vi, beforeEach } from "vitest";

// Silence console methods globally — prevents noisy output during test runs
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
