/**
 * Tests for the auth/anthropic module — OAuth token detection and
 * Anthropic client instantiation with correct config per token type.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so the mock constructor is available when vi.mock's
// factory runs (vi.mock is hoisted above all other statements).
const { MockAnthropicConstructor } = vi.hoisted(() => ({
  MockAnthropicConstructor: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: MockAnthropicConstructor,
}));

import { isOAuthToken, createAnthropicClient } from "@/modules/auth/anthropic";

// --- isOAuthToken ---

describe("isOAuthToken", () => {
  it("returns true for tokens containing 'sk-ant-oat'", () => {
    expect(isOAuthToken("sk-ant-oat-abc123-xyz")).toBe(true);
  });

  it("returns false for regular API keys like 'sk-ant-api...'", () => {
    expect(isOAuthToken("sk-ant-api03-abcdef123456")).toBe(false);
  });

  it("returns false for random strings", () => {
    expect(isOAuthToken("totally-random-string")).toBe(false);
    expect(isOAuthToken("")).toBe(false);
  });
});

// --- createAnthropicClient ---

describe("createAnthropicClient", () => {
  beforeEach(() => {
    MockAnthropicConstructor.mockClear();
  });

  it("instantiates Anthropic with authToken and anthropic-beta header for OAuth tokens", () => {
    const oauthKey = "sk-ant-oat-session-token-12345";
    createAnthropicClient(oauthKey);

    expect(MockAnthropicConstructor).toHaveBeenCalledOnce();
    const args = MockAnthropicConstructor.mock.calls[0][0];

    // Should pass the OAuth token as authToken
    expect(args.authToken).toBe(oauthKey);

    // Should include the anthropic-beta header
    expect(args.defaultHeaders).toBeDefined();
    expect(args.defaultHeaders["anthropic-beta"]).toContain("oauth-2025-04-20");
  });

  it("instantiates Anthropic with just apiKey for regular API keys", () => {
    const apiKey = "sk-ant-api03-regular-key-456";
    createAnthropicClient(apiKey);

    expect(MockAnthropicConstructor).toHaveBeenCalledOnce();
    const args = MockAnthropicConstructor.mock.calls[0][0];

    // Should pass the key as apiKey
    expect(args.apiKey).toBe(apiKey);

    // Should NOT include authToken or extra headers
    expect(args.authToken).toBeUndefined();
    expect(args.defaultHeaders).toBeUndefined();
  });
});
