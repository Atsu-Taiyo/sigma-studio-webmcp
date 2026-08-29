import { describe, expect, it } from "vitest";

import {
  computeProblemAreaColumnFlow,
  hasManualBreakInside,
  isProblemAreaFlowEligible,
  simulateBalancedColumnHeightPx,
} from ".";

describe("computeProblemAreaColumnFlow", () => {
  const blocks10 = Array.from(
    { length: 10 },
    (_, index) => ({ id: `b${index}`, height: 100 }),
  );

  it("stays in balance mode when the area fits in the remaining space", () => {
    const result = computeProblemAreaColumnFlow(
      blocks10,
      2,
      100,
      10,
      600,
      1000,
      1123,
    );

    expect(result.mode).toBe("balance");
    expect(result.segments).toBe(1);
    expect(result.blockLayouts).toEqual({});
  });

  it("continues columns onto the next page when it does not fit", () => {
    const result = computeProblemAreaColumnFlow(
      blocks10,
      2,
      100,
      10,
      300,
      1000,
      1123,
    );

    expect(result.mode).toBe("flow");
    expect(result.segments).toBe(2);
    expect(result.blockLayouts.b0).toEqual({ x: 0, y: 0, width: 100 });
    expect(result.blockLayouts.b2).toEqual({ x: 0, y: 200, width: 100 });
    expect(result.blockLayouts.b3).toEqual({ x: 110, y: 0, width: 100 });
    expect(result.blockLayouts.b5).toEqual({ x: 110, y: 200, width: 100 });
    expect(result.blockLayouts.b6).toEqual({ x: 0, y: 423, width: 100 });
    expect(result.blockLayouts.b9).toEqual({ x: 0, y: 723, width: 100 });
    expect(result.totalHeightPx).toBe(823);
  });

  it("honors manual breaks by moving the block to the next column", () => {
    const result = computeProblemAreaColumnFlow([
      { id: "before", height: 100 },
      { id: "after_break", height: 80, break: true },
    ], 2, 100, 10, 600, 1000, 1123);

    expect(result.mode).toBe("flow");
    expect(result.segments).toBe(1);
    expect(result.blockLayouts.before).toEqual({ x: 0, y: 0, width: 100 });
    expect(result.markerLayouts.after_break).toEqual({
      x: 0,
      y: 100,
      width: 100,
    });
    expect(result.blockLayouts.after_break).toEqual({
      x: 110,
      y: 0,
      width: 100,
    });
  });

  it("never lets a block straddle a page boundary", () => {
    const result = computeProblemAreaColumnFlow(
      blocks10,
      2,
      100,
      10,
      250,
      1000,
      1123,
    );
    const pageGap = 1123 - 1000;

    for (const layout of Object.values(result.blockLayouts)) {
      const inGap = layout.y >= 250 - 0.5
        && layout.y < 250 + pageGap - 0.5;
      expect(inGap).toBe(false);
    }
  });

  it("approximates a balanced column height", () => {
    const height = simulateBalancedColumnHeightPx(
      blocks10.map((block) => block.height),
      2,
    );

    expect(height).toBeGreaterThanOrEqual(499);
    expect(height).toBeLessThanOrEqual(501);
  });
});

describe("hasManualBreakInside", () => {
  it("is false when no block requests a manual break", () => {
    expect(hasManualBreakInside([
      { pagination: undefined },
      { pagination: { break: false } },
    ])).toBe(false);
  });

  it("is false when only the first block carries break (nothing to break away from)", () => {
    expect(hasManualBreakInside([
      { pagination: { break: true } },
      { pagination: undefined },
    ])).toBe(false);
  });

  it("is true when a block other than the first carries break: always", () => {
    expect(hasManualBreakInside([
      { pagination: undefined },
      { pagination: { break: true } },
    ])).toBe(true);
  });
});

