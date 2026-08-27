import { describe, expect, it } from "vitest";

import {
  DEFAULT_SERIF_BODY_FONT_FAMILY,
  LEGACY_STANDARD_SERIF_FONT_FAMILY,
  overlayRichTextInlinesToInlineNodes as canonicalOverlayRichTextInlinesToInlineNodes,
  type OverlayRichTextDocument,
} from "@/features/document";
import {
  fromTiptap,
  inlineNodesToPlainText,
  overlayRichTextInlinesToInlineNodes,
  overlayRichTextToTiptapDoc,
  tiptapDocToOverlayRichText,
  toTiptap,
  type TiptapDoc,
} from "@/lib/tiptap-adapter";
import type { ParagraphNode } from "@/types/sigma-doc";

describe("Tiptap adapter", () => {
  it("keeps overlay inline projection as a document-feature compatibility export", () => {
    expect(overlayRichTextInlinesToInlineNodes)
      .toBe(canonicalOverlayRichTextInlinesToInlineNodes);
  });

  it("projects legacy standard Mincho marks to the bundled editor font", () => {
    const document: OverlayRichTextDocument = {
      blocks: [{
        type: "paragraph",
        children: [{ type: "text", text: "明朝", fontFamily: LEGACY_STANDARD_SERIF_FONT_FAMILY }],
      }],
    };

    expect(overlayRichTextToTiptapDoc(document).content[0].content?.[0].marks).toContainEqual({
      type: "styledText",
      attrs: {
        color: undefined,
        backgroundColor: undefined,
        fontFamily: DEFAULT_SERIF_BODY_FONT_FAMILY,
        fontSize: undefined,
      },
    });
  });

  it("round-trips semantic overlay rich text through an editor-only Tiptap document", () => {
    const overlayDocument: OverlayRichTextDocument = {
      blocks: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              text: "本文\n",
              marks: ["bold", "boxed"],
            },
            {
              type: "mathInline",
              id: "math_overlay",
              tex: "x^2+1",
              display: "inline",
              marks: ["underline"],
              backgroundColor: "#fff3c2",
              fontSize: 13.5,
              semanticRole: "expression",
            },
          ],
        },
        {
          type: "heading",
          level: 2,
          align: "right",
          lineHeight: "1.5",
          children: [{ type: "text", text: "見出し", marks: ["italic"] }],
        },
      ],
    };

    const tiptapDocument = overlayRichTextToTiptapDoc(overlayDocument);
    const restored = tiptapDocToOverlayRichText(tiptapDocument);

    expect(tiptapDocument).not.toBe(overlayDocument);
    expect(tiptapDocument).toMatchObject({
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "heading", attrs: { level: 2, textAlign: "right", lineHeight: "1.5" } },
      ],
    });
    expect(restored).toEqual(overlayDocument);
  });

  it("rejects Tiptap nodes and marks outside the canonical overlay subset", () => {
    const unsupportedNode = {
      type: "doc",
      content: [{ type: "bulletList", content: [] }],
    } as TiptapDoc;
    const unsupportedMark = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "strike" }] }] }],
    } as TiptapDoc;

    expect(() => tiptapDocToOverlayRichText(unsupportedNode)).toThrow(TypeError);
    expect(() => tiptapDocToOverlayRichText(unsupportedMark)).toThrow(TypeError);
  });

  it("round-trips text and inline math without leaking Tiptap shape", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      id: "p1",
      children: [
        { type: "text", text: "関数 " },
        {
          type: "mathInline",
          id: "m1",
          tex: "y=x^2",
          display: "inline",
          semanticRole: "expression",
        },
        { type: "text", text: " を考える。" },
      ],
    };

    const tiptap = toTiptap(paragraph);
    expect(tiptap.content[0].content?.[1]).toMatchObject({
      type: "mathInline",
      attrs: { id: "m1", tex: "y=x^2" },
    });

    const restored = fromTiptap(tiptap, paragraph);
    expect(restored).toEqual(paragraph);
    expect(inlineNodesToPlainText(paragraph.children)).toBe("関数 $y=x^2$ を考える。");
  });

  it("preserves multiline inline math TeX", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      id: "p_multiline",
      children: [
        {
          type: "mathInline",
          id: "m_multiline",
          tex: "x=1\\\\y=2",
          display: "inline",
          semanticRole: "expression",
        },
      ],
    };

    const restored = fromTiptap(toTiptap(paragraph), paragraph);

    expect(restored.children).toEqual(paragraph.children);
    expect(inlineNodesToPlainText(paragraph.children)).toBe("$x=1\\\\y=2$");
  });

  it("restores saved text newlines through Tiptap hard breaks", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      id: "p_newlines",
      children: [
        {
          type: "text",
          text: "1行目\n2行目\n\n4行目",
        },
      ],
    };

    const tiptap = toTiptap(paragraph);

    expect(tiptap.content[0].content).toEqual([
      { type: "text", text: "1行目" },
      { type: "hardBreak" },
      { type: "text", text: "2行目" },
      { type: "hardBreak" },
      { type: "hardBreak" },
      { type: "text", text: "4行目" },
    ]);
    expect(fromTiptap(tiptap, paragraph)).toEqual(paragraph);
  });

  it("round-trips justified paragraph alignment", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      id: "p_justify",
      align: "justify",
      lineHeight: "1.2",
      children: [{ type: "text", text: "両端揃えの本文" }],
    };

    const tiptap = toTiptap(paragraph);

    expect(tiptap.content[0].attrs?.textAlign).toBe("justify");
    expect(tiptap.content[0].attrs?.lineHeight).toBe("1.2");
    expect(fromTiptap(tiptap, paragraph)).toEqual(paragraph);
  });

  it("round-trips inline text font size styling", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      id: "p_styled",
      children: [
        {
          type: "text",
          text: "大きい文字",
          marks: ["bold"],
          color: "#dc2626",
          backgroundColor: "#fff3c2",
          fontFamily: "serif",
          fontSize: 22,
        },
      ],
    };

    const tiptap = toTiptap(paragraph);

    expect(tiptap.content[0].content?.[0].marks).toContainEqual({
      type: "styledText",
      attrs: {
        color: "#dc2626",
        backgroundColor: "#fff3c2",
        fontFamily: "serif",
        fontSize: 22,
      },
    });
    expect(fromTiptap(tiptap, paragraph)).toEqual(paragraph);
  });

  it("round-trips inline math font size styling", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      id: "p_math_styled",
      children: [
        {
          type: "mathInline",
          id: "m_styled",
          tex: "\\frac{1}{2}",
          display: "inline",
          color: "#111827",
          backgroundColor: "#f6e500",
          fontFamily: '"Yu Mincho", serif',
          fontSize: 14,
          semanticRole: "expression",
        },
      ],
    };

    const tiptap = toTiptap(paragraph);

    expect(tiptap.content[0].content?.[0].marks).toContainEqual({
      type: "styledText",
      attrs: {
        color: "#111827",
        backgroundColor: "#f6e500",
        fontFamily: '"Yu Mincho", serif',
        fontSize: 14,
      },
    });
    expect(fromTiptap(tiptap, paragraph)).toEqual(paragraph);
  });

  it("round-trips underlined inline math marks", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      id: "p_math_underlined",
      children: [
        {
          type: "mathInline",
          id: "m_underlined",
          tex: "x+y",
          display: "inline",
          marks: ["underline"],
          semanticRole: "expression",
        },
      ],
    };

    const tiptap = toTiptap(paragraph);

    expect(tiptap.content[0].content?.[0].marks).toContainEqual({ type: "underline" });
    expect(fromTiptap(tiptap, paragraph)).toEqual(paragraph);
  });

  it("round-trips boxed inline text marks", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      id: "p_boxed",
      children: [
        {
          type: "text",
          text: "重要",
          marks: ["boxed"],
          boxedPaddingY: 3,
        },
      ],
    };

    const tiptap = toTiptap(paragraph);

    expect(tiptap.content[0].content?.[0].marks).toContainEqual({ type: "boxed", attrs: { paddingY: 3 } });
    expect(fromTiptap(tiptap, paragraph)).toEqual(paragraph);
  });

  it("round-trips boxed inline math marks", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      id: "p_boxed_math",
      children: [
        {
          type: "mathInline",
          id: "m_boxed",
          tex: "\\frac{1}{x}",
          display: "inline",
          marks: ["boxed"],
          boxedPaddingY: 4,
          semanticRole: "expression",
        },
      ],
    };

    const tiptap = toTiptap(paragraph);

    expect(tiptap.content[0].content?.[0].marks).toContainEqual({ type: "boxed", attrs: { paddingY: 4, math: true } });
    expect(fromTiptap(tiptap, paragraph)).toEqual(paragraph);
  });

  it("round-trips boxed variant and tone on text and math", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      id: "p_boxed_variant",
      children: [
        {
          type: "text",
          text: "合格",
          marks: ["boxed"],
          boxedVariant: "thick",
          boxedTone: "green",
        },
        {
          type: "mathInline",
          id: "m_boxed_variant",
          tex: "x^2",
          display: "inline",
          marks: ["boxed"],
          boxedVariant: "double",
          boxedTone: "blue",
          semanticRole: "expression",
        },
      ],
    };

    const tiptap = toTiptap(paragraph);

    expect(tiptap.content[0].content?.[0].marks).toContainEqual({
      type: "boxed",
      attrs: { variant: "thick", tone: "green" },
    });
    expect(tiptap.content[0].content?.[1].marks).toContainEqual({
      type: "boxed",
      attrs: { variant: "double", tone: "blue", math: true },
    });
    expect(fromTiptap(tiptap, paragraph)).toEqual(paragraph);
  });
});
