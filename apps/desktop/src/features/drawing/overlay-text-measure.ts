import type {
  InlineNode,
  OverlayRichTextDocument,
} from "@/features/document";

import {
  createOverlayTextLineModel,
  splitOverlayTextLines,
} from "@/features/rendering/core";

import { TEXT_SHAPE_LINE_HEIGHT } from "./text-shape-font";

/** A TeX formula's box metrics, in em units relative to its own font size. */
export interface OverlayMathBoxMetricsEm {
  ascentEm: number;
  descentEm: number;
  widthEm: number;
}

export interface OverlayMathMetricsPort {
  measureTexEm(tex: string): OverlayMathBoxMetricsEm | null;
}

/**
 * Module-level registry for the real math box measurer. `features/drawing` cannot import
 * `features/rendering/adapters` (see `architecture.test.ts`'s dependency-boundary checks), so the
 * KaTeX/MathLive-backed measurer in `features/rendering/adapters/math-metrics.ts` registers itself
 * here once from every entry point that renders overlay text (editor, print route, MCP server,
 * Electron-main AI tools). Callers can also pass `mathMetrics` on a single `measureOverlayText`
 * call to override this for that call only (tests use this instead of touching global state).
 *
 * When nothing is registered and no per-call port is passed, math atoms fall back to
 * `estimateFallbackMathMetricsEm` below. That fallback is deliberately biased to over- rather than
 * under-estimate: a missed registration must never quietly reintroduce the print/PDF clipping bug
 * this module exists to fix.
 */
let registeredMathMetricsProvider: OverlayMathMetricsPort | null = null;

export function setOverlayMathMetricsProvider(port: OverlayMathMetricsPort | null): void {
  registeredMathMetricsProvider = port;
}

export interface MeasureOverlayTextInput {
  /** Plain-text lines. Use inlineContent when the input contains MathLive TeX. */
  lines?: readonly string[];
  /** SigmaDoc inline content. TeX syntax is normalized before estimating glyph widths. */
  inlineContent?: readonly InlineNode[];
  /** Existing overlay rich text, including multiple paragraphs and hard breaks. */
  richText?: OverlayRichTextDocument;
  fontSizePx: number;
  /** Constrains the width and estimates the line count after character-unit wrapping. */
  maxWidthPx?: number;
  /** Overrides the module-level provider registered via `setOverlayMathMetricsProvider`, for this call only. */
  mathMetrics?: OverlayMathMetricsPort;
}

export interface OverlayTextMeasurement {
  w: number;
  h: number;
  wrapped: boolean;
}

type OverlayMeasurementToken =
  | { kind: "text"; text: string }
  | { kind: "math"; tex: string; metrics: OverlayMathBoxMetricsEm };

// Plain text's vertical box, split into ascent/descent so a mixed text+math line's height can be
// derived as `max(ascents) + max(descents)` alongside any math tokens on that line. Their sum MUST
// stay equal to `TEXT_SHAPE_LINE_HEIGHT` (1): CSS's `line-height: 1` for `.overlay-text-shape` in
// globals.css assumes exactly this, and changing either constant would shift every plain-text
// shape's rendered height. Do not change `TEXT_SHAPE_LINE_HEIGHT` itself either (imported, not
// redefined here, specifically so there is only one source of truth for that constraint).
// Exported because `shape-label-geometry.ts` measures an SVG `<text>` whose `y` is its baseline,
// so it needs the split rather than just the total.
export const TEXT_ASCENT_EM = 0.8;
export const TEXT_DESCENT_EM = 0.2;

// Used only by the no-port fallback below, to detect genuine multi-row environments
// (`\begin{cases}...\end{cases}`, `pmatrix`, etc) and structural macros whose rendered box is
// reliably taller than plain text even when nothing can actually measure them.
const MULTI_ROW_ENVIRONMENT_PATTERN = /\\begin\{[^}]*\}([\s\S]*?)\\end\{[^}]*\}/;
const STRUCTURAL_MACRO_PATTERN = /\\(?:frac|dfrac|tfrac|cfrac|sqrt|int|oint|iint|iiint|sum|prod|coprod|lim|begin|binom|dbinom|tbinom|overbrace|underbrace)\b/;
const FALLBACK_STRUCTURAL_ROW_HEIGHT_EM = 1.6;
const FALLBACK_PLAIN_ROW_HEIGHT_EM = 1.0;

