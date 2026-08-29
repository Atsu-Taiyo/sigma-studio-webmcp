import type {
  BoxBlockNode,
  CodeBlockNode,
  DividerNode,
  HeadingNode,
  LayoutSectionNode,
  ListNode,
  ParagraphNode,
  QuoteBlockNode,
  SectionNode,
} from "@/features/document";

export interface TextFlowColumnBlockLayout {
  x: number;
  y: number;
  width: number;
}

/** The subset of a block's page-break hints this layer cares about. */
export interface ProblemAreaFlowEligibilityBlock {
  pagination?: {
    break?: boolean;
  };
}

/**
 * True when a block other than the area's first carries an explicit manual
 * 改ページ. (A `break` on the very first block has no page/column to break
 * away from, so it is not "inside" the area in any observable sense.)
 */
export function hasManualBreakInside(
  blocks: readonly ProblemAreaFlowEligibilityBlock[],
): boolean {
  return blocks.some((block, index) => index > 0 && block.pagination?.break === true);
}

export interface ProblemAreaFlowEligibilityInput {
  /** `areaLayout.<area>.columnSpan === "full"` for this area. */
  isFullSpan: boolean;
  /** `problem.frame?.enabled === true` AND this area is the framed one (prompt). */
  isFramedArea: boolean;
  blocks: readonly ProblemAreaFlowEligibilityBlock[];
}

/**
 * A framed prompt area or a full-span area is atomic by default: splitting it at an
 * arbitrary page/column boundary would cut its border, or place part of it at column
 * width instead of full width, either of which looks broken when it happens by
 * accident from ordinary overflow. So automatic pagination always keeps such an area
 * whole. An EXPLICIT manual break placed inside it is a deliberate user request,
 * though, and must win over that atomicity — so the area becomes flowable (placed
 * block-by-block, potentially spanning the break) exactly when it contains one.
 */
export function isProblemAreaFlowEligible({
  isFullSpan,
  isFramedArea,
  blocks,
}: ProblemAreaFlowEligibilityInput): boolean {
  const isAtomicByDefault = isFullSpan || isFramedArea;
  return !isAtomicByDefault || hasManualBreakInside(blocks);
}

type ProblemAreaColumnFlowBlockType = (
  | SectionNode
  | HeadingNode
  | ParagraphNode
  | ListNode
  | QuoteBlockNode
  | CodeBlockNode
  | DividerNode
  | BoxBlockNode
  | LayoutSectionNode
)["type"];

export interface ProblemAreaColumnFlowBlock {
  id: string;
  height: number;
  type?: ProblemAreaColumnFlowBlockType;
  break?: boolean;
  breakOffsets?: number[];
  /**
   * `height` のうち末尾のブロック下余白 (`spaceAfterPx`) ぶん。**収まり判定からは除き、
   * カーソル前進には含める** — 本文フローの `PaginationItem.trailingSpacePx` と同じ規約で、
   * 「余白を足したらそのブロック自身が次の段へ飛ぶ」逆挙動を避ける。
   */
  trailingSpacePx?: number;
}

export interface ProblemAreaColumnFlowResult {
  /** "balance": fits on the current page, use CSS multicol balance (no absolute layout). */
  /** "flow": columns continue across page boundaries via absolute per-block placement. */
  mode: "balance" | "flow";
  /** Number of page-segments the area spans (1 in balance mode). */
  segments: number;
  /** Shell height in px. In flow mode this includes the inter-page gap regions. */
  totalHeightPx: number;
  /** Per-block absolute layout relative to the shell top-left (flow mode only). */
  blockLayouts: Record<string, TextFlowColumnBlockLayout>;
  /** Per-manual-break marker layout relative to the shell top-left (flow mode only). */
  markerLayouts: Record<string, TextFlowColumnBlockLayout>;
}

/**
 * Approximates the height a CSS `column-fill: balance` multicol would settle at:
 * the smallest column height where a greedy column fill needs no more than
 * `columnCount` columns. Used only to decide whether the area fits on the current
 * page; the input heights are measured at the fixed column width.
 */
