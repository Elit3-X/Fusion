import { describe, expect, it } from "vitest";
import { COLOR_THEMES as CORE_COLOR_THEMES } from "@fusion/core";
import { COLOR_THEMES as DASHBOARD_COLOR_THEMES } from "../components/themeOptions";
import { readAppFile } from "../test/cssFixture";

/*
FNXC:DashboardTheming 2026-08-19-19:23:
Medieval must remain one persisted theme across core, selectors, and web/Electron first paint. Its visual contract is intentionally limited to parchment tokens and generic modal paint so the existing modal interaction and mobile layout remain unchanged.
*/
describe("Medieval color theme", () => {
  const themeData = readAppFile("public/theme-data.css");
  const themeSelector = readAppFile("components/ThemeSelector.css");
  const styles = readAppFile("styles.css");
  const dashboardIndexHtml = readAppFile("index.html");
  const desktopIndexHtml = readAppFile("../../desktop/src/renderer/index.html");

  it("keeps persisted, selector, and first-paint registries in exact order", () => {
    const coreIds = [...CORE_COLOR_THEMES];
    const dashboardIds = DASHBOARD_COLOR_THEMES.map((theme) => theme.value);
    const dashboardValidThemes = extractValidThemes(dashboardIndexHtml);
    const desktopValidThemes = extractValidThemes(desktopIndexHtml);

    expect(CORE_COLOR_THEMES.filter((theme) => theme === "medieval")).toHaveLength(1);
    expect(DASHBOARD_COLOR_THEMES).toContainEqual({ value: "medieval", label: "Medieval", className: "theme-swatch-medieval" });
    expect(dashboardIds).toEqual(coreIds);
    expect(dashboardValidThemes).toEqual(coreIds);
    expect(desktopValidThemes).toEqual(coreIds);
  });

  it("defines readable parchment tokens and a bundled pixel display face in both modes", () => {
    for (const selector of ['[data-color-theme="medieval"]', '[data-color-theme="medieval"][data-theme="light"]']) {
      const block = extractSelectorBlock(themeData, selector);
      for (const token of ["--bg:", "--surface:", "--card:", "--surface-hover:", "--border:", "--text:", "--color-success:", "--color-warning:", "--color-error:", "--color-info:", "--cta-bg:", "--cta-text:", "--accent:", "--focus-ring:", "--shadow-glow:", "--font-primary:"]) expect(block).toContain(token);
      expect(block).toContain('"Press Start 2P", ui-monospace, monospace');
    }
    expect(themeData).toContain('[data-color-theme="medieval"] body');
    expect(readAppFile("main.tsx")).toContain('@fontsource/press-start-2p/400.css');
  });

  it("uses mode-specific swatches and generic modal paint without changing modal behavior", () => {
    for (const block of [extractSelectorBlock(themeData, ":root"), extractSelectorBlock(themeData, '[data-theme="light"]'), extractSelectorBlock(themeSelector, ".theme-swatch-medieval"), extractSelectorBlock(themeSelector, '[data-theme="light"] .theme-swatch-medieval')]) {
      for (const sample of [1, 2, 3, 4]) expect(block).toContain(`medieval-swatch-sample-${sample}`);
    }
    const medievalModal = extractSelectorBlock(styles, '[data-color-theme="medieval"] .modal');
    expect(medievalModal).toContain("border-color:");
    expect(medievalModal).toContain("box-shadow:");
    expect(medievalModal).toContain("background-image:");
    expect(medievalModal).not.toMatch(/(?:position|width|max-height|z-index|resize|touch-action)\s*:/);
    expect(styles).toContain('[data-color-theme="medieval"] .modal:not(.confirm-dialog)');
    expect(styles).toContain('Mobile\'s generic modal reset removes all borders');
  });
});

function extractValidThemes(html: string): string[] {
  const match = html.match(/var validThemes = \[([\s\S]*?)\];/);
  if (!match) throw new Error("Could not find pre-hydration validThemes array");
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((themeMatch) => themeMatch[1]);
}

function extractSelectorBlock(css: string, selector: string): string {
  const startIdx = css.indexOf(`${selector} {`);
  if (startIdx === -1) throw new Error(`Could not find selector block: ${selector}`);
  const openBraceIdx = css.indexOf("{", startIdx);
  let depth = 1;
  for (let index = openBraceIdx + 1; index < css.length; index++) {
    if (css[index] === "{") depth++;
    if (css[index] === "}") depth--;
    if (depth === 0) return css.slice(startIdx, index + 1);
  }
  throw new Error(`Could not find closing brace for selector block: ${selector}`);
}
