/** Builds and exports the Commander program with all registered commands */
import { Command } from "commander";
import { registerSetupCommand } from "./register.setup";
import { registerChatCommand } from "./register.chat";
import { registerTwitterCommand } from "./register.twitter";

/** Creates the top-level CLI program and registers all commands */
export function buildProgram(): Command {
  const program = new Command("myteam")
    .version("1.0.0")
    .description("AI marketing team for developers");

  registerSetupCommand(program);
  registerChatCommand(program);
  registerTwitterCommand(program);

  return program;
}
