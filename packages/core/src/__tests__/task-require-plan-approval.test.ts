import { describe, expect, it } from "vitest";
import {
  createTaskStoreForTest,
  pgDescribe,
  type PgTestHarness,
} from "../__test-utils__/pg-test-harness.js";

pgDescribe("TaskStore requirePlanApproval persistence", () => {
  let harness: PgTestHarness | null = null;

  async function makeHarness(): Promise<PgTestHarness> {
    harness = await createTaskStoreForTest({ prefix: "fusion_require_plan_approval" });
    return harness;
  }

  async function teardown(): Promise<void> {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  }

  it("round-trips create values and supports explicit false plus null clear", async () => {
    const h = await makeHarness();
    try {
      const store = h.store;
      const optedIn = await store.createTask({
        description: "Wait for operator approval",
        requirePlanApproval: true,
      });
      const inherited = await store.createTask({ description: "Inherit approval policy" });

      expect(optedIn.requirePlanApproval).toBe(true);
      expect((await store.getTask(optedIn.id)).requirePlanApproval).toBe(true);
      expect(inherited.requirePlanApproval).toBeUndefined();
      expect((await store.getTask(inherited.id)).requirePlanApproval).toBeUndefined();

      const optedOut = await store.updateTask(optedIn.id, { requirePlanApproval: false });
      expect(optedOut.requirePlanApproval).toBe(false);
      expect((await store.getTask(optedIn.id)).requirePlanApproval).toBe(false);

      const cleared = await store.updateTask(optedIn.id, { requirePlanApproval: null });
      expect(cleared.requirePlanApproval).toBeUndefined();
      expect((await store.getTask(optedIn.id)).requirePlanApproval).toBeUndefined();
    } finally {
      await teardown();
    }
  });
});

void describe;
