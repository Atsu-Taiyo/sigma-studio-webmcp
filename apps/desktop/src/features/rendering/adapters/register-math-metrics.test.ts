import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Importing any public adapter barrel must install the real math box measurer.
 *
 * This is a structural guard, not a style preference. Registration used to be a per-entry-point
 * call, and the editor route silently missed it (`app/layout.tsx` and `app/page.tsx` are server
 * components, so their module-level call never ran in the browser). The editor then measured
 * overlay text with the crude fallback while the print route used the real measurer — the exact
 * screen/print size disagreement this feature removes, and invisible until a PDF clipped.
 */
describe("math metrics registration is structural", () => {
  const barrels = [
    "./index.ts",
    "./svg/index.ts",
    "./react/index.ts",
  ];

  it.each(barrels)("%s imports the self-registering module", (barrel) => {
    const source = readFileSync(fileURLToPath(new URL(barrel, import.meta.url)), "utf8");
    expect(source).toMatch(/import\s+["'][^"']*register-math-metrics["']/);
  });

  it("registers a provider that reports real math box heights", async () => {
    const { setOverlayMathMetricsProvider, measureOverlayText } = await import("@/features/drawing");

    // Drop whatever the test setup installed so this asserts the barrel's own side effect.
    setOverlayMathMetricsProvider(null);
    await import("./register-math-metrics");
    // Already-imported modules do not re-run, so register explicitly to model a fresh bundle.
    const { registerOverlayMathMetricsPort } = await import("./overlay-math-metrics-port");
    registerOverlayMathMetricsPort();

    const tall = measureOverlayText({
      inlineContent: [{ type: "mathInline", id: "m", tex: "\\sum_{i=1}^{n}i", display: "inline" }],
      fontSizePx: 10,
    });

    // A big operator with both limits is ~2.9em tall; the pre-fix estimator returned one line.
    expect(tall.h).toBeGreaterThan(20);
  });
});
