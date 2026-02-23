/**
 * stats.ts — Display engagement analytics (the `myteam twitter stats` command).
 *
 * When a workflow is specified via --workflow, shows stats for that workflow only.
 * When no workflow is specified, shows a summary table across all workflows with totals.
 */

import { bold, dim, cyan, green, yellow, divider, info } from "../../common";
import { readMemory, type TwitterMemory } from "./memory";
import { listWorkflows } from "./workflow";
import { ensureMigrated } from "./workflow.migrate";

// --- Helpers ---

/** Compute aggregate stats from a memory object */
function computeStats(mem: TwitterMemory) {
  const today = new Date().toISOString().slice(0, 10);
  const todayStats = mem.dailyStats[today];

  // This week's aggregate
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekDays = Object.entries(mem.dailyStats).filter(
    ([date]) => date >= weekAgo.toISOString().slice(0, 10),
  );
  const weekTotals = { replies: 0, likes: 0, posts: 0, retweets: 0, follows: 0 };
  for (const [, stats] of weekDays) {
    weekTotals.replies += stats.replies;
    weekTotals.likes += stats.likes;
    weekTotals.posts += stats.posts;
    weekTotals.retweets += stats.retweets;
    weekTotals.follows += stats.follows;
  }

  // All-time aggregate
  const allDays = Object.entries(mem.dailyStats);
  const allTotals = { replies: 0, likes: 0, posts: 0, retweets: 0, follows: 0 };
  for (const [, stats] of allDays) {
    allTotals.replies += stats.replies;
    allTotals.likes += stats.likes;
    allTotals.posts += stats.posts;
    allTotals.retweets += stats.retweets;
    allTotals.follows += stats.follows;
  }

  return { todayStats, weekTotals, weekActiveDays: weekDays.length, allTotals, totalDays: allDays.length, mem };
}

/** Display stats for a single workflow (or legacy data) */
function displayWorkflowStats(workflowName: string, mem: TwitterMemory): void {
  const { todayStats, weekTotals, weekActiveDays, allTotals, totalDays } = computeStats(mem);

  const today = new Date().toISOString().slice(0, 10);

  // --- Today's Stats ---
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

  // --- This Week ---
  if (weekActiveDays > 0) {
    console.log(`\n${bold("This Week")} ${dim(`(${weekActiveDays} active days)`)}`);
    divider();
    console.log(`  Replies:   ${green(String(weekTotals.replies))}`);
    console.log(`  Likes:     ${green(String(weekTotals.likes))}`);
    console.log(`  Posts:     ${green(String(weekTotals.posts))}`);
    console.log(`  Retweets:  ${green(String(weekTotals.retweets))}`);
    console.log(`  Follows:   ${green(String(weekTotals.follows))}`);
  }

  // --- All Time ---
  if (totalDays > 1) {
    console.log(`\n${bold("All Time")} ${dim(`(${totalDays} active days)`)}`);
    divider();
    console.log(`  Replies:   ${green(String(allTotals.replies))}`);
    console.log(`  Likes:     ${green(String(allTotals.likes))}`);
    console.log(`  Posts:     ${green(String(allTotals.posts))}`);
    console.log(`  Retweets:  ${green(String(allTotals.retweets))}`);
    console.log(`  Follows:   ${green(String(allTotals.follows))}`);
  }

  // --- Recent Replies ---
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

  if (totalDays === 0 && mem.repliedTo.length === 0) {
    info(`No engagement data yet for "${workflowName}". Run \`myteam twitter -w ${workflowName}\` to start.`);
  }
}

// --- Main Command ---

/** Display engagement stats. With --workflow, shows stats for one workflow.
 *  Without --workflow, shows a summary table across all workflows. */
export async function twitterStats(opts: { workflow?: string } = {}) {
  ensureMigrated();

  // --- Single Workflow Mode ---
  if (opts.workflow) {
    const mem = readMemory(opts.workflow);
    console.log(`\n${bold(cyan("Twitter Stats"))} ${dim(`\u2014 ${opts.workflow} workflow`)}\n`);
    displayWorkflowStats(opts.workflow, mem);
    console.log();
    return;
  }

  // --- All Workflows Summary ---
  const workflows = listWorkflows();
  console.log(`\n${bold(cyan("Twitter Engagement Stats"))}\n`);

  if (workflows.length === 0) {
    info("No workflows found. Run `myteam twitter workflow create` to get started.");
    console.log();
    return;
  }

  // Aggregate totals across all workflows
  const grandTotals = { replies: 0, likes: 0, posts: 0, retweets: 0, follows: 0 };

  for (const name of workflows) {
    const mem = readMemory(name);
    const { allTotals, totalDays } = computeStats(mem);

    console.log(`${bold(yellow(name))} ${dim(`(${totalDays} active days)`)}`);
    console.log(
      `  ${green(String(allTotals.replies))} replies  ` +
      `${green(String(allTotals.likes))} likes  ` +
      `${green(String(allTotals.posts))} posts  ` +
      `${green(String(allTotals.retweets))} RTs  ` +
      `${green(String(allTotals.follows))} follows`
    );
    console.log();

    grandTotals.replies += allTotals.replies;
    grandTotals.likes += allTotals.likes;
    grandTotals.posts += allTotals.posts;
    grandTotals.retweets += allTotals.retweets;
    grandTotals.follows += allTotals.follows;
  }

  // Grand totals row
  if (workflows.length > 1) {
    divider();
    console.log(`${bold("Total across all workflows")}`);
    console.log(
      `  ${green(String(grandTotals.replies))} replies  ` +
      `${green(String(grandTotals.likes))} likes  ` +
      `${green(String(grandTotals.posts))} posts  ` +
      `${green(String(grandTotals.retweets))} RTs  ` +
      `${green(String(grandTotals.follows))} follows`
    );
  }

  console.log(dim(`\nRun \`myteam twitter stats -w <name>\` for detailed per-workflow stats.\n`));
}
