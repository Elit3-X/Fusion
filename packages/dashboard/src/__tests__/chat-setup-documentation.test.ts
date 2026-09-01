// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../../");
const bannedRetiredPhrases = [
  "New Chat dialog",
  "New Chat picker",
  "Prompt for model each time",
  "Always use configured default",
  "falls back to the dialog",
] as const;

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function getSectionBody(doc: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = doc.match(new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match?.[1]?.trim() ?? "";
}

describe("Direct chat setup documentation", () => {
  const dashboardGuide = readRepoFile("docs/dashboard-guide.md");
  const settingsReference = readRepoFile("docs/settings-reference.md");

  it("keeps documentation coupled to the retired setup UI being absent", () => {
    const chatView = readRepoFile("packages/dashboard/app/components/ChatView.tsx");
    const projectModels = readRepoFile("packages/dashboard/app/components/settings/sections/ProjectModelsSection.tsx");

    expect(chatView).not.toContain("NewChatDialog");
    expect(projectModels).not.toMatch(/chatNewSessionModePrompt|chatNewSessionModeAlwaysDefault/);
  });

  it("removes retired-flow claims from the dashboard guide", () => {
    for (const phrase of bannedRetiredPhrases) {
      expect(dashboardGuide).not.toContain(phrase);
    }
  });

  it("documents immediate creation and Brain-popover retargeting in Chat View", () => {
    const chatViewSection = getSectionBody(dashboardGuide, "Chat View");

    expect(chatViewSection).toMatch(/\*\*Brain\*\* control beside the composer to retarget an existing conversation/i);
    expect(chatViewSection).toMatch(/\*\*New Chat\*\* immediately creates a Direct conversation from the Settings-configured default/i);
  });

  it("marks the retained mode setting inert without retired-flow claims", () => {
    for (const phrase of bannedRetiredPhrases) {
      expect(settingsReference).not.toContain(phrase);
    }

    const modeRow = settingsReference.split("\n").find((line) => line.startsWith("| `chatNewSessionMode`"));
    expect(modeRow).toMatch(/retired|inert|no effect/i);
  });
});
