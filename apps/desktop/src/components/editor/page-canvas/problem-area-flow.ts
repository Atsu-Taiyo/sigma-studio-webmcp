import type { BlockExtent } from "@/components/editor/overlay-canvas/anchor";
import { blockSpaceAfterPx } from "@/features/document";
import type { ProblemAreaColumnFlowBlock } from "@/features/rendering/core";
import { collectTextFlowBlockElements } from "./layout-measure";
import { getBoxFragmentBreakOffsetsFromElement } from "./column-layout";
import { getLayoutSectionColumnCount, getLayoutSectionColumnGapPx } from "./render-units";
import type { RenderUnit } from "./types";

export {
  computeProblemAreaColumnFlow,
  simulateBalancedColumnHeightPx,
  type ProblemAreaColumnFlowBlock,
  type ProblemAreaColumnFlowResult,
} from "@/features/rendering/core";

export interface ProblemAreaColumnInput {
  unitId: string;
  sectionBlockId: string;
  /** Section top in unzoomed px, relative to the flow top. */
  sectionTop: number;
  /** Vertical offset of the column content origin below the section top (constant chrome). */
  contentOffset: number;
  /** Horizontal offset of the column content origin, relative to the flow left. */
  contentLeft: number;
  columnCount: number;
  columnWidthPx: number;
  columnGapPx: number;
  blockIds: string[];
  blockHeights: ProblemAreaColumnFlowBlock[];
}

/**
 * Reads the geometry needed to flow each multi-column problem area across pages:
 * the section position, the shell width (→ column width) and per-block heights
 * (already measured at column width, so stable across balance/flow rendering).
 */
export function collectProblemAreaColumnInputs(
  /** フローユニット要素の索引 (`applied-gaps.ts` が 1 パスで作る)。unit ごとの querySelector を避ける。 */
  unitElements: ReadonlyMap<string, HTMLElement>,
  flowRect: DOMRect,
  units: RenderUnit[],
  extents: Map<string, BlockExtent>,
  zoomFactor: number,
  columnGapPx: number,
  columnGapMm: number,
): ProblemAreaColumnInput[] {
  const inputs: ProblemAreaColumnInput[] = [];
  for (const unit of units) {
    const columnCount = unit.type === "layoutSection" || unit.type === "problemLayoutSection"
        ? getLayoutSectionColumnCount(unit.section)
        : 1;
    if (columnCount <= 1) {
      continue;
    }
    const section = unitElements.get(unit.id) ?? null;
    // The ProseMirror root (.text-flow-editor) is the offset parent for the
    // absolutely-placed blocks, so measure column geometry from it.
    const editor = section?.querySelector<HTMLElement>(".text-flow-editor");
    if (!section || !editor) {
      continue;
    }
    const sectionRect = section.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const editorWidth = editorRect.width / zoomFactor;
    const blockElements = collectTextFlowBlockElements(editor);
    const unitColumnGapPx = unit.type === "layoutSection" || unit.type === "problemLayoutSection"
      ? getLayoutSectionColumnGapPx(unit.section, columnGapMm, columnGapPx)
      : columnGapPx;
    const columnWidthPx = Math.max(1, (editorWidth - (columnCount - 1) * unitColumnGapPx) / columnCount);
    const blocks = unit.type === "problemArea" || unit.type === "layoutSection" || unit.type === "problemLayoutSection" ? unit.blocks : [];
    inputs.push({
      unitId: unit.id,
      sectionBlockId: unit.type === "layoutSection" || unit.type === "problemLayoutSection" ? unit.section.id : unit.id,
      sectionTop: (sectionRect.top - flowRect.top) / zoomFactor,
      contentOffset: Math.max(0, (editorRect.top - sectionRect.top) / zoomFactor),
      contentLeft: Math.max(0, (editorRect.left - flowRect.left) / zoomFactor),
      columnCount,
      columnWidthPx,
      columnGapPx: unitColumnGapPx,
      blockIds: blocks.map((block) => block.id),
      blockHeights: blocks.map((block) => ({
        id: block.id,
        height: extents.get(block.id)?.height ?? 0,
        type: block.type,
        break: block.pagination?.break === true,
        // 実測 height にはブロック下余白 (padding) が入っている。本文フローと同じ規約で、
        // 段に収まるかは本文だけで決め、カーソル前進には余白ごと含める。
        trailingSpacePx: blockSpaceAfterPx(block),
        breakOffsets: block.type === "boxBlock"
          ? getBoxFragmentBreakOffsetsFromElement(block, blockElements.get(block.id), zoomFactor)
          : undefined,
      })),
    });
  }
  return inputs;
}
