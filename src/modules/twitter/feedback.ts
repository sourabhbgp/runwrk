/**
 * feedback.ts — Interactive command for managing persistent user directives.
 *
 * Lets the user add general feedback (e.g. "be funnier", "stop engaging with crypto")
 * that the agent remembers across sessions and incorporates into its system prompt.
 */

import { createInterface } from "readline";
import { bold, dim, cyan, green, red, info, success, divider } from "../../common";
import { getFeedback, addFeedback, removeFeedback } from "./memory";

// --- Helpers ---

/** Wrap readline.question in a promise for async/await usage */
function prompt(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(q, (answer) => resolve(answer));
  });
}

/** Display all current feedback entries with numbered indices */
function showFeedback(): void {
  const entries = getFeedback();
  if (entries.length === 0) {
    info("No feedback directives yet. Add one to guide the agent's behavior.");
    return;
  }

  console.log(`\n${bold(cyan("Current Directives"))}\n`);
  for (let i = 0; i < entries.length; i++) {
    console.log(`  ${dim(`${i + 1}.`)} ${entries[i]}`);
  }
  console.log();
}

// --- Main Command ---

/** Interactive loop for viewing, adding, and removing feedback directives */
export async function twitterFeedback(): Promise<void> {
  console.log(`\n${bold(cyan("myteam twitter feedback"))} ${dim("— manage agent directives")}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Show existing entries on launch
  showFeedback();

  // Main loop — add, remove, or exit
  while (true) {
    const choice = await prompt(
      rl,
      `${cyan("?")} [${bold("a")}]dd [${bold("r")}]emove [${bold("q")}]uit: `
    );

    const c = choice.trim().toLowerCase();

    // Quit
    if (c === "q" || c === "quit" || c === "exit") {
      break;
    }

    // Add new feedback directive
    if (c === "a" || c === "add") {
      const text = await prompt(rl, `${cyan(">")} Directive: `);
      const trimmed = text.trim();
      if (!trimmed) {
        info("Empty input — skipped.");
        continue;
      }
      addFeedback(trimmed);
      success(`Added: "${trimmed}"`);
      showFeedback();
      continue;
    }

    // Remove an existing entry by number
    if (c === "r" || c === "remove") {
      const entries = getFeedback();
      if (entries.length === 0) {
        info("Nothing to remove.");
        continue;
      }
      showFeedback();
      const numStr = await prompt(rl, `${cyan("?")} Entry number to remove: `);
      const num = parseInt(numStr, 10);
      if (isNaN(num) || num < 1 || num > entries.length) {
        info("Invalid number — skipped.");
        continue;
      }
      const removed = entries[num - 1];
      removeFeedback(num - 1);
      success(`Removed: "${removed}"`);
      showFeedback();
      continue;
    }

    // Unrecognized input
    info("Unknown option. Use [a]dd, [r]emove, or [q]uit.");
  }

  rl.close();
  divider();
  console.log(dim("Directives saved. They'll be used in your next engagement session.\n"));
}
