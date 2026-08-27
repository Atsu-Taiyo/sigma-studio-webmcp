import { describe, expect, it } from "vitest";

import { resolveFlowFragmentStep } from "./flow-fragmentation";

describe("resolveFlowFragmentStep", () => {
  it("advances instead of cutting a line that fits a fresh page", () => {
    expect(resolveFlowFragmentStep({
      available: 10,
      breakOffsets: [24, 48, 72],
      fullSegmentHeight: 100,
      remaining: 72,
      sourceOffsetY: 0,
    })).toEqual({ advanceToNextSegment: true, height: 0 });
  });

  it("keeps an over-tall visual line intact", () => {
    expect(resolveFlowFragmentStep({
      available: 100,
      breakOffsets: [140, 180],
      fullSegmentHeight: 100,
      remaining: 180,
      sourceOffsetY: 0,
    })).toEqual({ advanceToNextSegment: false, height: 140 });
  });

  it("keeps closing box chrome with the final line", () => {
    expect(resolveFlowFragmentStep({
      available: 85,
      breakOffsets: [40, 80],
      fullSegmentHeight: 100,
      remaining: 93,
      sourceOffsetY: 0,
    })).toEqual({ advanceToNextSegment: false, height: 40 });
  });
});
