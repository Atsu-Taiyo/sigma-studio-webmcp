import type {
  BoxBlockNode,
  CodeBlockNode,
  DividerNode,
  HeadingNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
  ProblemAreaBlock,
  ProblemAreaKind,
  ProblemNode,
  QuoteBlockNode,
  SectionNode,
  SigmaBlock,
} from "@/features/document";

export const DEFAULT_PROBLEM_NUMBER_FONT_SIZE = 12;

/**
 * Canonical document blocks that participate in the body text-flow projection.
 *
 * `layoutSection` belongs to the editor projection, while a top-level
 * `layoutSection` is deliberately not considered a directly adjacent text-flow
 * block by `getNextTopLevelTextFlowBlockId`.
 */
export type BodyTextFlowBlock =
  | SectionNode
  | HeadingNode
  | ParagraphNode
  | ListNode
  | QuoteBlockNode
  | CodeBlockNode
  | DividerNode
  | BoxBlockNode
  | Extract<SigmaBlock, { type: "layoutSection" }>;

export type BodyEditableBlock = SigmaBlock | ProblemAreaBlock | ListItemNode;

export function isProblemAreaKind(value: string | null): value is ProblemAreaKind {
  return value === "lead" || value === "prompt" || value === "hints" || value === "solution";
}

export function getProblemNumberFontSize(problem: ProblemNode): number {
  const fontSize = problem.numbering?.fontSize;
  return typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize > 0
    ? fontSize
    : DEFAULT_PROBLEM_NUMBER_FONT_SIZE;
}

export function getPageBreakBeforeIds(blocks: readonly BodyTextFlowBlock[]): string[] {
  return blocks
    .filter((block) => block.pagination?.break === true)
    .map((block) => block.id);
}

/**
 * Manual-break ids on blocks nested INSIDE a layout section. A box's direct children
 * deliberately do not participate: TeX-style boxes may contain their own multicolumn
 * layout, but cannot manually break into an outer page/column.
 *
 * The first child is excluded because it has no preceding inner column to break away from.
 */
export function getNestedPageBreakBeforeIds(blocks: readonly BodyTextFlowBlock[]): string[] {
  return Object.keys(getNestedPageBreakBeforeKinds(blocks));
}

/**
 * 手動区切りの**種別**。表示文言ではなく種別を返すのが要点で、
 * 「段の区切りかどうか」の判定 (`manual-column-break-before` の付与) が
 * 表示言語に依存しないようにする — ラベルを返していた頃は、文言を訳した瞬間に
 * 判定が静かに外れて段組が崩れる作りだった。
 */
export type PageBreakMarkerKind = "columnBreak" | "pageBreak";

export function getNestedPageBreakBeforeKinds(
  blocks: readonly BodyTextFlowBlock[],
): Record<string, PageBreakMarkerKind> {
  const labels: Record<string, PageBreakMarkerKind> = {};
  const collect = (
    children: readonly { id: string; pagination?: { break?: boolean } }[],
    label: PageBreakMarkerKind,
  ) => {
    for (const [index, child] of children.entries()) {
      if (index > 0 && child.pagination?.break === true) {
        labels[child.id] = label;
      }
    }
  };

  const visitBox = (box: Extract<BodyTextFlowBlock, { type: "boxBlock" }>) => {
    // A direct child of a TeX-style box cannot start a new page/outer column.
    // Only an explicit layoutSection inside the box owns manual column breaks.
    for (const child of box.blocks) {
      if (child.type === "layoutSection") {
        visitLayoutSection(child, true);
      } else if (child.type === "boxBlock") {
        visitBox(child);
      }
    }
  };

  const visitLayoutSection = (
    section: Extract<BodyTextFlowBlock, { type: "layoutSection" }>,
    insideBox: boolean,
  ) => {
    const columnCount = Math.max(1, Math.floor(section.layout.columnCount));
    if (columnCount > 1) {
      collect(section.children, "columnBreak");
    } else if (!insideBox) {
      collect(section.children, "pageBreak");
    }
    for (const child of section.children) {
      if (child.type === "boxBlock") {
        visitBox(child);
      }
    }
  };

  for (const block of blocks) {
    if (block.type === "boxBlock") {
      visitBox(block);
    } else if (block.type === "layoutSection") {
      visitLayoutSection(block, false);
    }
  }
  return labels;
}

export function isColumnWrapTargetBlock(
  block: BodyEditableBlock,
): block is SectionNode | HeadingNode | ParagraphNode | ListNode {
  return block.type === "section"
    || block.type === "heading"
    || block.type === "paragraph"
    || block.type === "list";
}

