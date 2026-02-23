/**
 * auto.ts — Autonomous engagement mode (triggered by `myteam twitter` default).
 *
 * Claude analyzes each tweet and takes action automatically, respecting session
 * and global limits. When a workflow is provided, uses its strategy and limits.
 * All decisions (including skips) are logged to workflow-scoped memory for learning.
 */

import { bold, dim, cyan, green, yellow, success, info, error, spinner, divider } from "../../common";
import { postTweet, likeTweet, retweet } from "./api";
import { analyzeTweet } from "./agent";
import { logReply, logLike, logRetweet, logSkip } from "./memory";
import { getGlobalDailyPostCount, incrementGlobalDailyPosts } from "./workflow";
import type { FeedItem } from "./feed";
import type { TwitterConfig } from "./config";
import type { WorkflowConfig } from "./workflow.types";
import { fetchThread } from "./feed";

/** Run the auto engagement loop — Claude decides and acts, limits enforced.
 *  When a workflow is provided, uses its limits and passes strategy to the agent.
 *  Iterates through all feed items, skipping already-engaged tweets,
 *  and logs every action for learning and audit purposes. */
export async function runAuto(
  items: FeedItem[],
  config: TwitterConfig,
  workflow?: WorkflowConfig,
  workflowName?: string,
) {
  console.log(`${bold(yellow("Auto mode"))} ${dim("\u2014 Claude decides, limits enforced")}\n`);

  // Use workflow limits when available, otherwise global config limits
  const limits = workflow?.limits ?? config.limits;

  const actions = { replies: 0, likes: 0, retweets: 0, skipped: 0 };
  const log: string[] = [];

  for (const item of items) {
    // Skip tweets we've already engaged with in a previous session
    if (item.alreadyEngaged) continue;

    // Stop if both reply and like limits are reached
    if (
      actions.replies >= limits.maxRepliesPerSession &&
      actions.likes >= limits.maxLikesPerSession
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
      analysis = await analyzeTweet(item, workflow, workflowName);
    } catch (e: unknown) {
      spin.stop();
      const msg = e instanceof Error ? e.message : String(e);
      error(`Analysis failed: ${msg}`);
      continue;
    }
    spin.stop();

    const action = analysis.action;

    // --- Handle Skip ---
    if (action === "skip") {
      logSkip(item.tweet.username, item.tweet.text, analysis.reason, workflowName);
      actions.skipped++;
      log.push(`${dim("skip")} @${item.tweet.username}: ${analysis.reason}`);
      continue;
    }

    // --- Handle Like ---
    if (action === "like") {
      if (actions.likes >= limits.maxLikesPerSession) continue;
      try {
        await likeTweet(item.tweet.id, config);
        logLike(item.tweet.id, workflowName);
        actions.likes++;
        log.push(`${green("like")} @${item.tweet.username}`);
        success(`Liked @${item.tweet.username}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        error(`Like failed: ${msg}`);
      }
      continue;
    }

    // --- Handle Retweet ---
    if (action === "retweet") {
      try {
        await retweet(item.tweet.id, config);
        logRetweet(item.tweet.id, workflowName);
        actions.retweets++;
        log.push(`${green("RT")} @${item.tweet.username}`);
        success(`Retweeted @${item.tweet.username}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        error(`Retweet failed: ${msg}`);
      }
      continue;
    }

    // --- Handle Reply / Quote ---
    if (action === "reply" || action === "quote") {
      if (actions.replies >= limits.maxRepliesPerSession) continue;
      // Skip if Claude didn't provide draft text
      if (!analysis.draft) {
        actions.skipped++;
        continue;
      }

      // Check global daily post limit for quotes (they create new tweets)
      if (action === "quote" && getGlobalDailyPostCount() >= limits.maxPostsPerDay) {
        continue;
      }

      try {
        if (action === "reply") {
          await postTweet(analysis.draft, { replyTo: item.tweet.id }, config);
          logReply(item.tweet.id, item.tweet.userId, item.tweet.username, analysis.draft, workflowName);
          log.push(`${green("reply")} @${item.tweet.username}: ${dim(analysis.draft.slice(0, 60))}`);
          success(`Replied to @${item.tweet.username}`);
        } else {
          await postTweet(analysis.draft, { quote: item.tweet.id }, config);
          logReply(item.tweet.id, item.tweet.userId, item.tweet.username, `[QT] ${analysis.draft}`, workflowName);
          incrementGlobalDailyPosts();
          log.push(`${green("quote")} @${item.tweet.username}: ${dim(analysis.draft.slice(0, 60))}`);
          success(`Quoted @${item.tweet.username}`);
        }
        actions.replies++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        error(`${action} failed: ${msg}`);
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