export function simulateBalancedColumnHeightPx(
  heights: number[],
  columnCount: number,
): number {
  const total = heights.reduce((sum, height) => sum + Math.max(0, height), 0);
  if (columnCount <= 1 || heights.length === 0) {
    return total;
  }

  const maxBlock = heights.reduce((max, height) => Math.max(max, Math.max(0, height)), 0);
  const colsNeeded = (cap: number): number => {
    let columns = 1;
    let cursor = 0;
    for (const height of heights) {
      const h = Math.max(0, height);
      if (cursor > 0 && cursor + h > cap + 0.5) {
        columns += 1;
        cursor = 0;
      }
      cursor += h;
    }
    return columns;
  };

  let lo = Math.max(maxBlock, total / columnCount);
  let hi = Math.max(lo, total);
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (colsNeeded(mid) <= columnCount) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return hi;
}

/**
 * Lays out a problem area's blocks into columns that continue across page
 * boundaries. Coordinates are relative to the area shell and include the
 * inter-page gap so the shell reserves the same physical span as the canvas.
 */
export function computeProblemAreaColumnFlow(
  blocks: ProblemAreaColumnFlowBlock[],
  columnCount: number,
  columnWidthPx: number,
  columnGapPx: number,
  availableFirstHeightPx: number,
  pageContentHeightPx: number,
  pageStridePx: number,
): ProblemAreaColumnFlowResult {
  const heights = blocks.map((block) => Math.max(0, block.height));
  const fitHeights = blocks.map((block, index) => (
    Math.max(0, heights[index] - Math.max(0, block.trailingSpacePx ?? 0))
  ));
  const columns = Math.max(1, columnCount);

  if (columns <= 1 || blocks.length === 0) {
    return { mode: "balance", segments: 1, totalHeightPx: heights.reduce((sum, h) => sum + h, 0), blockLayouts: {}, markerLayouts: {} };
  }

  const hasManualColumnBreak = blocks.some((block, index) => index > 0 && block.break);
  const balanced = simulateBalancedColumnHeightPx(heights, columns);
  if (!hasManualColumnBreak && balanced <= availableFirstHeightPx + 0.5) {
    return { mode: "balance", segments: 1, totalHeightPx: balanced, blockLayouts: {}, markerLayouts: {} };
  }

  const pageGapToContentPx = Math.max(0, pageStridePx - pageContentHeightPx);
  const segmentHeight = (segmentIndex: number) =>
    segmentIndex === 0 ? Math.max(0, availableFirstHeightPx) : pageContentHeightPx;
  const segmentTopShellY = (segmentIndex: number) =>
    segmentIndex === 0
      ? 0
      : Math.max(0, availableFirstHeightPx) + pageGapToContentPx + (segmentIndex - 1) * pageStridePx;

  const blockLayouts: Record<string, TextFlowColumnBlockLayout> = {};
  const markerLayouts: Record<string, TextFlowColumnBlockLayout> = {};
  const step = columnWidthPx + columnGapPx;
  let segmentIndex = 0;
  let columnIndex = 0;
  let columnCursorY = 0;
  let maxBottom = 0;

  const advanceColumn = () => {
    columnIndex += 1;
    if (columnIndex >= columns) {
      segmentIndex += 1;
      columnIndex = 0;
    }
    columnCursorY = 0;
  };

  for (let i = 0; i < blocks.length; i += 1) {
    const height = heights[i];
    const hasManualBreakBefore = i > 0 && blocks[i].break;
    if (hasManualBreakBefore && (columnCursorY > 0 || columnIndex > 0)) {
      markerLayouts[blocks[i].id] = roundTextFlowColumnBlockLayout({
        x: columnIndex * step,
        y: segmentTopShellY(segmentIndex) + columnCursorY,
        width: columnWidthPx,
      });
      advanceColumn();
    }
    if (columnCursorY > 0 && columnCursorY + fitHeights[i] > segmentHeight(segmentIndex) + 0.5) {
      advanceColumn();
    }

    const x = columnIndex * step;
    const y = segmentTopShellY(segmentIndex) + columnCursorY;
    blockLayouts[blocks[i].id] = roundTextFlowColumnBlockLayout({ x, y, width: columnWidthPx });
    columnCursorY += height;
    maxBottom = Math.max(maxBottom, y + height);
  }

  return { mode: "flow", segments: segmentIndex + 1, totalHeightPx: maxBottom, blockLayouts, markerLayouts };
}

export function roundTextFlowColumnBlockLayout(
  layout: TextFlowColumnBlockLayout,
): TextFlowColumnBlockLayout {
  return {
    x: Math.round(layout.x),
    y: Math.round(layout.y),
    width: Math.round(layout.width),
  };
}
