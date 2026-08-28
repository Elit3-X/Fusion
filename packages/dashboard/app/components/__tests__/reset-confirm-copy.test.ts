// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { listComponentFiles, readAppFile } from "../../test/cssFixture";

const key = "taskDetail.reset.confirmMessage";
const expectedCopy = "Restart this task from nothing but the original request. Its plan, worktree, branch and commits, and reviews are permanently deleted and cannot be recovered.";
const hosts = ["ListView.tsx", "TaskCard.tsx", "TaskDetailModal.tsx"];

describe("Reset confirmation copy", () => {
  it("keeps every Reset host aligned with the English catalog", () => {
    const catalog = JSON.parse(readFileSync(resolve(__dirname, "../../../../i18n/locales/en/app.json"), "utf8")) as {
      taskDetail: { reset: { confirmMessage: string } };
    };
    expect(catalog.taskDetail.reset.confirmMessage).toBe(expectedCopy);

    for (const host of hosts) {
      const source = readAppFile(`components/${host}`);
      expect(source).toContain(`t("${key}", "${expectedCopy}")`);
    }
  });

  it("has exactly the three shared Reset hosts reference the key", () => {
    const references = listComponentFiles()
      .filter((path) => readAppFile(`components/${path}`).includes(key));
    expect(references).toEqual(hosts.toSorted());
  });
});
