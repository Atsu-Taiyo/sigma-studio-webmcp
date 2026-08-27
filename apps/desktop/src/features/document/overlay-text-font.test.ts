import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normalizeOverlayGroups } from "./overlay-group-normalization";
import type { OverlayShape } from "./overlay-model";
import { overlayTextSizeToPx } from "./overlay-rich-text-format";
import {
  CSS_PX_PER_PT,
  getTextShapeFontSizePt,
  getTextShapeFontSizePx,
  getTextShapeLineHeightPx,
  getTextShapeRenderedFontSizePx,
  getTextShapeRenderedLineHeightPx,
  getTextShapeScale,
  MAX_TEXT_SHAPE_SCALE,
  MIN_TEXT_SHAPE_SCALE,
  normalizeTextShapeScale,
  ptToPx,
  pxToPt,
  roundFontSize,
  TEXT_SHAPE_LINE_HEIGHT,
} from "./overlay-text-font";

function sourceFiles(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      return sourceFiles(new URL(`${entry.name}/`, directory));
    }
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)
      ? [fileURLToPath(entryUrl)]
      : [];
  });
}

function textShape(props: Partial<Extract<OverlayShape, { type: "text" }>["props"]> = {}): Extract<OverlayShape, { type: "text" }> {
  return {
    id: "text_1",
    type: "text",
    x: 0,
    y: 0,
    rotation: 0,
    props: {
      w: 100,
      size: "m",
      autoSize: true,
      color: "#111827",
      richText: { blocks: [{ type: "paragraph", children: [{ type: "text", text: "行" }] }] },
      ...props,
    },
  };
}

describe("overlay text size table ownership", () => {
  /**
   * The `s=13 / m=16 / l=20 / xl=24` table used to exist twice as this exact `if`-chain (here and
   * privately in `features/drawing/text-shape-font.ts`). This is a tripwire for that shape, not a
   * proof of uniqueness — a copy written as a record, a `switch`, or a nested ternary would slip
   * past it. Broader nets were tried and rejected: "any production file holding 13/20/24 plus the
   * string `"xl"`" matches five files, four of them legitimate consumers of the enum.
   */
  it("declares the overlay text size table in exactly one module", () => {
    const files = [
      ...sourceFiles(new URL("../../", import.meta.url)),
      ...sourceFiles(new URL("../../../electron/", import.meta.url)),
      ...sourceFiles(new URL("../../../mcp/", import.meta.url)),
    ].filter((file) => !/\.test\.tsx?$/.test(file));
    const sizeTablePattern = /return\s+13;[\s\S]{0,200}return\s+20;[\s\S]{0,200}return\s+24;/;
    const owners = files.filter((file) => sizeTablePattern.test(readFileSync(file, "utf8")));

    expect(owners).toEqual([
      fileURLToPath(new URL("./overlay-rich-text-format.ts", import.meta.url)),
    ]);
  });

  it("maps every overlay text size to its px value", () => {
    expect(overlayTextSizeToPx("s")).toBe(13);
    expect(overlayTextSizeToPx("m")).toBe(16);
    expect(overlayTextSizeToPx("l")).toBe(20);
    expect(overlayTextSizeToPx("xl")).toBe(24);
  });

  it("falls back to the medium size for unknown persisted size values", () => {
    // Persisted documents predate the current enum, and `overlay-validation` lets an unknown
    // string through as `size`; the renderer must not produce `NaN` geometry for it.
    expect(overlayTextSizeToPx("md" as never)).toBe(16);
  });
});

describe("overlay text font units", () => {
  it("keeps the CSS px-per-pt ratio and its round trip", () => {
    expect(CSS_PX_PER_PT).toBe(96 / 72);
    expect(ptToPx(12)).toBe(16);
    expect(pxToPt(16)).toBe(12);
    expect(pxToPt(13)).toBe(9.75);
    expect(roundFontSize(10.50049)).toBe(10.5);
  });

  it("renders one line box per font size by default", () => {
    expect(TEXT_SHAPE_LINE_HEIGHT).toBe(1);
  });
});

