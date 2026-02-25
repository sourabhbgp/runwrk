/** Registers the `runwrk daemon` command — starts the in-process scheduler loop */
import type { Command } from "commander";

export function registerDaemonCommand(program: Command): void {
  program
    .command("daemon")
    .description("Start the daemon scheduler (long-running foreground process for Docker)")
    .option("--max-concurrent <n>", "Maximum concurrent jobs", "3")
    .action(async (opts: { maxConcurrent: string }) => {
      const { createAppLogger, getLogger } = await import("../common");
      const { startDaemon } = await import("../modules/scheduler");

      // Initialize structured logger before daemon starts (async init for file stream)
      await createAppLogger();

      const maxConcurrent = parseInt(opts.maxConcurrent, 10) || 3;

      // Set up graceful shutdown via AbortController
      const controller = new AbortController();

      const shutdown = () => {
        getLogger().info({ component: "daemon" }, "Received shutdown signal");
        controller.abort();
      };

      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);

      // Force RUNWRK_DAEMON=1 so platform detection routes to daemon backend
      process.env.RUNWRK_DAEMON = "1";

      await startDaemon({
        maxConcurrent,
        signal: controller.signal,
      });
    });
}
