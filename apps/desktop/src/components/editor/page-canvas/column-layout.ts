import {
  getMeasuredLineBreakOffsets,
  measureElementLineBoxes,
  type MeasuredBlock,
  type MeasuredLine,
} from "@/components/editor/overlay-canvas/anchor";
import type {
  TextFlowBlock,
  TextFlowBoxFragmentSourceLayout,
} from "@/components/editor/TextFlowEditor";
import {
  resolveFlowFragmentStep,
  roundTextFlowColumnBlockLayout,
  type TextFlowColumnBlockLayout,
} from "@/features/rendering/core";
import { boxBlockTitleText, boxFragmentMinStartHeightPx, findBoxDecoration, resolveBoxFrame } from "@/lib/box-blocks";
import { collectBlocksById } from "@/lib/document-tree";
import {
  blockSpaceAfterPx,
  mmToPx,
  type PageMetrics,
  type BoxBlockChildBlock,
  type BoxBlockNode,
  type LayoutSectionChildBlock,
  type LayoutSectionNode,
  type ProblemAreaBlock,
  type SigmaBlock,
} from "@/features/document";
import { hasBreakBefore, isProblemFrameArea, PROBLEM_AREA_ORDER } from "./block-ops";
import {
  collectTextFlowBlockElements,
  getMeasuredColumnItemHeight,
  roundEditorBoxBlockFragmentLayout,
  roundFlowUnitLayout,
} from "./layout-measure";
import {
  getFirstUnitBlock,
  getLayoutSectionColumnCount,
  isFullSpanUnit,
  isProblemAreaColumnBlockFlowEligible,
} from "./render-units";
import type {
  EditorBoxBlockFragmentLayout,
  FlowUnitLayout,
  ProblemAreaColumnLayout,
  ProblemAreaFrameFragmentLayout,
  RenderUnit,
} from "./types";

/** The column geometry a block flow places against — normally the page's own
 * column count/width/gap, but a full-span area's flow substitutes a single
 * "column" spanning the whole content width (see fullSpanGeometry below). */
interface FlowColumnGeometry {
  columnCount: number;
  columnWidthPx: number;
  columnGapPx: number;
}

/** Visual style is deliberately irrelevant: every SigmaDoc box participates in
 * the same line-safe page/column fragmentation contract. */
export function isFlowBlockFragmentable(
  block: { type: string } | undefined,
  height: number,
  segmentHeight: number,
): boolean {
  return height > 0 && (block?.type === "boxBlock" || height > segmentHeight + 0.5);
}

interface ColumnBreakContextMenuLookup {
  blockId: string;
  blocks: SigmaBlock[];
  /**
   * **実際に描画しているユニット**。ここで組み直してはいけない — チャンク境界は前回の描画から
   * 引き継ぐ (`text-run-chunking.ts`) ので、blocks だけから作り直すと id が実描画とずれ、
   * `unitLayouts` が引けずにメニューが無言で出なくなる。
   */
  units: readonly RenderUnit[];
  isColumnFlow: boolean;
  metrics: PageMetrics;
  pageStridePx: number;
  blockRects?: ReadonlyMap<string, MeasuredBlock>;
  paginationMarkerLayouts: Record<string, FlowUnitLayout>;
  textFlowBlockLayouts: Record<string, TextFlowColumnBlockLayout>;
  unitLayouts: Record<string, FlowUnitLayout>;
  problemAreaColumnLayouts: Record<string, ProblemAreaColumnLayout>;
  localColumnContextMenuLayout?: LocalColumnContextMenuLayout | null;
}

export interface LocalColumnContextMenuLayout {
  sectionId: string;
  layout: ProblemAreaColumnLayout;
}

export function getColumnBreakBeforeBlockIdForContextMenu({
  blockId,
  blocks,
  units,
  isColumnFlow,
  metrics,
  pageStridePx,
  blockRects = new Map(),
  paginationMarkerLayouts,
  textFlowBlockLayouts,
  unitLayouts,
  problemAreaColumnLayouts,
  localColumnContextMenuLayout,
}: ColumnBreakContextMenuLookup): string | null {
  const section = findContainingLayoutSectionInBlocks(blocks, blockId);
  if (section && getLayoutSectionColumnCount(section) > 1) {
    const layout = problemAreaColumnLayouts[section.id]
      ?? (localColumnContextMenuLayout?.sectionId === section.id
        ? localColumnContextMenuLayout.layout
        : undefined);
    if (layout?.blockLayouts[blockId]) {
      return getLocalColumnBreakBeforeBlockId({
        blockId,
        layout,
        pageStridePx,
        section,
      });
    }
    return hasOneManualBreakPerColumnBoundary(section)
      ? getFollowingManualBreakBeforeBlockId(section, blockId)
      : null;
  }

  const clickedBlock = collectBlocksById(blocks).get(blockId);
  if (clickedBlock && clickedBlock.type !== "listItem" && hasBreakBefore(clickedBlock)) {
    return blockId;
  }

  if (!isColumnFlow) {
    return getSingleColumnPageBreakBeforeBlockId({
      blockId,
      blocks,
      blockRects,
      pageStridePx,
    });
  }

  const unit = units.find((candidate) => {
    if (
      candidate.type === "textFlow" ||
      (candidate.type === "problemArea" && isProblemAreaColumnBlockFlowEligible(candidate))
    ) {
      return candidate.blocks.some((block) => block.id === blockId);
    }
    return getFirstUnitBlock(candidate).id === blockId;
  });
  if (!unit) {
    return null;
  }

  const clickedLayout = getAbsoluteBlockColumnLayout(blockId, unit, unitLayouts, textFlowBlockLayouts);
  if (!clickedLayout) {
    return null;
  }

  const clickedColumn = getPageColumnKey(clickedLayout, metrics, pageStridePx);
  for (const [candidateId, markerLayout] of Object.entries(paginationMarkerLayouts)) {
    if (samePageColumn(clickedColumn, getPageColumnKey(markerLayout, metrics, pageStridePx))) {
      return candidateId;
    }
  }

  return null;
}

