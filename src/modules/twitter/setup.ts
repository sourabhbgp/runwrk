/**
 * setup.ts — Interactive Twitter credential setup (the `runwrk twitter setup` command).
 *
 * Walks the user through entering their rettiwt API key (base64 cookie string),
 * verifies the connection, and configures engagement topics/keywords/accounts.
 */

import {
  readEnv, writeEnv, normalizeKeyInput,
  bold, dim, success, error, info, ask, spinner, banner,
} from "../../common";
import { readConfig, writeConfig, type TwitterConfig } from "./config";
import { createTwitterClient } from "./api";

/** Run the interactive Twitter setup flow — API key entry, verification, and config */
export async function twitterSetup() {
  banner();
  console.log(`${bold("Twitter Setup")} — Configure Twitter credentials\n`);

  const env = readEnv();

  // --- API Key ---
  const currentKey = env.TWITTER_API_KEY;
  if (currentKey) {
    // Show a masked preview of the existing key
    const preview = currentKey.slice(0, 8) + "..." + currentKey.slice(-4);
    info(`Twitter API key: ${dim(preview)}`);
    const keep = ask("Use this key? (Y/n)");
    if (keep?.toLowerCase() === "n") {
      const key = ask("Enter rettiwt API key (base64 cookie string from X Auth Helper)");
      if (key) env.TWITTER_API_KEY = normalizeKeyInput(key);
    }
  } else {
    console.log(dim("Get your API key using the X Auth Helper browser extension."));
    console.log(dim("It exports your Twitter session as a base64 cookie string.\n"));
    const key = ask("Enter rettiwt API key");
    if (key) env.TWITTER_API_KEY = normalizeKeyInput(key);
  }

  // --- Connection Verification ---
  if (env.TWITTER_API_KEY) {
    const spin = spinner("Verifying Twitter connection...");
    try {
      const client = createTwitterClient(env.TWITTER_API_KEY);
      // Fetch a known account to verify the API key works
      await client.user.details("twitter");
      spin.stop();
      writeEnv(env);
      success("Twitter connected");
    } catch (e: any) {
      spin.stop();
      error(`Twitter API failed: ${e.message}`);
      info("Make sure your API key is a valid base64 cookie string from X Auth Helper.");
      return;
    }
  } else {
    error("No API key provided.");
    return;
  }

  // --- Engagement Config ---
  console.log(`\n${bold("Engagement Config")}\n`);

  const config = readConfig();

  // Topics — broad areas of interest for feed filtering
  const topicsInput = ask(`Topics to engage with (comma-separated)${config.topics.length ? ` [${dim(config.topics.join(", "))}]` : ""}`);
  if (topicsInput?.trim()) {
    config.topics = topicsInput.split(",").map((t) => t.trim()).filter(Boolean);
  }

  // Keywords — specific terms for discovery search
  const keywordsInput = ask(`Keywords to search for (comma-separated)${config.keywords.length ? ` [${dim(config.keywords.join(", "))}]` : ""}`);
  if (keywordsInput?.trim()) {
    config.keywords = keywordsInput.split(",").map((k) => k.trim()).filter(Boolean);
  }

  // Watch accounts — specific users to monitor
  const accountsInput = ask(`Accounts to watch (comma-separated, e.g. @user1, @user2)${config.watchAccounts.length ? ` [${dim(config.watchAccounts.join(", "))}]` : ""}`);
  if (accountsInput?.trim()) {
    config.watchAccounts = accountsInput
      .split(",")
      .map((a) => a.trim().replace(/^@/, ""))
      .filter(Boolean);
  }

  writeConfig(config);
  success("Config saved to .runwrk/twitter-config.json");

  console.log(`\n${dim("Run")} ${bold("runwrk twitter")} ${dim("to start an engagement session.")}\n`);
}
