import type { Graph3DParameter, Graph3DSpec } from "@/features/document";

import type { MathExpressionVariables } from "./math-expression";

/**
 * Timing of a 3D material that keeps moving on the page.
 *
 * The same sampling drives the settings panel's ▶ preview and the frames baked into the derived
 * image, so what the author watches while setting the animation up is what the page ends up
 * showing. Frame count and duration are deliberately modest: every frame is stored in the
 * document, and a material is a picture in a worksheet, not a video.
 */

/** Roughly 11 frames per second — a flipbook, chosen so the stored picture stays small. */
const TARGET_FRAME_MS = 90;
const MIN_FRAMES = 4;
const MAX_FRAMES = 24;
const MIN_LOOP_MS = 200;
const MAX_LOOP_MS = 12_000;
/**
 * RGBA pixels held at once across every frame. Bounds both the encode's peak memory and, once
 * compressed, how much of the document one moving material is allowed to take.
 */
const ANIMATION_PIXEL_BUDGET = 12_000_000;
const MAX_ANIMATION_SUPERSAMPLE = 2;
/** Used when a parameter carries no animation block of its own. */
export const DEFAULT_DURATION_MS = 4_000;

export interface Graph3DAnimationFrame {
  /** Parameter values at this instant, in the same shape the scene builder takes. */
  overrides: MathExpressionVariables;
  delayMs: number;
}

export interface Graph3DAnimationTimeline {
  loopMs: number;
  frames: Graph3DAnimationFrame[];
}

/** Parameters the author asked to keep moving once the material sits on the page. */
export function graph3DPageAnimationParameters(spec: Graph3DSpec): Graph3DParameter[] {
  return spec.parameters.filter((parameter) => parameter.animation?.playOnPage === true);
}

export function graph3DHasPageAnimation(spec: Graph3DSpec): boolean {
  return graph3DPageAnimationParameters(spec).length > 0;
}

/**
 * Value of one animated parameter at `timeMs` from the start of playback.
 *
 * The sweep is always the parameter's own `min`..`max`: the range the card states as
 * `min ≦ name ≦ max` is the only place it is written down.
 */
export function graph3DAnimationValueAt(parameter: Graph3DParameter, timeMs: number): number {
  const animation = parameter.animation;
  const span = parameter.max - parameter.min;
  const raw = Math.max(0, timeMs) / Math.max(1, animation?.durationMs ?? DEFAULT_DURATION_MS);
  if (animation?.loop === "once") return parameter.min + span * Math.min(1, raw);
  const cycle = Math.floor(raw);
  const fraction = raw - cycle;
  const progress = animation?.loop === "repeat" ? fraction : (cycle % 2 === 1 ? 1 - fraction : fraction);
  return parameter.min + span * progress;
}

/** How long one full pass takes before the picture is back where it started. */
export function graph3DAnimationCycleMs(parameter: Graph3DParameter): number {
  const animation = parameter.animation;
  const durationMs = animation?.durationMs ?? DEFAULT_DURATION_MS;
  return animation?.loop === "pingPong" || animation?.loop === undefined ? durationMs * 2 : durationMs;
}

export function buildGraph3DAnimationTimeline(
  spec: Graph3DSpec,
  options: { maxFrames?: number } = {},
): Graph3DAnimationTimeline | null {
  const parameters = graph3DPageAnimationParameters(spec);
  if (parameters.length === 0) return null;
  // Several moving parameters share one loop: the longest pass sets its length and each parameter
  // is read off its own clock, so a shorter one simply runs through more than once.
  const loopMs = clamp(
    Math.max(...parameters.map(graph3DAnimationCycleMs)),
    MIN_LOOP_MS,
    MAX_LOOP_MS,
  );
  const ceiling = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, options.maxFrames ?? MAX_FRAMES));
  const frameCount = clamp(Math.round(loopMs / TARGET_FRAME_MS), MIN_FRAMES, ceiling);
  const delayMs = Math.max(1, Math.round(loopMs / frameCount));
  const frames = Array.from({ length: frameCount }, (_unused, index) => {
    const timeMs = (index / frameCount) * loopMs;
    const overrides: Record<string, number> = {};
    for (const parameter of parameters) {
      overrides[parameter.name] = graph3DAnimationValueAt(parameter, timeMs);
    }
    return { delayMs, overrides };
  });
  return { loopMs, frames };
}

/** Frames a material of this size may spend before the pixel budget is used up. */
export function graph3DAnimationMaxFrames(width: number, height: number): number {
  const perFrame = Math.max(1, Math.round(width) * Math.round(height));
  return Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, Math.floor(ANIMATION_PIXEL_BUDGET / perFrame)));
}

/** Capture pixels per document pixel, traded down so the whole animation fits the budget. */
export function graph3DAnimationSupersample(
  width: number,
  height: number,
  frameCount: number,
): number {
  const pixels = Math.max(1, Math.round(width) * Math.round(height) * Math.max(1, frameCount));
  const byBudget = Math.sqrt(ANIMATION_PIXEL_BUDGET / pixels);
  if (!Number.isFinite(byBudget)) return 1;
  return clamp(byBudget, 1, MAX_ANIMATION_SUPERSAMPLE);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Shortest video worth writing to a file, and the longest one a worksheet figure justifies. */
const MIN_VIDEO_MS = 1_000;
const MAX_VIDEO_MS = 30_000;

function graph3DParameterSpans(parameter: Graph3DParameter): boolean {
  return Number.isFinite(parameter.min) && Number.isFinite(parameter.max) && parameter.max > parameter.min;
}

/**
 * Parameters an exported video animates.
 *
 * The page set wins when the author picked one, so the video shows what the worksheet shows.
 * With nothing marked there is no page animation to copy, and the author still pressed
 * “書き出す”: every parameter that spans a range then moves, each on the clock written in its
 * own card.
 */
export function graph3DVideoAnimationParameters(spec: Graph3DSpec): Graph3DParameter[] {
  const onPage = graph3DPageAnimationParameters(spec).filter(graph3DParameterSpans);
  return onPage.length > 0 ? onPage : spec.parameters.filter(graph3DParameterSpans);
}

/** One full pass of the slowest animated parameter. */
export function graph3DVideoDurationMs(parameters: readonly Graph3DParameter[]): number {
  if (parameters.length === 0) return 0;
  return clamp(Math.max(...parameters.map(graph3DAnimationCycleMs)), MIN_VIDEO_MS, MAX_VIDEO_MS);
}

/** Every animated parameter read off its own clock at the same instant. */
export function graph3DAnimationOverridesAt(
  parameters: readonly Graph3DParameter[],
  timeMs: number,
): MathExpressionVariables {
  const overrides: Record<string, number> = {};
  for (const parameter of parameters) {
    overrides[parameter.name] = graph3DAnimationValueAt(parameter, timeMs);
  }
  return overrides;
}
