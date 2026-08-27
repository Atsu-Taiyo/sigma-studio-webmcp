import { setOverlayMathMetricsProvider, type OverlayMathMetricsPort } from "@/features/drawing";
import { DEFAULT_MATH_RENDER_ENVIRONMENT } from "@/lib/math-environment";

import { measureTexBoxEm } from "./math-metrics";

/**
 * Wraps `measureTexBoxEm` (KaTeX/MathLive-backed) as the `OverlayMathMetricsPort` that
 * `features/drawing`'s `overlay-text-measure.ts` consumes. `features/drawing` cannot import
 * `features/rendering/adapters` directly (see `features/drawing/architecture.test.ts`), so this
 * indirection is what lets the real measurer reach it.
 */
export function createOverlayMathMetricsPort(): OverlayMathMetricsPort {
  return {
    measureTexEm(tex) {
      // このポートはグローバル singleton なので文書の描画環境を持てない (plan.md §11 のフォローアップ)。
      // 図形テキストの箱だけが前文マクロ非対応であることを明示するために既定環境を書いておく。
      return measureTexBoxEm(tex, DEFAULT_MATH_RENDER_ENVIRONMENT);
    },
  };
}

/**
 * Registers the real math box measurer as the module-level default for `measureOverlayText`.
 * Idempotent.
 *
 * Prefer letting `./register-math-metrics` do this: every public adapter barrel imports it, so
 * registration follows the render code into whatever bundle needs it. Call this directly only
 * from a process entry point that does not go through those barrels.
 */
export function registerOverlayMathMetricsPort(): void {
  setOverlayMathMetricsProvider(createOverlayMathMetricsPort());
}
