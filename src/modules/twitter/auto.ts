/**
 * auto.ts — Autonomous engagement mode (triggered by `myteam twitter --auto`).
 *
 * Claude analyzes each tweet and takes action automatically, respecting session
 * limits. All decisions (including skips) are logged to memory for learning.
 * Prints a summary and action log at the end.
 */

import { bold, dim, cyan, green, yellow, success, info, error, spinner, divider } from "../../common";
import { postTweet, likeTweet, retweet } from "./api";
import { analyzeTweet } from "./agent";
import { logReply, logLike, logRetweet, logSkip, getDailyCount } from "./memory";
import type { FeedItem } from "./feed";
import type { TwitterConfig } from "./config";
import { fetchThread } from "./feed";

/** Run the auto engagement loop — Claude decides and acts, limits enforced.
 *  Iterates through all feed items, skipping already-engaged tweets,
 *  and logs every action for learning and audit purposes. */
export async function runAuto(items: FeedItem[], config: TwitterConfig) {
  console.log(`${bold(yellow("Auto mode"))} ${dim("— Claude decides, limits enforced")}\n`);

  const actions = { replies: 0, likes: 0, retweets: 0, skipped: 0 };
  const log: string[] = [];

  for (const item of items) {
    // Skip tweets we've already engaged with in a previous session
    if (item.alreadyEngaged) continue;

    // Stop if both reply and like limits are reached
    if (
      actions.replies >= config.limits.maxRepliesPerSession &&
      actions.likes >= config.limits.maxLikesPerSession
    ) {
      info("Session limits reached. Stopping.");
      break;
    }

    // Fetch thread context for mentions so Claude has full conversation
    if (item.type === "mention" && !item.thread) {
      item.thread = await fetchThread(item.tweet.id);
    }

    // --- Claude Analysis ---
    const spin = spinner(`Analyzing @${item.tweet.username}...`);
    let analysis;
    try {
      analysis = await analyzeTweet(item);
    } catch (e: any) {
      spin.stop();
      error(`Analysis failed: ${e.message}`);
      continue;
    }
    spin.stop();

    const action = analysis.action;

    // --- Handle Skip ---
    if (action === "skip") {
      logSkip(item.tweet.username, item.tweet.text, analysis.reason);
      actions.skipped++;
      log.push(`${dim("skip")} @${item.tweet.username}: ${analysis.reason}`);
      continue;
    }

    // --- Handle Like ---
    if (action === "like") {
      if (actions.likes >= config.limits.maxLikesPerSession) continue;
      try {
        await likeTweet(item.tweet.id, config);
        logLike(item.tweet.id);
        actions.likes++;
        log.push(`${green("like")} @${item.tweet.username}`);
        success(`Liked @${item.tweet.username}`);
      } catch (e: any) {
        error(`Like failed: ${e.message}`);
      }
      continue;
    }

    // --- Handle Retweet ---
    if (action === "retweet") {
      try {
        await retweet(item.tweet.id, config);
        logRetweet(item.tweet.id);
        actions.retweets++;
        log.push(`${green("RT")} @${item.tweet.username}`);
        success(`Retweeted @${item.tweet.username}`);
      } catch (e: any) {
        error(`Retweet failed: ${e.message}`);
      }
      continue;
    }

    // --- Handle Reply / Quote ---
    if (action === "reply" || action === "quote") {
      if (actions.replies >= config.limits.maxRepliesPerSession) continue;
      // Skip if Claude didn't provide draft text
      if (!analysis.draft) {
        actions.skipped++;
        continue;
      }

      try {
        if (action === "reply") {
          await postTweet(analysis.draft, { replyTo: item.tweet.id }, config);
          logReply(item.tweet.id, item.tweet.userId, item.tweet.username, analysis.draft);
          log.push(`${green("reply")} @${item.tweet.username}: ${dim(analysis.draft.slice(0, 60))}`);
          success(`Replied to @${item.tweet.username}`);
        } else {
          await postTweet(analysis.draft, { quote: item.tweet.id }, config);
          logReply(item.tweet.id, item.tweet.userId, item.tweet.username, `[QT] ${analysis.draft}`);
          log.push(`${green("quote")} @${item.tweet.username}: ${dim(analysis.draft.slice(0, 60))}`);
          success(`Quoted @${item.tweet.username}`);
        }
        actions.replies++;
      } catch (e: any) {
        error(`${action} failed: ${e.message}`);
      }
      continue;
    }

    // Unrecognized action from Claude — treat as skip
    actions.skipped++;
  }

  // --- Session Summary ---
  console.log(`\n${bold(cyan("Auto Session Summary"))}`);
  divider();
  console.log(`  ${green(String(actions.replies))} replies`);
  console.log(`  ${green(String(actions.likes))} likes`);
  console.log(`  ${green(String(actions.retweets))} retweets`);
  console.log(`  ${dim(String(actions.skipped))} skipped`);
  divider();

  // Print detailed action log if any actions were taken
  if (log.length > 0) {
    console.log(`\n${bold("Action Log:")}`);
    for (const entry of log) {
      console.log(`  ${entry}`);
    }
    console.log();
  }
}
