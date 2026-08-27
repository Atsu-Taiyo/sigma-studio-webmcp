import { describe, expect, it } from "vitest";

import type { InlineNode, OverlayRichTextDocument } from "@/features/document";

import {
  getCalloutBodySize,
  getShapeBounds,
  getTextShapeEffectiveSize,
  measureOverlayText,
  type OverlayMathMetricsPort,
} from ".";

/**
 * Characterization test: every number here is the output of the estimator *before* its line
 * building was moved onto the shared render model. It exists to prove that refactor changed nothing.
 *
 * `measureOverlayText` is the single source of truth for auto-sized overlay text — it decides the
 * stored geometry of text shapes, callouts and graph labels, and `docs/pdf-parity-architecture.md`
 * depends on it being a DOM-free estimator so that sizing cannot form a feedback loop. A shift of
 * one pixel here silently moves every figure in every existing document, in the editor and in the
 * PDF, with nothing to catch it. So the expectations are literals, not derived values: recomputing
 * them from the implementation would make the test agree with whatever the implementation does.
 *
 * If a change makes one of these fail, the change is wrong — not the number.
 */

/** Deterministic stand-in for the KaTeX-backed port, so math paths are exercised without a DOM. */
const fixedMathPort: OverlayMathMetricsPort = {
  measureTexEm: (tex) => ({
    ascentEm: 0.9 + tex.length * 0.01,
    descentEm: 0.3,
    widthEm: tex.length * 0.5,
  }),
};

/** A port that cannot measure: exercises the `?? estimateFallbackMathMetricsEm` branch. */
const nullMathPort: OverlayMathMetricsPort = { measureTexEm: () => null };

function richText(...blocks: OverlayRichTextDocument["blocks"]): OverlayRichTextDocument {
  return { blocks };
}

function paragraph(...children: InlineNode[]): OverlayRichTextDocument["blocks"][number] {
  return { type: "paragraph", children } as OverlayRichTextDocument["blocks"][number];
}

const text = (value: string): InlineNode => ({ type: "text", text: value });
const math = (tex: string): InlineNode => ({ type: "mathInline", id: "m", tex, display: "inline" });

describe("measureOverlayText characterization — plain lines", () => {
  it.each([
    ["empty input", {}, { w: 0, h: 16, wrapped: false }],
    ["empty lines array", { lines: [] }, { w: 0, h: 16, wrapped: false }],
    ["one empty string", { lines: [""] }, { w: 0, h: 16, wrapped: false }],
    ["ascii", { lines: ["abc"] }, { w: 28, h: 16, wrapped: false }],
    ["ascii wide chars", { lines: ["WWW"] }, { w: 28, h: 16, wrapped: false }],
    ["spaces only", { lines: ["   "] }, { w: 17, h: 16, wrapped: false }],
    ["cjk", { lines: ["日本語"] }, { w: 48, h: 16, wrapped: false }],
    ["cjk punctuation (fullwidth)", { lines: ["、。"] }, { w: 32, h: 16, wrapped: false }],
    ["hangul", { lines: ["한글"] }, { w: 32, h: 16, wrapped: false }],
    ["mixed ascii + cjk", { lines: ["ab日"] }, { w: 35, h: 16, wrapped: false }],
    ["two lines", { lines: ["ab", "cd"] }, { w: 19, h: 32, wrapped: false }],
    ["embedded LF", { lines: ["ab\ncd"] }, { w: 19, h: 32, wrapped: false }],
    ["embedded CRLF", { lines: ["ab\r\ncd"] }, { w: 19, h: 32, wrapped: false }],
    ["embedded CR", { lines: ["ab\rcd"] }, { w: 19, h: 32, wrapped: false }],
    ["leading blank line", { lines: ["\nab"] }, { w: 19, h: 32, wrapped: false }],
    ["trailing blank line", { lines: ["ab\n"] }, { w: 19, h: 32, wrapped: false }],
  ])("%s", (_name, input, expected) => {
    expect(measureOverlayText({ fontSizePx: 16, ...input })).toEqual(expected);
  });
});

describe("measureOverlayText characterization — degenerate font sizes", () => {
  it.each([
    ["zero font size falls back to 1px", 0, { w: 2, h: 1, wrapped: false }],
    ["negative font size falls back to 1px", -12, { w: 2, h: 1, wrapped: false }],
    ["NaN font size falls back to 1px", Number.NaN, { w: 2, h: 1, wrapped: false }],
    ["Infinity font size falls back to 1px", Number.POSITIVE_INFINITY, { w: 2, h: 1, wrapped: false }],
  ])("%s", (_name, fontSizePx, expected) => {
    expect(measureOverlayText({ fontSizePx, lines: ["ab"] })).toEqual(expected);
  });
});

