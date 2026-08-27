import { describe, expect, it } from "vitest";

import type { OverlayCalloutShape, OverlayRichTextDocument, OverlayTextShape } from "@/features/document";

import { CALLOUT_TEXT_PADDING } from "./text-shape-font";
import { getCalloutBodySize, getTextShapeEffectiveSize } from "./overlay-text-box";

function richTextOf(text: string): OverlayRichTextDocument {
  return {
    blocks: [{
      type: "paragraph",
      children: [{ type: "text", text }],
    }],
  };
}

function textShape(props: Partial<OverlayTextShape["props"]> = {}): OverlayTextShape {
  return {
    id: "text",
    type: "text",
    x: 0,
    y: 0,
    props: {
      w: 100,
      richText: richTextOf("a"),
      autoSize: true,
      color: "black",
      size: "m",
      ...props,
    },
  };
}

describe("getTextShapeEffectiveSize", () => {
  it("grows a fixed-width shape's height to fit content wrapped at the stored width", () => {
    // 16px default font, 32px stored width -> 2 units/line fit exactly 2 CJK glyphs per line,
    // so this 10-glyph string needs exactly 5 wrapped lines (5 * 16 = 80).
    const shape = textShape({
      w: 32,
      h: 16,
      autoSize: false,
      richText: richTextOf("ああああああああああ"),
    });

    expect(getTextShapeEffectiveSize(shape).h).toBe(80);
  });

  it("never shrinks below the stored height (grow-only)", () => {
    const shape = textShape({
      w: 200,
      h: 400,
      autoSize: false,
      richText: richTextOf("word"),
    });

    expect(getTextShapeEffectiveSize(shape).h).toBe(400);
  });

  it("uses the explicit maxWidth as the width for auto-sized wrapping shapes", () => {
    const shape = textShape({
      w: 10,
      autoSize: true,
      maxWidth: 150,
      richText: richTextOf("this content is irrelevant to the resulting width"),
    });

    expect(getTextShapeEffectiveSize(shape).w).toBe(150);
  });

  it("feeds fontSize, size, and scale into the measured box (all three change the result)", () => {
    // Asserted on height, the only content-derived axis: `size`, an explicit `fontSize` in points,
    // and `scale` all have to reach the measurement, or a shape whose font grew keeps a box sized
    // for the old font and gets clipped in print.
    const text = richTextOf("ああああああああああ");

    const small = textShape({ w: 10, autoSize: true, size: "s", richText: text });
    const large = textShape({ w: 10, autoSize: true, size: "l", richText: text });
    expect(getTextShapeEffectiveSize(large).h).toBeGreaterThan(getTextShapeEffectiveSize(small).h);

    const basePt = textShape({ w: 10, autoSize: true, size: "m", fontSize: 9, richText: text });
    const biggerPt = textShape({ w: 10, autoSize: true, size: "m", fontSize: 30, richText: text });
    expect(getTextShapeEffectiveSize(biggerPt).h).toBeGreaterThan(getTextShapeEffectiveSize(basePt).h);

    const unscaled = textShape({ w: 10, autoSize: true, size: "m", scale: 1, richText: text });
    const scaledUp = textShape({ w: 10, autoSize: true, size: "m", scale: 3, richText: text });
    expect(getTextShapeEffectiveSize(scaledUp).h).toBeGreaterThan(getTextShapeEffectiveSize(unscaled).h);
  });

  it("never mutates the shape it measures", () => {
    const shape = textShape({
      w: 32,
      h: 16,
      autoSize: false,
      richText: richTextOf("ああああああああああ"),
    });
    const before = structuredClone(shape);

    getTextShapeEffectiveSize(shape);

    expect(shape).toEqual(before);
  });
});

function calloutShape(props: Partial<OverlayCalloutShape["props"]> = {}): OverlayCalloutShape {
  return {
    id: "callout",
    type: "callout",
    x: 0,
    y: 0,
    props: {
      w: 160,
      h: 72,
      radius: 18,
      tail: {
        baseStart: { x: 36, y: 72 },
        baseEnd: { x: 68, y: 72 },
        tip: { x: 24, y: 100 },
      },
      richText: richTextOf("a"),
      color: "black",
      size: "m",
      dash: "solid",
      strokeWidth: "m",
      ...props,
    },
  };
}

describe("getCalloutBodySize", () => {
  it("never grows the width past the stored value", () => {
    const shape = calloutShape({
      richText: richTextOf("説明".repeat(30)),
    });

    expect(getCalloutBodySize(shape).w).toBe(shape.props.w);
  });

  it("grows the height to fit the measured content plus padding on both sides", () => {
    // 136px content width (160 stored - 2*12 padding) at the default 16px font wraps this
    // 40-glyph CJK string into several lines, so the measured content height comfortably
    // exceeds what the stored 72px box leaves after padding.
    const shape = calloutShape({
      h: 72,
      richText: richTextOf("説明".repeat(20)),
    });

    const body = getCalloutBodySize(shape);
    const contentH = body.h - CALLOUT_TEXT_PADDING * 2;

    expect(body.h).toBeGreaterThanOrEqual(contentH + CALLOUT_TEXT_PADDING * 2);
    expect(body.h).toBeGreaterThan(shape.props.h);
  });

  it("never shrinks below the stored height (grow-only)", () => {
    const shape = calloutShape({
      h: 400,
      richText: richTextOf("short"),
    });

    expect(getCalloutBodySize(shape).h).toBe(400);
  });

  it("never mutates the shape it measures", () => {
    const shape = calloutShape({
      richText: richTextOf("説明".repeat(20)),
    });
    const before = structuredClone(shape);

    getCalloutBodySize(shape);

    expect(shape).toEqual(before);
  });
});
