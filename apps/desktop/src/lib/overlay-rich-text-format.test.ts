import { describe, expect, it } from "vitest";

import type { InlineNode, OverlayRichTextDocument } from "@/features/document";
import { formatRichTextDocument, fontSizeToOverlaySize } from "@/lib/overlay-rich-text-format";

const doc = (text: string): OverlayRichTextDocument => ({
  blocks: [{ type: "paragraph", children: [{ type: "text", text }] }],
});

const mathDoc = (): OverlayRichTextDocument => ({
  blocks: [{
    type: "paragraph",
    children: [{
      type: "mathInline",
      id: "m1",
      tex: "\\frac{1}{x}",
      display: "inline",
    }],
  }],
});

function firstInline(document: OverlayRichTextDocument): InlineNode {
  return document.blocks[0].children[0];
}

describe("formatRichTextDocument", () => {
  it("toggles semantic marks over the whole document", () => {
    const formatted = formatRichTextDocument(doc("Text"), "bold");
    expect(firstInline(formatted).marks).toEqual(["bold"]);
    expect(firstInline(formatRichTextDocument(formatted, "bold")).marks).toBeUndefined();
  });

  it("sets semantic inline style fields directly", () => {
    const colored = formatRichTextDocument(doc("Text"), "color", "#ff0000");
    const highlighted = formatRichTextDocument(colored, "backgroundColor", "#fff3c2");
    const withFont = formatRichTextDocument(highlighted, "fontFamily", "serif");
    expect(firstInline(withFont)).toMatchObject({
      color: "#ff0000",
      backgroundColor: "#fff3c2",
      fontFamily: "serif",
    });
  });

  it("sets boxed text padding and variants as semantic fields", () => {
    const padded = formatRichTextDocument(doc("Text"), "boxedPaddingY", "4");
    expect(firstInline(padded)).toMatchObject({ marks: ["boxed"], boxedPaddingY: 4 });

    const rounded = formatRichTextDocument(padded, "boxedVariant", "oval");
    expect(firstInline(rounded)).toMatchObject({
      marks: ["boxed"],
      boxedPaddingY: 4,
      boxedVariant: "oval",
    });

    const frame = formatRichTextDocument(rounded, "boxedVariant", "frame");
    expect(firstInline(frame).boxedVariant).toBeUndefined();
  });

  it("supports underline and boxed formatting on inline math only", () => {
    const underlined = formatRichTextDocument(mathDoc(), "underline");
    expect(firstInline(underlined).marks).toEqual(["underline"]);
    expect(firstInline(formatRichTextDocument(underlined, "underline")).marks).toBeUndefined();

    const boxed = formatRichTextDocument(mathDoc(), "boxedPaddingY", "5");
    expect(firstInline(boxed)).toMatchObject({ marks: ["boxed"], boxedPaddingY: 5 });

    const oval = formatRichTextDocument(mathDoc(), "boxedVariant", "oval");
    expect(firstInline(oval)).toMatchObject({ marks: ["boxed"], boxedVariant: "oval" });

    expect(firstInline(formatRichTextDocument(mathDoc(), "bold")).marks).toBeUndefined();
    expect(firstInline(formatRichTextDocument(mathDoc(), "italic")).marks).toBeUndefined();
  });

  it("sets semantic paragraph alignment", () => {
    const formatted = formatRichTextDocument(doc("Text"), "textAlign", "center");
    expect(formatted.blocks[0].align).toBe("center");
  });
});

describe("fontSizeToOverlaySize", () => {
  it("maps toolbar font sizes to overlay text sizes", () => {
    expect(fontSizeToOverlaySize(10)).toBe("s");
    expect(fontSizeToOverlaySize(12)).toBe("m");
    expect(fontSizeToOverlaySize(15)).toBe("l");
    expect(fontSizeToOverlaySize(18)).toBe("xl");
  });
});
