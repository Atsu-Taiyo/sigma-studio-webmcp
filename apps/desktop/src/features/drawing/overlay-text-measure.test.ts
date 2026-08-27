import { describe, expect, it } from "vitest";

import type { InlineNode, OverlayRichTextDocument } from "@/features/document";

import {
  measureOverlayText,
  setOverlayMathMetricsProvider,
  type OverlayMathMetricsPort,
} from "./overlay-text-measure";

// This file exercises `measureOverlayText`'s own no-port fallback and per-call `mathMetrics`
// override in isolation, so it clears whatever `vitest.setup.ts` registered globally (the real
// KaTeX/MathLive-backed measurer, used by every other test file so e.g. graph-label tests see
// real box sizes). Vitest gives each test file its own fresh module graph, so this doesn't affect
// other files.
setOverlayMathMetricsProvider(null);

// A fixed, arbitrarily-tall/-wide box: real box metrics vary per formula, but these tests only
// care that `measureOverlayText` plumbs a supplied port's numbers through correctly, not that any
// particular TeX produces any particular box (that's `math-metrics.test.ts`'s job).
const fakeMathMetricsPort: OverlayMathMetricsPort = {
  measureTexEm: () => ({ ascentEm: 3, descentEm: 1, widthEm: 4 }),
};

describe("measureOverlayText", () => {
  it("estimates mixed-width plain text without a DOM", () => {
    expect(measureOverlayText({
      lines: ["AB", "数学"],
      fontSizePx: 10,
    })).toEqual({
      w: 20,
      h: 20,
      wrapped: false,
    });
  });

  it("normalizes inline TeX before estimating visible glyphs", () => {
    const inlineContent: InlineNode[] = [
      { type: "text", text: "A" },
      { type: "mathInline", id: "math_1", tex: "\\frac{x}{y}", display: "inline" },
    ];

    expect(measureOverlayText({ inlineContent, fontSizePx: 10 })).toEqual({
      w: 18,
      h: 10,
      wrapped: false,
    });
  });

  it("preserves overlay paragraph and hard-break line boundaries", () => {
    const richText: OverlayRichTextDocument = {
      blocks: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "数学\nA" }],
        },
        {
          type: "paragraph",
          children: [{ type: "text", text: "BC" }],
        },
      ],
    };

    expect(measureOverlayText({ richText, fontSizePx: 10 })).toEqual({
      w: 20,
      h: 30,
      wrapped: false,
    });
  });

  it("counts constrained wrapping in a single character pass", () => {
    expect(measureOverlayText({
      lines: ["ABCD"],
      fontSizePx: 10,
      maxWidthPx: 12,
    })).toEqual({
      w: 12,
      h: 20,
      wrapped: true,
    });
  });

  it("falls back to a stable minimum line height for invalid input", () => {
    expect(measureOverlayText({ lines: [], fontSizePx: 0, maxWidthPx: 0 })).toEqual({
      w: 0,
      h: 1,
      wrapped: false,
    });
  });

  describe("with a math metrics port", () => {
    const mathInlineContent: InlineNode[] = [
      { type: "mathInline", id: "math_1", tex: "\\sum_{i=1}^{n}i", display: "inline" },
    ];

    it("grows the line height past 1em using the port's ascent+descent", () => {
      const measured = measureOverlayText({
        inlineContent: mathInlineContent,
        fontSizePx: 10,
        mathMetrics: fakeMathMetricsPort,
      });

      // ascentEm(3) + descentEm(1) = 4em, well past the plain-text 1em line height.
      expect(measured.h).toBe(40);
      expect(measured.w).toBe(40);
    });

    it("never splits a math token across wrapped segments, and reports w past maxWidthPx when the atom alone exceeds it", () => {
      const measured = measureOverlayText({
        inlineContent: mathInlineContent,
        fontSizePx: 10,
        maxWidthPx: 10, // 1 line-unit; the atom alone is 4 units wide.
        mathMetrics: fakeMathMetricsPort,
      });

      expect(measured.w).toBeGreaterThan(10);
      expect(measured.w).toBe(40);
      // A single atom on an otherwise-empty line is never itself "wrapped" -- there was nothing
      // to push it away from; the assertion that matters is that it wasn't split into pieces,
      // which the exact height below (one un-split 4em-tall segment) demonstrates.
      expect(measured.wrapped).toBe(false);
      expect(measured.h).toBe(40);
    });

    it("keeps the math atom intact when wrapping pushes it onto its own segment next to text", () => {
      const measured = measureOverlayText({
        inlineContent: [
          { type: "text", text: "A" },
          ...mathInlineContent,
        ],
        fontSizePx: 10,
        maxWidthPx: 10, // 1 line-unit: "A" (~0.58 units) fits alone, the 4-unit atom does not join it.
        mathMetrics: fakeMathMetricsPort,
      });

      expect(measured.wrapped).toBe(true);
      // Segment 1 ("A", plain text): ceil(10 * max(1, 1.0)) = 10.
      // Segment 2 (the un-split math atom): ceil(10 * max(1, 3 + 1)) = 40.
      expect(measured.h).toBe(50);
      expect(measured.w).toBe(40);
    });
  });

  describe("without a math metrics port", () => {
    it("keeps a single non-multiline formula's exact legacy character-flattened width/height", () => {
      // Regression guard for the "no math port at all" path: this must stay byte-identical to
      // pre-math-metrics behavior (see the inline-TeX-normalization test above), since real
      // formula height/width for single-row TeX is only fixed once a math metrics port is wired
      // up -- production always registers one; this fallback is a last-resort safety net.
      const inlineContent: InlineNode[] = [
        { type: "mathInline", id: "math_1", tex: "\\frac{x}{y}", display: "inline" },
      ];
      expect(measureOverlayText({ inlineContent, fontSizePx: 10 })).toEqual({
        w: 12,
        h: 10,
        wrapped: false,
      });
    });

    it("reflects row count and a structural-macro safety factor for multi-row environments", () => {
      // `\begin{cases}a\\b\end{cases}` is 2 rows; the old flattening treated each row as a plain
      // 1em text line (h = 2 * fontSizePx), which under-estimates the real ~3x fontSizePx box.
      const inlineContent: InlineNode[] = [
        { type: "mathInline", id: "math_1", tex: "\\begin{cases}a\\\\b\\end{cases}", display: "inline" },
      ];
      const measured = measureOverlayText({ inlineContent, fontSizePx: 10 });

      expect(measured.h).toBeGreaterThan(20);
    });
  });
});

describe("measureOverlayText with non-canonical rich text", () => {
  // 採寸は描画経路の最下流にある。ここで throw すると React の render 中に落ちて
  // ツリーごと消え、Electronでは真っ白な画面 + タイトルバーに index.html だけが
  // 残る。正規形でない入力 (旧Tiptap形式のまま保存されたAI提案ドラフトなど) は
  // 空として測り、実際の変換は @/features/document を使える呼び出し側で行う。
  const legacyTiptapRichText = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "補助線" }] }],
  } as unknown as OverlayRichTextDocument;
  const missingBlocks = { blocks: undefined } as unknown as OverlayRichTextDocument;

  it.each([
    ["legacy Tiptap shape", legacyTiptapRichText],
    ["missing blocks", missingBlocks],
  ])("measures %s as empty instead of throwing", (_label, richText) => {
    expect(() => measureOverlayText({ richText, fontSizePx: 16 })).not.toThrow();
    expect(measureOverlayText({ richText, fontSizePx: 16 })).toEqual(
      measureOverlayText({ richText: { blocks: [] }, fontSizePx: 16 }),
    );
  });
});

