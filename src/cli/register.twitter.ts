/** Registers the `myteam twitter` command and its subcommands */
import type { Command } from "commander";

export function registerTwitterCommand(program: Command): void {
  const twitter = program
    .command("twitter")
    .description("Twitter engagement tools")
    .option("--manual", "Run in interactive mode (default: auto)", false)
    .action(async (opts: { manual: boolean }) => {
      const { twitter } = await import("../modules/twitter");
      await twitter({ manual: opts.manual });
    });

  // Subcommand: configure Twitter credentials and engagement preferences
  twitter
    .command("setup")
    .description("Configure Twitter credentials and engagement preferences")
    .action(async () => {
      const { twitterSetup } = await import("../modules/twitter");
      await twitterSetup();
    });

  // Subcommand: display engagement analytics
  twitter
    .command("stats")
    .description("View engagement analytics and activity summary")
    .action(async () => {
      const { twitterStats } = await import("../modules/twitter");
      await twitterStats();
    });

  // Subcommand: manage persistent agent directives
  twitter
    .command("feedback")
    .description("Manage persistent agent directives (e.g. 'be funnier', 'avoid crypto')")
    .action(async () => {
      const { twitterFeedback } = await import("../modules/twitter");
      await twitterFeedback();
    });
}
