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
