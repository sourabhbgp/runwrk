/**
 * Tests for workflow template factories — verifying that each template
 * produces a WorkflowConfig with the correct defaults, biases, and
 * feed priorities for its intended campaign strategy.
 */

import { describe, it, expect } from "vitest";
import {
  createFollowerGrowthWorkflow,
  createHashtagNicheWorkflow,
  createCustomWorkflow,
  TEMPLATES,
} from "@/modules/twitter/workflow.templates";

// --- Follower Growth Template ---

describe("createFollowerGrowthWorkflow", () => {
  const config = createFollowerGrowthWorkflow("growth-test");

  it("returns a config with template 'follower-growth'", () => {
    expect(config.template).toBe("follower-growth");
  });

  it("has name matching the argument", () => {
    expect(config.name).toBe("growth-test");
  });

  it("has a non-empty strategyPrompt", () => {
    expect(config.strategyPrompt).toBeTruthy();
    expect(config.strategyPrompt.length).toBeGreaterThan(0);
  });

  it("has feedFilters.minFollowers set to 0 (allows peer engagement)", () => {
    expect(config.feedFilters.minFollowers).toBeDefined();
    expect(config.feedFilters.minFollowers).toBe(0);
  });

  it("has optimized session limits for high-volume engagement", () => {
    expect(config.limits.maxRepliesPerSession).toBe(17);
    expect(config.limits.maxLikesPerSession).toBe(12);
    expect(config.limits.maxFollowsPerSession).toBe(3);
    expect(config.limits.maxPostsPerDay).toBe(5);
    expect(config.limits.delayBetweenActions).toEqual([1500, 4000]);
  });

  it("has strategy prompt referencing algorithm weights", () => {
    expect(config.strategyPrompt).toContain("13.5-27x");
    expect(config.strategyPrompt).toContain("75x");
  });

  it("has feedPriority.discovery of 80 and timeline of 50", () => {
    expect(config.feedPriority.discovery).toBe(80);
    expect(config.feedPriority.timeline).toBe(50);
  });

  it("has actionBias.reply set to 'heavy'", () => {
    expect(config.actionBias.reply).toBe("heavy");
  });

  it("favors discovery over timeline (feedPriority.discovery > feedPriority.timeline)", () => {
    expect(config.feedPriority.discovery).toBeGreaterThan(config.feedPriority.timeline);
  });
});

// --- Hashtag/Niche Template ---

describe("createHashtagNicheWorkflow", () => {
  it("returns a config with template 'hashtag-niche'", () => {
    const config = createHashtagNicheWorkflow("niche-test");
    expect(config.template).toBe("hashtag-niche");
  });

  it("includes hashtags in the strategyPrompt when overrides include params.hashtags", () => {
    const config = createHashtagNicheWorkflow("niche-tags", {
      params: { hashtags: ["ai", "ml"] },
    });

    expect(config.strategyPrompt).toContain("#ai");
    expect(config.strategyPrompt).toContain("#ml");
  });

  it("sets feedFilters.requireHashtags to match provided hashtags", () => {
    const config = createHashtagNicheWorkflow("niche-filter", {
      params: { hashtags: ["ai", "ml"] },
    });

    expect(config.feedFilters.requireHashtags).toEqual(["ai", "ml"]);
  });

  it("favors discovery over mentions (feedPriority.discovery > feedPriority.mentions)", () => {
    const config = createHashtagNicheWorkflow("niche-priority");
    expect(config.feedPriority.discovery).toBeGreaterThan(config.feedPriority.mentions);
  });
});

// --- Custom Template ---

describe("createCustomWorkflow", () => {
  const config = createCustomWorkflow("blank-slate");

  it("returns a config with template 'custom'", () => {
    expect(config.template).toBe("custom");
  });

  it("has empty strategyPrompt and description", () => {
    expect(config.strategyPrompt).toBe("");
    expect(config.description).toBe("");
  });

  it("has all actionBias values set to 'moderate'", () => {
    const { actionBias } = config;
    expect(actionBias.reply).toBe("moderate");
    expect(actionBias.like).toBe("moderate");
    expect(actionBias.retweet).toBe("moderate");
    expect(actionBias.originalPost).toBe("moderate");
    expect(actionBias.follow).toBe("moderate");
  });
});

// --- TEMPLATES Registry ---

describe("TEMPLATES registry", () => {
  it("has entries for 'follower-growth', 'hashtag-niche', and 'custom'", () => {
    expect(TEMPLATES).toHaveProperty("follower-growth");
    expect(TEMPLATES).toHaveProperty("hashtag-niche");
    expect(TEMPLATES).toHaveProperty("custom");
  });

  it("each entry has a factory function", () => {
    for (const key of Object.keys(TEMPLATES) as Array<keyof typeof TEMPLATES>) {
      expect(typeof TEMPLATES[key].factory).toBe("function");
    }
  });
});
