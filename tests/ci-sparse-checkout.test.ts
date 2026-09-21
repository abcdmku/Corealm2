import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../tools/lib/paths.js";
import {
  SUITE_CHECKOUT, WORKFLOW_CHECKOUTS, workflowCheckoutSteps, workflowFiles, workflowSparseBlocks,
} from "../tools/ci/sparse-paths.js";

/**
 * A sparse checkout that is missing a directory does not fail loudly: the job installs, typechecks
 * and then loses tests to ENOENT minutes later. These hold the workflows to one declared list each.
 */
describe("CI sparse checkouts", () => {
  it("declares a checkout for every workflow", () => {
    expect(workflowFiles()).toEqual(Object.keys(WORKFLOW_CHECKOUTS).sort());
  });

  it("gives every job the checkout declared for its workflow", () => {
    const actual: Record<string, string[][]> = {}, declared: Record<string, string[][]> = {};
    for (const file of workflowFiles()) {
      const blocks = workflowSparseBlocks(file);
      actual[file] = blocks;
      declared[file] = blocks.map(() => [...WORKFLOW_CHECKOUTS[file]!]);
    }
    expect(actual).toEqual(declared);
  });

  it("takes a sparse checkout at every checkout step", () => {
    const sparse = Object.fromEntries(workflowFiles().map(file => [file, workflowSparseBlocks(file).length]));
    const steps = Object.fromEntries(workflowFiles().map(file => [file, workflowCheckoutSteps(file)]));
    expect(sparse).toEqual(steps);
  });

  // Runs inside the suite checkout, so a path that is misspelled or has moved cannot pass quietly.
  it("checks out every path the suite reads", () => {
    expect(SUITE_CHECKOUT.filter(entry => !existsSync(path.join(repoRoot, entry)))).toEqual([]);
  });
});
