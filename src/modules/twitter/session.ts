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
  logReply, logLike, logRetweet, logPost,
  getDailyCount,
} from "./memory";
import { runAuto } from "./auto";

function prompt(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(q, (answer) => resolve(answer));
  });
}

function formatTweet(item: FeedItem): string {
  const badge =
    item.type === "mention" ? yellow("[mention]") :
    item.type === "timeline" ? cyan("[timeline]") :
    dim("[discovery]");

  const stats = dim(`${item.tweet.likes}L ${item.tweet.retweets}RT ${item.tweet.replies}R`);
  const engaged = item.alreadyEngaged ? dim(" (already engaged)") : "";

  return `${badge} ${bold(`@${item.tweet.username}`)} ${stats}${engaged}\n${item.tweet.text}`;
}

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

export async function twitter(opts: { auto?: boolean } = {}) {
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

  // Fetch feed
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

  // Auto mode
  if (opts.auto) {
    await runAuto(items, config);
    return;
  }

  // Interactive mode
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const actions: Record<string, number> = { replies: 0, likes: 0, retweets: 0, posts: 0, skipped: 0 };

  rl.on("close", () => {
    sessionSummary(actions);
    process.exit(0);
  });

  for (const item of items) {
    divider();
    console.log(formatTweet(item));
    console.log();

    // Get thread context for mentions
    if (item.type === "mention" && !item.thread) {
      item.thread = await fetchThread(item.tweet.id);
    }

    // Claude's suggestion
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

    const choice = await prompt(
      rl,
      `${cyan("?")} [${bold("r")}]eply [${bold("l")}]ike [${bold("q")}]uote [${bold("R")}]T [${bold("s")}]kip [${bold("p")}]ost original [${bold("x")}]exit: `
    );

    const c = choice.trim().toLowerCase();

    if (c === "x") {
      break;
    }

    if (c === "s" || c === "") {
      actions.skipped++;
      continue;
    }

    if (c === "l") {
      // Check session limits
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

    if (c === "r") {
      if (actions.replies >= config.limits.maxRepliesPerSession) {
        info(`Reply limit reached (${config.limits.maxRepliesPerSession}/session). Skipping.`);
        continue;
      }

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

    actions.skipped++;
  }

  sessionSummary(actions);
  rl.close();
}