/**
 * Estimates an overlay text box without a DOM. Stored estimator bounds keep SVG/print/MCP
 * previews usable until the editor can refine auto-sized text with its rendered DOM.
 */
export function measureOverlayText(input: MeasureOverlayTextInput): OverlayTextMeasurement {
  const fontSizePx = positiveFiniteOr(input.fontSizePx, 1);
  const mathMetrics = input.mathMetrics ?? registeredMathMetricsProvider;
  const lines = getMeasurementLines(input, mathMetrics);
  const maxWidthPx = positiveFiniteOrUndefined(input.maxWidthPx);
  const minLineHeightPx = Math.ceil(fontSizePx * TEXT_SHAPE_LINE_HEIGHT);

  if (maxWidthPx === undefined) {
    const maxLineUnits = Math.max(0, ...lines.map(estimateLineWidthUnits));
    const h = lines.reduce((sum, line) => sum + estimateLineHeightPx(line, fontSizePx), 0);
    return {
      w: Math.ceil(maxLineUnits * fontSizePx),
      h: Math.max(minLineHeightPx, h),
      wrapped: false,
    };
  }

  const maxLineUnits = maxWidthPx / fontSizePx;
  let wrapped = false;
  let h = 0;
  let widestMathAtomUnits = 0;
  for (const line of lines) {
    const result = wrapMeasurementLine(line, maxLineUnits, fontSizePx);
    wrapped ||= result.wrapped;
    widestMathAtomUnits = Math.max(widestMathAtomUnits, result.widestMathAtomUnits);
    h += result.heightPx;
  }

  return {
    w: Math.max(maxWidthPx, Math.ceil(widestMathAtomUnits * fontSizePx)),
    h: Math.max(minLineHeightPx, h),
    wrapped,
  };
}

/**
 * Turns the shared line model into measurement tokens.
 *
 * Splitting text into lines is the renderer's rule and lives in
 * `features/rendering/core/overlay-text-line-model.ts`. What a formula's box measures — and whether
 * it is measured at all — is measurement policy and stays here.
 */
function getMeasurementLines(
  input: MeasureOverlayTextInput,
  mathMetrics: OverlayMathMetricsPort | null,
): OverlayMeasurementToken[][] {
  const modelLines = createOverlayTextLineModel(input);
  const lines: OverlayMeasurementToken[][] = [[]];
  modelLines.forEach((modelLine, index) => {
    if (index > 0) {
      lines.push([]);
    }
    for (const token of modelLine) {
      if (token.kind === "text") {
        appendTextToLines(lines, token.text);
        continue;
      }
      appendMathToLines(lines, token.tex, mathMetrics);
    }
  });
  return lines;
}

/** Appends to the current measurement line, using the model's newline rule. */
function appendTextToLines(lines: OverlayMeasurementToken[][], text: string): void {
  splitOverlayTextLines(text).forEach((segment, index) => {
    if (index > 0) {
      lines.push([]);
    }
    if (segment.length > 0) {
      lines[lines.length - 1].push({ kind: "text", text: segment });
    }
  });
}

/**
 * Appends a math atom to the current line. With a metrics port (registered or passed for this call)
 * every formula becomes a real `"math"` token measured by that port — the path that fixes the
 * `\frac`/`\sqrt`/`\sum` clipping bug.
 *
 * Without a port only genuine multi-row environments (`\begin{cases}…`, matrices) become a math
 * token; everything else keeps the legacy behaviour of being flattened by
 * `normalizeTexForMeasurement` into plain characters on the current line. **This branch is
 * load-bearing**: MCP and the Electron main process measure without registering a port, and their
 * output has to stay byte-identical. Do not "simplify" it into always emitting a math token.
 */
