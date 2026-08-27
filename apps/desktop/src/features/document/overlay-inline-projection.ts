import type { InlineNode } from "./model";
import type { OverlayRichTextDocument } from "./overlay-model";

/** Projects the first overlay rich-text block into canonical SigmaDoc inline nodes. */
export function overlayRichTextDocumentToInlineNodes(
  document: OverlayRichTextDocument,
): InlineNode[] {
  return document.blocks[0]?.children ?? [];
}

/** Compatibility helper for callers that already hold one semantic inline array. */
export function overlayRichTextInlinesToInlineNodes(
  nodes: readonly InlineNode[],
): InlineNode[] {
  return [...nodes];
}