export function measureLocalColumnContextMenuLayout(
  target: Element | null,
  zoomFactor: number,
): LocalColumnContextMenuLayout | null {
  const section = target?.closest<HTMLElement>(".sigma-doc-layout-section-block[data-sigma-doc-id]") ?? null;
  const body = section?.querySelector<HTMLElement>(":scope > .sigma-doc-layout-section-body") ?? null;
  const sectionId = section?.getAttribute("data-sigma-doc-id") ?? null;
  if (!section || !body || !sectionId) {
    return null;
  }

  const columnCount = Number.parseInt(section.getAttribute("data-column-count") ?? "", 10);
  if (!Number.isFinite(columnCount) || columnCount <= 1) {
    return null;
  }

  const bodyRect = body.getBoundingClientRect();
  const safeZoomFactor = Math.max(0.01, zoomFactor);
  const parsedGap = Number.parseFloat(getComputedStyle(body).columnGap);
  const columnGapPx = Number.isFinite(parsedGap) ? Math.max(0, parsedGap) : 0;
  const bodyWidthPx = bodyRect.width / safeZoomFactor;
  const columnWidthPx = Math.max(1, (bodyWidthPx - (columnCount - 1) * columnGapPx) / columnCount);
  const blockLayouts: Record<string, TextFlowColumnBlockLayout> = {};
  const markerLayouts: Record<string, TextFlowColumnBlockLayout> = {};

  for (const child of body.children) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    const rect = child.getBoundingClientRect();
    const childLayout = roundTextFlowColumnBlockLayout({
      x: (rect.left - bodyRect.left) / safeZoomFactor,
      y: (rect.top - bodyRect.top) / safeZoomFactor,
      width: rect.width / safeZoomFactor,
    });
    const markerBlockId = child.getAttribute("data-page-break-marker") !== null
      ? child.getAttribute("data-page-break-block-id")
      : null;
    if (markerBlockId) {
      markerLayouts[markerBlockId] = childLayout;
      continue;
    }
    const childBlockId = child.getAttribute("data-sigma-doc-id");
    if (childBlockId) {
      blockLayouts[childBlockId] = childLayout;
    }
  }

  return {
    sectionId,
    layout: {
      blockLayouts,
      markerLayouts,
      totalHeightPx: bodyRect.height / safeZoomFactor,
      columnWidthPx,
      columnGapPx,
    },
  };
}

function getSingleColumnPageBreakBeforeBlockId({
  blockId,
  blocks,
  blockRects,
  pageStridePx,
}: {
  blockId: string;
  blocks: SigmaBlock[];
  blockRects: ReadonlyMap<string, MeasuredBlock>;
  pageStridePx: number;
}): string | null {
  const clicked = blockRects.get(blockId);
  if (!clicked) {
    return null;
  }

  const clickedPageIndex = getPageIndexForMeasuredTop(clicked.top, pageStridePx);
  const blocksById = collectBlocksById(blocks);
  let nearest: MeasuredBlock | null = null;

  for (const [candidateId, candidate] of blocksById) {
    if (candidate.type === "listItem" || !hasBreakBefore(candidate)) {
      continue;
    }

    // A break inside a multi-column layout section belongs to that local
    // column flow and is resolved above from its rendered block/marker column.
    const section = findContainingLayoutSectionInBlocks(blocks, candidateId);
    if (section && getLayoutSectionColumnCount(section) > 1) {
      continue;
    }

    const measured = blockRects.get(candidateId);
    if (
      !measured
      || getPageIndexForMeasuredTop(measured.top, pageStridePx) !== clickedPageIndex + 1
      || measured.top <= clicked.top
    ) {
      continue;
    }

    if (!nearest || measured.top < nearest.top) {
      nearest = measured;
    }
  }

  return nearest?.id ?? null;
}

function getPageIndexForMeasuredTop(top: number, pageStridePx: number): number {
  return Math.max(0, Math.floor(Math.max(0, top) / Math.max(1, pageStridePx)));
}

function getLocalColumnBreakBeforeBlockId({
  blockId,
  layout,
  pageStridePx,
  section,
}: {
  blockId: string;
  layout: ProblemAreaColumnLayout;
  pageStridePx: number;
  section: LayoutSectionNode;
}): string | null {
  const clickedLayout = layout.blockLayouts[blockId];
  if (!clickedLayout) {
    return null;
  }
  const clickedIndex = section.children.findIndex((child) => child.id === blockId);
  if (clickedIndex < 0) {
    return null;
  }

  const clickedColumn = getLocalColumnKey(
    clickedLayout,
    layout.columnWidthPx,
    layout.columnGapPx,
    pageStridePx,
  );
  for (let index = clickedIndex + 1; index < section.children.length; index += 1) {
    const child = section.children[index];
    if (!child || !hasBreakBefore(child)) {
      continue;
    }
    const markerLayout = layout.markerLayouts[child.id];
    if (
      markerLayout
      && samePageColumn(
        clickedColumn,
        getLocalColumnKey(markerLayout, layout.columnWidthPx, layout.columnGapPx, pageStridePx),
      )
    ) {
      return child.id;
    }
  }
  return null;
}

function hasOneManualBreakPerColumnBoundary(section: LayoutSectionNode): boolean {
  const manualBreakCount = section.children.slice(1).filter(hasBreakBefore).length;
  return manualBreakCount === getLayoutSectionColumnCount(section) - 1;
}

function getFollowingManualBreakBeforeBlockId(
  section: LayoutSectionNode,
  blockId: string,
): string | null {
  const clickedIndex = section.children.findIndex((child) => child.id === blockId);
  if (clickedIndex < 0) {
    return null;
  }

  // A break-owning child starts the clicked segment; the removable break is
  // the next one that ends it. Direct marker clicks bypass this lookup.
  for (let index = clickedIndex + 1; index < section.children.length; index += 1) {
    const child = section.children[index];
    if (child && hasBreakBefore(child)) {
      return child.id;
    }
  }

  return null;
}

function getAbsoluteBlockColumnLayout(
  blockId: string,
  unit: RenderUnit,
  unitLayouts: Record<string, FlowUnitLayout>,
  textFlowBlockLayouts: Record<string, TextFlowColumnBlockLayout>,
): FlowUnitLayout | null {
  const unitLayout = unitLayouts[unit.id];
  if (!unitLayout) {
    return null;
  }
  if (
    unit.type === "textFlow" ||
    (unit.type === "problemArea" && isProblemAreaColumnBlockFlowEligible(unit))
  ) {
    const blockLayout = textFlowBlockLayouts[blockId];
    return blockLayout
      ? {
          x: unitLayout.x + blockLayout.x,
          y: unitLayout.y + blockLayout.y,
          width: blockLayout.width,
        }
      : null;
  }
  return getFirstUnitBlock(unit).id === blockId ? unitLayout : null;
}

function findContainingLayoutSectionInBlocks(blocks: SigmaBlock[], blockId: string): LayoutSectionNode | null {
  for (const block of blocks) {
    const section = findContainingLayoutSectionInBlock(block, blockId);
    if (section) {
      return section;
    }
  }
  return null;
}

