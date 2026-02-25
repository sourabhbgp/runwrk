/** Registers the `runwrk schedule` command and its subcommands */
import type { Command } from "commander";

export function registerScheduleCommand(program: Command): void {
  const schedule = program
    .command("schedule")
    .description("Manage scheduled jobs (OS-level timers)");

  // Show help when `runwrk schedule` is run without a subcommand
  schedule.action(() => {
    schedule.outputHelp();
  });

  // --- schedule add ---
  schedule
    .command("add")
    .description("Add and install a new scheduled job")
    .requiredOption("--name <name>", "Unique job identifier")
    .requiredOption("--command <cmd>", "runwrk command to run (e.g. \"twitter -w growth\")")
    .requiredOption("--cron <expr>", "Cron expression (e.g. \"0 9,14,20 * * *\")")
    .option("--timezone <tz>", "IANA timezone (default: system)")
    .option("--description <desc>", "Human-readable description")
    .action(async (opts: {
      name: string;
      command: string;
      cron: string;
      timezone?: string;
      description?: string;
    }) => {
      const { addJob, installJob, ensureSchedulerDir } = await import("../modules/scheduler");
      const { success, error: err, info, dim } = await import("../common");

      try {
        ensureSchedulerDir();

        const job = addJob({
          name: opts.name,
          command: opts.command,
          cron: opts.cron,
          timezone: opts.timezone,
          description: opts.description,
        });

        installJob(job);

        success(`Job "${job.name}" created and installed.`);
        info(`Command: runwrk ${job.command}`);
        info(`Schedule: ${job.cron}`);
        if (job.timezone) info(`Timezone: ${job.timezone}`);
      } catch (e) {
        err((e as Error).message);
        process.exit(1);
      }
    });

  // --- schedule remove ---
  schedule
    .command("remove <name>")
    .description("Uninstall and remove a scheduled job")
    .action(async (name: string) => {
      const { getJob, removeJob, uninstallJob } = await import("../modules/scheduler");
      const { success, error: err } = await import("../common");

      const job = getJob(name);
      if (!job) {
        err(`Job "${name}" not found.`);
        process.exit(1);
      }

      try {
        uninstallJob(name);
        removeJob(name);
        success(`Job "${name}" removed and uninstalled.`);
      } catch (e) {
        err((e as Error).message);
        process.exit(1);
      }
    });

  // --- schedule list ---
  schedule
    .command("list")
    .description("List all scheduled jobs with status")
    .action(async () => {
      const { listJobs, getJobStatus } = await import("../modules/scheduler");
      const { bold, dim, cyan, yellow, green, red } = await import("../common");

      const jobs = listJobs();

      if (jobs.length === 0) {
        console.log(dim("\n  No scheduled jobs. Use `runwrk schedule add` to create one.\n"));
        return;
      }

      console.log(`\n${bold("Scheduled Jobs")}\n`);

      for (const job of jobs) {
        const status = getJobStatus(job.name);
        const stateLabel = !job.enabled
          ? yellow("paused")
          : status?.installed
            ? green("active")
            : red("not installed");

        console.log(`  ${bold(cyan(job.name))}  ${dim("—")}  ${stateLabel}`);
        console.log(`    ${dim("Command:")}  runwrk ${job.command}`);
        console.log(`    ${dim("Cron:")}     ${job.cron}`);
        if (status?.lastRun) {
          console.log(`    ${dim("Last run:")} ${status.lastRun}`);
        }
        if (status?.nextRun) {
          console.log(`    ${dim("Next run:")} ${status.nextRun}`);
        }
        console.log();
      }
    });

  // --- schedule enable ---
  schedule
    .command("enable <name>")
    .description("Re-enable a paused job (reinstalls OS timer)")
    .action(async (name: string) => {
      const { getJob, updateJob, installJob } = await import("../modules/scheduler");
      const { success, error: err } = await import("../common");

      const job = getJob(name);
      if (!job) {
        err(`Job "${name}" not found.`);
        process.exit(1);
      }

      if (job.enabled) {
        success(`Job "${name}" is already enabled.`);
        return;
      }

      try {
        const updated = updateJob(name, { enabled: true });
        installJob(updated);
        success(`Job "${name}" enabled and installed.`);
      } catch (e) {
        err((e as Error).message);
        process.exit(1);
      }
    });

  // --- schedule disable ---
  schedule
    .command("disable <name>")
    .description("Pause a job without removing it (uninstalls OS timer)")
    .action(async (name: string) => {
      const { getJob, updateJob, uninstallJob } = await import("../modules/scheduler");
      const { success, error: err } = await import("../common");

      const job = getJob(name);
      if (!job) {
        err(`Job "${name}" not found.`);
        process.exit(1);
      }

      if (!job.enabled) {
        success(`Job "${name}" is already paused.`);
        return;
      }

      try {
        uninstallJob(name);
        updateJob(name, { enabled: false });
        success(`Job "${name}" paused. Use \`runwrk schedule enable ${name}\` to resume.`);
      } catch (e) {
        err((e as Error).message);
        process.exit(1);
      }
    });

  // --- schedule logs ---
  schedule
    .command("logs <name>")
    .description("Show recent output from scheduled runs")
    .option("--lines <n>", "Number of lines to show", "50")
    .option("--clear", "Clear log files instead of reading")
    .action(async (name: string, opts: { lines: string; clear?: boolean }) => {
      const { getJob, readJobLogs, clearJobLogs } = await import("../modules/scheduler");
      const { bold, dim, cyan, success, error: err } = await import("../common");

      const job = getJob(name);
      if (!job) {
        err(`Job "${name}" not found.`);
        process.exit(1);
      }

      if (opts.clear) {
        clearJobLogs(name);
        success(`Logs cleared for "${name}".`);
        return;
      }

      const lines = parseInt(opts.lines, 10) || 50;
      const { stdout, stderr } = readJobLogs(name, lines);

      if (!stdout && !stderr) {
        console.log(dim(`\n  No logs yet for "${name}".\n`));
        return;
      }

      if (stdout) {
        console.log(`\n${bold(cyan("stdout"))}`);
        console.log(stdout);
      }
      if (stderr) {
        console.log(`\n${bold(cyan("stderr"))}`);
        console.log(stderr);
      }
      console.log();
    });
}