describe("text shape font size resolution", () => {
  it("derives the font size from the size enum when no point size is stored", () => {
    expect(getTextShapeFontSizePx("s")).toBe(13);
    expect(getTextShapeFontSizePx("xl", 2)).toBe(48);
    expect(getTextShapeLineHeightPx("s")).toBe(13);
    expect(getTextShapeLineHeightPx("l", 1.5)).toBe(30);
    expect(getTextShapeFontSizePt(textShape({ size: "m" }))).toBe(12);
  });

  it("prefers an explicitly stored point size over the size enum", () => {
    const shape = textShape({ size: "xl", fontSize: 10.5 });

    expect(getTextShapeFontSizePt(shape)).toBe(10.5);
    expect(getTextShapeRenderedFontSizePx(shape)).toBe(14);
    expect(getTextShapeRenderedLineHeightPx(shape)).toBe(14);
  });

  it("ignores a stored point size that cannot describe a rendered glyph", () => {
    expect(getTextShapeFontSizePt(textShape({ size: "m", fontSize: 0 }))).toBe(12);
    expect(getTextShapeFontSizePt(textShape({ size: "m", fontSize: -3 }))).toBe(12);
    expect(getTextShapeFontSizePt(textShape({ size: "m", fontSize: Number.NaN }))).toBe(12);
  });

  it("clamps the stored scale to the supported range", () => {
    expect(normalizeTextShapeScale(MIN_TEXT_SHAPE_SCALE)).toBe(0.25);
    expect(normalizeTextShapeScale(MAX_TEXT_SHAPE_SCALE)).toBe(8);
    expect(normalizeTextShapeScale(0)).toBe(MIN_TEXT_SHAPE_SCALE);
    expect(normalizeTextShapeScale(20)).toBe(MAX_TEXT_SHAPE_SCALE);
    expect(normalizeTextShapeScale(Number.NaN)).toBe(1);
    expect(normalizeTextShapeScale(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalizeTextShapeScale(undefined)).toBe(1);
    expect(normalizeTextShapeScale("2")).toBe(1);
  });

  it("treats a callout as unscaled because it has no scale prop", () => {
    const callout: Extract<OverlayShape, { type: "callout" }> = {
      id: "callout_1",
      type: "callout",
      x: 0,
      y: 0,
      rotation: 0,
      props: {
        w: 120,
        h: 60,
        radius: 8,
        tail: { baseStart: { x: 0, y: 0 }, baseEnd: { x: 10, y: 0 }, tip: { x: 5, y: 20 } },
        richText: { blocks: [{ type: "paragraph", children: [{ type: "text", text: "口" }] }] },
        color: "#111827",
        size: "l",
        dash: "solid",
        strokeWidth: "m",
      },
    };

    expect(getTextShapeScale(callout)).toBe(1);
    expect(getTextShapeFontSizePt(callout)).toBe(15);
    expect(getTextShapeRenderedLineHeightPx(callout)).toBe(20);
    expect(getTextShapeFontSizePt({ ...callout, props: { ...callout.props, fontSize: 9 } })).toBe(9);
  });

  it("clamps the scale when reading it off a shape", () => {
    expect(getTextShapeScale(textShape())).toBe(1);
    expect(getTextShapeScale(textShape({ scale: 0.1 }))).toBe(0.25);
    expect(getTextShapeScale(textShape({ scale: 12 }))).toBe(8);
    expect(getTextShapeFontSizePt(textShape({ size: "m", fontSize: 10.5, scale: 2 }))).toBe(21);
    expect(getTextShapeRenderedFontSizePx(textShape({ size: "m", fontSize: 10.5, scale: 2 }))).toBe(28);
  });
});

describe("group bounds fallback height", () => {
  /**
   * The group bounds of an auto-sized text shape are derived from the same rendered line height
   * the drawing feature uses (`getTextShapeRenderedLineHeightPx`), not from a second pt→px
   * conversion. `size:"m"`, `scale:2` renders a 32px line box, so three explicit lines occupy 96px.
   */
  it("sizes a group around a text shape using the rendered line height", () => {
    const richText = {
      blocks: [{ type: "paragraph" as const, children: [{ type: "text" as const, text: "a\nb\nc" }] }],
    };
    const child = textShape({ size: "m", scale: 2, richText });
    const shapes: OverlayShape[] = [
      {
        id: "group_1",
        type: "group",
        x: 0,
        y: 0,
        rotation: 0,
        props: { w: 1, h: 1 },
      },
      { ...child, parentId: "group_1" },
      // A group with a single child is dissolved, so the text shape needs a sibling. Keep it
      // inside the text shape's box so the union bounds stay the text shape's own bounds.
      {
        id: "geo_1",
        type: "geo",
        x: 0,
        y: 0,
        rotation: 0,
        parentId: "group_1",
        props: {
          w: 10,
          h: 10,
          geo: "rectangle",
          fill: "none",
          color: "#111827",
          labelColor: "#111827",
          dash: "solid",
          size: "m",
        },
      },
    ];

    expect(getTextShapeRenderedLineHeightPx({ ...child, props: { ...child.props, richText } })).toBe(32);

    const group = normalizeOverlayGroups(shapes).find((shape) => shape.id === "group_1");

    expect(group?.type === "group" ? group.props.h : undefined).toBe(96);
  });
});