describe("isProblemAreaFlowEligible", () => {
  it("is always eligible for an ordinary (non-atomic) area", () => {
    expect(isProblemAreaFlowEligible({
      isFullSpan: false,
      isFramedArea: false,
      blocks: [{ pagination: undefined }],
    })).toBe(true);
  });

  it("keeps a framed area atomic when it has no manual break inside", () => {
    expect(isProblemAreaFlowEligible({
      isFullSpan: false,
      isFramedArea: true,
      blocks: [
        { pagination: undefined },
        { pagination: undefined },
      ],
    })).toBe(false);
  });

  it("keeps a full-span area atomic when it has no manual break inside", () => {
    expect(isProblemAreaFlowEligible({
      isFullSpan: true,
      isFramedArea: false,
      blocks: [
        { pagination: undefined },
        { pagination: undefined },
      ],
    })).toBe(false);
  });

  it("makes a framed area flowable once a manual break is placed inside it", () => {
    expect(isProblemAreaFlowEligible({
      isFullSpan: false,
      isFramedArea: true,
      blocks: [
        { pagination: undefined },
        { pagination: { break: true } },
      ],
    })).toBe(true);
  });

  it("makes a full-span area flowable once a manual break is placed inside it", () => {
    expect(isProblemAreaFlowEligible({
      isFullSpan: true,
      isFramedArea: false,
      blocks: [
        { pagination: undefined },
        { pagination: { break: true } },
      ],
    })).toBe(true);
  });

  it("does not become flowable from a break on its very first block", () => {
    expect(isProblemAreaFlowEligible({
      isFullSpan: false,
      isFramedArea: true,
      blocks: [
        { pagination: { break: true } },
        { pagination: undefined },
      ],
    })).toBe(false);
  });
});

describe("computeProblemAreaColumnFlow with a space below a block", () => {
  /** 本文フローと同じ規約 — 余白で溢れたら送るのは次のブロック、そのブロック自身ではない。 */
  const COLUMN_HEIGHT = 300;
  const PAGE_STRIDE = COLUMN_HEIGHT + 123;

  function flow(blocks: Array<{ id: string; height: number; trailingSpacePx?: number }>) {
    return computeProblemAreaColumnFlow(blocks, 2, 100, 10, COLUMN_HEIGHT, COLUMN_HEIGHT, PAGE_STRIDE);
  }

  // 合計 800px なので 2 段に均しても 1 段に収まらず、必ず flow モードになる。
  const tail = [
    { id: "c", height: 50 },
    { id: "d", height: 200 },
    { id: "e", height: 200 },
  ];

  it("keeps the block itself in its column when only its trailing space overflows", () => {
    const result = flow([
      { id: "a", height: 200 },
      { id: "b", height: 150, trailingSpacePx: 100 },
      ...tail,
    ]);

    expect(result.mode).toBe("flow");
    // 本文 50px は 1 段目に収まる (200 + 50 <= 300) ので b は動かない。
    expect(result.blockLayouts.b).toEqual({ x: 0, y: 200, width: 100 });
    // 次のブロックは余白ぶんで溢れるので次の段へ。
    expect(result.blockLayouts.c).toEqual({ x: 110, y: 0, width: 100 });
  });

  it("moves the same block without the trailing space (the space is what kept it)", () => {
    const result = flow([
      { id: "a", height: 200 },
      { id: "b", height: 150 },
      ...tail,
    ]);

    expect(result.blockLayouts.b).toEqual({ x: 110, y: 0, width: 100 });
  });

  it("still moves the block when its own content does not fit", () => {
    const result = flow([
      { id: "a", height: 200 },
      { id: "b", height: 250, trailingSpacePx: 100 },
      ...tail,
    ]);

    expect(result.blockLayouts.b).toEqual({ x: 110, y: 0, width: 100 });
  });

  it("treats a missing trailing space as 0", () => {
    const blocks = [{ id: "a", height: 200 }, { id: "b", height: 150 }, ...tail];

    expect(flow(blocks.map((block) => ({ ...block, trailingSpacePx: 0 })))).toEqual(flow(blocks));
  });
});