describe("measureOverlayText characterization — wrapping", () => {
  it.each([
    ["no wrap needed", { lines: ["ab"], maxWidthPx: 100 }, { w: 100, h: 16, wrapped: false }],
    ["exact boundary", { lines: ["ab"], maxWidthPx: 16 }, { w: 16, h: 32, wrapped: true }],
    ["one px under the boundary", { lines: ["ab"], maxWidthPx: 15 }, { w: 15, h: 32, wrapped: true }],
    ["long ascii wraps", { lines: ["abcdefghij"], maxWidthPx: 32 }, { w: 32, h: 64, wrapped: true }],
    ["long cjk wraps", { lines: ["日本語のテキスト"], maxWidthPx: 48 }, { w: 48, h: 48, wrapped: true }],
    ["zero maxWidth is ignored", { lines: ["ab"], maxWidthPx: 0 }, { w: 19, h: 16, wrapped: false }],
    ["negative maxWidth is ignored", { lines: ["ab"], maxWidthPx: -8 }, { w: 19, h: 16, wrapped: false }],
    ["NaN maxWidth is ignored", { lines: ["ab"], maxWidthPx: Number.NaN }, { w: 19, h: 16, wrapped: false }],
  ])("%s", (_name, input, expected) => {
    expect(measureOverlayText({ fontSizePx: 16, ...input })).toEqual(expected);
  });
});

describe("measureOverlayText characterization — inline content with a math port", () => {
  it.each([
    [
      "single math atom",
      { inlineContent: [math("x^2")] },
      { w: 24, h: 20, wrapped: false }],
    [
      "text then math",
      { inlineContent: [text("y="), math("x^2")] },
      { w: 41, h: 20, wrapped: false }],
    [
      "math then newline then text",
      { inlineContent: [math("x"), text("\nab")] },
      { w: 19, h: 36, wrapped: false }],
    [
      "tall math raises only its own line",
      { inlineContent: [text("ab"), math("\\frac{1}{2}"), text("\ncd")] },
      { w: 107, h: 37, wrapped: false }],
  ])("%s", (_name, input, expected) => {
    expect(measureOverlayText({ fontSizePx: 16, mathMetrics: fixedMathPort, ...input })).toEqual(expected);
  });

  it("keeps a wide math atom from being clipped by maxWidth", () => {
    expect(measureOverlayText({
      fontSizePx: 16,
      mathMetrics: fixedMathPort,
      inlineContent: [math("\\frac{1}{2}")],
      maxWidthPx: 20,
    })).toEqual({ w: 88, h: 21, wrapped: false });
  });
});

describe("measureOverlayText characterization — no math port (legacy flattening)", () => {
  // Deliberate compatibility branch: with no port registered, a formula is flattened into plain
  // characters on the current line. MCP and the Electron main process reach the estimator without
  // registering a port, so this path must keep working.
  it.each([
    ["simple formula is flattened", { inlineContent: [math("x^2")] }, { w: 17, h: 18, wrapped: false }],
    ["fraction is flattened", { inlineContent: [math("\\frac{1}{2}")] }, { w: 13, h: 34, wrapped: false }],
    [
      "multi-row environment becomes a real math token",
      { inlineContent: [math("\\begin{cases}a\\\\b\\end{cases}")] },
      { w: 25, h: 51, wrapped: false }],
    [
      "single-row environment stays flattened",
      { inlineContent: [math("\\begin{aligned}a\\end{aligned}")] },
      { w: 9, h: 21, wrapped: false }],
  ])("%s", (_name, input, expected) => {
    expect(measureOverlayText({ fontSizePx: 16, ...input })).toEqual(expected);
  });

  it("uses the structural fallback when a registered port cannot measure", () => {
    expect(measureOverlayText({
      fontSizePx: 16,
      mathMetrics: nullMathPort,
      inlineContent: [math("\\sqrt{2}")],
    })).toEqual({ w: 10, h: 29, wrapped: false });
  });
});

describe("measureOverlayText characterization — rich text", () => {
  it.each([
    ["no blocks", richText(), { w: 0, h: 16, wrapped: false }],
    ["one empty paragraph", richText(paragraph()), { w: 0, h: 16, wrapped: false }],
    ["one paragraph", richText(paragraph(text("ab"))), { w: 19, h: 16, wrapped: false }],
    [
      "two paragraphs",
      richText(paragraph(text("ab")), paragraph(text("cd"))),
      { w: 19, h: 32, wrapped: false }],
    [
      "blank paragraph between two",
      richText(paragraph(text("ab")), paragraph(), paragraph(text("cd"))),
      { w: 19, h: 48, wrapped: false }],
    [
      "hard break inside a paragraph",
      richText(paragraph(text("ab\ncd"))),
      { w: 19, h: 32, wrapped: false }],
  ])("%s", (_name, document, expected) => {
    expect(measureOverlayText({ fontSizePx: 16, richText: document })).toEqual(expected);
  });

  // `measureOverlayText` runs inside React's render (via `getShapeBounds`); throwing here blanks the
  // whole screen. Legacy/broken drafts must measure as empty instead.
  it.each([
    ["blocks is undefined", { }],
    ["blocks is null", { blocks: null }],
    ["blocks is an object", { blocks: { type: "doc" } }],
    ["blocks is a string", { blocks: "doc" }],
  ])("treats a non-canonical document as empty: %s", (_name, document) => {
    expect(measureOverlayText({
      fontSizePx: 16,
      richText: document as unknown as OverlayRichTextDocument,
    })).toEqual({ w: 0, h: 16, wrapped: false });
  });

  it("tolerates a block whose children are missing", () => {
    expect(measureOverlayText({
      fontSizePx: 16,
      richText: { blocks: [{ type: "paragraph" }] } as unknown as OverlayRichTextDocument,
    })).toEqual({ w: 0, h: 16, wrapped: false });
  });

  it("tolerates an inline node of an unknown type", () => {
    expect(measureOverlayText({
      fontSizePx: 16,
      richText: {
        blocks: [{ type: "paragraph", children: [{ type: "image" }, { type: "text", text: "ab" }] }],
      } as unknown as OverlayRichTextDocument,
    })).toEqual({ w: 19, h: 16, wrapped: false });
  });

  it("prefers inlineContent over richText when both are given", () => {
    expect(measureOverlayText({
      fontSizePx: 16,
      inlineContent: [text("ab")],
      richText: richText(paragraph(text("abcdefgh"))),
    })).toEqual({ w: 19, h: 16, wrapped: false });
  });
});

