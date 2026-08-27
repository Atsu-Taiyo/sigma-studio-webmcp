import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSiblingSource(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)]
    .map((match) => match[1]);
}

describe("page canvas pure-model dependency boundary", () => {
  it("keeps page models independent from UI and AI", () => {
    const runningRegionTextModel = readSiblingSource("./running-region-text-model.ts");
    const problemAreaModel = readSiblingSource("./problem-area-model.ts");
    const inlineContentComposition = readSiblingSource("./inline-content-composition.ts");
    const visibilityModel = readSiblingSource("./virtualization.ts");
    const sources = [
      readSiblingSource("./body-text-flow-transition.ts"),
      readSiblingSource("./reconciliation.ts"),
      readSiblingSource("./id-normalization.ts"),
      inlineContentComposition,
      readSiblingSource("./pointer-model.ts"),
      problemAreaModel,
      runningRegionTextModel,
      visibilityModel,
    ];
    const invalidImports = sources.flatMap(importSpecifiers).filter((specifier) => (
      specifier === "react"
      || specifier === "react-dom"
      || specifier.startsWith("@tiptap/")
      || specifier.startsWith("@/components/")
      || specifier.startsWith("@/features/ai-edit")
      || specifier.startsWith("@/lib/ai/")
      || specifier.startsWith("@/electron/")
      || specifier.includes("PageCanvasEditor")
      || specifier.includes("TextFlowEditor")
    ));

    expect(invalidImports).toEqual([]);
    expect(runningRegionTextModel).not.toMatch(
      /\b(?:window|HTMLElement|NodeList|Range)\b|\bdocument\s*\./,
    );
    expect(problemAreaModel).not.toMatch(
      /\b(?:window|HTMLElement|NodeList|Range)\b|\bdocument\s*\./,
    );
    expect(problemAreaModel).not.toContain('from "@/lib/id"');
    expect(inlineContentComposition).not.toMatch(
      /\b(?:window|HTMLElement|NodeList|Range|ReactNode)\b|\bdocument\s*\./,
    );
    expect(visibilityModel).not.toMatch(
      /\b(?:window|HTMLElement|DOMRect|ResizeObserver|IntersectionObserver|performance)\b|\bdocument\s*\./,
    );
  });

  it("keeps the page controller as the one-way composition entrypoint", () => {
    const pageCanvas = readSiblingSource("../PageCanvasEditor.tsx");

    expect(pageCanvas).toContain('from "./page-canvas/body-text-flow-transition"');
    expect(pageCanvas).toContain('from "./page-canvas/inline-content-composition"');
    expect(pageCanvas).toContain('from "./page-canvas/pointer-model"');
    expect(pageCanvas).toContain('from "./page-canvas/problem-area-model"');
    expect(pageCanvas).toContain('from "./page-canvas/running-region-text-model"');
    expect(pageCanvas).toContain('from "./page-canvas/virtualization"');
    expect(pageCanvas).toContain('from "./page-canvas/applied-gaps"');
    expect(pageCanvas).toContain('from "./page-canvas/pagination-decisions"');
    expect(pageCanvas).not.toContain('from "./page-canvas/reconciliation"');
    expect(pageCanvas).not.toMatch(/\bfunction collectReservedProblemAreaIds\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction collectReservedLayoutSectionIds\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction replaceProblemAreaRichBlocks\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction replaceLayoutSectionChildren\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction getPageDoubleTapHit\s*\(/);
    // ページ割りの判定と gap の読み戻しは純関数モジュール側にしか置かない。
    expect(pageCanvas).not.toMatch(/\bfunction decidePagination\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction gapMapSignature\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction detectGapOscillation\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction buildAppliedGapIndex\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction measureAppliedGapPx\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction arePageDoubleTapHitsEqual\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction pageRunningRegionToTextFlowBlocks\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction textFlowBlocksToRunningBlocks\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction getHiddenOptionalProblemAreas\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction ensureOptionalProblemArea\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction clearOptionalProblemArea\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction setProblemAreaMinHeight\s*\(/);
    expect(pageCanvas).not.toMatch(/\bfunction splitTextFlowBlocksByInlineContent\s*\(/);
    expect(pageCanvas).not.toMatch(/\btype TextFlowExtensionPart\b/);
    expect(pageCanvas).not.toMatch(/\bconst PAGE_WINDOW_OVERSCAN\s*=/);
    expect(pageCanvas).not.toMatch(/\bconst PAGE_WINDOW_FAST_SCROLL_OVERSCAN\s*=/);
    expect(pageCanvas).not.toMatch(/\bconst scrollSpeed\s*=/);
    expect(pageCanvas).toContain("createInitialVisiblePageRange()");
    expect(pageCanvas).toContain("resolvePageVisibilityWindow({");

    const runningRegionUpdate = pageCanvas.slice(
      pageCanvas.indexOf("const updateRunningRegionBlocks"),
      pageCanvas.indexOf("const resizeRunningRegionForContent"),
    );
    expect(runningRegionUpdate).toMatch(
      /onPageLayoutChange\(nextLayout\);\s*setPageLayoutDraft\(null\);\s*pageLayoutDraftRef\.current = null;/,
    );

    const problemAreaResize = pageCanvas.slice(
      pageCanvas.indexOf("const startProblemAreaResize"),
      pageCanvas.indexOf("const handleTextFlowFocusChange"),
    );
    expect(problemAreaResize).toMatch(
      /problemAreaHeightDraftsRef\.current = rest;\s*setProblemAreaHeightDrafts\(rest\);[\s\S]*?onChange\(transition\.targetId, transition\.reduce\);/,
    );

    const problemMenuActions = pageCanvas.slice(
      pageCanvas.indexOf("{contextMenuHiddenAreas.map"),
      pageCanvas.indexOf("{activeBodyContextMenu"),
    );
    expect(problemMenuActions).toMatch(
      /showProblemArea\([^;]+;\s*setProblemContextMenu\(null\);/,
    );
    expect(problemMenuActions).toMatch(
      /clearProblemArea\([^;]+;\s*setProblemContextMenu\(null\);/,
    );

    const problemAreaView = pageCanvas.slice(
      pageCanvas.indexOf("function ProblemAreaFlowUnit"),
      pageCanvas.indexOf("function problemAreaSideLabel"),
    );
    const textFlowIndex = problemAreaView.indexOf("<TextFlowWithInlineContent");
    const afterContentIndex = problemAreaView.indexOf(
      "{afterInlineContent.length > 0",
    );
    const resizeHandleIndex = problemAreaView.indexOf(
      'className="problem-area-resize-handle"',
    );
    expect(textFlowIndex).toBeGreaterThanOrEqual(0);
    expect(afterContentIndex).toBeGreaterThan(textFlowIndex);
    expect(resizeHandleIndex).toBeGreaterThan(afterContentIndex);

    expect(pageCanvas).toContain(
      'scroller.addEventListener("scroll", scheduleUpdate, { passive: true })',
    );
    // 可視ページ範囲は page canvas が 1 箇所で決めて配る (受け手が各自で数え直さない)。
    // 受け手は読み取り専用プレビュー 3 つと、編集モードの overlay 1 つ。
    expect(
      pageCanvas.match(/visiblePageRange=\{visiblePageRange\}/g),
    ).toHaveLength(4);
    // The running region used to take a `variant` prop that every production caller set to
    // `"print"`; the header/footer body is now drawn by the same renderer as the page body, so there
    // is no fork left to pin. What matters is that the page canvas still composes the view itself.
    expect(pageCanvas).toContain("<PageRunningRegionView");
    const runningRegionElements = pageCanvas.match(/<PageRunningRegionView[^>]*>/g) ?? [];
    expect(runningRegionElements).toHaveLength(2);
    expect(runningRegionElements.join("")).not.toContain("variant=");
  });
});
