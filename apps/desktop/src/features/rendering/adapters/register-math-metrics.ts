import { registerOverlayMathMetricsPort } from "./overlay-math-metrics-port";

/**
 * Side-effect module: importing it installs the real (KaTeX/MathLive-backed) math box measurer
 * as `measureOverlayText`'s provider.
 *
 * Every public adapter barrel imports this, so any bundle that can render overlay text also
 * measures it correctly. Registering from entry points instead was tried and silently failed:
 * `app/layout.tsx` and `app/page.tsx` are server components, so their module-level registration
 * never ran in the browser and the editor route fell back to the crude estimator while the
 * print route (a client component) used the real one — reintroducing exactly the screen/print
 * size disagreement this measurer exists to remove. Verified in a browser: the editor route
 * reported the provider unset, the print route reported it set.
 *
 * Keep this structural. A checklist of "call this from each new entry point" is the failure
 * mode above, and its symptom (boxes measured slightly too small, only in some surfaces) is
 * invisible until something gets clipped in a PDF.
 */
registerOverlayMathMetricsPort();
