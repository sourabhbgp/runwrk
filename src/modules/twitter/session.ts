/**
 * session.ts — Interactive engagement session (the main `myteam twitter` command).
 *
 * Fetches the feed, presents each tweet to the user with Claude's analysis,
 * and provides an action menu: reply, like, quote, retweet, skip, block, post, or exit.
 * Logs all actions (including skips and blocks) to memory for future learning.
 */

import { createInterface } from "readline";
import {
  bold, dim, cyan, yellow, green, red,
  error, info, success, spinner, readEnv, divider,
} from "../../common";
import { createTwitterClient, postTweet, likeTweet, retweet } from "./api";
import { readConfig } from "./config";
import { fetchFeed, fetchThread, type FeedItem } from "./feed";
import { analyzeTweet, craftReply, composeTweet } from "./agent";
import {
  logReply, logLike, logRetweet, logPost, logSkip, blockAccount,
  getDailyCount,
} from "./memory";
import { runAuto } from "./auto";

// --- Helpers ---

/** Wrap readline.question in a promise for async/await usage */
function prompt(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(q, (answer) => resolve(answer));
  });
}

/** Format a feed item for terminal display with type badge, stats, and engagement status */
function formatTweet(item: FeedItem): string {
  const badge =
    item.type === "mention" ? yellow("[mention]") :
    item.type === "timeline" ? cyan("[timeline]") :
    dim("[discovery]");

  const stats = dim(`${item.tweet.likes}L ${item.tweet.retweets}RT ${item.tweet.replies}R`);
  const engaged = item.alreadyEngaged ? dim(" (already engaged)") : "";

  return `${badge} ${bold(`@${item.tweet.username}`)} ${stats}${engaged}\n${item.tweet.text}`;
}

/** Print a summary of all actions taken during the session */
function sessionSummary(actions: Record<string, number>): void {
  console.log(`\n${bold(cyan("Session Summary"))}`);
  divider();
  const entries = Object.entries(actions).filter(([, v]) => v > 0);
  if (entries.length === 0) {
    console.log(dim("  No actions taken."));
  } else {
    for (const [action, count] of entries) {
      console.log(`  ${green(String(count))} ${action}`);
    }
  }
  divider();
  console.log();
}

// --- Main Session ---

/** Run the interactive Twitter engagement session.
 *  Validates credentials, fetches the feed, then loops through each tweet
 *  presenting Claude's suggestion and the action menu. */
