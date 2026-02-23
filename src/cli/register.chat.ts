/** Registers the `myteam chat` command for task-focused Claude sessions */
import type { Command } from "commander";

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Start a task-focused chat session with Claude")
    .action(async () => {
      const { chat } = await import("../modules/chat");
      await chat();
    });
}
