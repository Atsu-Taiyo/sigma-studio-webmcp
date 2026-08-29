"use client";

import {
  getMeasuredLineBreakOffsets,
  measureElementLineBoxes,
} from "@/components/editor/overlay-canvas/anchor";
import { PageRunningRegionView } from "@/components/editor/PageRunningRegionView";
import { PrintableRichBlock } from "@/components/print/PrintableRichBlock";
import { resolveFlowFragmentStep } from "@/features/rendering/core";
import {
  blockSpaceAfterPx,
  blockSpaceAfterStyleVars,
  normalizeOverlaySnapshot,
  estimateBlockHeightPx,
  getPageMetrics,
  MM_TO_PX,
  PAGE_GAP_PX,
  PROBLEM_AREA_ORDER,
  type BoxBlockChildBlock,
  type SigmaBlock,
  type SigmaDocument,
  type OutputProfileName,
  type PaginationHints,
  type PageOverlay,
  type ProblemAreaBlock,
  type ProblemAreaColumnSpan,
  type ProblemAreaKind,
  type RichBlock,
} from "@/features/document";
import {
  getShapeBounds,
  resolveShapesPosition,
  type MeasuredBlock,
} from "@/features/drawing";
import { MathEnvironmentValueProvider } from "@/features/rendering/adapters/react";
import { exportOverlaySvg } from "@/features/rendering/adapters/svg";
import { createMathRenderEnvironment } from "@/lib/math-environment";
import { renderInlineContent } from "@/features/rendering/adapters/react";
import { hasManualBreakInside, isProblemAreaFlowEligible } from "@/features/rendering/core";
import { formatProblemNumber, getProblemNumberMap } from "@/lib/problem-numbering";
import { getPrintableDocument } from "@/lib/print-renderer";
import { useT } from "@/lib/i18n/react";
import {
  boxBlockTitleText,
  boxFrameClassName,
  boxFrameDecorationAttributes,
  boxFrameStyleVars,
  cornerBoxReferenceHeightStyleVars,
  observeCornerBoxReferenceHeights,
  resolveBoxFrame,
} from "@/lib/box-blocks";
import {
  getPrintProblemFrameChromePaddingMm,
  getProblemFrameStyleId,
  problemFrameClassName,
} from "@/lib/problem-frame";
import { useCustomFonts } from "@/lib/use-custom-fonts";
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

const DEFAULT_PROBLEM_NUMBER_FONT_SIZE = 12;
const PRINT_CORNERBOX_SELECTOR = ".print-box-block.box-frame--corner[data-box-style='cornerbox']";
const OVERLAY_PAGE_EXTENT_EPSILON_PX = 12;

export type PrintContentUnit =
  | {
      type: "block";
      id: string;
      block: SigmaBlock;
      pagination?: PaginationHints;
    }
  | {
      type: "boxFragment";
      id: string;
      sourceId: string;
      block: Extract<SigmaBlock, { type: "boxBlock" }>;
      blocks: BoxBlockChildBlock[];
      fragmentRole: "single" | "first" | "middle" | "last";
      estimatedHeightPx: number;
      totalHeight: number;
      includeTitle: boolean;
      pagination?: PaginationHints;
    }
  | {
      type: "layoutSectionFragment";
      id: string;
      sourceId: string;
      block: Extract<SigmaBlock, { type: "layoutSection" }>;
      columns: PrintPaginatedColumn[];
      fragmentRole: "single" | "first" | "middle" | "last";
      estimatedHeightPx: number;
      columnGapMm: number;
      pagination?: PaginationHints;
    }
  | {
      // A pixel-clipped slice of a single block that is taller than one column.
      // Atomic content (a long paragraph, a list, or a box whose own child is
      // taller than a column) cannot be split at a child boundary, so it is split
      // visually: each slice renders the full block clipped to a vertical window.
      type: "blockSlice";
      id: string;
      sourceId: string;
      block: SigmaBlock;
      sliceTop: number;
      sliceHeight: number;
      totalHeight: number;
      fragmentRole: "single" | "first" | "middle" | "last";
      pagination?: PaginationHints;
    }
  | {
      type: "problemArea";
      id: string;
      problemId: string;
      area: ProblemAreaKind;
      blocks: ProblemAreaBlock[];
      minHeightMm?: number;
      problemNumber?: number;
      numberFontSize: number;
      hasFrame: boolean;
      frameStyleId?: string;
      isFirstProblemArea: boolean;
      isLastProblemArea: boolean;
      isFirstProblemFrameArea: boolean;
      isLastProblemFrameArea: boolean;
      columnSpan?: ProblemAreaColumnSpan;
      pagination?: PaginationHints;
    }
  | {
      type: "problemAreaFragment";
      id: string;
      sourceId: string;
      problemId: string;
      area: ProblemAreaKind;
      blocks: ProblemAreaBlock[];
      fragmentRole: "single" | "first" | "middle" | "last";
      estimatedHeightPx: number;
      minHeightMm?: number;
      problemNumber?: number;
      numberFontSize: number;
      hasFrame: boolean;
      frameStyleId?: string;
      columnSpan?: ProblemAreaColumnSpan;
      isFirstProblemArea: boolean;
      isLastProblemArea: boolean;
      pagination?: PaginationHints;
    };

interface PrintPaginatedColumn {
  id: string;
  number: number;
  blocks: PrintContentUnit[];
  estimatedContentHeightPx: number;
  oversizedBlockIds: string[];
}

interface PrintPaginatedPage {
  id: string;
  number: number;
  blocks: PrintContentUnit[];
  columns: PrintPaginatedColumn[];
  estimatedContentHeightPx: number;
  oversizedBlockIds: string[];
}

interface PrintContentMeasurement {
  height: number;
  flowHeight: number;
  descendantRects: MeasuredBlock[];
  breakOffsets: number[];
}

interface PrintMeasurementState {
  key: string;
  pages: PrintPaginatedPage[];
  blockRects: Map<string, MeasuredBlock>;
}

interface PrintPreviewProps {
  document: SigmaDocument;
  profile: OutputProfileName;
  displayMode?: PrintPreviewDisplayMode;
}

export type PrintPreviewDisplayMode = "vertical" | "spread" | "grid";

interface PrintPreviewThumbnailProps {
  document: SigmaDocument;
  profile?: OutputProfileName;
  maxPages?: number | "all";
}

interface PrintPreviewPageNavigatorProps {
  document: SigmaDocument;
  profile?: OutputProfileName;
  activePageNumber: number;
  onPageSelect?: (pageNumber: number) => void;
  className?: string;
  style?: CSSProperties;
}

interface PrintPreviewPageFrameArgs {
  page: PrintPaginatedPage;
  totalPages: number;
  pageNode: ReactNode;
}

interface PrintPreviewSurfaceProps extends PrintPreviewProps {
  maxPages?: number;
  stackClassName?: string;
  renderPageFrame?: (args: PrintPreviewPageFrameArgs) => ReactNode;
}

export interface SigmaDocPrintSurfaceProps {
  document: SigmaDocument;
  displayMode?: PrintPreviewDisplayMode;
  includePrintPageStyle?: boolean;
  maxPages?: number;
  stackClassName?: string;
  renderPageFrame?: (args: PrintPreviewPageFrameArgs) => ReactNode;
}

export function PrintPreview(props: PrintPreviewProps) {
  useCustomFonts();
  return <PrintPreviewSurface {...props} />;
}

export function PrintPreviewThumbnail({ document, profile = "teacher", maxPages = 1 }: PrintPreviewThumbnailProps) {
  const resolvedMaxPages = maxPages === "all" ? undefined : maxPages;
  return (
    <div className="print-preview-thumbnail" data-print-preview-thumbnail="true">
      <PrintPreviewSurface
        document={document}
        profile={profile}
        displayMode="vertical"
        maxPages={resolvedMaxPages}
        stackClassName="print-page-thumbnail-stack"
      />
    </div>
  );
}

export function PrintPreviewPageNavigator({
  document,
  profile = "teacher",
  activePageNumber,
  onPageSelect,
  className,
  style,
}: PrintPreviewPageNavigatorProps) {
  const t = useT("print");
  const renderPageFrame = useCallback(({ page, totalPages, pageNode }: PrintPreviewPageFrameArgs) => {
    const selected = page.number === activePageNumber;
    const selectPage = () => onPageSelect?.(page.number);
    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      selectPage();
    };

    return (
      <div
        key={page.id}
        className={`print-preview-page-nav-item ${selected ? "selected" : ""}`}
        role="listitem"
      >
        <div
          className="print-preview-page-nav-button"
          role="button"
          tabIndex={0}
          aria-current={selected ? "page" : undefined}
          aria-label={t("pagination.page", { page: page.number, total: totalPages })}
          onClick={selectPage}
          onKeyDown={handleKeyDown}
        >
          <div className="print-preview-page-nav-viewport" aria-hidden="true">
            <div className="print-preview-page-nav-scaler">
              {pageNode}
              <span className="print-preview-page-nav-paper-selection" />
            </div>
            <span className="print-preview-page-nav-label">-{page.number}-</span>
          </div>
        </div>
      </div>
    );
  }, [activePageNumber, onPageSelect, t]);

  return (
    <div
      className={["print-preview-page-navigator", className].filter(Boolean).join(" ")}
      data-print-page-navigator="true"
      role="list"
      aria-label={t("pagination.preview")}
      style={style}
    >
      <PrintPreviewSurface
        document={document}
        profile={profile}
        displayMode="vertical"
        stackClassName="print-page-nav-stack"
        renderPageFrame={renderPageFrame}
      />
    </div>
  );
}

function PrintPreviewSurface({
  document,
  profile,
  displayMode = "vertical",
  maxPages,
  stackClassName,
  renderPageFrame,
}: PrintPreviewSurfaceProps) {
  const t = useT("print");
  const printable = useMemo(() => getPrintableDocument(document, profile, t), [document, profile, t]);
  return (
    <SigmaDocPrintSurface
      document={printable}
      displayMode={displayMode}
      maxPages={maxPages}
      stackClassName={stackClassName}
      renderPageFrame={renderPageFrame}
    />
  );
}

/**
 * UI-free SigmaDoc page renderer shared by the desktop print preview and the
 * embeddable read-only viewer. The caller owns validation and any output-profile
 * projection; this component renders the supplied document as-is.
 */
