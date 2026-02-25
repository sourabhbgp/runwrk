/** Registers the `myteam daemon` command — starts the in-process scheduler loop */
import type { Command } from "commander";

export function registerDaemonCommand(program: Command): void {
  program
    .command("daemon")
    .description("Start the daemon scheduler (long-running foreground process for Docker)")
    .option("--max-concurrent <n>", "Maximum concurrent jobs", "3")
    .action(async (opts: { maxConcurrent: string }) => {
      const { startDaemon } = await import("../modules/scheduler");

      const maxConcurrent = parseInt(opts.maxConcurrent, 10) || 3;

      // Set up graceful shutdown via AbortController
      const controller = new AbortController();

      const shutdown = () => {
        console.log("\n[daemon] Received shutdown signal...");
        controller.abort();
      };

      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);

      // Force MYTEAM_DAEMON=1 so platform detection routes to daemon backend
      process.env.MYTEAM_DAEMON = "1";

      await startDaemon({
        maxConcurrent,
        signal: controller.signal,
      });
    });
}
