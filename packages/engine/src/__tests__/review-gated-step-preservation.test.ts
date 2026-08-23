import { describe, expect, it } from "vitest";
import type { TaskDetail, TaskStep, WorkflowIrNode } from "@fusion/core";
import { ParseStepsNodeRunner } from "../workflow-node-runners/parse-steps-runner.js";

const node = (config: Record<string, unknown>): WorkflowIrNode => ({ id: "parse", kind: "parse-steps", config });
const task = (steps: TaskStep[] = []) => ({ id: "FN-175", steps } as TaskDetail);

describe("review-gated parse-step preservation", () => {
  it("preserves live remediation before an empty parse can replace task steps", async () => {
    const writeSteps = async () => { throw new Error("must not write"); };
    const runner = new ParseStepsNodeRunner({
      readArtifact: async () => "",
      writeSteps,
      getLiveTask: async () => task([{ name: "Fix: guard", status: "pending", remediation: { wave: 1, gate: "Code Review", gateStepId: "code-review", detail: "guard" } }]),
    });
    await expect(runner.run(node({ artifact: "PROMPT.md", parser: "step-headings", preserveRemediationSteps: true }), { task: task(), context: {} }))
      .resolves.toMatchObject({ outcome: "success", value: "preserved-remediation-steps" });
  });

  it("audits but never filters implementation names containing gate words", async () => {
    const writes: TaskStep[][] = [];
    const audits: string[] = [];
    const runner = new ParseStepsNodeRunner({
      readArtifact: async () => "### Step 1: Wire documentation link resolver\n### Step 2: Testing & Verification",
      writeSteps: async (_task, steps) => { writes.push(steps); },
      audit: (reason) => audits.push(reason),
    });
    await runner.run(node({ artifact: "PROMPT.md", parser: "step-headings", implementationOnlySteps: true }), { task: task(), context: {} });
    expect(writes).toEqual([[{ name: "Wire documentation link resolver", status: "pending" }, { name: "Testing & Verification", status: "pending" }]]);
    expect(audits).toContain("implementation-only-leakage");
  });
});
