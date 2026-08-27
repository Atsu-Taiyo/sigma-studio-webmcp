import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SPACE_TOKENS } from "./layout";

describe("design tokens", () => {
  it("defines every typed spacing token in the global theme", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    for (const token of SPACE_TOKENS) {
      expect(css).toContain(`--space-${token}:`);
    }
  });

  it("defines the shared surface tokens documented by the UI system", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    for (const token of [
      "radius-control",
      "radius-round",
      "radius-panel",
      "radius-dialog",
      "shadow-floating",
      "z-modal",
      "z-modal-nested",
      "z-tooltip",
    ]) {
      expect(css).toContain(`--${token}:`);
    }
  });

  it("keeps icon-only buttons circular through the shared round token", () => {
    const buttonCss = readFileSync(new URL("./Button.module.css", import.meta.url), "utf8");
    const globalCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(buttonCss).toMatch(
      /\.button\[data-icon-only="true"\]\s*\{[^}]*border-radius:\s*var\(--radius-round\);/,
    );
    expect(globalCss).toMatch(
      /\.ai-chat-icon-button,\s*\.ai-chat-send-button\s*\{[^}]*border-radius:\s*var\(--radius-round\);/,
    );
  });

  it("keeps modal stacking on shared tokens instead of feature-level overrides", () => {
    const globalCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const modalCss = readFileSync(new URL("./Modal.module.css", import.meta.url), "utf8");

    expect(modalCss).toContain("z-index: var(--z-modal);");
    expect(modalCss).toContain("z-index: var(--z-modal-nested);");
    expect(globalCss).toMatch(
      /\.table-settings-backdrop\s*\{[^}]*z-index:\s*var\(--z-modal\);/,
    );
    expect(globalCss).not.toMatch(/\.ai-chat-room-dialog-backdrop[^{}]*\{[^}]*z-index:/);
  });

  it("keeps portalled tooltips above shared modal layers", () => {
    const tooltipCss = readFileSync(new URL("./Tooltip.module.css", import.meta.url), "utf8");

    expect(tooltipCss).toContain("z-index: var(--z-tooltip);");
  });

  it("dismisses shared and legacy app modals from pointer input on their backdrop", () => {
    const modalSource = readFileSync(new URL("./Modal.tsx", import.meta.url), "utf8");
    expect(modalSource).toContain("onPointerDown={handlePointerDown}");
    expect(modalSource).toContain("event.target === event.currentTarget");

    for (const path of [
      "../editor/PageSettingsDialog.tsx",
      "../editor/TableSettingsDialog.tsx",
      "../editor/EditorShell.tsx",
      "../editor/editor-shell/material-dialogs.tsx",
      "../templates/TemplateGallery.tsx",
      "../print/PdfExportSuccessDialog.tsx",
      "../workspace/WorkspaceCreateDialog.tsx",
      "../workspace/WorkspaceDeleteDialog.tsx",
    ]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).toContain('aria-modal="true"');
      expect(source).toContain('data-modal-backdrop=""');
      expect(source).toContain("onPointerDown");
    }
  });

  it("keeps interactive popovers inside a modal's isolation and focus scope", () => {
    const modalSource = readFileSync(new URL("./Modal.tsx", import.meta.url), "utf8");
    const popoverSource = readFileSync(new URL("../editor/ToolbarPopover.tsx", import.meta.url), "utf8");
    const tableDialogSource = readFileSync(new URL("../editor/TableSettingsDialog.tsx", import.meta.url), "utf8");

    expect(popoverSource).toContain('closest<HTMLElement>("[data-modal-backdrop]")');
    expect(popoverSource).toContain('data-toolbar-popover=""');
    expect(popoverSource).toContain('event.key !== "Escape"');
    expect(modalSource).toContain("getFocusableElements(backdrop)");
    expect(modalSource).toContain("backdrop.contains(event.target as Node)");
    expect(tableDialogSource).toContain('data-modal-backdrop=""');
  });
});
