import { describe, expect, it } from "vitest";

import type { OverlayRichTextDocument } from "./overlay-model";
import { appendOverlayRichTextInline } from "./overlay-rich-text";

describe("appendOverlayRichTextInline", () => {
  it("appends inline math inside the final semantic heading", () => {
    const document: OverlayRichTextDocument = {
      blocks: [
        { type: "paragraph", children: [{ type: "text", text: "前" }] },
        { type: "heading", level: 2, children: [{ type: "text", text: "末尾" }] },
      ],
    };
    const inline = {
      type: "mathInline" as const,
      id: "math_1",
      tex: "x^2",
      display: "inline" as const,
    };

    const next = appendOverlayRichTextInline(document, inline);

    expect(next).toEqual({
      blocks: [
        document.blocks[0],
        { ...document.blocks[1], children: [...document.blocks[1].children, inline] },
      ],
    });
    expect(next.blocks).toHaveLength(2);
    expect(document.blocks[1].children).toHaveLength(1);
  });

  it("creates a paragraph when the document has no block", () => {
    const inline = { type: "text" as const, text: "\n" };
    expect(appendOverlayRichTextInline({ blocks: [] }, inline)).toEqual({
      blocks: [{ type: "paragraph", children: [inline] }],
    });
  });
});
