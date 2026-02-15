#!/usr/bin/env bun

import { bold, dim, cyan, error } from "./common";

const VERSION = "1.0.0";

const HELP = `
${bold(cyan("myteam"))} ${dim(`v${VERSION}`)}

${bold("Usage:")}
  myteam setup                    Configure API keys
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
