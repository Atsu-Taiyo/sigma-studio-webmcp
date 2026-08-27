import { describe, expect, it } from "vitest";

import {
  isMultiEditorRunSelection,
  resolveRunEditorAtPoint,
  resolveRunSelectionRanges,
} from "./text-run-selection";

const editors = [
  { unitId: "a", docSize: 40 },
  { unitId: "b", docSize: 50 },
  { unitId: "c", docSize: 20 },
];

describe("resolveRunSelectionRanges", () => {
  it("stays inside one editor", () => {
    expect(resolveRunSelectionRanges(editors, { unitId: "b", pos: 4 }, { unitId: "b", pos: 12 })).toEqual([
      { unitId: "b", from: 4, to: 12 },
    ]);
    expect(isMultiEditorRunSelection([
      { unitId: "b", from: 4, to: 12 },
    ])).toBe(false);
  });

  it("fills intermediate editors when the caret crosses a chunk boundary", () => {
    expect(resolveRunSelectionRanges(editors, { unitId: "a", pos: 30 }, { unitId: "c", pos: 8 })).toEqual([
      { unitId: "a", from: 30, to: 40 },
      { unitId: "b", from: 0, to: 50 },
      { unitId: "c", from: 0, to: 8 },
    ]);
  });

  it("reverses anchor and head into document order", () => {
    expect(resolveRunSelectionRanges(editors, { unitId: "c", pos: 8 }, { unitId: "a", pos: 30 })).toEqual([
      { unitId: "a", from: 30, to: 40 },
      { unitId: "b", from: 0, to: 50 },
      { unitId: "c", from: 0, to: 8 },
    ]);
  });

  it("clamps positions onto the editor's doc", () => {
    expect(resolveRunSelectionRanges(editors, { unitId: "a", pos: -3 }, { unitId: "a", pos: 99 })).toEqual([
      { unitId: "a", from: 0, to: 40 },
    ]);
  });
});

describe("resolveRunEditorAtPoint", () => {
  const stacked = [
    { unitId: "a", rect: { left: 0, right: 100, top: 0, bottom: 40 } },
    { unitId: "b", rect: { left: 0, right: 100, top: 48, bottom: 90 } },
  ];

  it("hits the editor whose rectangle contains the point", () => {
    expect(resolveRunEditorAtPoint(stacked, 10, 10)).toBe("a");
    expect(resolveRunEditorAtPoint(stacked, 10, 60)).toBe("b");
  });

  it("picks the nearer editor when the pointer is in the seam between chunks", () => {
    expect(resolveRunEditorAtPoint(stacked, 10, 42)).toBe("a");
    expect(resolveRunEditorAtPoint(stacked, 10, 46)).toBe("b");
  });

  it("clamps onto the end editors outside the run", () => {
    expect(resolveRunEditorAtPoint(stacked, 10, -4)).toBe("a");
    expect(resolveRunEditorAtPoint(stacked, 10, 120)).toBe("b");
  });
});