function appendMathToLines(
  lines: OverlayMeasurementToken[][],
  tex: string,
  mathMetrics: OverlayMathMetricsPort | null,
): void {
  if (mathMetrics) {
    const metrics = mathMetrics.measureTexEm(tex) ?? estimateFallbackMathMetricsEm(tex);
    lines[lines.length - 1].push({ kind: "math", tex, metrics });
    return;
  }

  if (isMultiRowMathEnvironment(tex)) {
    lines[lines.length - 1].push({ kind: "math", tex, metrics: estimateFallbackMathMetricsEm(tex) });
    return;
  }

  appendTextToLines(lines, normalizeTexForMeasurement(tex));
}

function isMultiRowMathEnvironment(tex: string): boolean {
  const match = MULTI_ROW_ENVIRONMENT_PATTERN.exec(tex);
  return match !== null && countRowSeparators(match[1]) > 0;
}

function countRowSeparators(body: string): number {
  return (body.match(/\\\\/g) ?? []).length;
}

/**
 * Last-resort math box estimate used only when nothing can actually measure a formula: no port is
 * registered/passed AND (for the multi-row case) or a registered port itself returned `null`. Row
 * count comes from `\\` separators inside a `\begin{...}...\end{...}` block (defaulting to a
 * single row otherwise); structural macros (`\frac`, `\sqrt`, `\sum`, ...) get a taller per-row
 * height since their real rendered box is reliably taller than one text line.
 */
function estimateFallbackMathMetricsEm(tex: string): OverlayMathBoxMetricsEm {
  const envMatch = MULTI_ROW_ENVIRONMENT_PATTERN.exec(tex);
  const rowCount = envMatch ? countRowSeparators(envMatch[1]) + 1 : 1;
  const heightPerRowEm = STRUCTURAL_MACRO_PATTERN.test(tex)
    ? FALLBACK_STRUCTURAL_ROW_HEIGHT_EM
    : FALLBACK_PLAIN_ROW_HEIGHT_EM;
  const normalized = normalizeTexForMeasurement(tex);
  const widthEm = Math.max(0, ...normalized.split("\n").map(estimateOverlayTextLineUnits));

  return {
    ascentEm: rowCount * heightPerRowEm,
    descentEm: 0,
    widthEm,
  };
}

/**
 * Removes TeX layout syntax while retaining a compact approximation of rendered symbols.
 * Formatting macros keep their arguments, named operators keep their visible name, and other
 * symbol macros count as one glyph. Only used by the no-port fallback path above.
 */
