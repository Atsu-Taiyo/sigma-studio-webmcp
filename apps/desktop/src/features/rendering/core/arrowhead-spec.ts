// Type only: the rendering core must not pull the document layer in at runtime
// (`features/document/architecture.test.ts` pins that edge).
import type { OverlayArrowhead } from "@/features/document";

/**
 * The one description of what an arrow head looks like.
 *
 * Three renderers draw these: the editor canvas (which is also the print/PDF path), the SVG string
 * exporter (embedded viewer, thumbnails, template gallery) and the toolbar preview. They used to
 * carry three independent copies of the geometry, so every new head risked "selectable in the menu
 * but a different shape on paper". They all read this table now.
 *
 * Coordinates are in marker units. Every marker is declared `markerUnits="strokeWidth"`, so one
 * unit equals one pixel of the line's stroke width and a head grows with the line for free.
 */

/** Geometry drawn from straight segments. `closed` heads are filled outlines. */
export interface ArrowheadPolylineGeometry {
  readonly kind: "polyline";
  readonly points: readonly ArrowheadPoint[];
  readonly closed: boolean;
  readonly filled: boolean;
  readonly strokeWidth: number;
}

export interface ArrowheadCircleGeometry {
  readonly kind: "circle";
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly filled: boolean;
}

export interface ArrowheadPoint {
  readonly x: number;
  readonly y: number;
}

export type ArrowheadGeometry = ArrowheadPolylineGeometry | ArrowheadCircleGeometry;

export type ArrowheadKind = Exclude<OverlayArrowhead, "none">;

export interface ArrowheadMarkerSpec {
  readonly kind: ArrowheadKind;
  /**
   * The marker element id prefix.
   *
   * `arrow` has been persisted as the id `arrowhead` since the first release; the alias lives here
   * and nowhere else so the two renderers cannot disagree about it.
   */
  readonly idPrefix: string;
  readonly markerWidth: number;
  readonly markerHeight: number;
  /**
   * The marker-space x that has to land on the endpoint the document stores.
   *
   * For a head that points, this is its front-most ink — the miter of an open head, which sits well
   * ahead of the vertex listed in `points`. For a head that only marks the endpoint (a dot, a bar)
   * it is the centre, because a half turn has to leave the mark where it was.
   *
   * This is not the `<marker refX>`: the reference point moves back by whatever the line gave up at
   * this end, and only `planArrowheadEndpoints` knows that. See `ArrowheadPlacement`.
   */
  readonly tipX: number;
  /**
   * The marker-space x where the line's own stroke has to stop.
   *
   * Near a point the head is thinner than the line, and `stroke-linecap: butt` ends the line in a
   * square edge, so a line drawn all the way to the tip replaces the point with a rectangular stub
   * — the reported bug. Stopping the line here puts its end where the head is already wider than
   * the stroke (filled heads get half a unit of overlap so no seam shows).
   */
  readonly lineStopX: number;
  readonly refY: number;
  /**
   * Whether the start endpoint needs `orient="auto-start-reverse"`.
   *
   * True exactly when the head is not symmetric under a half turn about its reference point: an
   * arrow anchored at its tip has to be flipped to point away from the line, while a bar or a dot
   * anchored at its centre looks identical either way.
   */
  readonly reversibleOrient: boolean;
  readonly geometry: ArrowheadGeometry;
}

const OPEN_HEAD_STROKE = 1.2;

/**
 * Keyed by head so the compiler demands an entry for every value in `OVERLAY_ARROWHEADS`.
 *
 * A new head added to the document model breaks this table before it can reach a renderer that
 * silently draws nothing.
 */
