import { describe, expect, it } from "vitest";

import type { EditorExtensionContextValue } from "@/components/editor/editor-extension-context";

import {
  buildWebMcpEditorExtensions,
  mergeEditorExtensionSets,
} from "./webmcp-editor-extensions";

describe("WebMCP editor extensions", () => {
  it("deduplicates pending targets and exposes real body and overlay locks", () => {
    const extensions = buildWebMcpEditorExtensions({
      blockIds: ["p_1", "p_1", "p_2"],
      shapeIds: ["shape_1", "shape_1", "shape_2"],
    }, "Review the proposal first");

    expect(extensions.textFlowEditPolicy?.guards.map((guard) => guard.blockId)).toEqual(["p_1", "p_2"]);
    expect(extensions.textFlowEditPolicy?.guards[0]).toMatchObject({
      blockedMessage: "Review the proposal first",
      highlight: true,
    });
    expect([...extensions.overlayEditPolicy!.lockedShapeIds]).toEqual(["shape_1", "shape_2"]);
    expect(extensions.overlayShapeDecorations?.get("shape_1")?.className).toBe("webmcp-edit-target-shape");
  });

  it("unions WebMCP locks with desktop AI editor extensions", () => {
    const aiExtensions: EditorExtensionContextValue = {
      textFlowEditPolicy: {
        guards: [{
          blockId: "p_ai",
          guardId: "ai",
          isPrimaryActionTarget: true,
          blockedMessage: "AI lock",
          presentation: {
            highlightedBlockClassName: "ai-highlight",
            readOnlyBlockClassName: "ai-readonly",
            characterClassName: "ai-character",
            atomClassName: "ai-atom",
          },
          highlight: true,
        }],
      },
      overlayEditPolicy: { lockedShapeIds: new Set(["shape_ai"]) },
      overlayShapeDecorations: new Map([["shape_shared", { className: "ai-shape" }]]),
    };
    const webExtensions = buildWebMcpEditorExtensions({
      blockIds: ["p_web"],
      shapeIds: ["shape_web", "shape_shared"],
    }, "WebMCP lock");

    const merged = mergeEditorExtensionSets(aiExtensions, webExtensions)!;

    expect(merged.textFlowEditPolicy?.guards.map((guard) => guard.blockId)).toEqual(["p_ai", "p_web"]);
    expect([...merged.overlayEditPolicy!.lockedShapeIds]).toEqual(["shape_ai", "shape_web", "shape_shared"]);
    expect(merged.overlayShapeDecorations?.get("shape_shared")?.className).toBe(
      "ai-shape webmcp-edit-target-shape",
    );
  });
});
