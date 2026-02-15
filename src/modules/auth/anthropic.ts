import Anthropic from "@anthropic-ai/sdk";

export function isOAuthToken(key: string): boolean {
  return key.includes("sk-ant-oat");
}

export function createAnthropicClient(key: string): Anthropic {
  if (isOAuthToken(key)) {
    return new Anthropic({
      apiKey: "",
      authToken: key,
      defaultHeaders: {
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
        "user-agent": "claude-cli/2.1.2 (external, cli)",
        "x-app": "cli",
      },
    });
  }
  return new Anthropic({ apiKey: key });
}