describe("overlay text box characterization", () => {
  const textShape = (props: Record<string, unknown>) => ({
    id: "shape_text",
    type: "text" as const,
    x: 10,
    y: 20,
    rotation: 0,
    props: {
      w: 120,
      h: 40,
      scale: 1,
      color: "#111827",
      size: "m",
      autoSize: true,
      richText: richText(paragraph(text("ab"))),
      ...props,
    },
  });

  it.each([
    ["auto-sized single line", {}, { w: 120, h: 40 }],
    ["auto-sized taller content grows the height", { richText: richText(paragraph(text("a")), paragraph(text("b")), paragraph(text("c"))) }, { w: 120, h: 48 }],
    ["explicit size is not shrunk", { autoSize: false, w: 300, h: 200 }, { w: 300, h: 200 }],
  ])("getTextShapeEffectiveSize %s", (_name, props, expected) => {
    // Grow-only, and the width is never derived from the content: the asymmetry is a deliberate
    // fixed-point guard (see the note in `overlay-text-box.ts`).
    expect(getTextShapeEffectiveSize(textShape(props) as never)).toEqual(expected);
  });

  it("getCalloutBodySize measures the callout body", () => {
    expect(getCalloutBodySize({
      id: "shape_callout",
      type: "callout",
      x: 0,
      y: 0,
      rotation: 0,
      props: {
        w: 160,
        h: 90,
        scale: 1,
        color: "#111827",
        size: "m",
        kind: "speech",
        tailSide: "bottom",
        tailOffset: 0.5,
        richText: richText(paragraph(text("ふきだし"))),
      },
    } as never)).toMatchInlineSnapshot(`
      {
        "h": 90,
        "w": 160,
      }
    `);
  });
});

/**
 * `getShapeBounds` is the estimator's real consumer: it runs on the pointermove hit-test path, in
 * marquee selection and once per shape in `view-cache`, and its result is the stored geometry of
 * every auto-sized figure. These are the shape kinds whose bounds depend on the text estimate.
 */
describe("getShapeBounds characterization", () => {
  const base = { rotation: 0, scale: 1, color: "#111827", size: "m" as const };

  it.each([
    [
      "auto-sized text shape",
      {
        id: "s1",
        type: "text",
        x: 12,
        y: 24,
        props: { ...base, w: 100, h: 30, autoSize: true, richText: richText(paragraph(text("あいう"))) },
      },
      { x: 12, y: 24, w: 100, h: 30 },
    ],
    [
      "auto-sized text shape that outgrows its stored height",
      {
        id: "s2",
        type: "text",
        x: 0,
        y: 0,
        props: {
          ...base,
          w: 60,
          h: 10,
          autoSize: true,
          richText: richText(paragraph(text("a")), paragraph(text("b")), paragraph(text("c"))),
        },
      },
      { x: 0, y: 0, w: 60, h: 48 },
    ],
    [
      "constrained auto-sized text shape",
      {
        id: "s3",
        type: "text",
        x: 5,
        y: 5,
        props: {
          ...base,
          w: 40,
          h: 20,
          autoSize: true,
          maxWidth: 40,
          richText: richText(paragraph(text("あいうえおかきくけこ"))),
        },
      },
      { x: 5, y: 5, w: 40, h: 80 },
    ],
    [
      "fixed-size text shape",
      {
        id: "s4",
        type: "text",
        x: 3,
        y: 7,
        props: { ...base, w: 220, h: 90, autoSize: false, richText: richText(paragraph(text("ab"))) },
      },
      { x: 3, y: 7, w: 220, h: 90 },
    ],
  ])("%s", (_name, shape, expected) => {
    expect(getShapeBounds(shape as never)).toEqual(expected);
  });
});
