/** Registers the `runwrk setup` command for API key configuration */
import type { Command } from "commander";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Configure Anthropic API key")
    .action(async () => {
      const { setup } = await import("../modules/auth");
      await setup();
    });
}
