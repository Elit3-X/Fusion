import { describe, expect, it } from "vitest";

import {
  ENGINE_BACKWARD_MOVE_REASONS,
  LIFECYCLE_ROLE_RANK,
  classifyLifecycleDirection,
  classifyLifecycleRole,
  evaluateForbiddenLifecyclePath,
  isSanctionedEngineBackwardMove
} from "../workflows/workflow-lifecycle-direction.js";
import { evaluateLifecycleDirectionPostcondition } from "../workflows/workflow-transition-policy.js";

const policyInput = (fromFlags: object, toFlags: object, options: Partial<{ moveSource: "user" | "engine" | "scheduler"; lifecycleReason: string }> = {}) => ({
  taskId: "FN-207",
  from: { columnId: "from", flags: fromFlags },
  to: { columnId: "to", flags: toFlags },
  mergeBlockerReason: null,
  ...options,
});

describe("workflow lifecycle direction", () => {
  it("orders lifecycle roles from intake through archived", () => {
    expect(LIFECYCLE_ROLE_RANK).toEqual({
      intake: 0,
      hold: 1,
      wip: 2,
      review: 3,
      complete: 4,
      archived: 5,
    });
  });

  it("classifies effective column flags with highest-rank precedence", () => {
    expect(classifyLifecycleRole({ intake: true, hold: true })).toBe("hold");
    expect(classifyLifecycleRole({ mergeBlocker: true, humanReview: true, mergeOrchestration: true })).toBe("review");
    expect(classifyLifecycleRole({ archived: true, complete: true, countsTowardWip: true })).toBe("archived");
    expect(classifyLifecycleRole({})).toBeUndefined();
  });

  it("classifies every lifecycle direction without inventing trait-less roles", () => {
    expect(classifyLifecycleDirection("hold", "wip")).toBe("forward");
    expect(classifyLifecycleDirection("review", "wip")).toBe("backward");
    expect(classifyLifecycleDirection("wip", "wip")).toBe("lateral");
    expect(classifyLifecycleDirection(undefined, "wip")).toBe("unknown");
  });

  it("forbids every structural path while retaining legal adjacent repairs", () => {
    expect(evaluateForbiddenLifecyclePath("wip", "intake")?.rule).toBe("F1");
    expect(evaluateForbiddenLifecyclePath("review", "hold")?.rule).toBe("F2");
    expect(evaluateForbiddenLifecyclePath("review", "complete")?.rule).toBe("F3");
    expect(evaluateForbiddenLifecyclePath("archived", "complete")?.rule).toBe("F4");
    expect(evaluateForbiddenLifecyclePath("review", "wip")).toBeNull();
    expect(evaluateForbiddenLifecyclePath("wip", "hold")).toBeNull();
    expect(evaluateForbiddenLifecyclePath(undefined, "hold")).toBeNull();
  });

  it("requires a known reason whose declared role sets include the actual pair", () => {
    expect(isSanctionedEngineBackwardMove("code-review-revise-remediation", "review", "wip")).toBe(true);
    expect(isSanctionedEngineBackwardMove("code-review-revise-remediation", "wip", "hold")).toBe(false);
    expect(isSanctionedEngineBackwardMove("missing", "review", "wip")).toBe(false);
    expect(isSanctionedEngineBackwardMove(undefined, "review", "wip")).toBe(false);
  });

  it("enforces the direction policy only for explicitly automated moves", () => {
    expect(evaluateLifecycleDirectionPostcondition(policyInput({ mergeBlocker: true }, { hold: true }, {
      moveSource: "engine",
      lifecycleReason: "code-review-revise-remediation",
    }))?.messageKey).toBe("transition.rejected.forbiddenLifecyclePath");
    expect(evaluateLifecycleDirectionPostcondition(policyInput({ mergeBlocker: true }, { countsTowardWip: true }, {
      moveSource: "engine",
    }))?.messageKey).toBe("transition.rejected.unsanctionedLifecycleMove");
    expect(evaluateLifecycleDirectionPostcondition(policyInput({ mergeBlocker: true }, { countsTowardWip: true }, {
      moveSource: "scheduler",
      lifecycleReason: "code-review-revise-remediation",
    }))).toBeNull();
    expect(evaluateLifecycleDirectionPostcondition(policyInput({ mergeBlocker: true }, { hold: true }))).toBeNull();
    expect(evaluateLifecycleDirectionPostcondition(policyInput({}, { hold: true }, { moveSource: "engine" }))).toBeNull();
  });

  it("keeps broad recovery envelopes subordinate to the deny-list", () => {
    expect(ENGINE_BACKWARD_MOVE_REASONS["self-healing-session-recovery"]).toMatchObject({
      from: ["review", "wip"],
      to: ["wip", "hold"],
    });
    expect(isSanctionedEngineBackwardMove("self-healing-session-recovery", "review", "hold")).toBe(true);
    expect(evaluateForbiddenLifecyclePath("review", "hold")?.rule).toBe("F2");
  });
});
