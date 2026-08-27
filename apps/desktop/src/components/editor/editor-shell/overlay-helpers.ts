import { ensureShapeAnchorDx } from "@/components/editor/overlay-canvas/anchor";
import {
  estimateTopLevelBlockRects,
  normalizeOverlaySnapshot,
  type OverlayRichTextDocument,
  type InlineNode,
  type SigmaCommentAnchor,
  type SigmaDocument,
} from "@/features/document";
import type { OverlayShape, OverlayDash, OverlayTextSize } from "@/components/editor/overlay-canvas/types";
import type { OverlaySelectionSummary } from "@/components/editor/page-overlay-types";
import { resolveShapePosition, type MeasuredBlock } from "@/features/drawing";
import { createCurrentLocaleTranslator, type Translate } from "@/lib/i18n";

const DEFAULT_EDITOR_TRANSLATE = createCurrentLocaleTranslator("editor");

export function ensureOverlayAnchorOffsets(document: SigmaDocument): SigmaDocument {
  const layout = document.pageLayout;
  const snapshot = layout?.overlay?.overlaySnapshot;
  if (!layout || !snapshot) {
    return document;
  }

  const normalizedSnapshot = normalizeOverlaySnapshot(snapshot);
  const blockRects = estimateTopLevelBlockRects(document.content, layout);
  const { shapes, changed } = ensureShapeAnchorDx(normalizedSnapshot.shapes, blockRects);

  if (!changed) {
    return document;
  }

  return {
    ...document,
    pageLayout: {
      ...layout,
      overlay: {
        ...layout.overlay,
        overlaySnapshot: {
          ...normalizedSnapshot,
          shapes,
        },
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

/**
 * Convert paper overlay positions to absolute canvas coordinates before body blocks are removed.
 * DOM measurements are visual truth; headless estimates fill only blocks that were not measurable.
 */
export function convertOverlayToWhiteboard(
  document: SigmaDocument,
  measuredBlockRects?: ReadonlyMap<string, MeasuredBlock>,
): SigmaDocument {
  const layout = document.pageLayout;
  const snapshot = layout?.overlay?.overlaySnapshot;
  if (!layout || !snapshot) {
    return {
      ...document,
      content: [],
      comments: retainWhiteboardComments(document.comments, new Set()),
    };
  }

  const blockRects = new Map<string, MeasuredBlock>(
    estimateTopLevelBlockRects(document.content, layout),
  );
  for (const [blockId, rect] of measuredBlockRects ?? []) {
    blockRects.set(blockId, rect);
  }
  const normalizedSnapshot = normalizeOverlaySnapshot(snapshot);
  const shapeIds = new Set(normalizedSnapshot.shapes.map((shape) => shape.id));
  const shapes = normalizedSnapshot.shapes.map((shape) => {
    if (shape.anchor?.type === "shape") {
      return shape;
    }
    const positioned = resolveShapePosition(shape, blockRects);
    const absoluteShape = { ...positioned };
    delete absoluteShape.anchor;
    return absoluteShape;
  });

  return {
    ...document,
    content: [],
    comments: retainWhiteboardComments(document.comments, shapeIds),
    pageLayout: {
      ...layout,
      overlay: {
        ...layout.overlay,
        overlaySnapshot: { ...normalizedSnapshot, shapes },
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

function retainWhiteboardComments(
  comments: SigmaDocument["comments"],
  shapeIds: ReadonlySet<string>,
): SigmaDocument["comments"] {
  if (!comments) {
    return comments;
  }

  return comments.filter((thread) => {
    if (thread.anchor.type === "overlayShape") {
      return thread.anchor.shapeIds.some((shapeId) => shapeIds.has(shapeId));
    }
    if (thread.anchor.type === "overlayMath") {
      return typeof thread.anchor.shapeId === "string" && shapeIds.has(thread.anchor.shapeId);
    }
    return false;
  });
}

export function createOverlaySelectionCommentAnchor(
  selection: OverlaySelectionSummary,
  t: Translate<"editor"> = DEFAULT_EDITOR_TRANSLATE,
): SigmaCommentAnchor | null {
  if (selection.selectedShapeIds.length === 0) {
    return null;
  }

  const mathCandidate = findFirstOverlayMathCommentCandidate(selection.selectedShapes);
  if (mathCandidate) {
    return {
      type: "overlayMath",
      shapeId: mathCandidate.shapeId,
      mathInlineId: mathCandidate.mathInlineId,
      tex: mathCandidate.tex,
      quote: `$${mathCandidate.tex}$`,
    };
  }

  return {
    type: "overlayShape",
    shapeIds: selection.selectedShapeIds,
    quote: selection.selectedShapeIds.length > 1
      ? t("runtimeStatus.selectedShapes", { count: selection.selectedShapeIds.length })
      : t("runtimeStatus.selectedShape"),
  };
}

function findFirstOverlayMathCommentCandidate(
  shapes: readonly OverlayShape[],
): { shapeId: string; mathInlineId?: string; tex: string } | null {
  for (const shape of shapes) {
    const math = extractOverlayShapeMath(shape);
    if (math) {
      return {
        shapeId: shape.id,
        mathInlineId: math.mathInlineId,
        tex: math.tex,
      };
    }
  }
  return null;
}

function extractOverlayShapeMath(shape: OverlayShape): { mathInlineId?: string; tex: string } | null {
  if (shape.type === "text") {
    return findFirstOverlayMathInline(shape.props.richText);
  }

  if (shape.type === "tableShape") {
    for (const cell of shape.props.table.cells) {
      for (const content of cell.content) {
        const math = content.type === "paragraph"
          ? findFirstInlineMath(content.children)
          : findFirstInlineMath(content.label ?? []);
        if (math) {
          return math;
        }
      }
    }
    return null;
  }

  if (shape.type === "graph2dShape") {
    const curve = shape.props.spec.curves.find((item) => item.label?.trim() || item.expr.trim());
    const tex = curve?.label?.trim() || curve?.expr.trim();
    return tex ? { tex } : null;
  }

  return null;
}

function findFirstOverlayMathInline(document: OverlayRichTextDocument): { mathInlineId?: string; tex: string } | null {
  for (const block of document.blocks) {
    for (const inline of block.children) {
      if (inline.type !== "mathInline") {
        continue;
      }
      const tex = inline.tex.trim();
      if (tex) {
        const mathInlineId = inline.id || undefined;
        return { mathInlineId, tex };
      }
    }
  }

  return null;
}

function findFirstInlineMath(children: readonly InlineNode[]): { mathInlineId?: string; tex: string } | null {
  const math = children.find((node) => node.type === "mathInline" && node.tex.trim());
  if (!math || math.type !== "mathInline") {
    return null;
  }
  return {
    mathInlineId: math.id,
    tex: math.tex.trim(),
  };
}

export function getSharedOverlayLineDash(shapes: readonly OverlayShape[]): OverlayDash | null {
  let result: OverlayDash | null = null;

  for (const shape of shapes) {
    const dash = getOverlayLineStyleDash(shape);
    if (!dash) {
      continue;
    }
    if (!result) {
      result = dash;
      continue;
    }
    if (result !== dash) {
      return null;
    }
  }

  return result;
}

function getOverlayLineStyleDash(shape: OverlayShape): OverlayDash | null {
  if (shape.type === "geo" || shape.type === "arrow" || shape.type === "line" || shape.type === "arc" || shape.type === "callout") {
    return shape.props.dash;
  }

  return null;
}

export function getSharedOverlayLineSize(shapes: readonly OverlayShape[]): OverlayTextSize | null {
  let result: OverlayTextSize | null = null;

  for (const shape of shapes) {
    const size = getOverlayLineStyleSize(shape);
    if (!size) {
      continue;
    }
    if (!result) {
      result = size;
      continue;
    }
    if (result !== size) {
      return null;
    }
  }

  return result;
}

function getOverlayLineStyleSize(shape: OverlayShape): OverlayTextSize | null {
  if (shape.type === "geo" || shape.type === "arrow" || shape.type === "line" || shape.type === "arc") {
    return shape.props.size;
  }
  if (shape.type === "callout") {
    return shape.props.strokeWidth;
  }

  return null;
}
