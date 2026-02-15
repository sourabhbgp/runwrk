import { readEnv, writeEnv, normalizeKeyInput, bold, dim, success, error, info, ask, spinner, banner } from "../../common";
import { createAnthropicClient } from "./anthropic";

export async function setup() {
  banner();
  console.log(`${bold("Setup")} — Configure API keys\n`);

  const env = readEnv();

  // Anthropic API Key
  const currentKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  const isRealKey = currentKey?.startsWith("sk-ant-");

  if (isRealKey) {
    const preview = currentKey.slice(0, 4) + "..." + currentKey.slice(-4);
    info(`Anthropic API key: ${dim(preview)}`);
    const keep = ask("Use this key? (Y/n)");
    if (keep?.toLowerCase() === "n") {
      const key = ask("Enter Anthropic API key");
      if (key) env.ANTHROPIC_API_KEY = normalizeKeyInput(key);
    }
  } else {
    if (currentKey) info(`Anthropic API key looks invalid: ${dim(currentKey.slice(0, 10) + "...")}`);
    const key = ask("Enter Anthropic API key");
    if (key) env.ANTHROPIC_API_KEY = normalizeKeyInput(key);
  }

  // Verify Anthropic connection
  if (env.ANTHROPIC_API_KEY) {
    const spin = spinner("Verifying Anthropic API...");
    try {
      const client = createAnthropicClient(env.ANTHROPIC_API_KEY);
      await client.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 10,
        messages: [{ role: "user", content: "hi" }],
      });
      spin.stop();
      writeEnv(env);
      success("Authorized");
    } catch (e: any) {
      spin.stop();
      error(`Anthropic API failed: ${e.message}`);
    }
  }
}
