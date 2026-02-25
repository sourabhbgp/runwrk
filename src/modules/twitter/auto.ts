/**
 * auto.ts — Autonomous engagement mode (triggered by `myteam twitter` default).
 *
 * Claude analyzes each tweet and takes action automatically, respecting session
 * and global limits. When a workflow is provided, uses its strategy and limits.
 * All decisions (including skips) are logged to workflow-scoped memory for learning.
 */

import { bold, dim, yellow, success, info, error, spinner, getLogger } from "../../common";
import { postTweet, likeTweet, retweet, followUser } from "./api";
import { analyzeTweet } from "./agent";
import { logReply, logLike, logRetweet, logSkip, logFollow, hasFollowed } from "./memory";
import { getGlobalDailyPostCount, incrementGlobalDailyPosts } from "./workflow";
import type { FeedItem } from "./feed";
import type { TwitterConfig } from "./config";
import type { WorkflowConfig, WorkflowLimits } from "./workflow.types";
import { fetchThread } from "./feed";
import { sessionSummary } from "./session";

// --- Auto-Follow Helpers ---

/** Determine whether to auto-follow the author after a successful reply/quote.
 *  Rules:
 *    - Under session follow limit
 *    - Under 5K followers → always follow
 *    - 5K-50K followers → follow only if on watchAccounts
 *    - 50K+ followers → never follow
 *    - Haven't already followed this user */
function shouldAutoFollow(
  item: FeedItem,
  followsSoFar: number,
  limits: WorkflowLimits,
  workflow: WorkflowConfig | undefined,
  workflowName: string | undefined,
): boolean {
  // Session limit check
  if (followsSoFar >= limits.maxFollowsPerSession) return false;

  // Dedup — skip if we've already followed this user
  if (hasFollowed(item.tweet.userId, workflowName)) return false;

  const followers = item.tweet.followers;

  // 50K+ → never follow
  if (followers >= 50_000) return false;

  // 5K-50K → only if on watchAccounts
  if (followers >= 5_000) {
    const watchList = workflow?.watchAccounts ?? [];
    return watchList.includes(item.tweet.username);
  }

  // Under 5K → always follow (highest follow-back rate)
  return true;
}

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
  const log = getLogger().child({ component: "twitter", workflow: workflowName });
  const sessionStart = Date.now();
  console.log(`${bold(yellow("Auto mode"))} ${dim("\u2014 Claude decides, limits enforced")}\n`);

  // Use workflow limits when available, otherwise global config limits
  const limits = workflow?.limits ?? config.limits;

  const actions = { replies: 0, quotes: 0, likes: 0, retweets: 0, follows: 0, skipped: 0 };
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
      console.log(dim(`  [progress] ${processed} analyzed — ${actions.replies} replies, ${actions.quotes} quotes, ${actions.likes} likes, ${actions.follows} follows, ${actions.skipped} skipped`));
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
      log.error({ err: e, tweetId: item.tweet.id, username: item.tweet.username }, "Analysis failed");
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
        log.error({ err: e, tweetId: item.tweet.id, username: item.tweet.username }, "Like failed");
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
        log.error({ err: e, tweetId: item.tweet.id, username: item.tweet.username }, "Retweet failed");
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
        // --- Auto-follow after successful reply/quote ---
        if (shouldAutoFollow(item, actions.follows, limits, workflow, workflowName)) {
          try {
            await followUser(item.tweet.userId, config);
            logFollow(item.tweet.userId, workflowName);
            actions.follows++;
            success(`Followed @${item.tweet.username}`);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            error(`Follow failed: ${msg}`);
            log.error({ err: e, userId: item.tweet.userId, username: item.tweet.username }, "Follow failed");
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        error(`${action} failed: ${msg}`);
        log.error({ err: e, action, tweetId: item.tweet.id, username: item.tweet.username }, `${action} failed`);
      }
      continue;
    }

    // Unrecognized action from Claude — treat as skip
    actions.skipped++;
  }

  // --- Session Summary ---
  log.info({ actions, feedSize: items.length, durationMs: Date.now() - sessionStart }, "Session complete");
  sessionSummary(actions);
}
