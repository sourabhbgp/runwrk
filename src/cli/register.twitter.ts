/** Registers the `myteam twitter` command and its subcommands */
import type { Command } from "commander";

export function registerTwitterCommand(program: Command): void {
  const twitter = program
    .command("twitter")
    .description("Twitter engagement tools")
    .option("--manual", "Run in interactive mode (default: auto)", false)
    .option("-w, --workflow <name>", "Workflow to run")
    .action(async (opts: { manual: boolean; workflow?: string }) => {
      // Require --workflow — show available workflows if missing
      if (!opts.workflow) {
        const { listWorkflows } = await import("../modules/twitter/workflow");
        const { ensureMigrated } = await import("../modules/twitter/workflow.migrate");
        const { bold, dim, cyan, yellow, info, error: err } = await import("../common");

        ensureMigrated();
        const workflows = listWorkflows();

        if (workflows.length === 0) {
          err("No workflows found. Create one first:");
          console.log(dim(`  myteam twitter workflow create\n`));
        } else {
          err("Missing required --workflow flag.");
          console.log(`\n${bold("Available workflows:")}`);
          for (const name of workflows) {
            console.log(`  ${yellow(name)}`);
          }
          console.log(dim(`\nUsage: myteam twitter -w <name>`));
          console.log(dim(`       myteam twitter workflow create\n`));
        }
        process.exit(1);
      }

      const { twitter } = await import("../modules/twitter");
      await twitter({ manual: opts.manual, workflow: opts.workflow });
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
    .option("-w, --workflow <name>", "Show stats for a specific workflow")
    .action(async (opts: { workflow?: string }) => {
      const { twitterStats } = await import("../modules/twitter");
      await twitterStats({ workflow: opts.workflow });
    });

  // Subcommand: manage persistent agent directives
  twitter
    .command("feedback")
    .description("Manage persistent agent directives (e.g. 'be funnier', 'avoid crypto')")
    .requiredOption("-w, --workflow <name>", "Workflow to manage feedback for")
    .action(async (opts: { workflow: string }) => {
      const { twitterFeedback } = await import("../modules/twitter");
      await twitterFeedback({ workflow: opts.workflow });
    });

  // --- Workflow Management Subcommands ---
  const wfCmd = twitter
    .command("workflow")
    .description("Manage engagement workflows (campaigns)");

  // workflow create — interactive guided setup
  wfCmd
    .command("create")
    .description("Create a new engagement workflow from a template")
    .action(async () => {
      const { workflowCreate } = await import("../modules/twitter");
      await workflowCreate();
    });

  // workflow list — show all workflows
  wfCmd
    .command("list")
    .description("List all workflows with template and creation date")
    .action(async () => {
      const { workflowList } = await import("../modules/twitter");
      await workflowList();
    });

  // workflow edit — edit an existing workflow
  wfCmd
    .command("edit")
    .description("Edit an existing workflow's configuration")
    .requiredOption("-w, --workflow <name>", "Workflow to edit")
    .action(async (opts: { workflow: string }) => {
      const { workflowEdit } = await import("../modules/twitter");
      await workflowEdit({ workflow: opts.workflow });
    });

  // workflow delete — delete a workflow
  wfCmd
    .command("delete")
    .description("Permanently delete a workflow and its engagement history")
    .requiredOption("-w, --workflow <name>", "Workflow to delete")
    .action(async (opts: { workflow: string }) => {
      const { workflowDelete } = await import("../modules/twitter");
      await workflowDelete({ workflow: opts.workflow });
    });
}
