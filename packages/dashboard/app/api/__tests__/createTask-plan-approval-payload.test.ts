import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyApiMock = vi.hoisted(() => vi.fn());

vi.mock("../client/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client/client.js")>();
  return {
    ...actual,
    proxyApi: proxyApiMock,
  };
});

import { createTask } from "../tasks/tasks.js";

function postedBody(): Record<string, unknown> {
  const options = proxyApiMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
  return JSON.parse(String(options?.body)) as Record<string, unknown>;
}

describe("createTask plan approval payload", () => {
  beforeEach(() => {
    proxyApiMock.mockReset();
    proxyApiMock.mockResolvedValue({ id: "FN-228" });
  });

  it("forwards an enabled per-task plan approval override", async () => {
    await createTask({ description: "Review this plan", requirePlanApproval: true });

    expect(postedBody()).toMatchObject({
      description: "Review this plan",
      requirePlanApproval: true,
    });
  });

  it("leaves the inherited plan approval override absent", async () => {
    await createTask({ description: "Inherit project policy" });

    expect(postedBody().requirePlanApproval).toBeUndefined();
  });

  it("forwards an explicit disabled override", async () => {
    await createTask({ description: "Do not wait", requirePlanApproval: false });

    expect(postedBody().requirePlanApproval).toBe(false);
  });

  it("keeps every create-time task override in the explicit API whitelist", () => {
    const source = readFileSync(resolve(__dirname, "../tasks/tasks.ts"), "utf8");
    const start = source.indexOf("export async function createTask(");
    const end = source.indexOf("/** Update explicit workspace repository intent", start);
    const createTaskSource = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    for (const override of [
      "executionMode",
      "plannerOversightLevel",
      "sessionAdvisorEnabled",
      "enabledWorkflowSteps",
      "requirePlanApproval",
    ]) {
      expect(createTaskSource).toContain(override);
    }
  });
});
