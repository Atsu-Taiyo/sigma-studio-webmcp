/**
 * Hover model for the block handle (left gutter) and the insertion line drawn between
 * top-level blocks. Both read the same hovered block and the same pointer position, so
 * "which block am I on" and "which boundary am I near" can never disagree.
 *
 * Only the block under the pointer is measured, never the whole document: a cached table of
 * every block's box goes stale on any reflow, and a stale box silently stops matching the
 * pointer, which reads as "the handle just stopped appearing".
 *
 * All coordinates are canvas pixels (zoom already divided out), matching the geometry the
 * page canvas uses for its other absolutely positioned layers.
 */

export interface TopLevelBlockBox {
  id: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * What sits on one side of a block. `atomic` is a problem or a box — a block a caret cannot
 * step out of, so the gap beside it has no keyboard route in and always earns an insert line.
 */
export type BlockNeighborKind = "none" | "atomic" | "body";

export interface HoveredTopLevelBlock {
  box: TopLevelBlockBox;
  /**
   * 下端を伸ばすハンドルの対象。トップレベルのブロック、または問題エリアの中のブロック。
   * 枠を持つブロック (引用・コード・囲み枠) や入れ物 (段組・問題そのもの) では null —
   * 判定は描画・計測と同じ `rendersBlockSpaceAfter` を通す。
   */
  spaceAfterTarget?: BlockSpaceAfterTarget | null;
  /** The following top-level block, if any. Anchors "insert after" to a stable side. */
  nextBlockId: string | null;
  /** Whether this block is itself a problem or a box. */
  isAtomic: boolean;
  aboveKind: BlockNeighborKind;
  belowKind: BlockNeighborKind;
  /**
   * Set when the pointer sat in the gap between two blocks rather than on one of them. The
   * gap is wider than the edge threshold, so without this the line would blink out exactly
   * where the user is aiming — between a problem and the box under it, say.
   */
  gapEdge?: "top" | "bottom" | null;
}

export interface BlockInsertPoint {
  /** Null means "at the end of the document" — there is no block to anchor to. */
  anchorBlockId: string | null;
  position: "before" | "after";
  /** Where the line is drawn. */
  top: number;
  left: number;
  width: number;
}

/**
 * 「ブロックの下端を掴んで下余白を伸ばす」つまみの当たり先。
 *
 * ブロック本体の box とは別に持つ: 問題の中では box が問題全体でも、掴む相手は
 * その中の 1 ブロックの下端になる。
 */
export interface BlockSpaceAfterTarget {
  blockId: string;
  /** 実測のブロック下端 (canvas px)。つまみの y。 */
  bottom: number;
  /** 実測のブロック左端。n 段組ではその段の左に一致する。 */
  left: number;
  /** 問題エリアの中か。既存のエリア高さハンドル・問題番号と重ねないためのレーン指定。 */
  insideProblemArea: boolean;
  /** 現在の下余白 (px)。ドラッグの初期値。 */
  spaceAfterPx: number;
}

export interface BlockHandleTarget {
  blockId: string;
  top: number;
  bottom: number;
  left: number;
}

export interface BlockAffordanceHover {
  handle: BlockHandleTarget | null;
  insertPoint: BlockInsertPoint | null;
  spaceAfter: BlockSpaceAfterTarget | null;
}

export interface BlockAffordanceHoverOptions {
  /** How close to a block edge the pointer must be for the insertion line to appear. */
  edgeThresholdPx?: number;
  /** How far left of a block the pointer may stray and still count as hovering it. */
  gutterWidthPx?: number;
}

export const EMPTY_BLOCK_AFFORDANCE_HOVER: BlockAffordanceHover = {
  handle: null,
  insertPoint: null,
  spaceAfter: null,
};

export function resolveBlockAffordanceHover(
  hovered: HoveredTopLevelBlock | null,
  point: { x: number; y: number },
  options: BlockAffordanceHoverOptions = {},
): BlockAffordanceHover {
  const edgeThresholdPx = options.edgeThresholdPx ?? 7;
  const gutterWidthPx = options.gutterWidthPx ?? 48;
  if (!hovered) {
    return EMPTY_BLOCK_AFFORDANCE_HOVER;
  }

  const { box } = hovered;
  const withinColumn = point.x >= box.left - gutterWidthPx && point.x <= box.right;
  // A gap-resolved hit is adjacent by construction, so it skips the vertical range test the
  // pointer would otherwise fail for sitting further out than the edge threshold.
  const withinBlock = !!hovered.gapEdge
    || (point.y >= box.top - edgeThresholdPx && point.y <= box.bottom + edgeThresholdPx);
  if (!withinColumn || !withinBlock) {
    return EMPTY_BLOCK_AFFORDANCE_HOVER;
  }

  const distanceToTop = Math.abs(point.y - box.top);
  const distanceToBottom = Math.abs(point.y - box.bottom);
  const width = box.right - box.left;
  const nearTop = hovered.gapEdge === "top" || distanceToTop <= edgeThresholdPx;
  const nearBottom = hovered.gapEdge === "bottom" || distanceToBottom <= edgeThresholdPx;

  // A boundary earns the line when a caret cannot reach it: next to a problem or a box, or
  // at the very top of the document. Both sides of one gap agree, because the test looks at
  // the pair of blocks around it rather than at whichever one the pointer happens to be on.
  // The document's own end is left to the trailing click zone.
  const atTopEdge = nearTop && (hovered.isAtomic || hovered.aboveKind !== "body");
  const atBottomEdge = nearBottom && (hovered.isAtomic || hovered.belowKind === "atomic");

  // One gap must resolve to one insert point no matter which side the pointer approached
  // from, so "after this block" is expressed as "before the next one" whenever there is one.
  const insertPoint: BlockInsertPoint | null = atTopEdge
    && (!atBottomEdge || distanceToTop <= distanceToBottom)
    ? { anchorBlockId: box.id, position: "before", top: box.top, left: box.left, width }
    : atBottomEdge
      ? {
          anchorBlockId: hovered.nextBlockId ?? box.id,
          position: hovered.nextBlockId ? "before" : "after",
          top: box.bottom,
          left: box.left,
          width,
        }
      : null;

  return {
    handle: { blockId: box.id, top: box.top, bottom: box.bottom, left: box.left },
    insertPoint,
    // グリップと同じ条件 (段の中 + ブロックの縦範囲) で出す。掴む相手だけがブロック本体では
    // なく「その下端」なので、幾何は呼び出し側が実測した値をそのまま運ぶ。
    spaceAfter: hovered.spaceAfterTarget ?? null,
  };
}

/**
 * Shift-clicking a second handle selects everything between the two, so a run of paragraphs
 * can go in one Delete. Order follows the document, not the click order.
 */
export function resolveBlockSelectionRange(
  orderedIds: readonly string[],
  anchorId: string,
  targetId: string,
): string[] {
  const anchorIndex = orderedIds.indexOf(anchorId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) {
    return [targetId];
  }

  return orderedIds.slice(
    Math.min(anchorIndex, targetIndex),
    Math.max(anchorIndex, targetIndex) + 1,
  );
}

/** Pointer moves fire continuously; only a changed hover may re-render the canvas. */
export function sameBlockAffordanceHover(
  a: BlockAffordanceHover,
  b: BlockAffordanceHover,
): boolean {
  if (a.handle?.blockId !== b.handle?.blockId || a.handle?.top !== b.handle?.top) {
    return false;
  }
  // 下端つまみは位置も値も比べる。ここを省くとポインタが動くたびに新しいオブジェクトが
  // 採用され、紙面全体が 60Hz で再レンダリングされる。
  if (
    a.spaceAfter?.blockId !== b.spaceAfter?.blockId
    || a.spaceAfter?.bottom !== b.spaceAfter?.bottom
    || a.spaceAfter?.left !== b.spaceAfter?.left
    || a.spaceAfter?.spaceAfterPx !== b.spaceAfter?.spaceAfterPx
    || a.spaceAfter?.insideProblemArea !== b.spaceAfter?.insideProblemArea
  ) {
    return false;
  }
  if (!a.insertPoint || !b.insertPoint) {
    return a.insertPoint === b.insertPoint;
  }

  return (
    a.insertPoint.anchorBlockId === b.insertPoint.anchorBlockId &&
    a.insertPoint.position === b.insertPoint.position &&
    a.insertPoint.top === b.insertPoint.top &&
    a.insertPoint.left === b.insertPoint.left &&
    a.insertPoint.width === b.insertPoint.width
  );
}
