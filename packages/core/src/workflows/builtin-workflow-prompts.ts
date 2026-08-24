import { BUILTIN_AGENT_PROMPTS } from "../agents/agent-prompts.js";

const DEFAULT_EXECUTOR_PROMPT = BUILTIN_AGENT_PROMPTS.find((prompt) => prompt.role === "executor")?.prompt ?? "";
const DEFAULT_TRIAGE_PROMPT = BUILTIN_AGENT_PROMPTS.find((prompt) => prompt.id === "default-triage")?.prompt ?? "";
const DEFAULT_TRIAGE_FAST_PROMPT = BUILTIN_AGENT_PROMPTS.find((prompt) => prompt.id === "default-triage-fast")?.prompt ?? "";
const DEFAULT_REVIEWER_PROMPT = BUILTIN_AGENT_PROMPTS.find((prompt) => prompt.role === "reviewer")?.prompt ?? "";
const DEFAULT_MERGER_PROMPT = BUILTIN_AGENT_PROMPTS.find((prompt) => prompt.role === "merger")?.prompt ?? "";

/*
FNXC:ReviewGatedPlanning 2026-08-24-06:30:
The review-gated seam used to be `DEFAULT_TRIAGE_PROMPT` plus one appended sentence. That does not
work and was measured not working: the base prompt's PROMPT.md template MANDATES
`### Step {N-1}: Testing & Verification` and `### Step {N}: Documentation & Delivery`, with full
checklists, so a trailing line telling the planner to omit them is a self-contradicting prompt and
the detailed template wins. Tasks kept emitting both steps, the executor ran them in in-progress,
and the review-column gates then redid the same work under the same names.
The parse node's `implementationOnlySteps` is NOT a backstop — it only audits, by design
("Detection is deliberately non-destructive"), because a legitimate implementation step name can
contain these words.
So the template region is REMOVED and replaced by an explicit prohibition. If the base prompt is
reworded and the anchors stop matching, the strip degrades to the old append rather than breaking
planning at runtime; `builtin-workflow-prompts.test.ts` fails loudly on that drift.
*/
const REVIEW_GATE_STEP_TEMPLATE_START = "### Step {N-1}: Testing & Verification";
const REVIEW_GATE_STEP_TEMPLATE_END = "## Documentation Requirements";

const REVIEW_GATED_STEP_CONTRACT = `## Review-gated step contract (OVERRIDES the step template above)

This workflow runs testing, verification, documentation, and delivery as REVIEW-COLUMN GATES after
implementation. They are not task steps here.

- Do NOT emit a "Testing & Verification" step.
- Do NOT emit a "Documentation & Delivery" step.
- Emit implementation steps only, ending with the last implementation step.
- Per-step verification bullets stay: each implementation step still runs its own targeted tests.

`;

export function applyReviewGatedStepContract(prompt: string): string {
  const start = prompt.indexOf(REVIEW_GATE_STEP_TEMPLATE_START);
  const end = prompt.indexOf(REVIEW_GATE_STEP_TEMPLATE_END);
  if (start < 0 || end < 0 || end <= start) {
    return `${prompt}\n\n${REVIEW_GATED_STEP_CONTRACT}`;
  }
  return `${prompt.slice(0, start)}${REVIEW_GATED_STEP_CONTRACT}${prompt.slice(end)}`;
}

export const BUILTIN_SEAM_PROMPTS: Record<string, string> = {
  execute: DEFAULT_EXECUTOR_PROMPT,
  planning: DEFAULT_TRIAGE_PROMPT,
  "planning-fast": DEFAULT_TRIAGE_FAST_PROMPT,
  /* Review-gated tasks keep test and delivery work in review-column gates. */
  "planning-implementation-only": applyReviewGatedStepContract(DEFAULT_TRIAGE_PROMPT),
  "step-execute": DEFAULT_EXECUTOR_PROMPT,
  review: DEFAULT_REVIEWER_PROMPT,
  merge: DEFAULT_MERGER_PROMPT,
};

export function builtinSeamPrompt(seam: string): string {
  return BUILTIN_SEAM_PROMPTS[seam] ?? "";
}

export function builtinPromptConfig(seam: string, name: string): Record<string, unknown> {
  return { seam, name, prompt: builtinSeamPrompt(seam) };
}
