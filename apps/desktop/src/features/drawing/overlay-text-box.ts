import { getOverlayRichTextLineCount } from "@/features/rendering/core";

import type {
  OverlayCalloutShape,
  OverlayRichTextDocument,
  OverlayShape,
} from "@/features/document";

import { measureOverlayText } from "./overlay-text-measure";
import {
  CALLOUT_TEXT_PADDING,
  getTextShapeRenderedFontSizePx,
  getTextShapeRenderedLineHeightPx,
  MIN_TEXT_SHAPE_WIDTH,
} from "./text-shape-font";

export interface OverlayTextBoxSize {
  w: number;
  h: number;
}

/**
 * Per-(richText, inputs) memo for the estimator math below. `getShapeBounds` sits on the
 * hottest overlay path (pointermove hit-testing, marquee selection, `view-cache.ts`'s
 * per-shape pass), and every one of those callers re-derives the same text box unless we
 * cache it. Rich text documents are treated as immutable snapshots elsewhere in the overlay
 * model, so keying on object identity gets a high hit rate without any invalidation logic.
 */
const sizeCache = new WeakMap<OverlayRichTextDocument, Map<string, OverlayTextBoxSize>>();

function getMemoizedSize(
  richText: OverlayRichTextDocument,
  key: string,
  compute: () => OverlayTextBoxSize,
): OverlayTextBoxSize {
  let inner = sizeCache.get(richText);
  if (!inner) {
    inner = new Map();
    sizeCache.set(richText, inner);
  }

  const cached = inner.get(key);
  if (cached) {
    return cached;
  }

  const value = compute();
  inner.set(key, value);
  return value;
}

/**
 * Padding-free content box a shape's rich text needs at its current font size. Does not read
 * or apply grow-only/minimum-size rules — callers combine this with the shape's stored
 * geometry as appropriate. Never mutates `shape`.
 */
export function measureOverlayShapeTextContent(
  shape: Extract<OverlayShape, { type: "text" | "callout" }>,
  maxContentWidthPx?: number,
): OverlayTextBoxSize {
  const fontSizePx = getTextShapeRenderedFontSizePx(shape);
  const cacheKey = `content|${fontSizePx}|${maxContentWidthPx ?? ""}`;

  return getMemoizedSize(shape.props.richText, cacheKey, () => {
    const measured = measureOverlayText({
      richText: shape.props.richText,
      fontSizePx,
      maxWidthPx: maxContentWidthPx,
    });
    return { w: measured.w, h: measured.h };
  });
}

/**
 * Effective (render-time) box for a text shape: never mutates the shape or its stored
 * `props.w`/`props.h`, and never returns a box smaller than what was stored (grow-only), so
 * callers that already clamp to the stored size keep working unchanged.
 *
 * Only the height is content-derived. Width stays the stored width (`maxWidth` when the shape
 * wraps at one), because widening from the estimate makes the box visibly wider than the glyphs:
 * the estimator charges a flat per-character width, which overshoots real latin text, and an
 * `autoSize` shape renders at `width: max-content` so its DOM box already hugs the content while
 * the editor's live measurement keeps `props.w` honest. Overshooting there would inflate the
 * selection box and push graph label placement around for no benefit. A stored width that is too
 * *narrow* is handled at the point it actually hurts — print — by `overlay-svg.ts`'s bleed and
 * `overflow="visible"`, not by inflating layout geometry everywhere.
 *
 * Height is grow-only: `max(storedHeight, contentFallbackHeight, measuredHeight)`. This is the
 * axis the bug lives on — stored heights routinely under-count soft-wrapped lines and tall math.
 *
 * Never mutates the shape.
 */
