import { describe, expect, it } from "vitest";

import {
  resolveBlockAffordanceHover,
  resolveBlockSelectionRange,
  type HoveredTopLevelBlock,
} from "./block-affordances";

/** A problem opening the document, with a paragraph after it. */
const problem: HoveredTopLevelBlock = {
  box: { id: "problem", top: 48, bottom: 200, left: 100, right: 500 },
  nextBlockId: "outro",
  isAtomic: true,
  aboveKind: "none",
  belowKind: "body",
};
/** The paragraph after that problem, and the last block in the document. */
const lastParagraph: HoveredTopLevelBlock = {
  box: { id: "outro", top: 208, bottom: 240, left: 100, right: 500 },
  nextBlockId: null,
  isAtomic: false,
  aboveKind: "atomic",
  belowKind: "none",
};
/** A paragraph between two other paragraphs. */
const middleParagraph: HoveredTopLevelBlock = {
  box: { id: "middle", top: 300, bottom: 340, left: 100, right: 500 },
  nextBlockId: "tail",
  isAtomic: false,
  aboveKind: "body",
  belowKind: "body",
};

describe("resolveBlockAffordanceHover", () => {
  it("reports the hovered block without an insertion line in the middle of a block", () => {
    expect(resolveBlockAffordanceHover(problem, { x: 300, y: 120 })).toEqual({
      handle: { blockId: "problem", top: 48, bottom: 200, left: 100 },
      insertPoint: null,
    });
  });

  it("always offers both edges of a problem or a box", () => {
    expect(resolveBlockAffordanceHover(problem, { x: 300, y: 50 }).insertPoint).toEqual({
      anchorBlockId: "problem",
      position: "before",
      top: 48,
      left: 100,
      width: 400,
    });
    expect(resolveBlockAffordanceHover(problem, { x: 300, y: 199 }).insertPoint?.top).toBe(200);

    // Even with body text on both sides, a box keeps both of its edges offered.
    const boxBetweenParagraphs: HoveredTopLevelBlock = { ...middleParagraph, isAtomic: true };
    expect(resolveBlockAffordanceHover(boxBetweenParagraphs, { x: 300, y: 301 }).insertPoint)
      .not.toBeNull();
    expect(resolveBlockAffordanceHover(boxBetweenParagraphs, { x: 300, y: 339 }).insertPoint)
      .not.toBeNull();
  });

  it("stays out of gaps a caret can already reach", () => {
    expect(resolveBlockAffordanceHover(middleParagraph, { x: 300, y: 301 }).insertPoint).toBeNull();
    expect(resolveBlockAffordanceHover(middleParagraph, { x: 300, y: 339 }).insertPoint).toBeNull();
    // The handle is still offered there.
    expect(resolveBlockAffordanceHover(middleParagraph, { x: 300, y: 301 }).handle?.blockId)
      .toBe("middle");
  });

  it("agrees on one gap from either side", () => {
    const fromAbove = resolveBlockAffordanceHover(problem, { x: 300, y: 199 });
    const fromBelow = resolveBlockAffordanceHover(lastParagraph, { x: 300, y: 209 });

    expect(fromAbove.insertPoint?.anchorBlockId).toBe("outro");
    expect(fromAbove.insertPoint?.position).toBe("before");
    expect(fromBelow.insertPoint?.anchorBlockId).toBe("outro");
    expect(fromBelow.insertPoint?.position).toBe("before");
  });

  it("offers the top of the document but leaves its end to the trailing zone", () => {
    const firstParagraph: HoveredTopLevelBlock = { ...middleParagraph, aboveKind: "none" };

    expect(resolveBlockAffordanceHover(firstParagraph, { x: 300, y: 301 }).insertPoint?.position)
      .toBe("before");
    expect(resolveBlockAffordanceHover(lastParagraph, { x: 300, y: 241 }).insertPoint).toBeNull();
  });

  it("treats a pointer in the gap as being on the edge it came from", () => {
    // 20px below the block: past the edge threshold, but resolved through the gap probe.
    const throughGap: HoveredTopLevelBlock = { ...problem, gapEdge: "bottom" };

    expect(resolveBlockAffordanceHover(throughGap, { x: 300, y: 220 }).insertPoint).toEqual({
      anchorBlockId: "outro",
      position: "before",
      top: 200,
      left: 100,
      width: 400,
    });
  });

  it("keeps the handle available while the pointer sits in the left gutter", () => {
    expect(resolveBlockAffordanceHover(problem, { x: 70, y: 120 }).handle?.blockId).toBe("problem");
    expect(resolveBlockAffordanceHover(problem, { x: 20, y: 120 }).handle).toBeNull();
  });

  it("ignores pointers outside the block column and misses", () => {
    expect(resolveBlockAffordanceHover(problem, { x: 600, y: 120 })).toEqual({
      handle: null,
      insertPoint: null,
    });
    expect(resolveBlockAffordanceHover(null, { x: 300, y: 120 })).toEqual({
      handle: null,
      insertPoint: null,
    });
  });
});

describe("resolveBlockSelectionRange", () => {
  const ids = ["a", "b", "c", "d"];

  it("returns the document-ordered span between two blocks", () => {
    expect(resolveBlockSelectionRange(ids, "c", "a")).toEqual(["a", "b", "c"]);
    expect(resolveBlockSelectionRange(ids, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("falls back to the clicked block when the anchor is gone", () => {
    expect(resolveBlockSelectionRange(ids, "missing", "c")).toEqual(["c"]);
  });
});