const ARROWHEAD_MARKER_SPEC_TABLE: Record<ArrowheadKind, Omit<ArrowheadMarkerSpec, "kind">> = {
  arrow: {
    idPrefix: "arrowhead",
    // Wide enough for the miter: the vertex is at 7 but the ink runs to 8.45, and `<marker>` clips
    // whatever passes its own box.
    markerWidth: 9,
    markerHeight: 8,
    tipX: 8.45,
    lineStopX: 7,
    refY: 4,
    reversibleOrient: true,
    geometry: {
      kind: "polyline",
      points: [{ x: 1.5, y: 1.5 }, { x: 7, y: 4 }, { x: 1.5, y: 6.5 }],
      closed: false,
      filled: false,
      strokeWidth: OPEN_HEAD_STROKE,
    },
  },
  triangle: {
    idPrefix: "triangle",
    markerWidth: 8,
    markerHeight: 8,
    tipX: 7,
    lineStopX: 1.5,
    refY: 4,
    reversibleOrient: true,
    geometry: {
      kind: "polyline",
      points: [{ x: 1, y: 1 }, { x: 7, y: 4 }, { x: 1, y: 7 }],
      closed: true,
      filled: true,
      strokeWidth: 0,
    },
  },
  openArrow: {
    idPrefix: "openArrow",
    markerWidth: 9,
    markerHeight: 10,
    tipX: 8.07,
    lineStopX: 7,
    refY: 5,
    reversibleOrient: true,
    geometry: {
      kind: "polyline",
      points: [{ x: 0.8, y: 0.8 }, { x: 7, y: 5 }, { x: 0.8, y: 9.2 }],
      closed: false,
      filled: false,
      strokeWidth: OPEN_HEAD_STROKE,
    },
  },
  thinArrow: {
    idPrefix: "thinArrow",
    // Two units wider than the vertex: a 15° point overshoots it by most of two units at the miter.
    markerWidth: 11,
    markerHeight: 8,
    tipX: 10.7,
    lineStopX: 9,
    refY: 4,
    reversibleOrient: true,
    geometry: {
      kind: "polyline",
      points: [{ x: 1, y: 1.8 }, { x: 9, y: 4 }, { x: 1, y: 6.2 }],
      closed: false,
      filled: false,
      strokeWidth: 0.9,
    },
  },
  diamond: {
    idPrefix: "diamond",
    markerWidth: 10,
    markerHeight: 8,
    tipX: 9,
    lineStopX: 1.5,
    refY: 4,
    reversibleOrient: true,
    geometry: {
      kind: "polyline",
      points: [{ x: 1, y: 4 }, { x: 5, y: 1 }, { x: 9, y: 4 }, { x: 5, y: 7 }],
      closed: true,
      filled: true,
      strokeWidth: 0,
    },
  },
  dot: {
    idPrefix: "dot",
    markerWidth: 8,
    markerHeight: 8,
    // A dot marks the endpoint rather than pointing at it: its centre belongs on the endpoint, and
    // from there the circle already covers the line's end.
    tipX: 4,
    lineStopX: 4,
    refY: 4,
    reversibleOrient: false,
    geometry: { kind: "circle", cx: 4, cy: 4, r: 3, filled: true },
  },
  bar: {
    idPrefix: "bar",
    markerWidth: 8,
    markerHeight: 12,
    tipX: 4,
    lineStopX: 4,
    refY: 6,
    reversibleOrient: false,
    geometry: {
      kind: "polyline",
      points: [{ x: 4, y: 0 }, { x: 4, y: 12 }],
      closed: false,
      filled: false,
      strokeWidth: 2,
    },
  },
};

/** The specs in menu order. */
export const ARROWHEAD_MARKER_SPECS: readonly ArrowheadMarkerSpec[] = (
  Object.keys(ARROWHEAD_MARKER_SPEC_TABLE) as ArrowheadKind[]
).map((kind) => ({ kind, ...ARROWHEAD_MARKER_SPEC_TABLE[kind] }));

/**
 * Lookup by head name.
 *
 * A `Map`, not an object literal: the key comes from document data, and a plain literal answers
 * `__proto__` with an inherited value that `?? fallback` never replaces.
 */
const SPECS_BY_KIND = new Map<string, ArrowheadMarkerSpec>(
  ARROWHEAD_MARKER_SPECS.map((spec) => [spec.kind, spec]),
);

export function getArrowheadMarkerSpec(head: OverlayArrowhead | string | undefined): ArrowheadMarkerSpec | null {
  if (typeof head !== "string") {
    return null;
  }
  return SPECS_BY_KIND.get(head) ?? null;
}

