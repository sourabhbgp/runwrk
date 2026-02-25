/**
 * auto.ts — Autonomous engagement mode (triggered by `myteam twitter` default).
 *
 * Claude analyzes each tweet and takes action automatically, respecting session
 * and global limits. When a workflow is provided, uses its strategy and limits.
 * All decisions (including skips) are logged to workflow-scoped memory for learning.
 */

import { bold, dim, yellow, success, info, error, spinner } from "../../common";
import { postTweet, likeTweet, retweet } from "./api";
import { analyzeTweet } from "./agent";
import { logReply, logLike, logRetweet, logSkip } from "./memory";
import { getGlobalDailyPostCount, incrementGlobalDailyPosts } from "./workflow";
import type { FeedItem } from "./feed";
import type { TwitterConfig } from "./config";
import type { WorkflowConfig } from "./workflow.types";
import { fetchThread } from "./feed";
import { sessionSummary } from "./session";

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

  const actions = { replies: 0, quotes: 0, likes: 0, retweets: 0, skipped: 0 };
  let processed = 0;

  for (const item of items) {
    // Skip tweets we've already engaged with in a previous session
    if (item.alreadyEngaged) continue;

    // Stop if both reply+quote and like limits are reached
    const totalReplies = actions.replies + actions.quotes;
    if (
      totalReplies >= limits.maxRepliesPerSession &&
      actions.likes >= limits.maxLikesPerSession
    ) {
      info(`Session limits reached (${actions.replies} replies, ${actions.quotes} quotes, ${actions.likes} likes). Stopping.`);
      break;
    }

    // Progress logging every 5 processed items so user can see activity
    processed++;
    if (processed % 5 === 0) {
      console.log(dim(`  [progress] ${processed} analyzed — ${actions.replies} replies, ${actions.quotes} quotes, ${actions.likes} likes, ${actions.skipped} skipped`));
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
      continue;
    }

    // --- Handle Like ---
    if (action === "like") {
      if (actions.likes >= limits.maxLikesPerSession) continue;
      try {
        await likeTweet(item.tweet.id, config);
        logLike(item.tweet.id, workflowName);
        actions.likes++;
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
        success(`Retweeted @${item.tweet.username}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        error(`Retweet failed: ${msg}`);
      }
      continue;
    }

    // --- Handle Reply / Quote ---
    if (action === "reply" || action === "quote") {
      // Replies and quotes share the same session limit (both create tweets)
      if (actions.replies + actions.quotes >= limits.maxRepliesPerSession) continue;
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
          actions.replies++;
          success(`Replied to @${item.tweet.username}`);
        } else {
          await postTweet(analysis.draft, { quote: item.tweet.id }, config);
          logReply(item.tweet.id, item.tweet.userId, item.tweet.username, `[QT] ${analysis.draft}`, workflowName);
          incrementGlobalDailyPosts();
          actions.quotes++;
          success(`Quoted @${item.tweet.username}`);
        }
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
  sessionSummary(actions);
}
