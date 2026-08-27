import { describe, expect, it } from "vitest";

import { computeManualColumnFlowHeight } from "./manual-column-flow";

describe("computeManualColumnFlowHeight", () => {
  it("uses the taller pre-break segment when following content is short", () => {
    expect(computeManualColumnFlowHeight([
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
      { break: true, outerHeight: 30 },
    ], 2)).toBe(150);
  });

  it("uses the taller post-break segment when following content is long", () => {
    expect(computeManualColumnFlowHeight([
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
      { break: true, outerHeight: 30 },
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
    ], 2)).toBe(180);
  });

  it("lets post-break content flow through all remaining columns", () => {
    expect(computeManualColumnFlowHeight([
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
      { break: true, outerHeight: 30 },
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
    ], 3)).toBe(60);
  });

  it("keeps the visible break marker in the preceding column segment", () => {
    expect(computeManualColumnFlowHeight([
      { break: false, outerHeight: 90 },
      // The marker widget precedes the target carrying break-before in the DOM.
      { break: false, outerHeight: 20 },
      { break: true, outerHeight: 30 },
    ], 2)).toBe(110);
  });

  it("falls back to balanced columns when forced segments exceed the column count", () => {
    expect(computeManualColumnFlowHeight([
      { break: false, outerHeight: 30 },
      { break: true, outerHeight: 30 },
      { break: true, outerHeight: 30 },
    ], 2)).toBeNull();
  });

  it("leaves balanced column sections without a manual break unchanged", () => {
    expect(computeManualColumnFlowHeight([
      { break: false, outerHeight: 30 },
      { break: false, outerHeight: 30 },
    ], 2)).toBeNull();
  });
});
