/** Builds and exports the Commander program with all registered commands */
import { Command, Help } from "commander";
import { registerSetupCommand } from "./register.setup";
import { registerChatCommand } from "./register.chat";
import { registerTwitterCommand } from "./register.twitter";
import { bold, dim, cyan, yellow } from "../common/ui";

// --- Custom Help Display ---

interface HelpEntry {
  cmd: string;
  desc: string;
  sub?: boolean;
}

interface HelpSection {
  title: string;
  commands: HelpEntry[];
}

/** Builds the styled, grouped command listing shown for root --help */
function getHelpText(): string {
  const lines: string[] = [];

  // Banner
  lines.push(`\n${bold(cyan("myteam"))} ${dim("— AI marketing team for developers")}\n`);
  lines.push(dim("─".repeat(50)));

  const sections: HelpSection[] = [
    {
      title: "Setup",
      commands: [
        { cmd: "setup", desc: "Configure Anthropic API key" },
      ],
    },
    {
      title: "Chat",
      commands: [
        { cmd: "chat", desc: "Start a task-focused chat session" },
        { cmd: "/new", desc: "Clear conversation and start fresh", sub: true },
        { cmd: "/remember <text>", desc: "Save a fact to persistent memory", sub: true },
        { cmd: "/forget <text>", desc: "Remove a memory matching the text", sub: true },
        { cmd: "/memory", desc: "List all saved memories", sub: true },
        { cmd: "/exit", desc: "Exit the chat (or Ctrl+D)", sub: true },
      ],
    },
    {
      title: "Twitter",
      commands: [
        { cmd: "twitter", desc: "Run autonomous engagement (default: auto)" },
        { cmd: "twitter --manual", desc: "Run interactive engagement" },
        { cmd: "twitter setup", desc: "Configure credentials and preferences" },
        { cmd: "twitter stats", desc: "View engagement analytics" },
        { cmd: "twitter feedback", desc: "Manage agent directives" },
      ],
    },
  ];

  // Each section: bold yellow header, then cyan command + dim description rows
  for (const section of sections) {
    lines.push(`\n  ${bold(yellow(section.title))}`);
    for (const { cmd, desc, sub } of section.commands) {
      if (sub) {
        // Slash commands: extra indent, dimmed to show they're in-session
        lines.push(`      ${dim(cyan(cmd.padEnd(22)))}${dim(desc)}`);
      } else {
        lines.push(`    ${cyan(cmd.padEnd(24))}${dim(desc)}`);
      }
    }
  }

  // Footer
  lines.push("");
  lines.push(dim("─".repeat(50)));
  lines.push(dim(`  v1.0.0 · Run myteam <command> --help for details\n`));

  return lines.join("\n");
}

// --- Program Builder ---

/** Creates the top-level CLI program and registers all commands */
export function buildProgram(): Command {
  const program = new Command("myteam")
    .version("1.0.0")
    .description("AI marketing team for developers");

  // Style all --help output: custom root help + colored subcommand help
  program.configureHelp({
    styleTitle: (str) => bold(str),
    styleCommandText: (str) => cyan(str),
    styleOptionText: (str) => yellow(str),
    styleDescriptionText: (str) => dim(str),
    formatHelp: (cmd, helper) => {
      // Root command → show grouped custom help
      if (!cmd.parent) {
        return getHelpText();
      }
      // Subcommands → use Commander's default layout with style hooks
      return Help.prototype.formatHelp.call(helper, cmd, helper);
    },
  });

  // Show custom help when no command is given (bare `myteam`)
  program.action(() => {
    program.outputHelp();
  });

  registerSetupCommand(program);
  registerChatCommand(program);
  registerTwitterCommand(program);

  return program;
}
