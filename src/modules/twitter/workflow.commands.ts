/**
 * workflow.commands.ts — Interactive commands for managing Twitter workflows.
 *
 * Provides create, list, edit, and delete commands using the same readline/prompt
 * pattern as feedback.ts and setup.ts. Workflows are persistent campaigns with
 * isolated memory, strategy prompts, and feed filtering.
 */

import { createInterface } from "readline";
import {
  bold, dim, cyan, yellow, green, red,
  info, success, error, divider, ask,
} from "../../common";
import { listWorkflows, workflowExists, readWorkflowConfig, writeWorkflowConfig, deleteWorkflow } from "./workflow";
import { TEMPLATES } from "./workflow.templates";
import { ensureMigrated } from "./workflow.migrate";
import type { WorkflowConfig, WorkflowTemplate } from "./workflow.types";

// --- Helpers ---

/** Wrap readline.question in a promise for async/await usage */
function prompt(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(q, (answer) => resolve(answer));
  });
}

/** Validate workflow name: lowercase alphanumeric + hyphens only, not "default" */
function isValidName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name) && name !== "default";
}

// --- Create Command ---

/** Interactive guided workflow creation — template picker, params, and save */
export async function workflowCreate(): Promise<void> {
  ensureMigrated();

  console.log(`\n${bold(cyan("Create Workflow"))} ${dim("\u2014 set up a new engagement campaign")}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // --- 1. Workflow Name ---
  let name = "";
  while (!name) {
    const input = await prompt(rl, `${cyan("?")} Workflow name (lowercase, hyphens ok): `);
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) {
      info("Name is required.");
      continue;
    }
    if (!isValidName(trimmed)) {
      info('Use lowercase letters, numbers, and hyphens only. "default" is reserved.');
      continue;
    }
    if (workflowExists(trimmed)) {
      info(`Workflow "${trimmed}" already exists. Choose a different name.`);
      continue;
    }
    name = trimmed;
  }

  // --- 2. Template Picker ---
  console.log(`\n${bold("Templates:")}`);
  const templateKeys = Object.keys(TEMPLATES) as WorkflowTemplate[];
  for (let i = 0; i < templateKeys.length; i++) {
    const key = templateKeys[i];
    const tmpl = TEMPLATES[key];
    console.log(`  ${bold(`${i + 1}.`)} ${yellow(tmpl.label)} ${dim(`\u2014 ${tmpl.description}`)}`);
  }

  let template: WorkflowTemplate = "custom";
  const tmplChoice = await prompt(rl, `\n${cyan("?")} Template (1-${templateKeys.length}): `);
  const tmplIndex = parseInt(tmplChoice, 10) - 1;
  if (tmplIndex >= 0 && tmplIndex < templateKeys.length) {
    template = templateKeys[tmplIndex];
  } else {
    info("Invalid choice \u2014 using Custom template.");
  }

  // --- 3. Common Config ---
  const topicsInput = await prompt(rl, `${cyan("?")} Topics (comma-separated, or blank): `);
  const topics = topicsInput.trim()
    ? topicsInput.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const keywordsInput = await prompt(rl, `${cyan("?")} Keywords to search (comma-separated, or blank): `);
  const keywords = keywordsInput.trim()
    ? keywordsInput.split(",").map((k) => k.trim()).filter(Boolean)
    : [];

  const accountsInput = await prompt(rl, `${cyan("?")} Accounts to watch (comma-separated, or blank): `);
  const watchAccounts = accountsInput.trim()
    ? accountsInput.split(",").map((a) => a.trim().replace(/^@/, "")).filter(Boolean)
    : [];

  // --- 4. Template-Specific Params ---
  const params: Record<string, unknown> = {};

  // Hashtag/niche: ask for target hashtags
  if (template === "hashtag-niche") {
    const hashtagInput = await prompt(rl, `${cyan("?")} Target hashtags (comma-separated, without #): `);
    params.hashtags = hashtagInput.trim()
      ? hashtagInput.split(",").map((h) => h.trim().replace(/^#/, "")).filter(Boolean)
      : [];
  }

  // Follower growth: ask for minFollowers threshold
  if (template === "follower-growth") {
    const minInput = await prompt(rl, `${cyan("?")} Min followers to engage with (default: 1000): `);
    const minVal = parseInt(minInput, 10);
    if (!isNaN(minVal) && minVal > 0) {
      params.minFollowers = minVal;
    }
  }

  // --- 5. Optional Strategy Prompt ---
  const strategyInput = await prompt(
    rl,
    `${cyan("?")} Custom strategy/directives (or blank for template default): `,
  );

  // --- 6. Build + Save ---
  const factory = TEMPLATES[template].factory;
  const overrides: Partial<WorkflowConfig> = {
    topics,
    keywords,
    watchAccounts,
    params,
  };

  // Apply custom strategy if provided
  if (strategyInput.trim()) {
    overrides.strategyPrompt = strategyInput.trim();
  }

  // Apply minFollowers from follower-growth params
  if (template === "follower-growth" && typeof params.minFollowers === "number") {
    overrides.feedFilters = { minFollowers: params.minFollowers };
  }

  const wf = factory(name, overrides);
  writeWorkflowConfig(name, wf);

  rl.close();

  console.log();
  success(`Workflow "${name}" created (${TEMPLATES[template].label})`);
  console.log(dim(`\nRun ${bold(`runwrk twitter -w ${name}`)} to start a session.\n`));
}

// --- List Command ---

/** List all workflows with name, template, creation date */
export async function workflowList(): Promise<void> {
  ensureMigrated();

  const workflows = listWorkflows();
  console.log(`\n${bold(cyan("Workflows"))}\n`);

  if (workflows.length === 0) {
    info("No workflows yet. Run `runwrk twitter workflow create` to get started.");
    console.log();
    return;
  }

  for (const name of workflows) {
    try {
      const wf = readWorkflowConfig(name);
      const templateLabel = TEMPLATES[wf.template]?.label ?? wf.template;
      const created = dim(wf.createdAt.slice(0, 10));
      const desc = wf.description ? dim(` \u2014 ${wf.description}`) : "";
      console.log(`  ${yellow(name.padEnd(20))} ${cyan(templateLabel.padEnd(22))} ${created}${desc}`);
    } catch {
      // Malformed workflow — show name with error
      console.log(`  ${yellow(name.padEnd(20))} ${red("(invalid config)")}`);
    }
  }

  console.log();
}

// --- Edit Command ---

/** Interactive editor for modifying an existing workflow's configuration */
export async function workflowEdit(opts: { workflow: string }): Promise<void> {
  ensureMigrated();

  if (!workflowExists(opts.workflow)) {
    error(`Workflow "${opts.workflow}" not found.`);
    return;
  }

  const wf = readWorkflowConfig(opts.workflow);
  console.log(`\n${bold(cyan("Edit Workflow"))} ${dim(`\u2014 ${opts.workflow}`)}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Show current values and allow editing each field
  console.log(dim("Press Enter to keep current value.\n"));

  // Description
  console.log(`  ${bold("Description:")} ${wf.description || dim("(none)")}`);
  const descInput = await prompt(rl, `${cyan("?")} New description: `);
  if (descInput.trim()) wf.description = descInput.trim();

  // Topics
  console.log(`  ${bold("Topics:")} ${wf.topics.length > 0 ? wf.topics.join(", ") : dim("(none)")}`);
  const topicsInput = await prompt(rl, `${cyan("?")} Topics (comma-separated): `);
  if (topicsInput.trim()) {
    wf.topics = topicsInput.split(",").map((t) => t.trim()).filter(Boolean);
  }

  // Keywords
  console.log(`  ${bold("Keywords:")} ${wf.keywords.length > 0 ? wf.keywords.join(", ") : dim("(none)")}`);
  const keywordsInput = await prompt(rl, `${cyan("?")} Keywords (comma-separated): `);
  if (keywordsInput.trim()) {
    wf.keywords = keywordsInput.split(",").map((k) => k.trim()).filter(Boolean);
  }

  // Watch Accounts
  console.log(`  ${bold("Watch Accounts:")} ${wf.watchAccounts.length > 0 ? wf.watchAccounts.join(", ") : dim("(none)")}`);
  const accountsInput = await prompt(rl, `${cyan("?")} Watch accounts (comma-separated): `);
  if (accountsInput.trim()) {
    wf.watchAccounts = accountsInput.split(",").map((a) => a.trim().replace(/^@/, "")).filter(Boolean);
  }

  // Strategy Prompt
  console.log(`  ${bold("Strategy:")} ${wf.strategyPrompt ? wf.strategyPrompt.slice(0, 80) + "..." : dim("(none)")}`);
  const strategyInput = await prompt(rl, `${cyan("?")} Strategy prompt: `);
  if (strategyInput.trim()) wf.strategyPrompt = strategyInput.trim();

  // Feed Priority
  console.log(`  ${bold("Feed Priority:")} mentions=${wf.feedPriority.mentions} timeline=${wf.feedPriority.timeline} discovery=${wf.feedPriority.discovery}`);
  const priorityInput = await prompt(rl, `${cyan("?")} Feed priority (mentions,timeline,discovery e.g. 100,40,70): `);
  if (priorityInput.trim()) {
    const parts = priorityInput.split(",").map((p) => parseInt(p.trim(), 10));
    if (parts.length === 3 && parts.every((p) => !isNaN(p))) {
      wf.feedPriority = { mentions: parts[0], timeline: parts[1], discovery: parts[2] };
    } else {
      info("Invalid format \u2014 keeping current values.");
    }
  }

  // Limits
  console.log(`  ${bold("Limits:")} ${wf.limits.maxRepliesPerSession} replies, ${wf.limits.maxLikesPerSession} likes, ${wf.limits.maxPostsPerDay} posts/day`);
  const limitsInput = await prompt(rl, `${cyan("?")} Limits (replies,likes,posts/day e.g. 5,10,3): `);
  if (limitsInput.trim()) {
    const parts = limitsInput.split(",").map((p) => parseInt(p.trim(), 10));
    if (parts.length === 3 && parts.every((p) => !isNaN(p))) {
      wf.limits.maxRepliesPerSession = parts[0];
      wf.limits.maxLikesPerSession = parts[1];
      wf.limits.maxPostsPerDay = parts[2];
    } else {
      info("Invalid format \u2014 keeping current values.");
    }
  }

  // Save
  writeWorkflowConfig(opts.workflow, wf);
  rl.close();

  console.log();
  success(`Workflow "${opts.workflow}" updated.`);
  console.log();
}

// --- Delete Command ---

/** Confirm and delete a workflow directory (config + memory) */
export async function workflowDelete(opts: { workflow: string }): Promise<void> {
  ensureMigrated();

  if (!workflowExists(opts.workflow)) {
    error(`Workflow "${opts.workflow}" not found.`);
    return;
  }

  console.log(`\n${bold(red("Delete Workflow"))} ${dim(`\u2014 ${opts.workflow}`)}\n`);
  info("This will permanently delete the workflow config and all its engagement history.");

  const confirm = ask(`Type "${opts.workflow}" to confirm deletion`);
  if (confirm?.trim() !== opts.workflow) {
    info("Cancelled \u2014 workflow not deleted.");
    console.log();
    return;
  }

  deleteWorkflow(opts.workflow);
  success(`Workflow "${opts.workflow}" deleted.`);
  console.log();
}
