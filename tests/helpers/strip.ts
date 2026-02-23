/**
 * strip.ts — Re-export strip-ansi for convenient use in tests.
 *
 * Strips ANSI escape codes from strings so assertions can match
 * against clean text without color/formatting noise.
 */

export { default as stripAnsi } from "strip-ansi";