/**
 * The marker element id for one endpoint, or `null` when nothing should be drawn.
 *
 * Both renderers build their `<marker id>` and their `url(#…)` reference through this, so the
 * `arrow` → `arrowhead` alias can never apply on one side only.
 */
export function arrowheadMarkerId(
  head: OverlayArrowhead | string | undefined,
  shapeId: string,
  endpoint: "start" | "end",
): string | null {
  const spec = getArrowheadMarkerSpec(head);
  if (!spec) {
    return null;
  }
  return `${spec.idPrefix}-${shapeId}-${endpoint}`;
}

/**
 * How far the head is set back from the endpoint, in stroke widths.
 *
 * Marker units are stroke widths, so this is a ratio and not a pixel count: a `diamond` on an `xl`
 * line gives up 37.5px and on an `s` line 9.4px. A constant number of pixels would make a thick
 * short arrow disappear and a thin one still show its stub.
 */
export function getArrowheadTrimInStrokes(head: OverlayArrowhead | string | undefined): number {
  const spec = getArrowheadMarkerSpec(head);
  if (!spec) {
    return 0;
  }
  return Math.max(0, spec.tipX - spec.lineStopX);
}

/**
 * One endpoint's share of the drawing: how much the line gives up, and where the marker anchors.
 *
 * The two are only correct together — `refX + trimPx / strokeWidth === spec.tipX` is what puts the
 * head's point on the endpoint the document stores, and every clamp below preserves it.
 */
export interface ArrowheadPlacement {
  readonly spec: ArrowheadMarkerSpec | null;
  /** How much shorter the drawn path is at this end, in px. */
  readonly trimPx: number;
  /** The `<marker refX>` for this end. Meaningless when `spec` is null. */
  readonly refX: number;
}

export interface ArrowheadEndpointPlan {
  readonly start: ArrowheadPlacement;
  readonly end: ArrowheadPlacement;
}

/** An endpoint that draws nothing: no head chosen, or a shape that suppresses heads. */
export const NO_ARROWHEAD_PLACEMENT: ArrowheadPlacement = { spec: null, trimPx: 0, refX: 0 };

/**
 * Never take more than this share of the segment the head sits on.
 *
 * `orient="auto"` points a head along the last segment of the path. Trimming that segment away
 * entirely hands the head the direction of the segment before it, and the arrow swings to a
 * different angle while the author drags a vertex — a symptom with no obvious cause.
 */
const MAX_TERMINAL_SEGMENT_TRIM_RATIO = 0.9;

/** …and never more than this share of the whole path, so a short line keeps some line. */
const MAX_TOTAL_TRIM_RATIO = 0.8;

/**
 * Where to stop the line and where to anchor each head.
 *
 * Both clamps degrade towards "draw it the way it was drawn before": when the trim is clamped to
 * zero, `refX` becomes `tipX` and the result is exactly a head anchored at its own point, which is
 * what every renderer did before this existed.
 */
export function planArrowheadEndpoints(
  start: OverlayArrowhead | string | undefined,
  end: OverlayArrowhead | string | undefined,
  strokeWidth: number,
  pathLengthPx: number,
  terminalSegmentLengthPx: { readonly start: number; readonly end: number },
  /**
   * An extra ceiling the caller may impose, in px.
   *
   * A `<marker>` is a rigid straight stamp: `orient="auto"` aims it along the tangent at the point
   * the path ends, and it reaches forward from there in a straight line. On a curve that straight
   * reach leaves the curve, so a caller that draws one caps the trim at the point where the drift
   * stops being visible. Straight paths pass nothing.
   */
  maxTrimPx?: { readonly start: number; readonly end: number },
): ArrowheadEndpointPlan {
  const startSpec = getArrowheadMarkerSpec(start);
  const endSpec = getArrowheadMarkerSpec(end);
  const stroke = Number.isFinite(strokeWidth) && strokeWidth > 0 ? strokeWidth : 0;

  let startTrim = clampToSegment(
    clampToCeiling(idealTrim(startSpec, stroke), maxTrimPx?.start),
    terminalSegmentLengthPx.start,
  );
  let endTrim = clampToSegment(
    clampToCeiling(idealTrim(endSpec, stroke), maxTrimPx?.end),
    terminalSegmentLengthPx.end,
  );

  const budget = Number.isFinite(pathLengthPx) && pathLengthPx > 0
    ? pathLengthPx * MAX_TOTAL_TRIM_RATIO
    : 0;
  const total = startTrim + endTrim;
  if (total > budget) {
    const scale = total > 0 ? budget / total : 0;
    startTrim *= scale;
    endTrim *= scale;
  }

  return {
    start: toPlacement(startSpec, startTrim, stroke),
    end: toPlacement(endSpec, endTrim, stroke),
  };
}

