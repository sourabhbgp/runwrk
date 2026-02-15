import { bold, dim, cyan, green, yellow, divider, info } from "../../common";
import { readMemory } from "./memory";

export async function twitterStats() {
  const mem = readMemory();

  console.log(`\n${bold(cyan("Twitter Engagement Stats"))}\n`);

  // Today
  const today = new Date().toISOString().slice(0, 10);
  const todayStats = mem.dailyStats[today];

  console.log(bold("Today") + dim(` (${today})`));
  divider();
  if (todayStats) {
    console.log(`  Replies:   ${green(String(todayStats.replies))}`);
    console.log(`  Likes:     ${green(String(todayStats.likes))}`);
    console.log(`  Posts:     ${green(String(todayStats.posts))}`);
    console.log(`  Retweets:  ${green(String(todayStats.retweets))}`);
    console.log(`  Follows:   ${green(String(todayStats.follows))}`);
  } else {
    console.log(dim("  No activity today."));
  }

  // This week
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekDays = Object.entries(mem.dailyStats).filter(([date]) => date >= weekAgo.toISOString().slice(0, 10));

  if (weekDays.length > 0) {
    const totals = { replies: 0, likes: 0, posts: 0, retweets: 0, follows: 0 };
    for (const [, stats] of weekDays) {
      totals.replies += stats.replies;
      totals.likes += stats.likes;
      totals.posts += stats.posts;
      totals.retweets += stats.retweets;
      totals.follows += stats.follows;
    }

    console.log(`\n${bold("This Week")} ${dim(`(${weekDays.length} active days)`)}`);
    divider();
    console.log(`  Replies:   ${green(String(totals.replies))}`);
    console.log(`  Likes:     ${green(String(totals.likes))}`);
    console.log(`  Posts:     ${green(String(totals.posts))}`);
    console.log(`  Retweets:  ${green(String(totals.retweets))}`);
    console.log(`  Follows:   ${green(String(totals.follows))}`);
  }

  // All time
  const allDays = Object.entries(mem.dailyStats);
  if (allDays.length > 1) {
    const totals = { replies: 0, likes: 0, posts: 0, retweets: 0, follows: 0 };
    for (const [, stats] of allDays) {
      totals.replies += stats.replies;
      totals.likes += stats.likes;
      totals.posts += stats.posts;
      totals.retweets += stats.retweets;
      totals.follows += stats.follows;
    }

    console.log(`\n${bold("All Time")} ${dim(`(${allDays.length} active days)`)}`);
    divider();
    console.log(`  Replies:   ${green(String(totals.replies))}`);
    console.log(`  Likes:     ${green(String(totals.likes))}`);
    console.log(`  Posts:     ${green(String(totals.posts))}`);
    console.log(`  Retweets:  ${green(String(totals.retweets))}`);
    console.log(`  Follows:   ${green(String(totals.follows))}`);
  }

  // Recent replies
  if (mem.repliedTo.length > 0) {
    const recent = mem.repliedTo.slice(-5);
    console.log(`\n${bold("Recent Replies")}`);
    divider();
    for (const r of recent) {
      const date = dim(r.date.slice(0, 10));
      const reply = r.ourReply?.slice(0, 70) ?? "";
      console.log(`  ${date} ${yellow(`@${r.username}`)}: ${reply}${reply.length >= 70 ? dim("...") : ""}`);
    }
  }

  if (allDays.length === 0 && mem.repliedTo.length === 0) {
    info("No engagement data yet. Run `myteam twitter` to start a session.");
  }

  console.log();
}