export function isBodyContextMenuBlock(
  block: BodyEditableBlock,
): block is SigmaBlock | ProblemAreaBlock {
  return block.type !== "listItem";
}

export function bodyTextFlowBlockContainsId(
  block: BodyTextFlowBlock,
  selectedId: string | null,
): boolean {
  if (!selectedId) {
    return false;
  }
  if (block.id === selectedId) {
    return true;
  }
  if (block.type === "boxBlock") {
    return block.blocks.some((child) => bodyTextFlowBlockContainsId(child, selectedId));
  }
  if (block.type === "layoutSection") {
    return block.children.some((child) => bodyTextFlowBlockContainsId(child, selectedId));
  }
  if (block.type === "list") {
    return block.items.some((item) => (
      item.id === selectedId
      || (item.continuations ?? []).some((continuation) => continuation.id === selectedId)
      || (item.nested ?? []).some((nested) => bodyTextFlowBlockContainsId(nested, selectedId))
    ));
  }
  return false;
}

export function setLayoutSectionColumnCount<T extends SigmaBlock | ProblemAreaBlock>(
  block: T,
  columnCount: number,
): T {
  if (block.type !== "layoutSection") {
    return block;
  }

  const nextColumnCount = Math.min(4, Math.max(1, Math.floor(columnCount)));
  const currentColumnCount = Math.min(4, Math.max(1, Math.floor(block.layout.columnCount)));
  let children = block.children;

  if (nextColumnCount < currentColumnCount) {
    const maximumManualBreaks = nextColumnCount - 1;
    let manualBreakCount = 0;
    children = block.children.map((child, index) => {
      if (index === 0 || child.pagination?.break !== true) {
        return child;
      }
      manualBreakCount += 1;
      return manualBreakCount > maximumManualBreaks
        ? setBlockBreakBefore(child, false)
        : child;
    });
  }

  return {
    ...block,
    layout: {
      ...block.layout,
      columnCount: nextColumnCount,
    },
    children,
  } as T;
}

export function setBlockBreakBefore<T extends SigmaBlock | ProblemAreaBlock>(
  block: T,
  enabled: boolean,
): T {
  const pagination = { ...(block.pagination ?? {}) };
  if (enabled) {
    pagination.break = true;
  } else {
    delete pagination.break;
  }

  const nextPagination = Object.keys(pagination).length > 0 ? pagination : undefined;
  return {
    ...block,
    ...(nextPagination ? { pagination: nextPagination } : { pagination: undefined }),
  };
}

export function findTopLevelBlock(
  content: readonly SigmaBlock[],
  blockId: string,
): SigmaBlock | null {
  return content.find((block) => block.id === blockId) ?? null;
}

export function collectBoxBlocksById(
  content: readonly SigmaBlock[],
): Map<string, BoxBlockNode> {
  const boxes = new Map<string, BoxBlockNode>();

  const visitTextBlock = (block: BodyTextFlowBlock) => {
    if (block.type === "boxBlock") {
      boxes.set(block.id, block);
      for (const child of block.blocks) {
        visitTextBlock(child);
      }
      return;
    }

    if (block.type === "layoutSection") {
      for (const child of block.children) {
        visitTextBlock(child);
      }
      return;
    }

    if (block.type === "list") {
      for (const item of block.items) {
        for (const continuation of item.continuations ?? []) {
          visitTextBlock(continuation);
        }
        for (const nested of item.nested ?? []) {
          visitTextBlock(nested);
        }
      }
    }
  };

  for (const block of content) {
    if (isTopLevelTextFlowBlock(block)) {
      visitTextBlock(block);
    } else if (block.type === "problem") {
      for (const child of [...block.lead, ...block.prompt, ...block.hints, ...block.solution]) {
        visitTextBlock(child);
      }
    } else if (block.type === "layoutSection") {
      for (const child of block.children) {
        visitTextBlock(child);
      }
    }
  }

  return boxes;
}

export function getNextTopLevelTextFlowBlockId(
  content: readonly SigmaBlock[],
  blockId: string,
): string | null {
  const blockIndex = content.findIndex((block) => block.id === blockId);
  if (blockIndex < 0 || !isTopLevelTextFlowBlock(content[blockIndex])) {
    return null;
  }

  const nextBlock = content[blockIndex + 1];
  return nextBlock && isTopLevelTextFlowBlock(nextBlock) ? nextBlock.id : null;
}

function isTopLevelTextFlowBlock(
  block: SigmaBlock,
): block is SectionNode | HeadingNode | ParagraphNode | ListNode | BoxBlockNode {
  return block.type === "section"
    || block.type === "heading"
    || block.type === "paragraph"
    || block.type === "list"
    || block.type === "boxBlock";
}
