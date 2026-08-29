import { describe, expect, it } from "vitest";

import {
  resolveBlockAffordanceHover,
  resolveBlockSelectionRange,
  sameBlockAffordanceHover,
  type BlockSpaceAfterTarget,
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
      spaceAfter: null,
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
      spaceAfter: null,
    });
    expect(resolveBlockAffordanceHover(null, { x: 300, y: 120 })).toEqual({
      handle: null,
      insertPoint: null,
      spaceAfter: null,
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

describe("the space-after handle target", () => {
  const target: BlockSpaceAfterTarget = {
    blockId: "middle",
    bottom: 340,
    left: 100,
    insideProblemArea: false,
    spaceAfterPx: 0,
  };
  const hovered: HoveredTopLevelBlock = { ...middleParagraph, spaceAfterTarget: target };

  it("comes back for a block that can carry a space below it", () => {
    expect(resolveBlockAffordanceHover(hovered, { x: 300, y: 320 }).spaceAfter).toEqual(target);
  });

  it("is null for a block that never draws one (a quote, a box, a column section)", () => {
    // 呼び出し側が `rendersBlockSpaceAfter` で落とすと `spaceAfterTarget` が付かない。
    expect(resolveBlockAffordanceHover(middleParagraph, { x: 300, y: 320 }).spaceAfter).toBeNull();
  });

  it("appears from the left gutter, like the grip", () => {
    expect(resolveBlockAffordanceHover(hovered, { x: 60, y: 320 }).spaceAfter).toEqual(target);
  });

  it("disappears when the pointer leaves the block", () => {
    expect(resolveBlockAffordanceHover(hovered, { x: 600, y: 320 }).spaceAfter).toBeNull();
  });

  it("carries the current value so the drag can start from it", () => {
    const withSpace: HoveredTopLevelBlock = {
      ...middleParagraph,
      spaceAfterTarget: { ...target, spaceAfterPx: 24 },
    };

    expect(resolveBlockAffordanceHover(withSpace, { x: 300, y: 320 }).spaceAfter?.spaceAfterPx).toBe(24);
  });
});

describe("sameBlockAffordanceHover with a space-after target", () => {
  const base = resolveBlockAffordanceHover(
    { ...middleParagraph, spaceAfterTarget: { blockId: "middle", bottom: 340, left: 100, insideProblemArea: false, spaceAfterPx: 0 } },
    { x: 300, y: 320 },
  );

  function hoverWith(patch: Partial<BlockSpaceAfterTarget>) {
    return resolveBlockAffordanceHover(
      {
        ...middleParagraph,
        spaceAfterTarget: {
          blockId: "middle",
          bottom: 340,
          left: 100,
          insideProblemArea: false,
          spaceAfterPx: 0,
          ...patch,
        },
      },
      { x: 300, y: 320 },
    );
  }

  it("treats an identical hover as unchanged (no re-render)", () => {
    expect(sameBlockAffordanceHover(base, hoverWith({}))).toBe(true);
  });

  it.each([
    ["bottom", { bottom: 341 }],
    ["left", { left: 210 }],
    ["value", { spaceAfterPx: 24 }],
    ["lane", { insideProblemArea: true }],
    ["block", { blockId: "other" }],
  ])("detects a changed %s", (_name, patch) => {
    expect(sameBlockAffordanceHover(base, hoverWith(patch))).toBe(false);
  });

  it("detects the target appearing and disappearing", () => {
    const without = resolveBlockAffordanceHover(middleParagraph, { x: 300, y: 320 });

    expect(sameBlockAffordanceHover(base, without)).toBe(false);
    expect(sameBlockAffordanceHover(without, base)).toBe(false);
  });
});