export async function twitter(opts: { auto?: boolean } = {}) {
  // --- Credential Validation ---
  const env = readEnv();
  const apiKey = env.TWITTER_API_KEY;
  if (!apiKey) {
    error("No Twitter API key. Run `myteam twitter setup` first.");
    process.exit(1);
  }
  const anthropicKey = env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    error("No Anthropic API key. Run `myteam setup` first.");
    process.exit(1);
  }

  createTwitterClient(apiKey);
  const config = readConfig();

  console.log(`\n${bold(cyan("myteam twitter"))} ${dim("— engagement session")}\n`);

  // --- Feed Loading ---
  const spin = spinner("Fetching feed...");
  const { items, counts } = await fetchFeed();
  spin.stop();

  console.log(
    `${yellow(`${counts.mentions}`)} mentions  ` +
    `${cyan(`${counts.timeline}`)} timeline  ` +
    `${dim(`${counts.discovery}`)} discovery  ` +
    `${dim(`(${items.length} total)`)}\n`
  );

  if (items.length === 0) {
    info("No tweets to engage with. Try adding topics/keywords in config.");
    return;
  }

  // --- Auto Mode Handoff ---
  if (opts.auto) {
    await runAuto(items, config);
    return;
  }

  // --- Interactive Loop ---
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const actions: Record<string, number> = { replies: 0, likes: 0, retweets: 0, posts: 0, skipped: 0 };

  // Print summary on Ctrl+C / stream close
  rl.on("close", () => {
    sessionSummary(actions);
    process.exit(0);
  });

  for (const item of items) {
    divider();
    console.log(formatTweet(item));
    console.log();

    // Fetch thread context for mentions so Claude has the full conversation
    if (item.type === "mention" && !item.thread) {
      item.thread = await fetchThread(item.tweet.id);
    }

    // --- Claude Analysis ---
    const spin2 = spinner("Analyzing...");
    const analysis = await analyzeTweet(item);
    spin2.stop();

    console.log(
      `${dim("Suggestion:")} ${bold(analysis.action)} ${dim(`— ${analysis.reason}`)}`
    );
    if (analysis.draft) {
      console.log(`${dim("Draft:")} ${analysis.draft}`);
    }
    console.log();

    // --- Action Menu ---
    const choice = await prompt(
      rl,
      `${cyan("?")} [${bold("r")}]eply [${bold("l")}]ike [${bold("q")}]uote [${bold("R")}]T [${bold("s")}]kip [${bold("b")}]lock [${bold("p")}]ost original [${bold("x")}]exit: `
    );

    const c = choice.trim().toLowerCase();

    // Exit the session
    if (c === "x") {
      break;
    }

    // Skip — log the skip reason for learning, then move to next tweet
    if (c === "s" || c === "") {
      logSkip(item.tweet.username, item.tweet.text, analysis.reason);
      actions.skipped++;
      continue;
    }

    // Block — permanently block this account and skip
    if (c === "b") {
      blockAccount(item.tweet.username);
      logSkip(item.tweet.username, item.tweet.text, "User blocked account");
      actions.skipped++;
      success(`Blocked @${item.tweet.username} — they won't appear in future sessions`);
      continue;
    }

    // Like
    if (c === "l") {
      if (actions.likes >= config.limits.maxLikesPerSession) {
        info(`Like limit reached (${config.limits.maxLikesPerSession}/session). Skipping.`);
        continue;
      }
      try {
        await likeTweet(item.tweet.id, config);
        logLike(item.tweet.id);
        actions.likes++;
        success(`Liked @${item.tweet.username}'s tweet`);
      } catch (e: any) {
        error(`Failed to like: ${e.message}`);
      }
      continue;
    }

    // Retweet
    if (c === "rt" || c === "R") {
      try {
        await retweet(item.tweet.id, config);
        logRetweet(item.tweet.id);
        actions.retweets++;
        success(`Retweeted @${item.tweet.username}'s tweet`);
      } catch (e: any) {
        error(`Failed to retweet: ${e.message}`);
      }
      continue;
    }

    // Reply — use Claude's draft if available, otherwise generate one
    if (c === "r") {
      if (actions.replies >= config.limits.maxRepliesPerSession) {
        info(`Reply limit reached (${config.limits.maxRepliesPerSession}/session). Skipping.`);
        continue;
      }

      // Reuse Claude's draft if analysis already suggested a reply
      let draft = analysis.action === "reply" && analysis.draft ? analysis.draft : null;
      if (!draft) {
        const spin3 = spinner("Crafting reply...");
        draft = await craftReply(item);
        spin3.stop();
      }

      console.log(`\n${dim("Reply:")} ${draft}\n`);
      const confirm = await prompt(rl, `${cyan("?")} [${bold("a")}]pprove [${bold("e")}]dit [${bold("s")}]kip: `);
      const cc = confirm.trim().toLowerCase();

      if (cc === "s") {
        actions.skipped++;
        continue;
      }

      let finalText = draft;
      if (cc === "e") {
        const edited = await prompt(rl, `${cyan(">")} `);
        if (edited.trim()) finalText = edited.trim();
      }

      try {
        const tweetId = await postTweet(finalText, { replyTo: item.tweet.id }, config);
        logReply(item.tweet.id, item.tweet.userId, item.tweet.username, finalText);
        actions.replies++;
        success(`Replied to @${item.tweet.username}`);
      } catch (e: any) {
        error(`Failed to reply: ${e.message}`);
      }
      continue;
    }

    // Quote tweet
    if (c === "q") {
      if (actions.replies >= config.limits.maxRepliesPerSession) {
        info(`Reply limit reached (${config.limits.maxRepliesPerSession}/session). Skipping.`);
        continue;
      }

      const spin3 = spinner("Crafting quote tweet...");
      const draft = await craftReply(item, "Write a quote tweet commentary, not a direct reply.");
      spin3.stop();

      console.log(`\n${dim("Quote:")} ${draft}\n`);
      const confirm = await prompt(rl, `${cyan("?")} [${bold("a")}]pprove [${bold("e")}]dit [${bold("s")}]kip: `);
      const cc = confirm.trim().toLowerCase();

      if (cc === "s") {
        actions.skipped++;
        continue;
      }

      let finalText = draft;
      if (cc === "e") {
        const edited = await prompt(rl, `${cyan(">")} `);
        if (edited.trim()) finalText = edited.trim();
      }

      try {
        await postTweet(finalText, { quote: item.tweet.id }, config);
        logReply(item.tweet.id, item.tweet.userId, item.tweet.username, `[QT] ${finalText}`);
        actions.replies++;
        success(`Quoted @${item.tweet.username}'s tweet`);
      } catch (e: any) {
        error(`Failed to quote tweet: ${e.message}`);
      }
      continue;
    }

    // Post original tweet (unrelated to current feed item)
    if (c === "p") {
      if (getDailyCount("posts") >= config.limits.maxPostsPerDay) {
        info(`Daily post limit reached (${config.limits.maxPostsPerDay}/day). Skipping.`);
        continue;
      }

      const spin3 = spinner("Composing tweet...");
      const draft = await composeTweet();
      spin3.stop();

      console.log(`\n${dim("Tweet:")} ${draft}\n`);
      const confirm = await prompt(rl, `${cyan("?")} [${bold("a")}]pprove [${bold("e")}]dit [${bold("s")}]kip: `);
      const cc = confirm.trim().toLowerCase();

      if (cc === "s") {
        actions.skipped++;
        continue;
      }

      let finalText = draft;
      if (cc === "e") {
        const edited = await prompt(rl, `${cyan(">")} `);
        if (edited.trim()) finalText = edited.trim();
      }

      try {
        const tweetId = await postTweet(finalText, undefined, config);
        logPost(tweetId ?? "unknown", finalText);
        actions.posts++;
        success("Posted tweet");
      } catch (e: any) {
        error(`Failed to post: ${e.message}`);
      }
      continue;
    }

    // Unrecognized input — treat as skip
    actions.skipped++;
  }

  sessionSummary(actions);
  rl.close();
}
