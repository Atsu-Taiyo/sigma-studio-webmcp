/**
 * The drawing feature's view of the overlay text font math. The implementation lives in
 * `@/features/document/overlay-text-font` (a leaf module) so that `features/document`'s own
 * `getShapeBounds` and `@/lib/font-size-units` share one copy with the renderers instead of each
 * keeping a size table and a pt→px conversion of their own.
 *
 * This file is the drawing feature's *only* runtime edge into `features/document` and it is a pure
 * re-export — `features/drawing/architecture.test.ts` pins both halves of that rule. The deep
 * specifier is deliberate: importing the `@/features/document` barrel here would drag the whole
 * document feature into the drawing feature's runtime graph. The re-export list stays limited to
 * what the drawing feature exposed before the move (`shape-bounds.ts` re-exports this module into
 * the public `@/features/drawing` API), so the unit helpers stay internal to the owning module.
 */
export {
  CSS_PX_PER_PT,
  MAX_TEXT_SHAPE_SCALE,
  MIN_TEXT_SHAPE_SCALE,
  TEXT_SHAPE_LINE_HEIGHT,
  getTextShapeFontSizePt,
  getTextShapeFontSizePx,
  getTextShapeLineHeightPx,
  getTextShapeRenderedFontSizePx,
  getTextShapeRenderedLineHeightPx,
  getTextShapeScale,
  normalizeTextShapeScale,
} from "@/features/document/overlay-text-font";

export const MIN_TEXT_SHAPE_WIDTH = 8;
/**
 * Inset between a callout's body rect and its text rect. Lives in this module (which imports
 * nothing from its siblings) rather than in `callout-geometry.ts` because `overlay-text-box.ts`
 * needs it too (for `getCalloutBodySize`/`getCalloutTextRect`), and `callout-geometry.ts` needs
 * `overlay-text-box.ts` — putting the constant in either of those two would create a cycle.
 * `callout-geometry.ts` re-exports it so existing imports keep working unchanged.
 */
export const CALLOUT_TEXT_PADDING = 12;
