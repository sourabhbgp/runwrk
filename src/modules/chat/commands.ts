import { success, info, error, dim, bold, cyan } from "../../common";
import { reset } from "./session";
import { readMemory, appendMemory, removeMemory } from "./memory";

export function handleCommand(input: string): { handled: boolean } {
  if (!input.startsWith("/")) return { handled: false };

  const spaceIdx = input.indexOf(" ");
  const cmd = spaceIdx === -1 ? input : input.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case "/new":
      reset();
      success("Session cleared — starting fresh.");
      return { handled: true };

    case "/remember":
      if (!args) {
        error("Usage: /remember <text to save>");
        return { handled: true };
      }
      appendMemory(args);
      success(`Remembered: ${dim(args)}`);
      return { handled: true };

    case "/forget":
      if (!args) {
        error("Usage: /forget <text to match>");
        return { handled: true };
      }
      if (removeMemory(args)) {
        success(`Forgot entry matching: ${dim(args)}`);
      } else {
        error(`No memory found matching: ${dim(args)}`);
      }
      return { handled: true };

    case "/memory": {
      const facts = readMemory();
      if (facts.length === 0) {
        info("No saved memories. Use /remember <text> to add one.");
      } else {
        console.log(`\n${bold(cyan("Saved memories:"))}`);
        for (const fact of facts) {
          console.log(`  ${dim("•")} ${fact}`);
        }
        console.log();
      }
      return { handled: true };
    }

    case "/exit":
      console.log(dim("\nGoodbye!\n"));
      process.exit(0);

    default:
      error(`Unknown command: ${cmd}`);
      info("Commands: /new, /remember, /forget, /memory, /exit");
      return { handled: true };
  }
}
