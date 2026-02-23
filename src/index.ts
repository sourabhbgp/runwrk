#!/usr/bin/env bun

import { bold, dim, cyan, error } from "./common";

const VERSION = "1.0.0";

const HELP = `
${bold(cyan("myteam"))} ${dim(`v${VERSION}`)}

${bold("Usage:")}
  myteam setup                    Configure API keys
  myteam chat                     Start a chat session
  myteam twitter                  Run autonomous engagement session (default)
  myteam twitter --manual         Run interactive engagement session
  myteam twitter setup            Configure Twitter credentials
  myteam twitter stats            View engagement analytics
  myteam twitter feedback         Manage agent directives (e.g. "be funnier")
  myteam --help                   Show this help
  myteam --version                Show version
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case "setup": {
      const { setup } = await import("./modules/auth");
      await setup();
      break;
    }
    case "chat": {
      const { chat } = await import("./modules/chat");
      await chat();
      break;
    }
    case "twitter": {
      const subcommand = args[1];
      if (subcommand === "setup") {
        const { twitterSetup } = await import("./modules/twitter");
        await twitterSetup();
      } else if (subcommand === "stats") {
        const { twitterStats } = await import("./modules/twitter");
        await twitterStats();
      } else if (subcommand === "feedback") {
        const { twitterFeedback } = await import("./modules/twitter");
        await twitterFeedback();
      } else {
        const { twitter } = await import("./modules/twitter");
        const manual = args.includes("--manual");
        await twitter({ manual });
      }
      break;
    }
    default: {
      error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
    }
  }
}

main().catch((e) => {
  error(e.message);
  process.exit(1);
});
