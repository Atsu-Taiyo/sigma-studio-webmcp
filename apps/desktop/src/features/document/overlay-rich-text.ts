import type { InlineNode } from "./model/rich-text";
import type { OverlayRichTextDocument } from "./overlay-model";

/** Appends an inline node to the final block without weakening the document schema. */
export function appendOverlayRichTextInline(
  document: OverlayRichTextDocument,
  inline: InlineNode,
): OverlayRichTextDocument {
  const lastIndex = document.blocks.length - 1;
  if (lastIndex < 0) {
    return {
      blocks: [{ type: "paragraph", children: [inline] }],
    };
  }

  const block = document.blocks[lastIndex];
  return {
    blocks: [
      ...document.blocks.slice(0, lastIndex),
      {
        ...block,
        children: [...block.children, inline],
      },
    ],
  };
}