function idealTrim(spec: ArrowheadMarkerSpec | null, strokeWidth: number): number {
  if (!spec || strokeWidth <= 0) {
    return 0;
  }
  return Math.max(0, spec.tipX - spec.lineStopX) * strokeWidth;
}

function clampToCeiling(trim: number, ceiling: number | undefined): number {
  if (ceiling === undefined) {
    return trim;
  }
  return Number.isFinite(ceiling) && ceiling > 0 ? Math.min(trim, ceiling) : 0;
}

function clampToSegment(trim: number, segmentLength: number): number {
  if (!Number.isFinite(segmentLength) || segmentLength <= 0) {
    return 0;
  }
  return Math.min(trim, segmentLength * MAX_TERMINAL_SEGMENT_TRIM_RATIO);
}

function toPlacement(
  spec: ArrowheadMarkerSpec | null,
  trim: number,
  strokeWidth: number,
): ArrowheadPlacement {
  if (!spec) {
    return NO_ARROWHEAD_PLACEMENT;
  }
  const trimPx = Number.isFinite(trim) && trim > 0 && strokeWidth > 0 ? trim : 0;
  return { spec, trimPx, refX: spec.tipX - (strokeWidth > 0 ? trimPx / strokeWidth : 0) };
}

/**
 * How far a head's own ink reaches forward, in marker units.
 *
 * Not the same as the front-most point in `points`: an open head is a stroked polyline whose miter
 * runs past its vertex by `strokeWidth / |u1 + u2|`, and a butt cap spreads half a stroke sideways.
 * The table's `tipX` is checked against this rather than trusted, because the overshoot moves the
 * moment the head's own stroke width does.
 */
export function getArrowheadInkApexX(geometry: ArrowheadGeometry): number {
  if (geometry.kind === "circle") {
    return geometry.cx + geometry.r;
  }

  const { points, filled, strokeWidth } = geometry;
  let apex = Math.max(...points.map((point) => point.x));
  if (filled || strokeWidth <= 0 || points.length < 2) {
    // A filled outline is its own ink; the table gives these heads `strokeWidth: 0`.
    return apex;
  }

  const half = strokeWidth / 2;
  const directions: ArrowheadPoint[] = [];
  for (let index = 1; index < points.length; index += 1) {
    directions.push(normalize({
      x: points[index].x - points[index - 1].x,
      y: points[index].y - points[index - 1].y,
    }));
  }

  // Butt caps square off across the segment, so the two ends spread half a stroke sideways.
  for (const [point, direction] of [
    [points[0], directions[0]],
    [points[points.length - 1], directions[directions.length - 1]],
  ] as const) {
    apex = Math.max(apex, point.x + Math.abs(direction.y) * half);
  }

  // Miter joins run past the vertex along the bisector of the outer angle.
  for (let index = 1; index < points.length - 1; index += 1) {
    const incoming = directions[index - 1];
    const outgoing = directions[index];
    const bisector = { x: incoming.x - outgoing.x, y: incoming.y - outgoing.y };
    const opening = Math.hypot(incoming.x + outgoing.x, incoming.y + outgoing.y);
    if (opening <= 1e-9) {
      continue;
    }
    const direction = normalize(bisector);
    apex = Math.max(apex, points[index].x + (direction.x * strokeWidth) / opening);
  }

  return apex;
}

function normalize(vector: ArrowheadPoint): ArrowheadPoint {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= 0) {
    return { x: 0, y: 0 };
  }
  return { x: vector.x / length, y: vector.y / length };
}

