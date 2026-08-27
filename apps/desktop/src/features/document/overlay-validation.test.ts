import { describe, expect, it } from "vitest";

import { OVERLAY_ARROWHEADS, type OverlayRichTextDocument } from "./overlay-model";
import {
  isOverlayRichTextDocument,
  isValidOverlaySnapshot,
} from "./overlay-validation";

const supportedDocument: OverlayRichTextDocument = {
  blocks: [
    {
      type: "paragraph",
      children: [
        {
          type: "text",
          text: "辺\n",
          marks: ["bold", "italic", "boxed"],
          boxedPaddingY: 2,
          boxedVariant: "double",
          boxedTone: "blue",
        },
        {
          type: "mathInline",
          id: "math_pq",
          tex: "\\overline{PQ}",
          display: "inline",
          marks: ["underline"],
          backgroundColor: "#fff3c2",
          fontFamily: '"Yu Mincho", serif',
          fontSize: 13,
        },
      ],
    },
    {
      type: "heading",
      level: 3,
      align: "center",
      lineHeight: "1.8",
      children: [{ type: "text", text: "見出し" }],
    },
  ],
};

describe("overlay rich-text validation", () => {
  it("accepts semantic blocks backed by canonical InlineNode arrays", () => {
    expect(isOverlayRichTextDocument(supportedDocument)).toBe(true);
  });

  it.each([
    { type: "doc", content: [{ type: "paragraph", content: [] }] },
    { blocks: [{ type: "bulletList", children: [] }] },
    { blocks: [{ type: "paragraph", children: [{ type: "text", text: "x", marks: ["strike"] }] }] },
    { blocks: [{ type: "paragraph", children: [{ type: "mathInline", id: "", tex: "x", display: "inline" }] }] },
    { blocks: [{ type: "heading", level: 4, children: [] }] },
    { blocks: [{ type: "paragraph", align: "start", children: [] }] },
  ])("rejects unsupported persisted content %#", (document) => {
    expect(isOverlayRichTextDocument(document)).toBe(false);
  });

  it("uses the semantic rich-text validator from snapshot validation", () => {
    const snapshot = {
      version: 1,
      shapes: [
        {
          id: "shape_text",
          type: "text",
          x: 0,
          y: 0,
          props: {
            w: 120,
            richText: supportedDocument,
            autoSize: true,
            color: "#111111",
            size: "m",
          },
        },
      ],
      assets: {},
    };

    expect(isValidOverlaySnapshot(snapshot)).toBe(true);
    const invalidSnapshot = structuredClone(snapshot);
    invalidSnapshot.shapes[0].props.richText.blocks[0].children[0].marks?.push("strike" as never);
    expect(isValidOverlaySnapshot(invalidSnapshot)).toBe(false);
  });

  it.each(OVERLAY_ARROWHEADS)("accepts %s on both endpoints of a line", (head) => {
    expect(isValidOverlaySnapshot(lineSnapshotWithHeads(head, head))).toBe(true);
  });

  it("rejects an endpoint decoration the model does not define", () => {
    // The validator is what keeps an unknown head out of the renderers, which would otherwise
    // reference a marker that no `<defs>` declares and silently draw a bare line.
    expect(isValidOverlaySnapshot(lineSnapshotWithHeads("spiral", "arrow"))).toBe(false);
    expect(isValidOverlaySnapshot(lineSnapshotWithHeads("arrow", "__proto__"))).toBe(false);
  });
});

function lineSnapshotWithHeads(start: string, end: string) {
  return {
    version: 1,
    shapes: [
      {
        id: "shape_line",
        type: "line",
        x: 0,
        y: 0,
        props: {
          kind: "polyline",
          points: [{ x: 0, y: 0 }, { x: 40, y: 0 }],
          closed: false,
          arrowheadStart: start,
          arrowheadEnd: end,
          color: "#111111",
          dash: "solid",
          size: "m",
        },
      },
    ],
    assets: {},
  };
}