export function getTextShapeEffectiveSize(
  shape: Extract<OverlayShape, { type: "text" }>,
): OverlayTextBoxSize {
  const fontSizePx = getTextShapeRenderedFontSizePx(shape);
  const storedW = shape.props.w;
  const storedH = typeof shape.props.h === "number" && Number.isFinite(shape.props.h)
    ? shape.props.h
    : undefined;
  const autoSize = shape.props.autoSize;
  const maxWidth = shape.props.maxWidth;

  const constraintWidthPx = autoSize
    ? maxWidth
    : Math.max(MIN_TEXT_SHAPE_WIDTH, storedW);

  // `autoSize` belongs in the key even though it also steers `constraintWidthPx`: cloned
  // shapes (AI ghosts, diff previews) share one `richText` object identity, so two entries
  // can otherwise collide on an identical constraint while wanting different widths.
  const cacheKey = `effective|${autoSize ? "auto" : "fixed"}|${fontSizePx}|${constraintWidthPx ?? ""}|${storedW}|${storedH ?? ""}`;

  return getMemoizedSize(shape.props.richText, cacheKey, () => {
    const measured = measureOverlayShapeTextContent(shape, constraintWidthPx);
    const fallbackHeight = getTextShapeContentFallbackHeight(shape);

    const w = autoSize && maxWidth !== undefined
      ? maxWidth
      : Math.max(MIN_TEXT_SHAPE_WIDTH, storedW);

    const h = Math.max(storedH ?? 0, fallbackHeight, measured.h);

    return { w, h };
  });
}

/**
 * Effective (render-time) body-rect size for a callout: width is never grown past the stored
 * `props.w` (grow-only would let a wider box "help" wrapping, which would then need less
 * height, which would then let the box narrow again — an unstable two-axis fixed point; text
 * already wraps via `overflow-wrap:anywhere` at the stored width, so there's no correctness
 * reason to grow it too), height grows to fit the measured content and never shrinks below the
 * stored `props.h` (grow-only: a user-enlarged box should never be silently shrunk back).
 * Never mutates `shape`; memoized like the other estimators here.
 */
export function getCalloutBodySize(
  shape: OverlayCalloutShape,
): OverlayTextBoxSize {
  const wEff = Math.max(1, shape.props.w);
  const fontSizePx = getTextShapeRenderedFontSizePx(shape);
  const cacheKey = `calloutBody|${wEff}|${shape.props.h}|${fontSizePx}`;

  return getMemoizedSize(shape.props.richText, cacheKey, () => {
    const contentW = Math.max(1, wEff - 2 * CALLOUT_TEXT_PADDING);
    const measured = measureOverlayShapeTextContent(shape, contentW);
    const hEff = Math.max(shape.props.h, measured.h + 2 * CALLOUT_TEXT_PADDING);
    return { w: wEff, h: hEff };
  });
}

/**
 * The callout's inner text rect, in coordinates local to its (effective) body rect — i.e. after
 * applying `CALLOUT_TEXT_PADDING` on all sides of `getCalloutBodySize(shape)`. Renderers place
 * the rich-text content here instead of re-deriving it from the stored `props.w`/`props.h`.
 */
export function getCalloutTextRect(
  shape: OverlayCalloutShape,
): { x: number; y: number; w: number; h: number } {
  const body = getCalloutBodySize(shape);
  return {
    x: CALLOUT_TEXT_PADDING,
    y: CALLOUT_TEXT_PADDING,
    w: Math.max(1, body.w - 2 * CALLOUT_TEXT_PADDING),
    h: Math.max(1, body.h - 2 * CALLOUT_TEXT_PADDING),
  };
}

/**
 * Height a text shape needs from its explicit line breaks alone (hard breaks and `\n` in
 * plain text runs), ignoring width-driven wrapping. Used as one lower bound inside
 * `getTextShapeEffectiveSize`; kept separate because a few callers (e.g. resize) want this
 * cheaper estimate without triggering a full content measurement.
 */
export function getTextShapeContentFallbackHeight(
  shape: Extract<OverlayShape, { type: "text" }>,
): number {
  const lineHeight = getTextShapeRenderedLineHeightPx(shape);
  return Math.max(
    lineHeight,
    getOverlayRichTextLineCount(shape.props.richText) * lineHeight,
  );
}

