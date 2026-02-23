/**
 * workflow-lifecycle.test.ts — End-to-end CRUD tests for the workflow system.
 *
 * Runs against real filesystem in isolated temp directories. Each test gets
 * a fresh workspace with .myteam/workflows/ structure via createTestWorkspace.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import { createMockWorkflowConfig } from "../../helpers/mock-data";
import {
  writeWorkflowConfig,
  readWorkflowConfig,
  listWorkflows,
  workflowExists,
  deleteWorkflow,
} from "@/modules/twitter/workflow";

describe("Workflow lifecycle (CRUD)", () => {
  let workspace: TestWorkspace;

  beforeEach(() => {
    workspace = createTestWorkspace();
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it("full lifecycle: create → read → list → exists → update → delete", () => {
    const config = createMockWorkflowConfig({
      name: "growth-campaign",
      description: "Grow the follower base",
      template: "follower-growth",
    });

    // 1. Create workflow
    writeWorkflowConfig("growth-campaign", config);

    // 2. Verify it appears in the list
    expect(listWorkflows()).toContain("growth-campaign");

    // 3. Verify exists check returns true
    expect(workflowExists("growth-campaign")).toBe(true);

    // 4. Verify reading returns the written data
    const loaded = readWorkflowConfig("growth-campaign");
    expect(loaded.name).toBe("growth-campaign");
    expect(loaded.description).toBe("Grow the follower base");
    expect(loaded.template).toBe("follower-growth");
    expect(loaded.topics).toEqual(["typescript", "webdev"]);

    // 5. Update the workflow — change description and write again
    const updated = { ...loaded, description: "Updated growth strategy" };
    writeWorkflowConfig("growth-campaign", updated);

    // 6. Verify the update persisted
    const reloaded = readWorkflowConfig("growth-campaign");
    expect(reloaded.description).toBe("Updated growth strategy");

    // 7. Delete the workflow
    deleteWorkflow("growth-campaign");

    // 8. Verify it no longer exists
    expect(workflowExists("growth-campaign")).toBe(false);

    // 9. Verify it's gone from the list
    expect(listWorkflows()).not.toContain("growth-campaign");
  });

  it("multiple workflows: create, list, and selective delete", () => {
    const alpha = createMockWorkflowConfig({
      name: "alpha",
      description: "Alpha campaign",
    });
    const beta = createMockWorkflowConfig({
      name: "beta",
      description: "Beta campaign",
    });

    // Create both workflows
    writeWorkflowConfig("alpha", alpha);
    writeWorkflowConfig("beta", beta);

    // Verify both appear in list, sorted alphabetically
    const workflows = listWorkflows();
    expect(workflows).toEqual(["alpha", "beta"]);

    // Delete alpha, verify only beta remains
    deleteWorkflow("alpha");
    expect(listWorkflows()).toEqual(["beta"]);
    expect(workflowExists("alpha")).toBe(false);
    expect(workflowExists("beta")).toBe(true);
  });

  it("readWorkflowConfig throws for non-existent workflow", () => {
    expect(() => readWorkflowConfig("does-not-exist")).toThrow(
      /Workflow "does-not-exist" not found/
    );
  });

  it("listWorkflows returns empty array when no workflows exist", () => {
    expect(listWorkflows()).toEqual([]);
  });

  it("deleteWorkflow is a no-op for non-existent workflow", () => {
    // Should not throw when deleting something that doesn't exist
    expect(() => deleteWorkflow("ghost")).not.toThrow();
  });
});
