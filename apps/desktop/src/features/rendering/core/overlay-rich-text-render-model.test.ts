import { describe, expect, it } from "vitest";

import {
  DEFAULT_SERIF_BODY_FONT_FAMILY,
  LEGACY_STANDARD_SERIF_FONT_FAMILY,
  type OverlayRichTextDocument,
} from "@/features/document";

import { createOverlayRichTextRenderModel } from "./overlay-rich-text-render-model";

describe("overlay rich-text render model", () => {
  it("renders semantic blocks and InlineNode decorations without Tiptap data", () => {
    const document: OverlayRichTextDocument = {
      blocks: [
        {
          type: "paragraph",
          align: "center",
          lineHeight: "1.8",
          children: [
            {
              type: "text",
              text: "A",
              marks: ["bold", "boxed"],
              color: "#123456",
              fontSize: 12.5,
              boxedPaddingY: 2,
              boxedVariant: "double",
              boxedTone: "blue",
            },
            { type: "text", text: "\u200B" },
            {
              type: "mathInline",
              id: "math_1",
              tex: "x^2",
              display: "inline",
              marks: ["boxed"],
              boxedPaddingY: 2,
              boxedVariant: "double",
              boxedTone: "blue",
            },
          ],
        },
        {
          type: "heading",
          level: 2,
          children: [{ type: "text", text: "Heading" }],
        },
      ],
    };

    const model = createOverlayRichTextRenderModel(document);
    expect(model).toMatchObject({
      kind: "fragment",
      children: [
        {
          kind: "block",
          blockType: "paragraph",
          textAlign: "center",
          lineHeight: "1.8",
          children: [
            {
              kind: "text",
              text: "A",
              decorations: expect.arrayContaining([
                { type: "bold" },
                expect.objectContaining({ type: "box", variant: "double", tone: "blue" }),
              ]),
            },
            { kind: "text", text: "\u200B" },
            {
              kind: "math",
              id: "math_1",
              tex: "x^2",
              decorations: [
                expect.objectContaining({ type: "box", math: true, variant: "double" }),
              ],
            },
          ],
        },
        {
          kind: "block",
          blockType: "heading",
          headingLevel: 2,
        },
      ],
    });
  });

  it("marks blank blocks so every renderer emits the same line-box placeholder", () => {
    const document: OverlayRichTextDocument = {
      blocks: [
        { type: "paragraph", children: [] },
        { type: "paragraph", children: [{ type: "text", text: "" }] },
        // Serializing this block yields a non-empty string, so "output was empty" is not a usable
        // blank test — only the model's own predicate agrees across renderers.
        { type: "paragraph", children: [{ type: "text", text: "", color: "#f00" }] },
        { type: "paragraph", children: [{ type: "text", text: " " }] },
        { type: "paragraph", children: [{ type: "mathInline", id: "m", tex: "", display: "inline" }] },
      ],
    };

    const model = createOverlayRichTextRenderModel(document);
    const blanks = model.children.map((child) => child.kind === "block" && child.isBlank === true);

    expect(blanks).toEqual([true, true, true, false, false]);
  });

  it("renders legacy standard Mincho runs with the bundled cross-platform serif", () => {
    const document: OverlayRichTextDocument = {
      blocks: [{
        type: "paragraph",
        children: [{ type: "text", text: "明朝", fontFamily: LEGACY_STANDARD_SERIF_FONT_FAMILY }],
      }],
    };

    const block = createOverlayRichTextRenderModel(document).children[0];
    const child = block.kind === "block" ? block.children[0] : undefined;
    const style = child && "decorations" in child
      ? child.decorations.find((decoration) => decoration.type === "style")
      : undefined;

    expect(style).toEqual({
      type: "style",
      style: { fontFamily: DEFAULT_SERIF_BODY_FONT_FAMILY },
    });
  });

  it("prefixes boxed run ids with the caller's prefix so both renderers can agree", () => {
    const document: OverlayRichTextDocument = {
      blocks: [
        { type: "paragraph", children: [] },
        {
          type: "paragraph",
          children: [{ type: "text", text: "枠", marks: ["boxed"] }],
        },
      ],
    };

    const runId = (prefix?: string) => {
      const block = createOverlayRichTextRenderModel(
        document,
        prefix === undefined ? {} : { runIdPrefix: prefix },
      ).children[1];
      const child = block.kind === "block" ? block.children[0] : undefined;
      const decorations = child && "decorations" in child ? child.decorations : [];
      const boxed = decorations.find((decoration) => decoration.type === "box");
      return boxed && boxed.type === "box" ? boxed.run?.runId : undefined;
    };

    expect(runId()).toBe("overlay-1-boxed-run-0");
    expect(runId("overlay-text-shape_1")).toBe("overlay-text-shape_1-1-boxed-run-0");
  });

  it("normalizes the line height identically for every caller", () => {
    const document: OverlayRichTextDocument = {
      blocks: [
        { type: "paragraph", lineHeight: "1.80", children: [{ type: "text", text: "a" }] },
        { type: "paragraph", lineHeight: "9", children: [{ type: "text", text: "b" }] },
      ],
    };

    const model = createOverlayRichTextRenderModel(document);
    const lineHeights = model.children.map((child) => (child.kind === "block" ? child.lineHeight : undefined));

    expect(lineHeights).toEqual(["1.8", undefined]);
  });

  it("reuses the derived model for the same document and prefix", () => {
    const document: OverlayRichTextDocument = {
      blocks: [{ type: "paragraph", children: [{ type: "text", text: "memo" }] }],
    };

    expect(createOverlayRichTextRenderModel(document)).toBe(createOverlayRichTextRenderModel(document));
    expect(createOverlayRichTextRenderModel(document, { runIdPrefix: "other" }))
      .not.toBe(createOverlayRichTextRenderModel(document));
  });
});
