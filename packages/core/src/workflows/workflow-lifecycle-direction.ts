import type { TraitFlags } from "./trait-types.js";

/** A task's trait-derived position in the forward lifecycle. */
export type LifecycleRole = "intake" | "hold" | "wip" | "review" | "complete" | "archived";

/** The only lifecycle ordering used for automatic-move containment. */
export const LIFECYCLE_ROLE_RANK: Readonly<Record<LifecycleRole, number>> = Object.freeze({
  intake: 0,
  hold: 1,
  wip: 2,
  review: 3,
  complete: 4,
  archived: 5,
});

export type LifecycleDirection = "forward" | "backward" | "lateral" | "unknown";

/*
FNXC:LifecycleContainment 2026-08-28-01:09:
FN-207 requires cards to advance from Ideas through Planning, In Progress, In-Review, and Done.
A defect is repaired in its owning stage: automatic moves may step back at most one rank, may never
enter intake, and may leave review only for WIP. Every remaining engine backward move is declared in
the registry below. Roles are derived from each column's own trait flags because the first-column-per-
role helper cannot classify a second WIP or review lane.
*/
/**
 * Classify one column from its own effective flags. Higher lifecycle roles win
 * when a custom column intentionally carries several lifecycle traits.
 */
export function classifyLifecycleRole(flags: TraitFlags): LifecycleRole | undefined {
  if (flags.archived === true) return "archived";
  if (flags.complete === true) return "complete";
  if (flags.mergeOrchestration === true || flags.mergeBlocker === true || flags.humanReview === true) {
    return "review";
  }
  if (flags.countsTowardWip === true) return "wip";
  if (flags.hold === true) return "hold";
  if (flags.intake === true) return "intake";
  return undefined;
}

/** Classify an automatic move without inventing a role for trait-less columns. */
export function classifyLifecycleDirection(
  from: LifecycleRole | undefined,
  to: LifecycleRole | undefined,
): LifecycleDirection {
  if (from === undefined || to === undefined) return "unknown";
  const difference = LIFECYCLE_ROLE_RANK[to] - LIFECYCLE_ROLE_RANK[from];
  if (difference > 0) return "forward";
  if (difference < 0) return "backward";
  return "lateral";
}

export interface ForbiddenLifecyclePath {
  rule: "F1" | "F2" | "F3" | "F4";
  detail: string;
}

/**
 * The structural lifecycle deny-list. It intentionally runs independently of
 * reason registration: an engine reason may explain a legal step backward but
 * can never authorize a structurally forbidden route.
 */
export function evaluateForbiddenLifecyclePath(
  from: LifecycleRole | undefined,
  to: LifecycleRole | undefined,
): ForbiddenLifecyclePath | null {
  if (from === undefined || to === undefined) return null;
  const direction = classifyLifecycleDirection(from, to);
  if (to === "intake") {
    return { rule: "F1", detail: "Automatic moves may not target the intake lifecycle role" };
  }
  if (LIFECYCLE_ROLE_RANK[from] - LIFECYCLE_ROLE_RANK[to] > 1) {
    return { rule: "F2", detail: "Automatic moves may not step backward more than one lifecycle rank" };
  }
  if (from === "review" && to !== "review" && to !== "wip") {
    return { rule: "F3", detail: "A review-lane card may leave review only for a WIP lane" };
  }
  /* DELIBERATE-LITERAL: LifecycleRole values are policy roles, not column ids. */
  if ((from === "complete" || from === "archived") && direction === "backward") {
    return { rule: "F4", detail: "A terminal-lane card may not move backward automatically" };
  }
  return null;
}

export type LifecycleRoleSet = readonly LifecycleRole[] | "any";

export interface EngineBackwardMoveReason {
  from: LifecycleRoleSet;
  to: LifecycleRoleSet;
  summary: string;
}

/** Every legal engine/scheduler backward move must use one of these reason ids. */
export const ENGINE_BACKWARD_MOVE_REASONS: Readonly<Record<string, EngineBackwardMoveReason>> = Object.freeze({
  "workflow-graph-node-column": {
    from: "any",
    to: "any",
    summary: "Workflow graph moved the card to its declared next column",
  },
  "code-review-revise-remediation": {
    from: ["review"], to: ["wip"], summary: "Code review requested implementation fixes",
  },
  "verification-failure-remediation": {
    from: ["review", "wip"], to: ["wip"], summary: "Verification requested implementation fixes",
  },
  "execution-resume": {
    from: ["review"], to: ["wip"], summary: "Incomplete implementation work is resuming",
  },
  "merge-failure-rebound": {
    from: ["review"], to: ["review", "wip"], summary: "Merge recovery requires review or implementation work",
  },
  "merge-fix-remediation": {
    from: ["review"], to: ["wip"], summary: "Merge feedback requested implementation fixes",
  },
  "plan-review-revise-replan": {
    from: ["wip"], to: ["hold"], summary: "Plan review requested a planning revision",
  },
  "stale-spec-replan": {
    from: ["wip"], to: ["hold"], summary: "A stale specification requires replanning",
  },
  "blocked-exit-replan": {
    from: ["wip"], to: ["hold"], summary: "A blocked completion requires replanning",
  },
  "missing-required-artifact-recovery": {
    from: ["wip"], to: ["hold"], summary: "A required artifact is missing and requires replanning",
  },
  "workflow-retry-rehome": {
    from: ["wip"], to: ["hold"], summary: "Workflow recovery requires a planning-lane retry",
  },
  "self-healing-worktree-reclaim": {
    from: ["review", "wip"], to: ["wip", "hold"], summary: "Self-healing reclaimed stale worktree state",
  },
  "self-healing-stranded-recovery": {
    from: ["review", "wip"], to: ["wip", "hold"], summary: "Self-healing recovered stranded task state",
  },
  "self-healing-dependency-rebound": {
    from: ["review", "wip"], to: ["wip", "hold"], summary: "Self-healing recovered dependency-blocked work",
  },
  "self-healing-session-recovery": {
    from: ["review", "wip"], to: ["wip", "hold"], summary: "Self-healing recovered an interrupted session",
  },
  "contamination-recovery": {
    from: ["review", "wip"], to: ["wip", "hold"], summary: "Recovery isolated contaminated work",
  },
  "branch-worktree-recovery": {
    from: ["review", "wip"], to: ["wip", "hold"], summary: "Recovery repaired branch or worktree state",
  },
  "capacity-hold-return": {
    from: ["review", "wip"], to: ["wip", "hold"], summary: "Capacity recovery returned the card to its legal waiting lane",
  },
});

function includesRole(roles: LifecycleRoleSet, role: LifecycleRole): boolean {
  return roles === "any" || roles.includes(role);
}

/** True only when a known reason explicitly permits this concrete role pair. */
export function isSanctionedEngineBackwardMove(
  reason: string | undefined,
  from: LifecycleRole | undefined,
  to: LifecycleRole | undefined,
): boolean {
  if (!reason || from === undefined || to === undefined) return false;
  const definition = ENGINE_BACKWARD_MOVE_REASONS[reason];
  return definition !== undefined && includesRole(definition.from, from) && includesRole(definition.to, to);
}