function findContainingLayoutSectionInBlock(
  block: SigmaBlock | ProblemAreaBlock | LayoutSectionChildBlock | BoxBlockChildBlock,
  blockId: string,
): LayoutSectionNode | null {
  if (block.type === "layoutSection") {
    if (block.id === blockId || block.children.some((child) => child.id === blockId)) {
      return block;
    }
    for (const child of block.children) {
      const nested = findContainingLayoutSectionInBlock(child, blockId);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (block.type === "boxBlock") {
    for (const child of block.blocks) {
      const nested = findContainingLayoutSectionInBlock(child, blockId);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (block.type === "problem") {
    for (const area of PROBLEM_AREA_ORDER) {
      for (const child of block[area]) {
        const nested = findContainingLayoutSectionInBlock(child, blockId);
        if (nested) {
          return nested;
        }
      }
    }
  }

  return null;
}

interface PageColumnKey {
  pageIndex: number;
  columnIndex: number;
}

function getPageColumnKey(layout: Pick<FlowUnitLayout, "x" | "y">, metrics: PageMetrics, pageStridePx: number): PageColumnKey {
  const columnStep = metrics.flow.columnWidthPx + metrics.flow.columnGapPx;
  return {
    pageIndex: Math.max(0, Math.floor(Math.max(0, layout.y) / Math.max(1, pageStridePx))),
    columnIndex: columnStep > 0
      ? Math.max(0, Math.round((layout.x - metrics.margins.leftPx) / columnStep))
      : 0,
  };
}

function getLocalColumnKey(
  layout: Pick<TextFlowColumnBlockLayout, "x" | "y">,
  columnWidthPx: number,
  columnGapPx: number,
  pageStridePx: number,
): PageColumnKey {
  const columnStep = columnWidthPx + columnGapPx;
  return {
    pageIndex: Math.max(0, Math.floor(Math.max(0, layout.y) / Math.max(1, pageStridePx))),
    columnIndex: columnStep > 0 ? Math.max(0, Math.round(layout.x / columnStep)) : 0,
  };
}

function samePageColumn(a: PageColumnKey, b: PageColumnKey): boolean {
  return a.pageIndex === b.pageIndex && a.columnIndex === b.columnIndex;
}

export function computeColumnUnitLayouts(
  flow: HTMLElement,
  units: RenderUnit[],
  metrics: PageMetrics,
  pageHeightPx: number,
  pageGapPx: number,
  zoomFactor: number,
  reserveSpaceGaps: Readonly<Record<string, number>> = {},
): {
  layouts: Record<string, FlowUnitLayout>;
  blockLayouts: Record<string, TextFlowColumnBlockLayout>;
  boxBlockFragmentLayouts: Record<string, EditorBoxBlockFragmentLayout[]>;
  boxFragmentSourceLayouts: Record<string, TextFlowBoxFragmentSourceLayout>;
  frameFragmentLayouts: Record<string, ProblemAreaFrameFragmentLayout[]>;
  markerLayouts: Record<string, FlowUnitLayout>;
  pageCount: number;
} {
  const elements = new Map<string, HTMLElement>();
  flow.querySelectorAll<HTMLElement>("[data-flow-unit-id]").forEach((element) => {
    const id = element.getAttribute("data-flow-unit-id");
    if (id) {
      elements.set(id, element);
    }
  });
  const textBlockElementsByUnit = new Map<string, Map<string, HTMLElement>>();
  for (const [unitId, element] of elements) {
    textBlockElementsByUnit.set(unitId, collectTextFlowBlockElements(element));
  }

  const layouts: Record<string, FlowUnitLayout> = {};
  const blockLayouts: Record<string, TextFlowColumnBlockLayout> = {};
  const boxBlockFragmentLayouts: Record<string, EditorBoxBlockFragmentLayout[]> = {};
  const boxFragmentSourceLayouts: Record<string, TextFlowBoxFragmentSourceLayout> = {};
  const markerLayouts: Record<string, FlowUnitLayout> = {};
  const frameFragmentLayouts: Record<string, ProblemAreaFrameFragmentLayout[]> = {};
  const columnGeometry: FlowColumnGeometry = {
    columnCount: metrics.flow.columnCount,
    columnWidthPx: metrics.flow.columnWidthPx,
    columnGapPx: metrics.flow.columnGapPx,
  };
  // A full-span problem area (`columnSpan: "full"`) that flows past a manual break
  // is placed like a single-column page: one "column" spanning the full content
  // width, so each fragment lands at the same x/width as the atomic full-span
  // placement below, not squeezed into a page-column's width.
  const fullSpanGeometry: FlowColumnGeometry = {
    columnCount: 1,
    columnWidthPx: metrics.content.widthPx,
    columnGapPx: 0,
  };
  const pageStride = pageHeightPx + pageGapPx;
  let pageIndex = 0;
  let columnIndex = 0;
  let cursorY = 0;
  let pageColumnStartY = 0;
  let maxPageIndex = 0;
  let maxPlacedUnitBottom = 0;

  const advanceColumn = (geometry: FlowColumnGeometry = columnGeometry) => {
    if (columnIndex < geometry.columnCount - 1) {
      columnIndex += 1;
      cursorY = pageColumnStartY;
      return;
    }

    pageIndex += 1;
    columnIndex = 0;
    cursorY = 0;
    pageColumnStartY = 0;
  };

  const placeAtPageStart = (nextPageIndex: number) => {
    pageIndex = Math.max(pageIndex, nextPageIndex);
    columnIndex = 0;
    cursorY = 0;
    pageColumnStartY = 0;
  };

  const placeOnNextPage = () => {
    pageIndex += 1;
    columnIndex = 0;
    cursorY = 0;
    pageColumnStartY = 0;
  };

  const currentColumnX = (geometry: FlowColumnGeometry = columnGeometry) =>
    metrics.margins.leftPx + columnIndex * (geometry.columnWidthPx + geometry.columnGapPx);

  const placeLayout = (
    target: Record<string, FlowUnitLayout>,
    id: string,
    x: number,
    width: number,
    height: number,
    includeHeight = false,
  ): FlowUnitLayout => {
    const y = pageIndex * pageStride + metrics.margins.topPx + cursorY;
    const layout = roundFlowUnitLayout({
      x,
      y,
      width,
      ...(includeHeight ? { height } : {}),
    });
    target[id] = layout;
    maxPageIndex = Math.max(maxPageIndex, pageIndex);
    return layout;
  };

  const pageHasColumnContent = () => columnIndex > 0 || cursorY > pageColumnStartY + 0.5;
  const pageHasPlacedContent = () => pageHasColumnContent() || pageColumnStartY > 0.5;
  const movePastOverflowingUnit = (unitTop: number, height: number) => {
    const currentContentBottom = pageIndex * pageStride + metrics.margins.topPx + metrics.content.heightPx;
    const unitBottom = unitTop + Math.max(0, height);
    if (unitBottom <= currentContentBottom + 0.5) {
      return false;
    }

    const safePageIndex = Math.max(
      pageIndex + 1,
      Math.ceil(Math.max(0, unitBottom - metrics.margins.topPx) / pageStride),
    );
    placeAtPageStart(safePageIndex);
    return true;
  };
  const recordPlacedUnitBottom = (layout: FlowUnitLayout, height: number) => {
    maxPlacedUnitBottom = Math.max(maxPlacedUnitBottom, layout.y + Math.max(0, height));
  };
  const createColumnBoxFragments = (
    blockId: string,
    height: number,
    breakOffsets?: number[],
    geometry: FlowColumnGeometry = columnGeometry,
  ): {
    fragments: EditorBoxBlockFragmentLayout[];
    nextPageIndex: number;
    nextColumnIndex: number;
    nextCursorY: number;
    nextPageColumnStartY: number;
    bottom: number;
  } => {
    const fragmentStep = geometry.columnWidthPx + geometry.columnGapPx;
    const fragments: EditorBoxBlockFragmentLayout[] = [];
    let remaining = Math.max(0, height);
    let sourceOffsetY = 0;
    let fragmentPageIndex = pageIndex;
    let fragmentColumnIndex = columnIndex;
    let fragmentCursorY = cursorY;
    let fragmentPageColumnStartY = pageColumnStartY;
    let bottom = pageIndex * pageStride + metrics.margins.topPx + cursorY;

    for (let guard = 0; remaining > 0.5 && guard < Math.ceil(height) + 2; guard += 1) {
      const available = Math.max(1, metrics.content.heightPx - fragmentCursorY);
      const fragmentStepResult = resolveFlowFragmentStep({
        available,
        breakOffsets,
        fullSegmentHeight: metrics.content.heightPx,
        remaining,
        sourceOffsetY,
      });
      if (fragmentStepResult.advanceToNextSegment) {
        if (fragmentColumnIndex < geometry.columnCount - 1) {
          fragmentColumnIndex += 1;
          fragmentCursorY = fragmentPageColumnStartY;
        } else {
          fragmentPageIndex += 1;
          fragmentColumnIndex = 0;
          fragmentCursorY = 0;
          fragmentPageColumnStartY = 0;
        }
        continue;
      }
      const fragmentHeight = fragmentStepResult.height;
      const fragmentX = metrics.margins.leftPx + fragmentColumnIndex * fragmentStep;
      const fragmentY = fragmentPageIndex * pageStride + metrics.margins.topPx + fragmentCursorY;
      fragments.push({
        blockId,
        fragmentIndex: fragments.length,
        x: fragmentX,
        y: fragmentY,
        width: geometry.columnWidthPx,
        height: fragmentHeight,
        sourceOffsetY,
        totalHeight: height,
      });
      bottom = Math.max(bottom, fragmentY + fragmentHeight);
      maxPageIndex = Math.max(maxPageIndex, fragmentPageIndex);
      remaining -= fragmentHeight;
      sourceOffsetY += fragmentHeight;

      if (remaining <= 0.5) {
        fragmentCursorY += fragmentHeight;
        break;
      }

      if (fragmentColumnIndex < geometry.columnCount - 1) {
        fragmentColumnIndex += 1;
        fragmentCursorY = fragmentPageColumnStartY;
      } else {
        fragmentPageIndex += 1;
        fragmentColumnIndex = 0;
        fragmentCursorY = 0;
        fragmentPageColumnStartY = 0;
      }
    }

    return {
      fragments,
      nextPageIndex: fragmentPageIndex,
      nextColumnIndex: fragmentColumnIndex,
      nextCursorY: fragmentCursorY,
      nextPageColumnStartY: fragmentPageColumnStartY,
      bottom,
    };
  };

  const placeColumnBlock = (
    block: TextFlowBlock,
    height: number,
    breakOffsets?: number[],
    geometry: FlowColumnGeometry = columnGeometry,
    nextBlock?: { height: number; hasExplicitBreak: boolean },
  ): FlowUnitLayout => {
    // 実測 height にはブロック下余白 (padding) が入っている。段に「収まるか」は本文だけで
    // 決め (余白で溢れたら送るのは次のブロック)、カーソルの前進には余白ごと含める。
    const trailingSpacePx = blockSpaceAfterPx(block);
    const fitHeight = Math.max(0, height - trailingSpacePx);
    if (block.pagination?.break === true && (cursorY > 0 || columnIndex > 0)) {
      markerLayouts[block.id] = roundFlowUnitLayout({
        x: currentColumnX(geometry),
        y: pageIndex * pageStride + metrics.margins.topPx + cursorY,
        width: geometry.columnWidthPx,
      });
      advanceColumn(geometry);
    }

    // keepWithNext は「2 つが同じ段に載るか」なので、間に挟まる余白は数える。
    const keepWithNextHeight = block.pagination?.keepWithNext === true
      && nextBlock
      && !nextBlock.hasExplicitBreak
      ? height + nextBlock.height
      : 0;
    if (
      cursorY > pageColumnStartY + 0.5
      && keepWithNextHeight > metrics.content.heightPx - cursorY + 0.5
      && keepWithNextHeight <= metrics.content.heightPx + 0.5
    ) {
      advanceColumn(geometry);
    }

    const reserveGap = Math.max(0, reserveSpaceGaps[block.id] ?? 0);
    if (
      reserveGap > 0.5 &&
      cursorY > pageColumnStartY + 0.5 &&
      reserveGap + Math.min(fitHeight, metrics.content.heightPx) > metrics.content.heightPx - cursorY + 0.5 &&
      reserveGap + Math.min(fitHeight, metrics.content.heightPx) <= metrics.content.heightPx + 0.5
    ) {
      advanceColumn(geometry);
    }
    cursorY += reserveGap;

    if (block.type === "boxBlock" && height > 0) {
      // A box flows like body text across columns/pages: it fills the rest of the
      // current column and continues (open-edged) into the next. So we don't push
      // the whole box to the next column when it overflows — only when too little
      // room remains in the current column to start it cleanly.
      const available = metrics.content.heightPx - cursorY;
      if (
        block.pagination?.keepTogether === true
        && cursorY > pageColumnStartY + 0.5
        && fitHeight > available + 0.5
        && fitHeight <= metrics.content.heightPx + 0.5
      ) {
        advanceColumn(geometry);
      }
      const nextAvailable = metrics.content.heightPx - cursorY;
      const minStart = boxFragmentMinStartHeightPx(resolveBoxFrame(block), boxBlockTitleText(block).length > 0);
      if (cursorY > pageColumnStartY + 0.5 && fitHeight > nextAvailable + 0.5 && nextAvailable < minStart - 0.5) {
        advanceColumn(geometry);
      }
    } else if (
      cursorY <= pageColumnStartY + 0.5 &&
      pageColumnStartY > 0.5 &&
      height > 0 &&
      cursorY + fitHeight > metrics.content.heightPx + 0.5
    ) {
      placeOnNextPage();
    } else if (cursorY > pageColumnStartY + 0.5 && height > 0 && cursorY + fitHeight > metrics.content.heightPx + 0.5) {
      advanceColumn(geometry);
    }

    const layout = placeLayout(blockLayouts as Record<string, FlowUnitLayout>, block.id, currentColumnX(geometry), geometry.columnWidthPx, height, true);
    // A box always flows across columns; a non-box block is only split when it is
    // taller than a full column (otherwise it is kept whole and moved as needed).
    const shouldFragment = isFlowBlockFragmentable(block, fitHeight, metrics.content.heightPx);
    const fragmentResult = shouldFragment
      ? createColumnBoxFragments(block.id, height, breakOffsets, geometry)
      : null;
    if (fragmentResult && fragmentResult.fragments.length > 1) {
      const firstFragment = fragmentResult.fragments[0];
      boxBlockFragmentLayouts[block.id] = fragmentResult.fragments.slice(1).map(roundEditorBoxBlockFragmentLayout);
      boxFragmentSourceLayouts[block.id] = {
        visibleHeight: firstFragment.height,
        totalHeight: height,
      };
      maxPlacedUnitBottom = Math.max(maxPlacedUnitBottom, fragmentResult.bottom);
      pageIndex = fragmentResult.nextPageIndex;
      columnIndex = fragmentResult.nextColumnIndex;
      cursorY = fragmentResult.nextCursorY;
      pageColumnStartY = fragmentResult.nextPageColumnStartY;
    } else {
      cursorY += Math.max(0, height);
      recordPlacedUnitBottom(layout, height);
      movePastOverflowingUnit(layout.y, height);
    }

    return layout;
  };

  const placeBlockFlowUnit = (
    unit: Extract<RenderUnit, { type: "textFlow" | "problemArea" }>,
    element: HTMLElement | undefined,
  ): boolean => {
    if (unit.blocks.length === 0) {
      return false;
    }

    // A full-span problem area's flow places blocks against a single "column"
    // spanning the whole content width (see fullSpanGeometry), not the page's own
    // column width — otherwise a split full-span area would render squeezed into
    // one page-column instead of the full page width it is meant to occupy.
    const isFullSpanFlow = unit.type === "problemArea" && isFullSpanUnit(unit);
    const geometry = isFullSpanFlow ? fullSpanGeometry : columnGeometry;
    // Mirrors the atomic full-span placement below: full-span content can't share
    // a horizontal band with page-column content, so it always starts a fresh page
    // when there is already column content on the current one.
    if (isFullSpanFlow && pageHasColumnContent()) {
      placeOnNextPage();
    }

    const firstUnitBlock = unit.type === "problemArea" ? getFirstUnitBlock(unit) : undefined;
    const problemPageBreakBlock = firstUnitBlock && !unit.blocks.some((block) => block.id === firstUnitBlock.id)
      ? firstUnitBlock
      : undefined;
    if (problemPageBreakBlock?.pagination?.break === true && (cursorY > 0 || columnIndex > 0)) {
      markerLayouts[problemPageBreakBlock.id] = roundFlowUnitLayout({
        x: currentColumnX(geometry),
        y: pageIndex * pageStride + metrics.margins.topPx + cursorY,
        width: geometry.columnWidthPx,
      });
      advanceColumn(geometry);
    }

    const blockElements = textBlockElementsByUnit.get(unit.id);
    const measuredBlocks = unit.blocks.map((block) => {
      const blockElement = blockElements?.get(block.id);
      return {
        block,
        blockElement,
        height: getMeasuredColumnItemHeight(blockElement ?? (unit.blocks.length === 1 ? element : undefined), zoomFactor),
      };
    });
    const placedBlocks: Array<{ blockId: string; layout: FlowUnitLayout }> = [];
    for (const [index, { block, blockElement, height }] of measuredBlocks.entries()) {
      const next = measuredBlocks[index + 1];
      placedBlocks.push({
        blockId: block.id,
        layout: placeColumnBlock(
          block,
          height,
          block.type === "boxBlock"
            ? getBoxFragmentBreakOffsetsFromElement(block, blockElement, zoomFactor)
            : height > metrics.content.heightPx + 0.5
              ? getBlockFragmentBreakOffsetsFromElement(blockElement, zoomFactor)
              : undefined,
          geometry,
          next ? {
            height: next.height,
            hasExplicitBreak: next.block.pagination?.break === true,
          } : undefined,
        ),
      });
    }

    const x = Math.min(...placedBlocks.map((entry) => entry.layout.x));
    const y = Math.min(...placedBlocks.map((entry) => entry.layout.y));
    const right = Math.max(...placedBlocks.map((entry) => entry.layout.x + entry.layout.width));
    const bottom = Math.max(...placedBlocks.map((entry) => entry.layout.y + (entry.layout.height ?? 0)));
    const unitLayout = roundFlowUnitLayout({
      x,
      y,
      width: right - x,
      height: Math.max(1, bottom - y),
    });

    if (unit.type === "problemArea") {
      const minHeightPx = mmToPx(unit.problem.areaLayout?.[unit.area]?.minHeightMm ?? 0);
      const firstColumn = getPageColumnKey(placedBlocks[0].layout, metrics, pageStride);
      const stayedInOneColumn = placedBlocks.every((entry) =>
        samePageColumn(firstColumn, getPageColumnKey(entry.layout, metrics, pageStride)),
      );
      const cursorColumn = getPageColumnKey({
        x: currentColumnX(geometry),
        y: pageIndex * pageStride + metrics.margins.topPx + cursorY,
      }, metrics, pageStride);
      if (minHeightPx > 0 && stayedInOneColumn && samePageColumn(firstColumn, cursorColumn)) {
        const unitPageIndex = firstColumn.pageIndex;
        const unitTopInPage = unitLayout.y - unitPageIndex * pageStride - metrics.margins.topPx;
        const reservedHeight = Math.max(unitLayout.height ?? 0, minHeightPx);
        cursorY = Math.max(cursorY, unitTopInPage + minHeightPx);
        unitLayout.height = Math.round(reservedHeight);
        recordPlacedUnitBottom(unitLayout, reservedHeight);
        movePastOverflowingUnit(unitLayout.y, reservedHeight);
      }
    }

    if (isFullSpanFlow) {
      // Mirrors the atomic full-span placement below: subsequent page-column
      // content must start below the full-span band on every column, not beside it.
      pageColumnStartY = cursorY;
      columnIndex = 0;
    }

    const isFrameArea = unit.type === "problemArea" &&
      unit.problem.frame?.enabled === true && isProblemFrameArea(unit.area);
    if (isFrameArea) {
      // The frame can no longer be a single CSS box around the whole unit once its
      // blocks are split across a page/column break — group the placed blocks back
      // into the page/column segments they actually landed in, so the caller can
      // render one border "piece" per segment (open at the break, see
      // ProblemAreaFrameFragmentLayout).
      const segments: ProblemAreaFrameFragmentLayout[] = [];
      let segmentStart = 0;
      for (let i = 1; i <= placedBlocks.length; i += 1) {
        const atSegmentBoundary = i === placedBlocks.length || !samePageColumn(
          getPageColumnKey(placedBlocks[segmentStart].layout, metrics, pageStride),
          getPageColumnKey(placedBlocks[i].layout, metrics, pageStride),
        );
        if (!atSegmentBoundary) {
          continue;
        }
        const segmentBlocks = placedBlocks.slice(segmentStart, i);
        const segmentX = Math.min(...segmentBlocks.map((entry) => entry.layout.x));
        const segmentY = Math.min(...segmentBlocks.map((entry) => entry.layout.y));
        const segmentRight = Math.max(...segmentBlocks.map((entry) => entry.layout.x + entry.layout.width));
        const segmentBottom = Math.max(...segmentBlocks.map((entry) => entry.layout.y + (entry.layout.height ?? 0)));
        segments.push({
          x: segmentX - unitLayout.x,
          y: segmentY - unitLayout.y,
          width: segmentRight - segmentX,
          height: Math.max(1, segmentBottom - segmentY),
        });
        segmentStart = i;
      }
      if (segments.length > 1) {
        frameFragmentLayouts[unit.id] = segments;
      }
    }

    layouts[unit.id] = unitLayout;
    for (const entry of placedBlocks) {
      blockLayouts[entry.blockId] = roundTextFlowColumnBlockLayout({
        x: entry.layout.x - unitLayout.x,
        y: entry.layout.y - unitLayout.y,
        width: entry.layout.width,
      });
    }
    return true;
  };

  for (const [unitIndex, unit] of units.entries()) {
    const element = elements.get(unit.id);
    if (
      unit.type === "textFlow" ||
      (unit.type === "problemArea" && isProblemAreaColumnBlockFlowEligible(unit))
    ) {
      if (placeBlockFlowUnit(unit, element)) {
        continue;
      }
    }

    if (unit.type === "textFlow") {
      continue;
    }

    const height = getMeasuredColumnItemHeight(element, zoomFactor);
    const block = getFirstUnitBlock(unit);
    const isFullSpan = isFullSpanUnit(unit);
    const reserveGap = Math.max(0, reserveSpaceGaps[block.id] ?? 0);

    if (block.pagination?.break === true && (cursorY > 0 || columnIndex > 0)) {
      markerLayouts[block.id] = roundFlowUnitLayout({
        x: currentColumnX(),
        y: pageIndex * pageStride + metrics.margins.topPx + cursorY,
        width: isFullSpan ? metrics.content.widthPx : metrics.flow.columnWidthPx,
      });
      advanceColumn();
    }

    const nextUnit = units[unitIndex + 1];
    const nextBlock = nextUnit ? getFirstUnitBlock(nextUnit) : undefined;
    const nextHeight = nextUnit ? getMeasuredColumnItemHeight(elements.get(nextUnit.id), zoomFactor) : 0;
    const keepWithNextHeight = block.pagination?.keepWithNext === true
      && nextBlock
      && nextBlock.pagination?.break !== true
      && nextUnit
      && !isFullSpan
      && !isFullSpanUnit(nextUnit)
      ? reserveGap + height + nextHeight
      : 0;
    if (
      cursorY > pageColumnStartY + 0.5
      && keepWithNextHeight > metrics.content.heightPx - cursorY + 0.5
      && keepWithNextHeight <= metrics.content.heightPx + 0.5
    ) {
      advanceColumn();
    }

    if (isFullSpan) {
      if (pageHasColumnContent()) {
        placeOnNextPage();
      }

      if (cursorY > 0 && height > 0 && cursorY + reserveGap + height > metrics.content.heightPx + 0.5) {
        placeOnNextPage();
      }

      cursorY += reserveGap;

      const layout = placeLayout(layouts, unit.id, metrics.margins.leftPx, metrics.content.widthPx, height);

      cursorY += Math.max(0, height);
      if (!movePastOverflowingUnit(layout.y, height)) {
        pageColumnStartY = cursorY;
        columnIndex = 0;
      }

      continue;
    }

    const exceedsBlankColumn = height > metrics.content.heightPx + 0.5;
    if (
      reserveGap > 0.5 &&
      cursorY > pageColumnStartY + 0.5 &&
      reserveGap + Math.min(height, metrics.content.heightPx) > metrics.content.heightPx - cursorY + 0.5 &&
      reserveGap + Math.min(height, metrics.content.heightPx) <= metrics.content.heightPx + 0.5
    ) {
      advanceColumn();
    }
    cursorY += reserveGap;
    if (exceedsBlankColumn && pageHasPlacedContent()) {
      placeOnNextPage();
    } else if (
      cursorY <= pageColumnStartY + 0.5 &&
      pageColumnStartY > 0.5 &&
      height > 0 &&
      cursorY + height > metrics.content.heightPx + 0.5
    ) {
      placeOnNextPage();
    } else if (cursorY > pageColumnStartY + 0.5 && height > 0 && cursorY + height > metrics.content.heightPx + 0.5) {
      advanceColumn();
    }

    const layout = placeLayout(layouts, unit.id, currentColumnX(), metrics.flow.columnWidthPx, height);
    recordPlacedUnitBottom(layout, height);

    cursorY += Math.max(0, height);
    movePastOverflowingUnit(layout.y, height);

  }

  return {
    layouts,
    blockLayouts,
    boxBlockFragmentLayouts,
    boxFragmentSourceLayouts,
    frameFragmentLayouts,
    markerLayouts,
    pageCount: Math.max(1, maxPageIndex + 1, getPageCountForBottom(maxPlacedUnitBottom, pageHeightPx, pageStride)),
  };
}

export function getPageCountForBottom(bottom: number, pageHeightPx: number, pageStridePx: number): number {
  return bottom > pageHeightPx
    ? Math.ceil((bottom - pageHeightPx) / pageStridePx) + 1
    : 1;
}

export function getPageIndexForY(y: number, pageStridePx: number): number {
  return Math.max(0, Math.floor(Math.max(0, y) / pageStridePx));
}

export function createSingleColumnBoxFragments({
  blockId,
  height,
  metrics,
  pageHeightPx,
  pageStride,
  sourceTop,
  width,
  x,
  breakOffsets,
}: {
  blockId: string;
  height: number;
  metrics: PageMetrics;
  pageHeightPx: number;
  pageStride: number;
  sourceTop: number;
  width: number;
  x: number;
  breakOffsets?: number[];
}): EditorBoxBlockFragmentLayout[] {
  const fragments: EditorBoxBlockFragmentLayout[] = [];
  let remaining = Math.max(0, height);
  let sourceOffsetY = 0;
  let fragmentPageIndex = getPageIndexForY(sourceTop, pageStride);
  let fragmentY = sourceTop;

  for (let guard = 0; remaining > 0.5 && guard < Math.ceil(height) + 2; guard += 1) {
    const contentTop = fragmentPageIndex * pageStride + metrics.margins.topPx;
    const contentBottom = contentTop + metrics.content.heightPx;
    if (fragmentY >= contentBottom - 0.5) {
      fragmentPageIndex += 1;
      fragmentY = fragmentPageIndex * pageStride + metrics.margins.topPx;
      continue;
    }

    const fragmentStep = resolveFlowFragmentStep({
      available: Math.max(1, contentBottom - fragmentY),
      breakOffsets,
      fullSegmentHeight: metrics.content.heightPx,
      remaining,
      sourceOffsetY,
    });
    if (fragmentStep.advanceToNextSegment) {
      fragmentPageIndex += 1;
      fragmentY = fragmentPageIndex * pageStride + metrics.margins.topPx;
      continue;
    }
    const fragmentHeight = fragmentStep.height;
    fragments.push({
      blockId,
      fragmentIndex: fragments.length,
      x,
      y: fragmentY,
      width,
      height: fragmentHeight,
      sourceOffsetY,
      totalHeight: height,
    });
    remaining -= fragmentHeight;
    sourceOffsetY += fragmentHeight;

    if (remaining <= 0.5) {
      break;
    }

    fragmentPageIndex += 1;
    fragmentY = fragmentPageIndex * pageStride + metrics.margins.topPx;
  }

  return fragments.length > 0
    ? fragments
    : [{
      blockId,
      fragmentIndex: 0,
      x,
      y: sourceTop,
      width,
      height: Math.max(0, Math.min(height, pageHeightPx)),
      sourceOffsetY: 0,
      totalHeight: height,
    }];
}

export function createNestedColumnBoxFragments({
  blockId,
  breakOffsets,
  columnCount,
  columnGapPx,
  columnWidthPx,
  contentHeightPx,
  height,
  metrics,
  pageStride,
  sourceLeft,
  sourceTop,
  startSegmentTop,
}: {
  blockId: string;
  breakOffsets?: number[];
  columnCount: number;
  columnGapPx: number;
  columnWidthPx: number;
  contentHeightPx: number;
  height: number;
  metrics: PageMetrics;
  pageStride: number;
  sourceLeft: number;
  sourceTop: number;
  startSegmentTop: number;
}): EditorBoxBlockFragmentLayout[] {
  const fragments: EditorBoxBlockFragmentLayout[] = [];
  const columnStep = columnWidthPx + columnGapPx;
  let remaining = Math.max(0, height);
  let sourceOffsetY = 0;
  let fragmentPageIndex = getPageIndexForY(sourceTop, pageStride);
  let fragmentColumnIndex = Math.max(0, Math.min(columnCount - 1, Math.round((sourceLeft - metrics.margins.leftPx) / columnStep)));
  const baseLeft = sourceLeft - fragmentColumnIndex * columnStep;
  let fragmentSegmentTop = startSegmentTop;
  let fragmentY = sourceTop;

  for (let guard = 0; remaining > 0.5 && guard < Math.ceil(height) + 2; guard += 1) {
    const contentBottom = fragmentPageIndex * pageStride + metrics.margins.topPx + contentHeightPx;
    if (fragmentY >= contentBottom - 0.5) {
      fragmentPageIndex += 1;
      fragmentColumnIndex = 0;
      fragmentSegmentTop = fragmentPageIndex * pageStride + metrics.margins.topPx;
      fragmentY = fragmentSegmentTop;
      continue;
    }

    const fragmentStep = resolveFlowFragmentStep({
      available: Math.max(1, contentBottom - fragmentY),
      breakOffsets,
      fullSegmentHeight: contentHeightPx,
      remaining,
      sourceOffsetY,
    });
    if (fragmentStep.advanceToNextSegment) {
      if (fragmentColumnIndex < columnCount - 1) {
        fragmentColumnIndex += 1;
        fragmentY = fragmentSegmentTop;
      } else {
        fragmentPageIndex += 1;
        fragmentColumnIndex = 0;
        fragmentSegmentTop = fragmentPageIndex * pageStride + metrics.margins.topPx;
        fragmentY = fragmentSegmentTop;
      }
      continue;
    }
    const fragmentHeight = fragmentStep.height;
    fragments.push({
      blockId,
      fragmentIndex: fragments.length,
      x: baseLeft + fragmentColumnIndex * columnStep,
      y: fragmentY,
      width: columnWidthPx,
      height: fragmentHeight,
      sourceOffsetY,
      totalHeight: height,
    });
    remaining -= fragmentHeight;
    sourceOffsetY += fragmentHeight;

    if (remaining <= 0.5) {
      break;
    }

    if (fragmentColumnIndex < columnCount - 1) {
      fragmentColumnIndex += 1;
      fragmentY = fragmentSegmentTop;
    } else {
      fragmentPageIndex += 1;
      fragmentColumnIndex = 0;
      fragmentSegmentTop = fragmentPageIndex * pageStride + metrics.margins.topPx;
      fragmentY = fragmentSegmentTop;
    }
  }

  return fragments;
}

export function getNestedColumnSegmentTop(
  shellTop: number,
  sourceTop: number,
  metrics: PageMetrics,
  pageStride: number,
): number {
  const shellPageIndex = getPageIndexForY(shellTop, pageStride);
  const sourcePageIndex = getPageIndexForY(sourceTop, pageStride);
  return sourcePageIndex === shellPageIndex
    ? shellTop
    : sourcePageIndex * pageStride + metrics.margins.topPx;
}

export function getBoxFragmentBreakOffsetsFromMeasuredBox(
  block: BoxBlockNode,
  measured: MeasuredBlock | undefined,
  measuredBlocks?: ReadonlyMap<string, MeasuredBlock>,
): number[] | undefined {
  const measuredHeight = measured?.height ?? 0;
  const lineOffsets = measured && measuredBlocks && measuredHeight > 0
    ? getMeasuredLineBreakOffsets(
      getLeafMeasuredDescendantLines(block.id, measuredBlocks),
      measured.top,
    ).filter((offset) => offset > 0.5 && offset < measuredHeight - 0.5)
    : measured?.lines && measured.lines.length > 0 && measuredHeight > 0
      ? getMeasuredLineBreakOffsets(measured.lines, measured.top)
        .filter((offset) => offset > 0.5 && offset < measuredHeight - 0.5)
      : [];
  return mergeBoxFragmentBreakOffsets(lineOffsets, getNotebookRingBreakOffsets(block, measuredHeight), measuredHeight);
}

function getLeafMeasuredDescendantLines(
  containerId: string,
  measuredBlocks: ReadonlyMap<string, MeasuredBlock>,
): MeasuredLine[] {
  const descendants = [...measuredBlocks.values()].filter((candidate) =>
    candidate.id !== containerId && measuredBlockIsInside(candidate, containerId, measuredBlocks),
  );
  const containers = new Set(
    descendants.flatMap((candidate) => candidate.containerId ? [candidate.containerId] : []),
  );
  return descendants
    .filter((candidate) => !containers.has(candidate.id))
    .flatMap((candidate) => candidate.lines ?? []);
}

function measuredBlockIsInside(
  candidate: MeasuredBlock,
  containerId: string,
  measuredBlocks: ReadonlyMap<string, MeasuredBlock>,
): boolean {
  let parentId = candidate.containerId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    if (parentId === containerId) {
      return true;
    }
    visited.add(parentId);
    parentId = measuredBlocks.get(parentId)?.containerId;
  }
  return false;
}

/**
 * Break offsets for a non-box block split into clipped fragments: the bottoms of
 * its measured text line boxes, so a slice falls between lines rather than through
 * the middle of one.
 */
export function getBlockFragmentBreakOffsetsFromMeasured(measured: MeasuredBlock | undefined): number[] | undefined {
  const measuredHeight = measured?.height ?? 0;
  if (!measured?.lines || measured.lines.length === 0 || measuredHeight <= 0) {
    return undefined;
  }
  const lineOffsets = getMeasuredLineBreakOffsets(measured.lines, measured.top)
    .filter((offset) => offset > 0.5 && offset < measuredHeight - 0.5);
  return mergeBoxFragmentBreakOffsets(lineOffsets, undefined, measuredHeight);
}

function getBlockFragmentBreakOffsetsFromElement(
  element: HTMLElement | undefined,
  zoomFactor: number,
): number[] | undefined {
  if (!element || !element.ownerDocument) {
    return undefined;
  }
  const rootRect = element.getBoundingClientRect();
  const measuredHeight = rootRect.height / zoomFactor;
  const lineOffsets = getMeasuredLineBreakOffsets(
    measureElementLineBoxes(element, rootRect, 1 / zoomFactor, 1 / zoomFactor),
  );
  return mergeBoxFragmentBreakOffsets(lineOffsets, undefined, measuredHeight);
}

export function getBoxFragmentBreakOffsetsFromElement(
  block: BoxBlockNode,
  element: HTMLElement | undefined,
  zoomFactor: number,
): number[] | undefined {
  if (!element) {
    return getNotebookRingBreakOffsets(block, 0);
  }

  const rootRect = element.getBoundingClientRect();
  const measuredHeight = rootRect.height / zoomFactor;
  const childOffsets = Array.from(element.querySelectorAll<HTMLElement>(":scope > .sigma-doc-box-body > [data-sigma-doc-id]"))
    .map((child) => {
      const rect = child.getBoundingClientRect();
      return (rect.bottom - rootRect.top) / zoomFactor;
    });
  const descendants = Array.from(element.querySelectorAll<HTMLElement>(
    ".sigma-doc-box-body [data-sigma-doc-id]",
  ));
  const leafDescendants = descendants.filter((candidate) =>
    !descendants.some((other) => other !== candidate && candidate.contains(other)),
  );
  const lineOffsets = element.ownerDocument
    ? getMeasuredLineBreakOffsets(
      leafDescendants.flatMap((child) =>
        measureElementLineBoxes(child, rootRect, 1 / zoomFactor, 1 / zoomFactor),
      ),
    )
    : [];
  // Child bottoms preserve semantic block boundaries, while line bottoms let a
  // single long paragraph/code child continue without being cut mid-line.
  return mergeBoxFragmentBreakOffsets(
    [...childOffsets, ...lineOffsets],
    getNotebookRingBreakOffsets(block, measuredHeight),
    measuredHeight,
  );
}

/** Prefer measured content boundaries and retain decoration geometry only as an
 * initial-render fallback. Both inputs are candidates, never forced page breaks. */
function mergeBoxFragmentBreakOffsets(
  primaryOffsets: number[],
  fallbackDecorationOffsets: number[] | undefined,
  totalHeight: number,
): number[] | undefined {
  // Measured visual-line boundaries always win. Decoration geometry (notebook
  // rings) is useful only while text has not been measured; choosing it over
  // the lines can put a page edge straight through a glyph.
  const sourceOffsets = primaryOffsets.length > 0
    ? primaryOffsets
    : fallbackDecorationOffsets ?? [];
  const offsets = sourceOffsets
    .filter((offset) => Number.isFinite(offset) && offset > 0.5 && offset < totalHeight - 0.5)
    .sort((a, b) => a - b);
  return offsets.length > 0 ? Array.from(new Set(offsets.map((offset) => Math.round(offset)))) : undefined;
}

function getNotebookRingBreakOffsets(block: BoxBlockNode, totalHeight: number): number[] | undefined {
  if (totalHeight <= 0) {
    return undefined;
  }

  const frame = resolveBoxFrame(block);
  const notebookRules = findBoxDecoration(frame, "notebookRules");
  if (!notebookRules) {
    return undefined;
  }

  const ringGap = notebookRules.ringGapPx ?? 23.35;
  const ringTop = notebookRules.ringTopPx ?? 8;
  const ringHeight = notebookRules.ringHeightPx ?? 12;
  if (ringGap <= 0 || ringHeight <= 0) {
    return undefined;
  }

  const offsets: number[] = [];
  for (let bottom = ringTop + ringHeight; bottom < totalHeight - 0.5; bottom += ringGap) {
    offsets.push(bottom);
  }
  return offsets;
}