function normalizeTexForMeasurement(tex: string): string {
  return tex
    .replace(/\\\\(?:\[[^\]]*\])?/g, "\n")
    .replace(/\\(?:begin|end)\s*\{[^}]*\}/g, "")
    .replace(/\\(?:left|right|displaystyle|textstyle|scriptstyle|scriptscriptstyle)\b/g, "")
    .replace(/\\(?:mathrm|mathbf|mathit|mathsf|mathtt|text|textrm|textbf|textit|operatorname|frac|dfrac|tfrac|sqrt|overline|underline|vec|hat|bar|dot|ddot)\b/g, "")
    .replace(/\\(sin|cos|tan|cot|sec|csc|log|ln|exp|max|min|lim)\b/g, "$1")
    .replace(/\\(?:quad|qquad|,|;|:|!)/g, " ")
    .replace(/\\([{}_%&#$])/g, "$1")
    .replace(/\\[a-zA-Z]+/g, "M")
    .replace(/[{}^_]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, ""))
    .join("\n");
}

function estimateLineWidthUnits(line: readonly OverlayMeasurementToken[]): number {
  return line.reduce((sum, token) => (
    sum + (token.kind === "text" ? estimateOverlayTextLineUnits(token.text) : token.metrics.widthEm)
  ), 0);
}

function estimateLineHeightPx(line: readonly OverlayMeasurementToken[], fontSizePx: number): number {
  let ascentEm = TEXT_ASCENT_EM;
  let descentEm = TEXT_DESCENT_EM;
  for (const token of line) {
    if (token.kind === "math") {
      ascentEm = Math.max(ascentEm, token.metrics.ascentEm);
      descentEm = Math.max(descentEm, token.metrics.descentEm);
    }
  }
  return Math.ceil(fontSizePx * Math.max(TEXT_SHAPE_LINE_HEIGHT, ascentEm + descentEm));
}

interface WrapUnit {
  widthEm: number;
  ascentEm: number;
  descentEm: number;
  isMathAtom: boolean;
}

interface WrapLineResult {
  heightPx: number;
  wrapped: boolean;
  widestMathAtomUnits: number;
}

/**
 * Greedily wraps one line's tokens at `maxLineUnits`, treating each math token as a single
 * indivisible unit (never split mid-formula across two wrapped segments) while plain text still
 * wraps per character exactly as before. Each wrapped segment gets its own height via the same
 * `max(ascents) + max(descents)` rule as `estimateLineHeightPx`, so a wrapped segment containing a
 * tall formula grows only that segment, not the whole line.
 */
function wrapMeasurementLine(
  line: readonly OverlayMeasurementToken[],
  maxLineUnits: number,
  fontSizePx: number,
): WrapLineResult {
  const units: WrapUnit[] = line.flatMap((token): WrapUnit[] => (
    token.kind === "math"
      ? [{
        widthEm: token.metrics.widthEm,
        ascentEm: token.metrics.ascentEm,
        descentEm: token.metrics.descentEm,
        isMathAtom: true,
      }]
      : Array.from(token.text).map((char): WrapUnit => ({
        widthEm: estimateOverlayTextCharUnits(char),
        ascentEm: TEXT_ASCENT_EM,
        descentEm: TEXT_DESCENT_EM,
        isMathAtom: false,
      }))
  ));

  if (units.length === 0) {
    return {
      heightPx: Math.ceil(fontSizePx * TEXT_SHAPE_LINE_HEIGHT),
      wrapped: false,
      widestMathAtomUnits: 0,
    };
  }

  let heightPx = 0;
  let wrapped = false;
  let widestMathAtomUnits = 0;
  let currentWidth = 0;
  let currentAscent = TEXT_ASCENT_EM;
  let currentDescent = TEXT_DESCENT_EM;

  const flushSegment = () => {
    heightPx += Math.ceil(fontSizePx * Math.max(TEXT_SHAPE_LINE_HEIGHT, currentAscent + currentDescent));
  };

  for (const unit of units) {
    if (unit.isMathAtom) {
      widestMathAtomUnits = Math.max(widestMathAtomUnits, unit.widthEm);
    }
    if (currentWidth > 0 && currentWidth + unit.widthEm > maxLineUnits) {
      flushSegment();
      wrapped = true;
      currentWidth = unit.widthEm;
      currentAscent = Math.max(TEXT_ASCENT_EM, unit.ascentEm);
      currentDescent = Math.max(TEXT_DESCENT_EM, unit.descentEm);
    } else {
      currentWidth += unit.widthEm;
      currentAscent = Math.max(currentAscent, unit.ascentEm);
      currentDescent = Math.max(currentDescent, unit.descentEm);
    }
  }
  flushSegment();

  return { heightPx, wrapped, widestMathAtomUnits };
}

function estimateOverlayTextLineUnits(line: string): number {
  let units = 0;
  for (const char of line) {
    units += estimateOverlayTextCharUnits(char);
  }
  return units;
}

function estimateOverlayTextCharUnits(char: string): number {
  if (/\s/u.test(char)) {
    return 0.35;
  }

  const codePoint = char.codePointAt(0) ?? 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef)
  ) {
    return 1;
  }

  if (/[+\-*/=<>()[\]{}^_,.;:|]/u.test(char)) {
    return 0.45;
  }

  return 0.58;
}

function positiveFiniteOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveFiniteOrUndefined(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}