export interface ArrowheadMarkerRequest {
  readonly spec: ArrowheadMarkerSpec;
  readonly endpoint: "start" | "end";
  readonly id: string;
  /** The reference point this endpoint's plan asked for, never `spec.tipX` directly. */
  readonly refX: number;
}

/**
 * The markers one shape has to declare, in a fixed order.
 *
 * Both renderers build their `<defs>` from this list, so the set of declared markers, the set of
 * referenced ids and the reference points can never diverge. Only the heads the shape actually
 * uses are declared; the endpoints a shape suppresses (a closed polyline, a sector) carry
 * `NO_ARROWHEAD_PLACEMENT` and declare nothing.
 */
export function getArrowheadMarkerRequests(
  shapeId: string,
  plan: ArrowheadEndpointPlan,
): readonly ArrowheadMarkerRequest[] {
  const requests: ArrowheadMarkerRequest[] = [];
  for (const [endpoint, placement] of [["start", plan.start], ["end", plan.end]] as const) {
    const spec = placement.spec;
    const id = spec ? arrowheadMarkerId(spec.kind, shapeId, endpoint) : null;
    if (spec && id) {
      requests.push({ spec, endpoint, id, refX: placement.refX });
    }
  }
  return requests;
}

/** `orient` for one endpoint. Symmetric heads never reverse. */
export function arrowheadOrient(spec: ArrowheadMarkerSpec, endpoint: "start" | "end"): string {
  return endpoint === "start" && spec.reversibleOrient ? "auto-start-reverse" : "auto";
}

/** The `d` attribute for a polyline head. */
export function arrowheadPathData(geometry: ArrowheadPolylineGeometry): string {
  const [first, ...rest] = geometry.points;
  const segments = [`M ${formatCoordinate(first.x)} ${formatCoordinate(first.y)}`];
  for (const point of rest) {
    segments.push(`L ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`);
  }
  if (geometry.closed) {
    segments.push("Z");
  }
  return segments.join(" ");
}

/**
 * How far the head reaches from the endpoint, in stroke widths.
 *
 * Used to size selection boxes: the head is the outermost ink on a line, and because markers are
 * measured in stroke widths a flat padding is wrong at every size but one.
 */
export function getArrowheadExtentInStrokes(head: OverlayArrowhead | string | undefined): number {
  const spec = getArrowheadMarkerSpec(head);
  if (!spec) {
    return 0;
  }
  return specExtentInStrokes(spec);
}

/** The reach of the largest head, for callers that must stay safe on an unrecognised value. */
export const WIDEST_ARROWHEAD_EXTENT_IN_STROKES = Math.max(
  ...ARROWHEAD_MARKER_SPECS.map(specExtentInStrokes),
);

function specExtentInStrokes(spec: ArrowheadMarkerSpec): number {
  return Math.max(spec.markerWidth, spec.markerHeight);
}

/**
 * The same geometry scaled around its anchor point, for previews that cannot use a real marker.
 *
 * The anchor is `tipX`, the same point a real marker puts on the endpoint, so a preview drawn at
 * the end of its line shows the head exactly where the page will put it. `flip` mirrors the head
 * the way `orient="auto-start-reverse"` does, so a start endpoint in the toolbar points the same
 * way it will on the page.
 */
export function scaleArrowheadGeometry(
  spec: ArrowheadMarkerSpec,
  scale: number,
  flip: boolean,
): ArrowheadGeometry {
  const direction = flip ? -1 : 1;
  const project = (point: ArrowheadPoint): ArrowheadPoint => ({
    x: (point.x - spec.tipX) * scale * direction,
    y: (point.y - spec.refY) * scale * direction,
  });
  if (spec.geometry.kind === "circle") {
    const centre = project({ x: spec.geometry.cx, y: spec.geometry.cy });
    return { ...spec.geometry, cx: centre.x, cy: centre.y, r: spec.geometry.r * scale };
  }
  return { ...spec.geometry, points: spec.geometry.points.map(project) };
}

function formatCoordinate(value: number): string {
  return String(Number(value.toFixed(4)));
}