export function SigmaDocPrintSurface({
  document: printable,
  displayMode = "vertical",
  includePrintPageStyle = true,
  maxPages,
  stackClassName,
  renderPageFrame,
}: SigmaDocPrintSurfaceProps) {
  const mathFractionSizing = printable.metadata.mathFractionSizing ?? "uniform";
  // 公開ビューア (`@sigma-studio/viewer`) はこのコンポーネントを直接 print surface に使うので、
  // Provider をここに置かないと publish 済み教材で前文マクロが一切効かない。
  // 図形 SVG の書き出しは React の外なので、同じ環境オブジェクトを明示的に渡す。
  const mathEnvironment = useMemo(
    () => createMathRenderEnvironment(printable.metadata.texPreamble, mathFractionSizing),
    [mathFractionSizing, printable.metadata.texPreamble],
  );
  const layout = printable.pageLayout!;
  const metrics = getPageMetrics(layout);
  const pageStride = metrics.page.heightPx + PAGE_GAP_PX;
  const printContent = useMemo(() => buildPrintContent(printable.content), [printable.content]);
  const stackRef = useRef<HTMLElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const estimatedPrintContentHeights = useMemo(
    () => printContent.map((unit) => estimatePrintContentUnitHeight(unit)),
    [printContent],
  );
  const fallbackContentPages = useMemo(
    () => paginateMeasuredPrintBlocks(
      printContent,
      estimatedPrintContentHeights,
      estimatedPrintContentHeights,
      metrics.flow.columnCount,
      metrics.content.heightPx,
      0,
      new Map(),
      metrics.flow.columnGapMm,
    ),
    [estimatedPrintContentHeights, metrics.content.heightPx, metrics.flow.columnCount, metrics.flow.columnGapMm, printContent],
  );
  const contentKey = useMemo(() => JSON.stringify(printContent), [printContent]);
  const layoutKey = useMemo(() => JSON.stringify(layout), [layout]);
  const measurementKey = `${contentKey}\n${layoutKey}`;
  const emptyBlockRects = useMemo(() => new Map<string, MeasuredBlock>(), []);
  const [measurement, setMeasurement] = useState<PrintMeasurementState | null>(null);
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const activeMeasurement = measurement?.key === measurementKey ? measurement : null;
  const contentPages = activeMeasurement?.pages ?? fallbackContentPages;
  const measuredBlockRects = activeMeasurement?.blockRects ?? emptyBlockRects;
  const resolvedOverlay = useMemo(
    () => resolvePrintOverlay(layout.overlay, measuredBlockRects),
    [layout.overlay, measuredBlockRects],
  );
  const pages = useMemo(
    () => extendPagesForOverlay(
      contentPages,
      resolvedOverlay,
      metrics.flow.columnCount,
      metrics.page.heightPx,
      pageStride,
    ),
    [contentPages, metrics.flow.columnCount, metrics.page.heightPx, pageStride, resolvedOverlay],
  );
  const renderedPages = typeof maxPages === "number"
    ? pages.slice(0, Math.max(1, maxPages))
    : pages;
  const pageStyle = {
    "--print-page-width": `${metrics.page.widthMm}mm`,
    "--print-page-height": `${metrics.page.heightMm}mm`,
    "--print-margin-top": `${metrics.margins.topPx}px`,
    "--print-margin-right": `${metrics.margins.rightPx}px`,
    "--print-margin-bottom": `${metrics.margins.bottomPx}px`,
    "--print-margin-left": `${metrics.margins.leftPx}px`,
    "--print-column-count": String(metrics.flow.columnCount),
    "--print-column-gap": `${metrics.flow.columnGapMm}mm`,
    "--print-measure-column-width": `${metrics.flow.columnWidthPx}px`,
    "--print-measure-content-width": `${metrics.content.widthPx}px`,
  } as CSSProperties;

  useLayoutEffect(() => {
    const stackRoot = stackRef.current;
    if (!stackRoot) {
      return;
    }

    return observeCornerBoxReferenceHeights(stackRoot, PRINT_CORNERBOX_SELECTOR);
  }, [contentKey, layoutKey]);

  useLayoutEffect(() => {
    const measureRoot = measureRef.current;
    if (!measureRoot) {
      return;
    }

    let active = true;
    let frameId: number | null = null;
    const requestMeasurement = () => {
      if (!active || frameId !== null) {
        return;
      }
      const schedule = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
      frameId = schedule(() => {
        frameId = null;
        if (active) {
          setMeasurementRevision((revision) => revision + 1);
        }
      });
    };

    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(requestMeasurement) : null;
    observer?.observe(measureRoot);
    if (typeof document !== "undefined" && document.fonts) {
      void document.fonts.ready.then(requestMeasurement);
    }

    return () => {
      active = false;
      observer?.disconnect();
      if (frameId !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame?.(frameId);
        window.clearTimeout(frameId);
      }
    };
  }, [contentKey, layoutKey]);

  useLayoutEffect(() => {
    const measureRoot = measureRef.current;
    if (!measureRoot) {
      return;
    }

    const measurements = measurePrintContentUnits(measureRoot, printContent);
    const heights = measurements.map((measurement) => measurement.height);
    const flowHeights = measurements.map((measurement) => measurement.flowHeight);
    const nestedRects = measurements.map((measurement) => measurement.descendantRects);
    const measuredDescendantHeights = getMeasuredDescendantHeightMap(nestedRects);
    const measuredBlockBreakOffsets = new Map(
      printContent.map((unit, index) => [unit.id, measurements[index]?.breakOffsets ?? []]),
    );
    const nextPages = paginateMeasuredPrintBlocks(
      printContent,
      heights,
      flowHeights,
      metrics.flow.columnCount,
      metrics.content.heightPx,
      0,
      measuredDescendantHeights,
      metrics.flow.columnGapMm,
      measuredBlockBreakOffsets,
    );
    const nextBlockRects = getMeasuredPrintBlockRects(
      nextPages,
      printContent,
      heights,
      flowHeights,
      metrics.margins.topPx,
      metrics.margins.leftPx,
      metrics.flow.columnWidthPx,
      metrics.flow.columnGapPx,
      pageStride,
      0,
      nestedRects,
      measuredDescendantHeights,
    );

    setMeasurement((current) => (
      current?.key === measurementKey &&
      sameBlockRectMap(current.blockRects, nextBlockRects) &&
      samePrintPagination(current.pages, nextPages)
        ? current
        : { key: measurementKey, pages: nextPages, blockRects: nextBlockRects }
    ));
  }, [
    contentKey,
    layoutKey,
    measurementKey,
    measurementRevision,
    metrics.content.heightPx,
    metrics.flow.columnCount,
    metrics.flow.columnGapPx,
    metrics.flow.columnGapMm,
    metrics.flow.columnWidthPx,
    metrics.margins.leftPx,
    metrics.margins.topPx,
    pageStride,
    printContent,
  ]);

  return (
    <MathEnvironmentValueProvider environment={mathEnvironment}>
    <article
      ref={stackRef}
      className={["print-page-stack", `layout-${displayMode}`, stackClassName].filter(Boolean).join(" ")}
      data-print-preview-layout={displayMode}
      data-print-preview-max-pages={typeof maxPages === "number" ? String(maxPages) : undefined}
      data-print-preview-page-count={String(pages.length)}
      style={pageStyle}
    >
      {includePrintPageStyle ? (
        <style>{`@media print { @page { size: ${metrics.page.widthMm}mm ${metrics.page.heightMm}mm; margin: 0; } }`}</style>
      ) : null}
      {renderedPages.map((page) => {
        const backgroundSvg = resolvedOverlay?.overlaySnapshot
          ? exportOverlaySvg(resolvedOverlay.overlaySnapshot.shapes, resolvedOverlay.overlaySnapshot.assets, {
              width: metrics.page.widthPx,
              height: metrics.page.heightPx,
              offsetY: (page.number - 1) * pageStride,
            }, { mathEnvironment, stackLayer: "background", viewportPaddingPx: 0 })
          : undefined;
        const foregroundSvg = resolvedOverlay?.overlaySnapshot
          ? exportOverlaySvg(resolvedOverlay.overlaySnapshot.shapes, resolvedOverlay.overlaySnapshot.assets, {
              width: metrics.page.widthPx,
              height: metrics.page.heightPx,
              offsetY: (page.number - 1) * pageStride,
            }, { mathEnvironment, stackLayer: "foreground", viewportPaddingPx: 0 })
          : undefined;

        const pageNode = (
          <section
            key={page.id}
            className="print-a4-page"
            style={pageStyle}
          >
            <PageRunningRegionView
              region={layout.header}
              kind="header"
              title={printable.metadata.title}
              pageNumber={page.number}
              totalPages={pages.length}
              metrics={metrics}
              mathFractionSizing={mathFractionSizing}
            />
            <PageRunningRegionView
              region={layout.footer}
              kind="footer"
              title={printable.metadata.title}
              pageNumber={page.number}
              totalPages={pages.length}
              metrics={metrics}
              mathFractionSizing={mathFractionSizing}
            />
            {backgroundSvg && (
              <div
                className="print-page-overlay-layer background"
                dangerouslySetInnerHTML={{ __html: backgroundSvg }}
              />
            )}
              <div className="print-page-content-layer">
                {getPageFullSpanBlocks(page).map((unit, index) => (
                  <div className="print-page-full-span-block" key={`${page.id}-full-${unit.id}-${index}`}>
                    <PrintBlock unit={unit} columnGapMm={metrics.flow.columnGapMm} mathFractionSizing={mathFractionSizing} />
                  </div>
                ))}
                <div className="print-page-columns">
                  {page.columns.map((column) => (
                    <div className="print-page-column" key={`${page.id}-${column.id}`}>
                    {getColumnFlowBlocks(column).map((unit, index) => (
                      <PrintBlock
                        key={`${unit.id}-${index}`}
                        unit={unit}
                        columnGapMm={metrics.flow.columnGapMm}
                        mathFractionSizing={mathFractionSizing}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            {foregroundSvg && (
              <div
                className="print-page-overlay-layer foreground"
                dangerouslySetInnerHTML={{ __html: foregroundSvg }}
              />
            )}
          </section>
        );

        return renderPageFrame
          ? renderPageFrame({ page, totalPages: pages.length, pageNode })
          : pageNode;
      })}
      <div className="print-measure-layer" ref={measureRef} style={pageStyle} aria-hidden="true">
        <div className="print-measure-column">
          {printContent.map((unit, index) => (
            <div
              data-print-measure-index={index}
              key={`${unit.id}-${index}`}
              style={isFullSpanPrintUnit(unit) ? { width: "var(--print-measure-content-width)" } : undefined}
            >
              <PrintBlock unit={unit} columnGapMm={metrics.flow.columnGapMm} mathFractionSizing={mathFractionSizing} />
            </div>
          ))}
        </div>
      </div>
    </article>
    </MathEnvironmentValueProvider>
  );
}

function buildPrintContent(content: SigmaBlock[]): PrintContentUnit[] {
  const problemNumbers = getProblemNumberMap(content);

  return content.flatMap((block): PrintContentUnit[] => {
    if (block.type !== "problem") {
      return [{
        type: "block",
        id: block.id,
        block,
        pagination: block.pagination,
      }];
    }

    const problemNumber = problemNumbers.get(block.id);
    const areas = PROBLEM_AREA_ORDER
      .map((area) => ({
        area,
        blocks: block[area],
        minHeightMm: block.areaLayout?.[area]?.minHeightMm,
        columnSpan: block.areaLayout?.[area]?.columnSpan,
      }))
      .filter(({ area, blocks, minHeightMm }) => (
        area === "lead"
          ? typeof problemNumber === "number" || blocks.length > 0 || Boolean(minHeightMm)
          : area === "prompt" || blocks.length > 0 || Boolean(minHeightMm)
      ));
    const frameAreas = areas.filter(({ area }) => isProblemFrameArea(area));
    const firstFrameArea = frameAreas[0]?.area;
    const lastFrameArea = frameAreas.at(-1)?.area;

    return areas.map((areaUnit, index): PrintContentUnit => ({
      type: "problemArea",
      id: `${block.id}:${areaUnit.area}`,
      problemId: block.id,
      area: areaUnit.area,
      blocks: areaUnit.blocks,
      minHeightMm: areaUnit.minHeightMm,
      problemNumber,
      numberFontSize: getProblemNumberFontSize(block),
      hasFrame: block.frame?.enabled === true && isProblemFrameArea(areaUnit.area),
      frameStyleId: block.frame?.enabled === true && isProblemFrameArea(areaUnit.area)
        ? getProblemFrameStyleId(block)
        : undefined,
      isFirstProblemArea: index === 0,
      isLastProblemArea: index === areas.length - 1,
      isFirstProblemFrameArea: areaUnit.area === firstFrameArea,
      isLastProblemFrameArea: areaUnit.area === lastFrameArea,
      columnSpan: areaUnit.columnSpan,
      pagination: paginationForProblemArea(block.pagination, index, areas.length),
    }));
  });
}

function paginationForProblemArea(
  pagination: PaginationHints | undefined,
  index: number,
  areaCount: number,
): PaginationHints | undefined {
  if (!pagination) {
    return undefined;
  }

  const next = { ...pagination };
  if (index > 0) {
    delete next.break;
  }
  if (index < areaCount - 1) {
    delete next.keepWithNext;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function isProblemFrameArea(area: ProblemAreaKind): boolean {
  return area === "prompt";
}

/** Delegates to the shared predicate in features/rendering/core; see isProblemAreaColumnBlockFlowEligible in page-canvas/render-units.ts for the editor mirror. */
function isFlowableProblemArea(
  unit: PrintContentUnit,
): boolean {
  return unit.type === "problemArea" && isProblemAreaFlowEligible({
    isFullSpan: unit.columnSpan === "full",
    isFramedArea: unit.hasFrame,
    blocks: unit.blocks,
  });
}

function estimatePrintContentUnitHeight(unit: PrintContentUnit): number {
  if (unit.type === "block") {
    return estimateBlockHeightPx(unit.block);
  }

  if (unit.type === "boxFragment") {
    return unit.estimatedHeightPx;
  }

  if (unit.type === "layoutSectionFragment") {
    return unit.estimatedHeightPx;
  }

  if (unit.type === "blockSlice") {
    return unit.sliceHeight;
  }

  if (unit.type === "problemAreaFragment") {
    return unit.estimatedHeightPx;
  }

  return Math.max(
    unit.blocks.reduce((height, block) => height + estimateBlockHeightPx(block), 0),
    (unit.minHeightMm ?? 0) * MM_TO_PX,
  );
}

/** Exported for `PrintPreview.test.tsx`: 紙面のページ割りを DOM 抜きで固定するため。 */
export function paginateMeasuredPrintBlocks(
  blocks: PrintContentUnit[],
  heights: number[],
  flowHeights: number[],
  columnCount: number,
  contentHeightPx: number,
  firstPageHeaderHeightPx: number,
  measuredDescendantHeights: Map<string, number>,
  defaultColumnGapMm: number,
  measuredBlockBreakOffsets: Map<string, number[]> = new Map(),
): PrintPaginatedPage[] {
  const pages: PrintPaginatedPage[] = [];
  let pageNumber = 1;
  let columns = createEmptyPrintPage(pageNumber, columnCount).columns;
  let columnIndex = 0;

  const pageHasContent = () => columns.some((column) => column.blocks.length > 0);
  const pageHasColumnContent = () => columns.some((column) => column.blocks.some((block) => !isFullSpanPrintUnit(block)));
  const currentColumn = () => columns[columnIndex];
  const currentColumnHeight = () => Math.max(0, contentHeightPx - (pageNumber === 1 ? firstPageHeaderHeightPx : 0));
  const flushPage = (force = false) => {
    if (!force && !pageHasContent()) {
      return;
    }

    pages.push({
      id: `page_${pageNumber}`,
      number: pageNumber,
      blocks: columns.flatMap((column) => column.blocks),
      columns,
      estimatedContentHeightPx: columns.reduce((height, column) => height + column.estimatedContentHeightPx, 0),
      oversizedBlockIds: columns.flatMap((column) => column.oversizedBlockIds),
    });
    pageNumber += 1;
    columns = createEmptyPrintPage(pageNumber, columnCount).columns;
    columnIndex = 0;
  };
  const advanceColumn = () => {
    if (columnIndex < columnCount - 1) {
      columnIndex += 1;
      return;
    }

    flushPage();
  };
  const advanceForExplicitBreak = () => {
    advanceColumn();
  };
  const columnHasFlowContent = (column: PrintPaginatedColumn) => column.blocks.some((unit) => !isFullSpanPrintUnit(unit));
  const currentColumnRemainingHeight = () => Math.max(0, currentColumnHeight() - currentColumn().estimatedContentHeightPx);
  const placeFlowUnit = (unit: PrintContentUnit, height: number, flowHeight = height) => {
    const column = currentColumn();
    column.blocks.push(unit);
    column.estimatedContentHeightPx += Math.max(height, flowHeight);
    if (height > currentColumnHeight()) {
      column.oversizedBlockIds.push(unit.id);
    }
  };
  const keepProblemAreasTogetherIfPossible = (index: number) => {
    const unit = blocks[index];
    if (isFlowableProblemArea(unit)) {
      return;
    }

    if (unit.type !== "problemArea" || !unit.isFirstProblemArea || !columnHasFlowContent(currentColumn())) {
      return;
    }

    let groupHeight = 0;
    for (let groupIndex = index; groupIndex < blocks.length; groupIndex += 1) {
      const candidate = blocks[groupIndex];
      if (candidate.type !== "problemArea" || candidate.problemId !== unit.problemId) {
        break;
      }
      if (isFullSpanPrintUnit(candidate) || (groupIndex > index && candidate.pagination?.break === true)) {
        return;
      }
      groupHeight += Math.max(heights[groupIndex] || 0, flowHeights[groupIndex] ?? 0);
    }

    const nextColumnHeight = columnIndex < columnCount - 1 ? currentColumnHeight() : contentHeightPx;
    if (groupHeight > currentColumnRemainingHeight() + 0.5 && groupHeight <= nextColumnHeight + 0.5) {
      advanceColumn();
    }
  };
  const keepWithNextIfPossible = (index: number) => {
    const unit = blocks[index];
    const next = blocks[index + 1];
    if (
      unit.pagination?.keepWithNext !== true
      || !next
      || next.pagination?.break === true
      || isFullSpanPrintUnit(unit)
      || isFullSpanPrintUnit(next)
    ) {
      return;
    }

    const groupHeight = Math.max(heights[index] || 0, flowHeights[index] ?? 0)
      + Math.max(heights[index + 1] || 0, flowHeights[index + 1] ?? 0);
    const nextColumnHeight = columnIndex < columnCount - 1 ? currentColumnHeight() : contentHeightPx;
    if (
      columnHasFlowContent(currentColumn())
      && groupHeight > currentColumnRemainingHeight() + 0.5
      && groupHeight <= nextColumnHeight + 0.5
    ) {
      advanceColumn();
    }
  };
  const placeBreakableBox = (
    unit: Extract<PrintContentUnit, { type: "block" }>,
    totalHeight: number,
  ): boolean => {
    const boxBlock = unit.block;
    // Break the box whenever it does not fit the space remaining in the current
    // column (not only when it is taller than a whole column): a box flows like
    // body text, filling the rest of the current column/page and continuing,
    // open-edged, on the next.
    if (boxBlock.type !== "boxBlock" || boxBlock.blocks.length === 0) {
      return false;
    }

    if (totalHeight <= currentColumnRemainingHeight() + 0.5) {
      return false;
    }

    const nextColumnHeight = columnIndex < columnCount - 1 ? currentColumnHeight() : contentHeightPx;
    if (
      boxBlock.pagination?.keepTogether === true
      && columnHasFlowContent(currentColumn())
      && totalHeight <= nextColumnHeight + 0.5
    ) {
      advanceColumn();
      if (totalHeight <= currentColumnRemainingHeight() + 0.5) {
        return false;
      }
    }

    const fragments: Array<Extract<PrintContentUnit, { type: "boxFragment" }>> = [];
    const fragmentChromeHeight = estimatePrintBoxFragmentChromeHeight(boxBlock);
    const childHeights = boxBlock.blocks.map((child) => getMeasuredOrEstimatedBlockHeight(child, measuredDescendantHeights));
    let childIndex = 0;
    let fragmentIndex = 0;

    while (childIndex < boxBlock.blocks.length) {
      if (columnHasFlowContent(currentColumn()) && currentColumnRemainingHeight() < Math.min(72, currentColumnHeight() * 0.22)) {
        advanceColumn();
      }
      const nextChildHeight = childHeights[childIndex] ?? 0;
      if (
        columnHasFlowContent(currentColumn()) &&
        fragmentChromeHeight + nextChildHeight > currentColumnRemainingHeight() + 0.5 &&
        fragmentChromeHeight + nextChildHeight <= currentColumnHeight() + 0.5
      ) {
        advanceColumn();
      }

      const fragmentBlocks: BoxBlockChildBlock[] = [];
      let fragmentHeight = fragmentChromeHeight;

      while (childIndex < boxBlock.blocks.length) {
        const childHeight = childHeights[childIndex] ?? 0;
        const wouldFit = fragmentBlocks.length === 0 ||
          fragmentHeight + childHeight <= Math.max(fragmentChromeHeight + childHeight, currentColumnRemainingHeight() + 0.5);
        if (!wouldFit) {
          break;
        }

        fragmentBlocks.push(boxBlock.blocks[childIndex]);
        fragmentHeight += childHeight;
        childIndex += 1;

        if (fragmentHeight >= currentColumnRemainingHeight() - 0.5) {
          break;
        }
      }

      if (fragmentBlocks.length === 0) {
        fragmentBlocks.push(boxBlock.blocks[childIndex]);
        fragmentHeight += childHeights[childIndex] ?? 0;
        childIndex += 1;
      }

      const fragment: Extract<PrintContentUnit, { type: "boxFragment" }> = {
        type: "boxFragment",
        id: `${boxBlock.id}:fragment:${fragmentIndex}`,
        sourceId: boxBlock.id,
        block: boxBlock,
        blocks: fragmentBlocks,
        fragmentRole: "middle",
        estimatedHeightPx: fragmentHeight,
        totalHeight,
        includeTitle: fragmentIndex === 0,
        pagination: fragmentIndex === 0 ? unit.pagination : undefined,
      };
      fragments.push(fragment);
      placeFlowUnit(fragment, fragmentHeight);
      fragmentIndex += 1;

      if (childIndex < boxBlock.blocks.length) {
        advanceColumn();
      }
    }

    fragments.forEach((fragment, index) => {
      fragment.fragmentRole = fragments.length === 1
        ? "single"
        : index === 0
          ? "first"
          : index === fragments.length - 1
            ? "last"
            : "middle";
    });

    return true;
  };
  const placeOverTallBlock = (
    unit: Extract<PrintContentUnit, { type: "block" }>,
    totalHeight: number,
  ): void => {
    const breakOffsets = getBlockSliceBreakOffsets(
      unit.block,
      totalHeight,
      measuredDescendantHeights,
      measuredBlockBreakOffsets.get(unit.id),
    );
    const slices: Array<Extract<PrintContentUnit, { type: "blockSlice" }>> = [];
    let sliceTop = 0;
    let sliceIndex = 0;

    for (let guard = 0; sliceTop < totalHeight - 0.5 && guard < Math.ceil(totalHeight) + 2; guard += 1) {
      // Don't start a slice on the last sliver of a column — continue on the next one.
      if (columnHasFlowContent(currentColumn()) && currentColumnRemainingHeight() < Math.min(48, currentColumnHeight() * 0.2)) {
        advanceColumn();
      }
      const available = Math.max(1, currentColumnRemainingHeight());
      const remaining = totalHeight - sliceTop;
      const step = resolveFlowFragmentStep({
        available,
        breakOffsets,
        fullSegmentHeight: currentColumnHeight(),
        remaining,
        sourceOffsetY: sliceTop,
      });
      if (step.advanceToNextSegment) {
        advanceColumn();
        continue;
      }
      const sliceHeight = step.height;

      const slice: Extract<PrintContentUnit, { type: "blockSlice" }> = {
        type: "blockSlice",
        id: `${unit.id}:slice:${sliceIndex}`,
        sourceId: unit.id,
        block: unit.block,
        sliceTop,
        sliceHeight,
        totalHeight,
        fragmentRole: "middle",
        pagination: sliceIndex === 0 ? unit.pagination : undefined,
      };
      slices.push(slice);
      placeFlowUnit(slice, sliceHeight);
      sliceTop += sliceHeight;
      sliceIndex += 1;

      if (sliceTop < totalHeight - 0.5) {
        advanceColumn();
      }
    }

    slices.forEach((slice, index) => {
      slice.fragmentRole = slices.length === 1
        ? "single"
        : index === 0
          ? "first"
          : index === slices.length - 1
            ? "last"
            : "middle";
    });

  };
  const placeFlowableProblemArea = (
    unit: Extract<PrintContentUnit, { type: "problemArea" }>,
  ): boolean => {
    if (!isFlowableProblemArea(unit) || unit.blocks.length === 0) {
      return false;
    }

    // A full-span area has no "next column" to flow into — its only unit of
    // movement is a whole page, and every column must reserve the same height for
    // it (mirroring the atomic full-span placement above). A framed (non-full-span)
    // area behaves exactly like an ordinary flowable area otherwise.
    const isFullSpanFlow = unit.columnSpan === "full";
    const advanceAreaFlow = () => {
      if (isFullSpanFlow) {
        flushPage();
      } else {
        advanceColumn();
      }
    };

    // Each framed fragment draws its own border+padding around its blocks, so its box is
    // taller than the sum of their heights. Reserve that up front — the same thing
    // estimatePrintBoxFragmentChromeHeight does for box fragments — or a fragment overflows
    // the column bottom by its chrome.
    const framePadding = getPrintProblemFrameChromePaddingMm(unit.frameStyleId);
    const frameChromeHeightPx = unit.hasFrame ? framePadding.y * 2 * MM_TO_PX : 0;

    const startColumn = currentColumn();
    const startHeight = startColumn.estimatedContentHeightPx;
    const fragments: Array<Extract<PrintContentUnit, { type: "problemAreaFragment" }>> = [];
    const fragmentColumns: PrintPaginatedColumn[] = [];
    let runBlocks: ProblemAreaBlock[] = [];
    let runHeight = frameChromeHeightPx;
    let emittedSliceContentBeforeFirstFragment = false;

    const placeFragment = (fragmentBlocks: ProblemAreaBlock[], fragmentHeight: number) => {
      const fragmentIndex = fragments.length;
      const fragment: Extract<PrintContentUnit, { type: "problemAreaFragment" }> = {
        type: "problemAreaFragment",
        id: `${unit.id}:area-fragment:${fragmentIndex}`,
        sourceId: unit.id,
        problemId: unit.problemId,
        area: unit.area,
        blocks: fragmentBlocks,
        fragmentRole: "middle",
        estimatedHeightPx: fragmentHeight,
        minHeightMm: unit.minHeightMm,
        problemNumber: unit.problemNumber,
        numberFontSize: unit.numberFontSize,
        hasFrame: unit.hasFrame,
        frameStyleId: unit.frameStyleId,
        columnSpan: unit.columnSpan,
        isFirstProblemArea: unit.isFirstProblemArea,
        isLastProblemArea: unit.isLastProblemArea,
        pagination: fragmentIndex === 0 ? unit.pagination : undefined,
      };
      fragments.push(fragment);
      if (isFullSpanFlow) {
        if (pageHasColumnContent()) {
          flushPage();
        }
        if (pageHasContent() && currentColumn().estimatedContentHeightPx + fragmentHeight > currentColumnHeight() + 0.5) {
          flushPage();
        }
        columns[0].blocks.push(fragment);
        for (const column of columns) {
          column.estimatedContentHeightPx += fragmentHeight;
        }
        fragmentColumns.push(columns[0]);
      } else {
        fragmentColumns.push(currentColumn());
        placeFlowUnit(fragment, fragmentHeight);
      }
    };
    const flushRun = () => {
      if (runBlocks.length === 0) {
        return;
      }

      placeFragment(runBlocks, runHeight);
      runBlocks = [];
      runHeight = frameChromeHeightPx;
    };

    for (const [childIndex, child] of unit.blocks.entries()) {
      if (child.pagination?.break === true) {
        // "Is there content to break away from?" must count this area's own pending
        // run and already-emitted fragments, not just the shared column state: the
        // run has not reached the column yet, and a full-span fragment is
        // deliberately excluded from columnHasFlowContent (it is not "column flow"
        // content). Without those two, a break on the second block of an area that
        // starts a fresh column would emit two fragments into the SAME column —
        // drawing an open frame across a break that moved nothing.
        const hasContentBeforeBreak = fragments.length > 0
          || runBlocks.length > 0
          || (!isFullSpanFlow && (columnHasFlowContent(currentColumn()) || columnIndex > 0));
        flushRun();
        if (hasContentBeforeBreak) {
          advanceAreaFlow();
        }
      }

      const childHeight = getMeasuredOrEstimatedBlockHeight(child, measuredDescendantHeights);
      const nextChild = unit.blocks[childIndex + 1];
      const keepWithNextHeight = child.pagination?.keepWithNext === true
        && nextChild
        && nextChild.pagination?.break !== true
        ? childHeight + getMeasuredOrEstimatedBlockHeight(nextChild, measuredDescendantHeights)
        : 0;
      const pendingHeight = runHeight + keepWithNextHeight;
      if (
        (columnHasFlowContent(currentColumn()) || runBlocks.length > 0)
        && keepWithNextHeight > 0
        && pendingHeight > currentColumnRemainingHeight() + 0.5
        && keepWithNextHeight + frameChromeHeightPx <= contentHeightPx + 0.5
      ) {
        flushRun();
        advanceAreaFlow();
      }
      if (child.type === "layoutSection") {
        flushRun();
        const sectionFragmentHeight = childHeight + frameChromeHeightPx;
        if (
          sectionFragmentHeight > currentColumnRemainingHeight() + 0.5 &&
          sectionFragmentHeight <= contentHeightPx + 0.5
        ) {
          advanceAreaFlow();
        }
        placeFragment([child], sectionFragmentHeight);
        continue;
      }

      if (childHeight > contentHeightPx + 0.5) {
        flushRun();
        if (fragments.length === 0) {
          emittedSliceContentBeforeFirstFragment = true;
        }
        placeOverTallBlock({
          type: "block",
          id: child.id,
          block: child,
          pagination: child.pagination,
        }, childHeight);
        continue;
      }

      const remainingAfterRun = Math.max(0, currentColumnRemainingHeight() - runHeight);
      if (
        (columnHasFlowContent(currentColumn()) || runBlocks.length > 0) &&
        childHeight > remainingAfterRun + 0.5 &&
        childHeight + frameChromeHeightPx <= contentHeightPx + 0.5
      ) {
        flushRun();
        advanceAreaFlow();
      }

      runBlocks.push(child);
      runHeight += childHeight;

    }

    flushRun();
    fragments.forEach((fragment, index) => {
      fragment.fragmentRole = emittedSliceContentBeforeFirstFragment
        ? index === fragments.length - 1
          ? "last"
          : "middle"
        : fragments.length === 1
          ? "single"
          : index === 0
            ? "first"
            : index === fragments.length - 1
              ? "last"
              : "middle";
    });

    if (
      (unit.minHeightMm ?? 0) > 0 &&
      fragments.length > 0 &&
      fragmentColumns.every((column) => column === startColumn) &&
      currentColumn() === startColumn
    ) {
      startColumn.estimatedContentHeightPx = Math.max(
        startColumn.estimatedContentHeightPx,
        startHeight + (unit.minHeightMm ?? 0) * MM_TO_PX,
      );
    }

    return true;
  };
  const placeBreakableLayoutSection = (
    unit: Extract<PrintContentUnit, { type: "block" }>,
    totalHeight: number,
  ): boolean => {
    const layoutSection = unit.block;
    if (layoutSection.type !== "layoutSection" || layoutSection.children.length === 0) {
      return false;
    }

    if (
      layoutSection.pagination?.keepTogether === true
      && columnHasFlowContent(currentColumn())
      && totalHeight > currentColumnRemainingHeight() + 0.5
      && totalHeight <= currentColumnHeight() + 0.5
    ) {
      advanceColumn();
      return false;
    }

    const containsBoxBlock = layoutSection.children.some((child) => child.type === "boxBlock");
    // A section that already fits a column normally stays atomic — re-paginating it would
    // be pointless work. But a manual break on one of its children only takes effect on
    // this path (child units reach `advanceForExplicitBreak` in the main loop), and the
    // editor always enters flow mode for one (`hasManualColumnBreak` in
    // problem-area-column-flow.ts), so a fitting section with an explicit break must be
    // re-paginated here too or the PDF would ignore a break the editor honors.
    const childBreak = hasManualBreakInside(layoutSection.children);
    if (!containsBoxBlock && !childBreak && totalHeight <= currentColumnHeight() + 0.5) {
      return false;
    }

    const sectionColumnCount = getPrintLayoutSectionColumnCount(layoutSection.layout.columnCount);
    const layoutColumnGapMm = defaultColumnGapMm;
    const sectionUnits = layoutSection.children.map((child): PrintContentUnit => ({
      type: "block",
      id: child.id,
      block: child,
      pagination: child.pagination,
    }));
    const sectionHeights = layoutSection.children.map((child) => (
      getMeasuredOrEstimatedBlockHeight(child, measuredDescendantHeights, Math.max(12, Math.floor(54 / sectionColumnCount)))
    ));
    const sectionPages = paginateMeasuredPrintBlocks(
      sectionUnits,
      sectionHeights,
      sectionHeights,
      sectionColumnCount,
      currentColumnHeight(),
      0,
      measuredDescendantHeights,
      layoutColumnGapMm,
    );
    const fragments = sectionPages.map((sectionPage, fragmentIndex): Extract<PrintContentUnit, { type: "layoutSectionFragment" }> => ({
      type: "layoutSectionFragment",
      id: `${layoutSection.id}:layout-fragment:${fragmentIndex}`,
      sourceId: layoutSection.id,
      block: layoutSection,
      columns: sectionPage.columns,
      fragmentRole: "middle",
      estimatedHeightPx: Math.max(
        32,
        ...sectionPage.columns.map((column) => column.estimatedContentHeightPx),
      ),
      columnGapMm: layoutColumnGapMm,
      pagination: fragmentIndex === 0 ? unit.pagination : undefined,
    }));

    fragments.forEach((fragment, index) => {
      fragment.fragmentRole = fragments.length === 1
        ? "single"
        : index === 0
          ? "first"
          : index === fragments.length - 1
            ? "last"
            : "middle";

      if (
        columnHasFlowContent(currentColumn()) &&
        currentColumn().estimatedContentHeightPx + fragment.estimatedHeightPx > currentColumnHeight() + 0.5
      ) {
        advanceColumn();
      }

      placeFlowUnit(fragment, fragment.estimatedHeightPx);
      if (index < fragments.length - 1) {
        advanceColumn();
      }
    });

    return true;
  };

  blocks.forEach((block, index) => {
    const blockHeight = heights[index] || 0;
    const blockFlowHeight = flowHeights[index] ?? blockHeight;
    // 実測 (と推定) の高さにはブロック下余白 (padding) が入っている。**収まり判定からは除き、
    // カーソル前進には含める** — 本文フローの `PaginationItem.trailingSpacePx` と同じ規約。
    // ここを揃えないと、同じ文書でエディタ/PDF は 1 ページ目に残すブロックを、印刷プレビューと
    // 埋め込みビューアだけ次ページへ送る。
    const blockFitHeight = Math.max(
      0,
      blockHeight - (block.type === "block" ? blockSpaceAfterPx(block.block) : 0),
    );
    if (pageHasContent() && block.pagination?.break === true) {
      advanceForExplicitBreak();
    }

    keepWithNextIfPossible(index);
    keepProblemAreasTogetherIfPossible(index);

    // A flowable problem area (ordinary, or framed/full-span with a manual break
    // inside — see isFlowableProblemArea) is handled entirely by its own fragment
    // placer, including full-span fragments (placeFlowableProblemArea reserves
    // height across all columns for those). Only an ATOMIC full-span area falls
    // through to the whole-unit full-span placement below.
    if (block.type === "problemArea" && placeFlowableProblemArea(block)) {
      return;
    }

    if (isFullSpanPrintUnit(block)) {
      if (pageHasColumnContent()) {
        flushPage();
      }

      if (pageHasContent() && currentColumn().estimatedContentHeightPx + blockFitHeight > currentColumnHeight()) {
        flushPage();
      }

      columns[0].blocks.push(block);
      for (const column of columns) {
        column.estimatedContentHeightPx += Math.max(blockHeight, blockFlowHeight);
        if (blockHeight > currentColumnHeight()) {
          column.oversizedBlockIds.push(block.id);
        }
      }

      return;
    }

    const isBreakableBox = block.type === "block"
      && block.block.type === "boxBlock"
      && block.block.blocks.length > 0;

    // Atomic content taller than a whole column cannot be split at a child boundary,
    // so it must be pixel-sliced: a standalone over-tall block, or a box whose own
    // child is taller than a column (which child-boundary splitting can't rescue).
    // Compare against the full column height (not the header-reduced first page) so a
    // block that fits a full column is moved, not sliced.
    const mustSlice = block.type === "block" && (
      block.block.type === "boxBlock"
        ? boxHasOverTallChild(block.block, contentHeightPx, measuredDescendantHeights)
        : block.block.type !== "layoutSection" && blockFitHeight > contentHeightPx + 0.5
    );

    if (isBreakableBox || mustSlice) {
      // Flows like body text: it fills the rest of the current column/page and
      // continues, open-edged, on the next. The placer advances columns itself, so
      // we must NOT push the whole block to a fresh page/column here — that would
      // waste the rest of this page.
    } else if (blockFitHeight > currentColumnHeight() + 0.5 && pageHasContent()) {
      flushPage();
    } else if (
      columnHasFlowContent(currentColumn()) &&
      currentColumn().estimatedContentHeightPx + blockFitHeight > currentColumnHeight()
    ) {
      advanceColumn();
    } else if (
      !columnHasFlowContent(currentColumn()) &&
      currentColumn().estimatedContentHeightPx > 0.5 &&
      currentColumn().estimatedContentHeightPx + blockFitHeight > currentColumnHeight()
    ) {
      flushPage();
    }

    if (mustSlice && block.type === "block") {
      placeOverTallBlock(block, blockHeight);
      return;
    }

    if (block.type === "block" && placeBreakableBox(block, blockHeight)) {
      return;
    }

    if (block.type === "block" && placeBreakableLayoutSection(block, blockHeight)) {
      return;
    }

    placeFlowUnit(block, blockHeight, blockFlowHeight);

  });

  flushPage();
  return pages.length > 0 ? pages : [createEmptyPrintPage(1, columnCount)];
}

function estimatePrintBoxFragmentChromeHeight(block: Extract<SigmaBlock, { type: "boxBlock" }>): number {
  const frame = resolveBoxFrame(block);
  const padding = frame.paddingPx ?? { top: 12, right: 14, bottom: 12, left: 14 };
  const title = boxBlockTitleText(block);
  const titleHeight = title ? 24 : 0;
  return padding.top + padding.bottom + titleHeight;
}

/**
 * True when a box has a single child too tall to ever fit a full column, so it
 * cannot be split cleanly at child boundaries — the whole box must be split
 * visually (pixel-sliced) instead.
 */
function boxHasOverTallChild(
  block: Extract<SigmaBlock, { type: "boxBlock" }>,
  columnHeightPx: number,
  measuredDescendantHeights: Map<string, number>,
): boolean {
  const chrome = estimatePrintBoxFragmentChromeHeight(block);
  return block.blocks.some(
    (child) => chrome + getMeasuredOrEstimatedBlockHeight(child, measuredDescendantHeights) > columnHeightPx + 0.5,
  );
}

/**
 * Break offsets (px from the block top) at which a visual slice can end without
 * cutting through structured content. Child-block bottoms remain valid box
 * boundaries; measured visual-line boundaries additionally cover one very long
 * child. This uses the same line-safe contract as the page canvas.
 */
function getBlockSliceBreakOffsets(
  block: SigmaBlock,
  totalHeight: number,
  measuredDescendantHeights: Map<string, number>,
  measuredBreakOffsets?: number[],
): number[] {
  if (block.type !== "boxBlock") {
    return measuredBreakOffsets ?? [];
  }
  const frame = resolveBoxFrame(block);
  const padding = frame.paddingPx ?? { top: 12, right: 14, bottom: 12, left: 14 };
  const title = boxBlockTitleText(block);
  let cursor = padding.top + (title ? 24 : 0);
  const offsets: number[] = [];
  for (const child of block.blocks) {
    cursor += getMeasuredOrEstimatedBlockHeight(child, measuredDescendantHeights);
    if (cursor > 0.5 && cursor < totalHeight - 0.5) {
      offsets.push(Math.round(cursor));
    }
  }
  return Array.from(new Set([...offsets, ...(measuredBreakOffsets ?? [])]))
    .filter((offset) => offset > 0.5 && offset < totalHeight - 0.5)
    .sort((left, right) => left - right);
}

function getMeasuredOrEstimatedBlockHeight(
  block: SigmaBlock | RichBlock,
  measuredDescendantHeights: Map<string, number>,
  charsPerLine?: number,
): number {
  return measuredDescendantHeights.get(block.id) ?? estimateBlockHeightPx(block, charsPerLine);
}

function getMeasuredDescendantHeightMap(nestedRects: MeasuredBlock[][]): Map<string, number> {
  const heights = new Map<string, number>();
  nestedRects.forEach((rects) => {
    rects.forEach((rect) => {
      heights.set(rect.id, rect.height ?? 0);
    });
  });
  return heights;
}

function getMeasuredPrintBlockRects(
  pages: PrintPaginatedPage[],
  blocks: PrintContentUnit[],
  heights: number[],
  flowHeights: number[],
  marginTopPx: number,
  marginLeftPx: number,
  columnWidthPx: number,
  columnGapPx: number,
  pageStridePx: number,
  firstPageHeaderHeightPx: number,
  nestedRects: MeasuredBlock[][],
  measuredDescendantHeights: Map<string, number>,
): Map<string, MeasuredBlock> {
  const heightById = new Map(blocks.map((block, index) => [block.id, heights[index] || 0]));
  const flowHeightById = new Map(blocks.map((block, index) => [block.id, flowHeights[index] ?? heights[index] ?? 0]));
  const nestedRectsById = new Map(blocks.map((block, index) => [block.id, nestedRects[index] ?? []]));
  const rects = new Map<string, MeasuredBlock>();

  for (const page of pages) {
    const pageTop = (page.number - 1) * pageStridePx;
    const headerOffset = page.number === 1 ? firstPageHeaderHeightPx : 0;
    let fullSpanCursorY = headerOffset;
    for (const block of getPageFullSpanBlocks(page)) {
      const height = getPrintContentUnitHeight(block, heightById, measuredDescendantHeights);
      const blockRect = {
        id: block.id,
        top: pageTop + marginTopPx + fullSpanCursorY,
        left: marginLeftPx,
        width: columnWidthPx * Math.max(1, page.columns.length) + columnGapPx * Math.max(0, page.columns.length - 1),
        height,
      };
      rects.set(block.id, blockRect);

      for (const nested of nestedRectsById.get(block.id) ?? []) {
        rects.set(nested.id, translateNestedMeasuredBlock(nested, blockRect.top, blockRect.left));
      }
      fullSpanCursorY += getPrintContentUnitFlowHeight(block, heightById, flowHeightById, measuredDescendantHeights);
    }

    for (const column of page.columns) {
      const left = marginLeftPx + (column.number - 1) * (columnWidthPx + columnGapPx);
      let cursorY = fullSpanCursorY;
      for (const block of getColumnFlowBlocks(column)) {
        const height = getPrintContentUnitHeight(block, heightById, measuredDescendantHeights);
        const blockRect = {
          id: block.id,
          top: pageTop + marginTopPx + cursorY,
          left,
          width: columnWidthPx,
          height,
        };
        rects.set(block.id, blockRect);
        // Anchor the source block (e.g. for overlays) to the top of its first slice.
        if (block.type === "blockSlice" && (block.fragmentRole === "first" || block.fragmentRole === "single")) {
          rects.set(block.sourceId, { ...blockRect, id: block.sourceId, height: block.totalHeight });
        }
        if (block.type === "problemAreaFragment") {
          const sourceNestedRects = nestedRectsById.get(block.sourceId) ?? [];
          if (block.fragmentRole === "first" || block.fragmentRole === "single") {
            const sourceHeight = heightById.get(block.sourceId) ?? blockRect.height;
            rects.set(block.sourceId, {
              ...blockRect,
              id: block.sourceId,
              height: sourceHeight,
            });
            if (block.isFirstProblemArea) {
              const measuredProblemAnchor = sourceNestedRects.find((nested) => nested.id === block.problemId);
              rects.set(block.problemId, {
                ...blockRect,
                id: block.problemId,
                height: measuredProblemAnchor?.height ?? sourceHeight,
              });
            }
          }

          const fragmentBlockIds = collectProblemAreaBlockSubtreeIds(block.blocks);
          const firstBlockRect = sourceNestedRects.find((nested) => nested.id === block.blocks[0]?.id);
          const firstBlockTop = firstBlockRect?.top ?? 0;
          const showsProblemNumber = block.area === "lead" &&
            typeof block.problemNumber === "number" &&
            (block.fragmentRole === "first" || block.fragmentRole === "single");
          const sourceLeftOrigin = showsProblemNumber ? 0 : firstBlockRect?.left ?? 0;
          for (const nested of sourceNestedRects) {
            if (!fragmentBlockIds.has(nested.id)) {
              continue;
            }
            rects.set(
              nested.id,
              translateNestedMeasuredBlock(
                nested,
                blockRect.top - firstBlockTop,
                blockRect.left,
                sourceLeftOrigin,
              ),
            );
          }
        } else {
          for (const nested of nestedRectsById.get(block.id) ?? []) {
            rects.set(nested.id, translateNestedMeasuredBlock(nested, blockRect.top, blockRect.left));
          }
        }
        cursorY += getPrintContentUnitFlowHeight(block, heightById, flowHeightById, measuredDescendantHeights);
      }
    }
  }

  return rects;
}

export function translateNestedMeasuredBlock(
  rect: MeasuredBlock,
  topOffset: number,
  leftOffset: number,
  sourceLeftOrigin = 0,
): MeasuredBlock {
  return {
    ...rect,
    top: topOffset + rect.top,
    left: leftOffset + (rect.left ?? 0) - sourceLeftOrigin,
    lines: rect.lines?.map((line) => ({
      ...line,
      top: topOffset + line.top,
      left: typeof line.left === "number"
        ? leftOffset + line.left - sourceLeftOrigin
        : line.left,
    })),
  };
}

function collectProblemAreaBlockSubtreeIds(blocks: ProblemAreaBlock[]): Set<string> {
  const ids = new Set<string>();

  const visitBlock = (block: SigmaBlock) => {
    ids.add(block.id);
    if (block.type === "list") {
      for (const item of block.items) {
        ids.add(item.id);
        item.nested?.forEach(visitBlock);
      }
      return;
    }

    if (block.type === "layoutSection") {
      block.children.forEach(visitBlock);
      return;
    }

    if (block.type === "boxBlock") {
      block.blocks.forEach(visitBlock);
      return;
    }

    if (block.type === "problem") {
      block.lead.forEach(visitBlock);
      block.prompt.forEach(visitBlock);
      block.hints.forEach(visitBlock);
      block.solution.forEach(visitBlock);
    }
  };

  blocks.forEach(visitBlock);
  return ids;
}

function getPrintContentUnitHeight(
  unit: PrintContentUnit,
  heightById: Map<string, number>,
  measuredDescendantHeights: Map<string, number>,
): number {
  if (
    unit.type === "boxFragment" ||
    unit.type === "layoutSectionFragment" ||
    unit.type === "problemAreaFragment"
  ) {
    return unit.estimatedHeightPx;
  }

  if (unit.type === "blockSlice") {
    return unit.sliceHeight;
  }

  return heightById.get(unit.id) ?? measuredDescendantHeights.get(unit.id) ?? 0;
}

function getPrintContentUnitFlowHeight(
  unit: PrintContentUnit,
  heightById: Map<string, number>,
  flowHeightById: Map<string, number>,
  measuredDescendantHeights: Map<string, number>,
): number {
  if (
    unit.type === "boxFragment" ||
    unit.type === "layoutSectionFragment" ||
    unit.type === "blockSlice" ||
    unit.type === "problemAreaFragment"
  ) {
    return getPrintContentUnitHeight(unit, heightById, measuredDescendantHeights);
  }

  return Math.max(
    getPrintContentUnitHeight(unit, heightById, measuredDescendantHeights),
    flowHeightById.get(unit.id) ?? 0,
  );
}

function measurePrintContentUnits(
  measureRoot: HTMLElement,
  units: PrintContentUnit[],
): PrintContentMeasurement[] {
  const entries = units.map((unit, index) => {
    const element = measureRoot.querySelector<HTMLElement>(`[data-print-measure-index="${index}"]`);
    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    return {
      element,
      height: rect.height,
      top: rect.top,
      descendantRects: getMeasuredPrintDescendantRects(element, unit.id),
      breakOffsets: getMeasuredPrintUnitBreakOffsets(element, unit),
    };
  });

  return entries.map((entry, index) => {
    if (!entry) {
      return { height: 0, flowHeight: 0, descendantRects: [], breakOffsets: [] };
    }

    const nextEntry = entries.slice(index + 1).find(
      (candidate): candidate is NonNullable<(typeof entries)[number]> => candidate !== null,
    );
    const flowHeight = nextEntry
      ? Math.max(entry.height, nextEntry.top - entry.top)
      : measureLastPrintUnitFlowHeight(entry.element, entry.height);
    return {
      height: entry.height,
      flowHeight,
      descendantRects: entry.descendantRects,
      breakOffsets: entry.breakOffsets,
    };
  });
}

/**
 * Code blocks and every visual box style share safe break positions after each
 * rendered line, including wrapped lines. Capture those positions from the same
 * measurement DOM used for total height so print slices cannot cut through glyphs.
 */
function getMeasuredPrintUnitBreakOffsets(root: HTMLElement, unit: PrintContentUnit): number[] {
  if (
    unit.type !== "block"
    || (unit.block.type !== "codeBlock" && unit.block.type !== "boxBlock")
  ) {
    return [];
  }
  const element = root.querySelector<HTMLElement>(
    `[data-sigma-doc-id="${CSS.escape(unit.block.id)}"]`,
  );
  if (!element) {
    return [];
  }
  const rect = element.getBoundingClientRect();
  const measuredElements = unit.block.type === "boxBlock"
    ? getLeafPrintBoxBlockElements(element)
    : [element];
  return getMeasuredLineBreakOffsets(
    measuredElements.flatMap((candidate) => measureElementLineBoxes(candidate, rect, 1, 1)),
  )
    .filter((offset) => offset > 0.5 && offset < rect.height - 0.5);
}

function getLeafPrintBoxBlockElements(box: HTMLElement): HTMLElement[] {
  const descendants = Array.from(box.querySelectorAll<HTMLElement>(
    ":scope > .print-box-body [data-sigma-doc-id]",
  ));
  return descendants.filter((candidate) =>
    !descendants.some((other) => other !== candidate && candidate.contains(other)),
  );
}

function measureLastPrintUnitFlowHeight(element: HTMLElement, height: number): number {
  const marginBottom = parseCssPixelValue(getComputedStyle(element).marginBottom);
  return height + marginBottom;
}

function parseCssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFullSpanPrintUnit(unit: PrintContentUnit): boolean {
  return (unit.type === "problemArea" || unit.type === "problemAreaFragment") && unit.columnSpan === "full";
}

function getPageFullSpanBlocks(page: PrintPaginatedPage): PrintContentUnit[] {
  return page.columns[0]?.blocks.filter(isFullSpanPrintUnit) ?? [];
}

function getColumnFlowBlocks(column: PrintPaginatedColumn): PrintContentUnit[] {
  return column.blocks.filter((unit) => !isFullSpanPrintUnit(unit));
}

function getMeasuredPrintDescendantRects(root: HTMLElement, topLevelBlockId: string): MeasuredBlock[] {
  const rootRect = root.getBoundingClientRect();
  const seen = new Set<string>([topLevelBlockId]);
  const rects: MeasuredBlock[] = [];

  root.querySelectorAll<HTMLElement>("[data-sigma-doc-id]").forEach((element) => {
    const id = element.getAttribute("data-sigma-doc-id");
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    const rect = element.getBoundingClientRect();
    rects.push({
      id,
      top: rect.top - rootRect.top,
      left: rect.left - rootRect.left,
      width: rect.width,
      height: rect.height,
      lines: measureElementLineBoxes(element, rootRect, 1, 1),
    });
  });

  return rects;
}

function resolvePrintOverlay(
  overlay: PageOverlay | undefined,
  blockRects: Map<string, MeasuredBlock>,
): PageOverlay | undefined {
  if (!overlay?.overlaySnapshot) {
    return overlay;
  }

  const snapshot = normalizeOverlaySnapshot(overlay.overlaySnapshot);
  const shapes = resolveShapesPosition(snapshot.shapes, blockRects);
  return {
    ...overlay,
    overlaySnapshot: {
      ...snapshot,
      shapes,
    },
  };
}

function extendPagesForOverlay(
  pages: PrintPaginatedPage[],
  overlay: PageOverlay | undefined,
  columnCount: number,
  pageHeightPx: number,
  pageStridePx: number,
): PrintPaginatedPage[] {
  const snapshot = overlay?.overlaySnapshot ? normalizeOverlaySnapshot(overlay.overlaySnapshot) : null;
  if (!snapshot) {
    return pages;
  }

  const maxShapeBottom = snapshot.shapes.reduce((bottom, shape) => {
    if (shape.hidden) {
      return bottom;
    }

    const bounds = getShapeBounds(shape);
    return Math.max(bottom, bounds.y + bounds.h);
  }, 0);
  const overlayPageCount = maxShapeBottom > pageHeightPx + OVERLAY_PAGE_EXTENT_EPSILON_PX
    ? Math.ceil((maxShapeBottom - pageHeightPx - OVERLAY_PAGE_EXTENT_EPSILON_PX) / pageStridePx) + 1
    : 1;

  if (overlayPageCount <= pages.length) {
    return pages;
  }

  return [
    ...pages,
    ...Array.from({ length: overlayPageCount - pages.length }, (_, index) => {
      const number = pages.length + index + 1;
      return createEmptyPrintPage(number, columnCount);
    }),
  ];
}

function createEmptyPrintPage(number: number, columnCount: number): PrintPaginatedPage {
  return {
    id: `page_${number}`,
    number,
    blocks: [],
    columns: Array.from({ length: Math.max(1, columnCount) }, (_, index) => ({
      id: `column_${index + 1}`,
      number: index + 1,
      blocks: [],
      estimatedContentHeightPx: 0,
      oversizedBlockIds: [],
    })),
    estimatedContentHeightPx: 0,
    oversizedBlockIds: [],
  };
}

function samePrintPagination(current: PrintPaginatedPage[] | null, next: PrintPaginatedPage[]): boolean {
  if (!current || current.length !== next.length) {
    return false;
  }

  return current.every((page, pageIndex) => {
    const nextPage = next[pageIndex];
    return (
      page.columns.length === nextPage.columns.length &&
      page.columns.every((column, columnIndex) => {
        const nextColumn = nextPage.columns[columnIndex];
        return (
          column.blocks.length === nextColumn.blocks.length &&
          column.blocks.every((block, blockIndex) => samePrintUnitPagination(block, nextColumn.blocks[blockIndex]))
        );
      })
    );
  });
}

function samePrintUnitPagination(current: PrintContentUnit, next: PrintContentUnit): boolean {
  if (current.id !== next.id || current.type !== next.type) {
    return false;
  }

  if (current.type === "boxFragment" && next.type === "boxFragment") {
    return (
      current.fragmentRole === next.fragmentRole &&
      Math.abs(current.estimatedHeightPx - next.estimatedHeightPx) < 0.5 &&
      Math.abs(current.totalHeight - next.totalHeight) < 0.5 &&
      current.blocks.length === next.blocks.length &&
      current.blocks.every((block, index) => block.id === next.blocks[index].id)
    );
  }

  if (current.type === "layoutSectionFragment" && next.type === "layoutSectionFragment") {
    return (
      current.fragmentRole === next.fragmentRole &&
      current.columns.length === next.columns.length &&
      current.columns.every((column, columnIndex) => {
        const nextColumn = next.columns[columnIndex];
        return (
          column.blocks.length === nextColumn.blocks.length &&
          column.blocks.every((block, blockIndex) => samePrintUnitPagination(block, nextColumn.blocks[blockIndex]))
        );
      })
    );
  }

  if (current.type === "blockSlice" && next.type === "blockSlice") {
    return (
      current.fragmentRole === next.fragmentRole &&
      Math.abs(current.sliceTop - next.sliceTop) < 0.5 &&
      Math.abs(current.sliceHeight - next.sliceHeight) < 0.5
    );
  }

  if (current.type === "problemAreaFragment" && next.type === "problemAreaFragment") {
    return (
      current.fragmentRole === next.fragmentRole &&
      Math.abs(current.estimatedHeightPx - next.estimatedHeightPx) < 0.5 &&
      current.blocks.length === next.blocks.length &&
      current.blocks.every((block, index) => block.id === next.blocks[index].id)
    );
  }

  return true;
}

function sameBlockRectMap(current: Map<string, MeasuredBlock>, next: Map<string, MeasuredBlock>): boolean {
  if (current.size !== next.size) {
    return false;
  }

  for (const [id, rect] of next) {
    const currentRect = current.get(id);
    if (
      !currentRect ||
      Math.abs(currentRect.top - rect.top) > 0.5 ||
      Math.abs((currentRect.left ?? 0) - (rect.left ?? 0)) > 0.5 ||
      Math.abs((currentRect.width ?? 0) - (rect.width ?? 0)) > 0.5 ||
      Math.abs((currentRect.height ?? 0) - (rect.height ?? 0)) > 0.5
    ) {
      return false;
    }
  }

  return true;
}

function PrintBlock({
  unit,
  columnGapMm,
  mathFractionSizing,
}: {
  unit: PrintContentUnit;
  columnGapMm: number;
  mathFractionSizing?: SigmaDocument["metadata"]["mathFractionSizing"];
}) {
  if (unit.type === "problemArea") {
    return (
      <PrintProblemArea
        problemId={unit.problemId}
        area={unit.area}
        minHeightMm={unit.minHeightMm}
        problemNumber={unit.problemNumber}
        numberFontSize={unit.numberFontSize}
        hasFrame={unit.hasFrame}
        frameStyleId={unit.frameStyleId}
        isFirstProblemArea={unit.isFirstProblemArea}
        isFirstProblemFrameArea={unit.isFirstProblemFrameArea}
        isLastProblemFrameArea={unit.isLastProblemFrameArea}
        columnGapMm={columnGapMm}
        mathFractionSizing={mathFractionSizing}
        blocks={unit.blocks}
      />
    );
  }

  if (unit.type === "problemAreaFragment") {
    // A framed area only reaches this fragment path when a manual break inside it
    // forced it to flow (see isFlowableProblemArea); the frame must then render as
    // open-ended pieces across the break — the first fragment draws the top edge,
    // the last draws the bottom edge, and middle fragments draw sides only, exactly
    // like a frame spanning multiple problem areas does today.
    const isFirstFragment = unit.fragmentRole === "single" || unit.fragmentRole === "first";
    const isLastFragment = unit.fragmentRole === "single" || unit.fragmentRole === "last";
    return (
      <PrintProblemArea
        problemId={unit.problemId}
        area={unit.area}
        minHeightMm={unit.fragmentRole === "single" ? unit.minHeightMm : undefined}
        problemNumber={unit.problemNumber}
        numberFontSize={unit.numberFontSize}
        hasFrame={unit.hasFrame}
        frameStyleId={unit.frameStyleId}
        isFirstProblemArea={unit.isFirstProblemArea}
        isFirstProblemFrameArea={unit.hasFrame && isFirstFragment}
        isLastProblemFrameArea={unit.hasFrame && isLastFragment}
        columnGapMm={columnGapMm}
        mathFractionSizing={mathFractionSizing}
        blocks={unit.blocks}
        fragmentRole={unit.fragmentRole}
        sourceId={unit.sourceId}
      />
    );
  }

  if (unit.type === "boxFragment") {
    return (
      <PrintBoxBlock
        block={unit.block}
        columnGapMm={columnGapMm}
        fragmentBlocks={unit.blocks}
        fragmentRole={unit.fragmentRole}
        includeTitle={unit.includeTitle}
        cornerReferenceHeightPx={unit.totalHeight}
        mathFractionSizing={mathFractionSizing}
      />
    );
  }

  if (unit.type === "layoutSectionFragment") {
    return <PrintLayoutSectionFragment unit={unit} mathFractionSizing={mathFractionSizing} />;
  }

  if (unit.type === "blockSlice") {
    return (
      <div
        className={`print-block-slice print-block-slice-${unit.fragmentRole}`}
        data-block-slice={unit.fragmentRole}
        data-block-source-id={unit.sourceId}
        style={{ height: `${Math.round(unit.sliceHeight * 100) / 100}px`, overflow: "hidden" }}
      >
        <div
          className="print-block-slice-inner"
          style={{ marginTop: `${-Math.round(unit.sliceTop * 100) / 100}px` }}
        >
          <PrintBlock
            unit={{ type: "block", id: unit.sourceId, block: unit.block }}
            columnGapMm={columnGapMm}
            mathFractionSizing={mathFractionSizing}
          />
        </div>
      </div>
    );
  }

  const { block } = unit;

  if (block.type === "section") {
    return (
      <h1
        data-sigma-doc-id={block.id}
        className="print-section"
        style={{
          textAlign: block.align ?? "left",
          lineHeight: block.lineHeight,
          ...blockSpaceAfterStyleVars(block),
        } as CSSProperties}
      >
        {block.title}
      </h1>
    );
  }

  if (block.type === "heading") {
    return <PrintableRichBlock block={block} mathFractionSizing={mathFractionSizing} />;
  }

  if (block.type === "paragraph") {
    return <PrintableRichBlock block={block} mathFractionSizing={mathFractionSizing} />;
  }

  if (block.type === "list") {
    return <PrintableRichBlock block={block} mathFractionSizing={mathFractionSizing} />;
  }

  if (block.type === "divider" || block.type === "quote" || block.type === "codeBlock") {
    return <PrintableRichBlock block={block} mathFractionSizing={mathFractionSizing} />;
  }

  if (block.type === "boxBlock") {
    return <PrintBoxBlock block={block} columnGapMm={columnGapMm} mathFractionSizing={mathFractionSizing} />;
  }

  if (block.type === "layoutSection") {
    const columnCount = getPrintLayoutSectionColumnCount(block.layout.columnCount);
    const layoutColumnGapMm = columnGapMm;
    return (
      <section
        data-sigma-doc-id={block.id}
        className="print-layout-section"
        style={{
          "--print-layout-section-column-count": String(columnCount),
          "--print-layout-section-column-gap": `${layoutColumnGapMm}mm`,
        } as CSSProperties}
      >
        {block.children.map((child) => {
          const rendered = (
            <PrintBlock
              unit={{
                type: "block",
                id: child.id,
                block: child,
                pagination: child.pagination,
              }}
              columnGapMm={layoutColumnGapMm}
              mathFractionSizing={mathFractionSizing}
            />
          );
          return columnCount > 1 && child.pagination?.break === true
            ? <div key={child.id} className="print-column-break-before">{rendered}</div>
            : <Fragment key={child.id}>{rendered}</Fragment>;
        })}
      </section>
    );
  }
}

function PrintLayoutSectionFragment({
  unit,
  mathFractionSizing,
}: {
  unit: Extract<PrintContentUnit, { type: "layoutSectionFragment" }>;
  mathFractionSizing?: SigmaDocument["metadata"]["mathFractionSizing"];
}) {
  const columnCount = unit.columns.length;
  const style = {
    "--print-layout-section-column-count": String(columnCount),
    "--print-layout-section-column-gap": `${unit.columnGapMm}mm`,
    display: "grid",
    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
    columnGap: `${unit.columnGapMm}mm`,
  } as CSSProperties;

  return (
    <section
      data-sigma-doc-id={unit.fragmentRole === "single" || unit.fragmentRole === "first" ? unit.sourceId : undefined}
      data-layout-section-source-id={unit.sourceId}
      data-layout-section-fragment={unit.fragmentRole}
      className={`print-layout-section print-layout-section-fragment print-layout-section-fragment-${unit.fragmentRole}`}
      style={style}
    >
      {unit.columns.map((column) => (
        <div
          key={`${unit.id}-${column.id}`}
          className="print-layout-section-column"
          style={{ minWidth: 0 }}
        >
          {getColumnFlowBlocks(column).map((child, index) => (
            <PrintBlock
              key={`${child.id}-${index}`}
              unit={child}
              columnGapMm={unit.columnGapMm}
              mathFractionSizing={mathFractionSizing}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

function PrintBoxBlock({
  block,
  columnGapMm,
  mathFractionSizing,
  fragmentBlocks,
  fragmentRole,
  includeTitle = true,
  cornerReferenceHeightPx,
}: {
  block: Extract<SigmaBlock, { type: "boxBlock" }>;
  columnGapMm: number;
  mathFractionSizing?: SigmaDocument["metadata"]["mathFractionSizing"];
  fragmentBlocks?: BoxBlockChildBlock[];
  fragmentRole?: Extract<PrintContentUnit, { type: "boxFragment" }>["fragmentRole"];
  includeTitle?: boolean;
  cornerReferenceHeightPx?: number;
}) {
  const frame = resolveBoxFrame(block);
  const hasTitle = boxBlockTitleText(block).length > 0;
  const blocks = fragmentBlocks ?? block.blocks;
  const fragmentClass = fragmentRole ? ` print-box-fragment print-box-fragment-${fragmentRole}` : "";
  const style = {
    ...boxFrameStyleVars(frame),
    ...cornerBoxReferenceHeightStyleVars(cornerReferenceHeightPx),
  } as CSSProperties;
  return (
    <section
      data-sigma-doc-id={!fragmentRole || fragmentRole === "single" || fragmentRole === "first" ? block.id : undefined}
      data-box-source-id={fragmentRole ? block.id : undefined}
      data-box-fragment={fragmentRole}
      data-corner-reference-height={cornerReferenceHeightPx ? "explicit" : undefined}
      className={`${boxFrameClassName("print-box-block", frame, block.styleId)}${fragmentClass}`}
      data-box-style={block.styleId}
      {...boxFrameDecorationAttributes(frame)}
      style={style}
    >
      <span className="print-box-corner top-left" aria-hidden="true" />
      <span className="print-box-corner top-right" aria-hidden="true" />
      <span className="print-box-corner bottom-left" aria-hidden="true" />
      <span className="print-box-corner bottom-right" aria-hidden="true" />
      {includeTitle && hasTitle && (
        <div className="print-box-title">
          {renderInlineContent(block.title ?? [], {
            keyPrefix: `${block.id}-title`,
            mathFractionSizing,
          })}
        </div>
      )}
      <div className="print-box-body">
        {blocks.map((child) => (
          <PrintBoxBlockChild
            key={child.id}
            block={child}
            columnGapMm={columnGapMm}
            mathFractionSizing={mathFractionSizing}
          />
        ))}
      </div>
    </section>
  );
}

function PrintBoxBlockChild({
  block,
  columnGapMm,
  mathFractionSizing,
}: {
  block: BoxBlockChildBlock;
  columnGapMm: number;
  mathFractionSizing?: SigmaDocument["metadata"]["mathFractionSizing"];
}) {
  if (block.type === "layoutSection") {
    return (
      <PrintBlock
        unit={{
          type: "block",
          id: block.id,
          block,
          pagination: block.pagination,
        }}
        columnGapMm={columnGapMm}
        mathFractionSizing={mathFractionSizing}
      />
    );
  }

  if (block.type === "section" || block.type === "boxBlock") {
    return (
      <PrintBlock
        unit={{
          type: "block",
          id: block.id,
          block,
          pagination: block.pagination,
        }}
        columnGapMm={columnGapMm}
        mathFractionSizing={mathFractionSizing}
      />
    );
  }

  return <PrintableRichBlock block={block} mathFractionSizing={mathFractionSizing} />;
}

function PrintProblemArea({
  problemId,
  area,
  blocks,
  minHeightMm,
  problemNumber,
  numberFontSize,
  hasFrame,
  frameStyleId,
  isFirstProblemArea,
  isFirstProblemFrameArea,
  isLastProblemFrameArea,
  columnGapMm,
  mathFractionSizing,
  fragmentRole,
  sourceId,
}: {
  problemId: string;
  area: ProblemAreaKind;
  blocks: ProblemAreaBlock[];
  minHeightMm?: number;
  problemNumber?: number;
  numberFontSize: number;
  hasFrame: boolean;
  frameStyleId?: string;
  isFirstProblemArea: boolean;
  isFirstProblemFrameArea: boolean;
  isLastProblemFrameArea: boolean;
  columnGapMm: number;
  mathFractionSizing?: SigmaDocument["metadata"]["mathFractionSizing"];
  fragmentRole?: Extract<PrintContentUnit, { type: "problemAreaFragment" }>["fragmentRole"];
  sourceId?: string;
}) {
  const isFirstFragment = !fragmentRole || fragmentRole === "single" || fragmentRole === "first";
  const showNumber = area === "lead" && typeof problemNumber === "number" && isFirstFragment;
  if (blocks.length === 0 && !minHeightMm && !showNumber) {
    return null;
  }

  const showEmptyLeadPlaceholder = showNumber && blocks.length === 0;
  const frameClasses = hasFrame ? problemFrameClassName("print-problem-area with-frame", frameStyleId) : "print-problem-area";
  const fragmentClasses = fragmentRole
    ? ` print-problem-area-fragment print-problem-area-fragment-${fragmentRole}`
    : "";

  return (
    <section
      className={`${frameClasses}${fragmentClasses} ${hasFrame && isFirstProblemFrameArea ? "first-frame-area" : ""} ${hasFrame && isLastProblemFrameArea ? "last-frame-area" : ""}`}
      data-sigma-doc-id={isFirstProblemArea && isFirstFragment ? problemId : undefined}
      data-problem-area={area}
      data-problem-area-fragment={fragmentRole}
      data-problem-source-id={sourceId}
      data-problem-frame-style={hasFrame ? frameStyleId : undefined}
      style={minHeightMm ? { minHeight: `${minHeightMm}mm` } : undefined}
    >
      <div className={`print-problem-area-content ${showNumber ? "with-number" : ""}`}>
        {showNumber && <span className="print-problem-number" style={{ fontSize: `${numberFontSize}pt` }}>{formatProblemNumber(problemNumber)}</span>}
        <div
          className={`print-problem-area-body ${showEmptyLeadPlaceholder ? "empty-lead-placeholder" : ""}`}
        >
          {showEmptyLeadPlaceholder ? (
            <div className="print-empty-lead-shell" aria-hidden="true" />
          ) : (
            blocks.map((child) => child.type === "layoutSection" || child.type === "boxBlock" ? (
              <PrintBlock
                key={child.id}
                unit={{
                  type: "block",
                  id: child.id,
                  block: child,
                  pagination: child.pagination,
                }}
                columnGapMm={columnGapMm}
                mathFractionSizing={mathFractionSizing}
              />
            ) : (
              <PrintableRichBlock key={child.id} block={child} mathFractionSizing={mathFractionSizing} />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function getPrintLayoutSectionColumnCount(columnCount: number): number {
  return Number.isInteger(columnCount) ? Math.min(4, Math.max(1, columnCount)) : 2;
}

function getProblemNumberFontSize(problem: Extract<SigmaBlock, { type: "problem" }>): number {
  const fontSize = problem.numbering?.fontSize;
  return typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize > 0
    ? fontSize
    : DEFAULT_PROBLEM_NUMBER_FONT_SIZE;
}
