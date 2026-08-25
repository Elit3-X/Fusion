---
"@runfusion/fusion": minor
---

summary: A rejected review now adds named fix-it steps to the card instead of bouncing it unchanged.
category: feature
dev: `workflow-graph-foreach.ts` sequential regions now cover steps appended after expansion, re-reading the live list per iteration exactly as the existing status probe does and bounded by `pinnedStepCount + 64`. Growth is the only relaxation — the pin still governs every step it already covers, a shrinking list is ignored, and the worktree-isolated path keeps the strict pin because its instances are allocated up front. This unblocks `review-remediation-steps`, whose appended steps previously never received an instance and stayed `pending` forever, so `builtin:coding-ideas-v2` now enables named remediation on both its review gates.
