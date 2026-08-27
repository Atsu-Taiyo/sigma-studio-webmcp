import { measureOverlayText, type GraphLabelLayoutPort } from "@/features/drawing";
import { evaluateExpression } from "@/lib/graph2d";
import { ptToPx } from "@/lib/font-size-units";
import { createId } from "@/lib/id";

/**
 * Builds the `GraphLabelLayoutPort` that `features/drawing`'s pure graph-label-layout functions
 * need to measure/evaluate/mint ids for graph-owned text labels (axis/point/annotation/formula
 * labels). `features/drawing` cannot reach `@/lib/graph2d`/`@/lib/id` itself (see
 * `features/drawing/architecture.test.ts`: it only allows `@/features/document` types and
 * relative imports), so every caller used to hand-roll an identical object literal. Both
 * `components/editor/overlay-canvas/shapes/graph.ts` and `lib/ai/sigma-doc-agent-tools.ts` build
 * this port purely from public, dependency-light modules (`@/features/drawing`, `@/lib/graph2d`,
 * `@/lib/font-size-units`, `@/lib/id`), so it lives here on the shared rendering-adapters
 * entrypoint rather than being duplicated in each.
 */
export function createGraphLabelLayoutPort(): GraphLabelLayoutPort {
  return {
    measureMathLabel(tex, fontSizePt) {
      const measurement = measureOverlayText({
        inlineContent: [{
          type: "mathInline",
          id: "graph_label_measurement",
          tex,
          display: "inline",
        }],
        fontSizePx: ptToPx(fontSizePt),
      });
      return {
        width: measurement.w,
        height: measurement.h,
      };
    },
    evaluateExpression,
    createInlineMathId: () => createId("overlay_math"),
  };
}
