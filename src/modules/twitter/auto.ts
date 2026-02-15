import { bold, dim, cyan, green, yellow, success, info, error, spinner, divider } from "../../common";
import { postTweet, likeTweet, retweet } from "./api";
import { analyzeTweet } from "./agent";
import { logReply, logLike, logRetweet, getDailyCount } from "./memory";
import type { FeedItem } from "./feed";
import type { TwitterConfig } from "./config";
import { fetchThread } from "./feed";

export async function runAuto(items: FeedItem[], config: TwitterConfig) {
  console.log(`${bold(yellow("Auto mode"))} ${dim("— Claude decides, limits enforced")}\n`);

  const actions = { replies: 0, likes: 0, retweets: 0, skipped: 0 };
  const log: string[] = [];

  for (const item of items) {
    if (item.alreadyEngaged) continue;

    // Check session limits
    if (
      actions.replies >= config.limits.maxRepliesPerSession &&
      actions.likes >= config.limits.maxLikesPerSession
    ) {
      info("Session limits reached. Stopping.");
      break;
    }

    // Get thread context for mentions
    if (item.type === "mention" && !item.thread) {
      item.thread = await fetchThread(item.tweet.id);
    }

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

    // Extra safety: skip if unsure or controversial
    if (action === "skip") {
      actions.skipped++;
      log.push(`${dim("skip")} @${item.tweet.username}: ${analysis.reason}`);
      continue;
    }

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

    if (action === "reply" || action === "quote") {
      if (actions.replies >= config.limits.maxRepliesPerSession) continue;
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

    actions.skipped++;
  }

  // Summary
  console.log(`\n${bold(cyan("Auto Session Summary"))}`);
  divider();
  console.log(`  ${green(String(actions.replies))} replies`);
  console.log(`  ${green(String(actions.likes))} likes`);
  console.log(`  ${green(String(actions.retweets))} retweets`);
  console.log(`  ${dim(String(actions.skipped))} skipped`);
  divider();

  if (log.length > 0) {
    console.log(`\n${bold("Action Log:")}`);
    for (const entry of log) {
      console.log(`  ${entry}`);
    }
    console.log();
  }
}
