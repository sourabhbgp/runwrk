import { createInterface } from "readline";
import { bold, dim, cyan, error, readEnv } from "../../common";
import { createAnthropicClient } from "../auth";
import { addMessage, getMessages, getSystemPrompt } from "./session";
import { handleCommand } from "./commands";

function promptUser(rl: ReturnType<typeof createInterface>): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${bold(cyan("> "))}`, (answer) => resolve(answer));
  });
}

export async function chat() {
  const env = readEnv();
  const key = env.ANTHROPIC_API_KEY;
  if (!key) {
    error("No API key found. Run `myteam setup` first.");
    process.exit(1);
  }

  const client = createAnthropicClient(key);

  console.log(`\n${bold(cyan("myteam chat"))} ${dim("— task-focused assistant")}`);
  console.log(dim("Commands: /new /remember /forget /memory /exit\n"));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on("close", () => {
    console.log(dim("\nGoodbye!\n"));
    process.exit(0);
  });

  while (true) {
    const input = await promptUser(rl);
    const trimmed = input.trim();
    if (!trimmed) continue;

    const { handled } = handleCommand(trimmed);
    if (handled) continue;

    addMessage("user", trimmed);

    try {
      const stream = client.messages.stream({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
        system: getSystemPrompt(),
        messages: getMessages(),
      });

      let fullResponse = "";
      process.stdout.write("\n");

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          process.stdout.write(event.delta.text);
          fullResponse += event.delta.text;
        }
      }

      process.stdout.write("\n\n");
      addMessage("assistant", fullResponse);
    } catch (e: any) {
      error(e.message ?? "Failed to get response from Claude.");
    }
  }
}
