import { memo } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

import {
  Graph2DPreview,
  OverlayRichTextPreview,
  OverlayTableStaticView,
} from "@/features/rendering/adapters/react";
import {
  arrowheadOrient,
  arrowheadPathData,
  getArrowheadMarkerRequests,
  overlayLabelFontSize,
  overlayStrokeWidth,
  type ArrowheadEndpointPlan,
} from "@/features/rendering/core";
import type {
  Graph2DSpec,
} from "@/features/document";
import {
  getArrowheadPathTrim,
  getShapeArrowheadPlan,
  getShapeBounds,
  getCalloutGeometry,
  getCalloutTextRect,
  getShapeDimensionBounds,
  getShapeLabelPlacement,
  getShapeRotation,
  getShapeRotationPivot,
  getTextShapeFontSizePt,
  getTextShapeRenderedLineHeightPx,
  MIN_TEXT_SHAPE_WIDTH,
  trimPolylinePoints,
} from "@/features/drawing";
import type { GraphSpecChangeMeta } from "@/lib/graph2d";
import { countPerformanceEvent } from "@/lib/performance";

import type { OriginPickPreview } from "./shape-editors";
import { getImageCropCss } from "./image-crop";
import type { OverlayShapeDecoration } from "./editor-extension";
import { getAxisAlignedRotatedBounds } from "./math";
import {
  dashToStrokeDasharray,
  getArcFill,
  getArcPath,
  getGeoPolygonPoints,
  markerUrl,
} from "./render-attrs";
import { getCalloutPath } from "./shapes/callout";
import { getGraphRenderLayout } from "./shapes/graph";
import {
  getLinePolylinePoints,
  getLineSvgPath,
  isClosedPolyline,
  normalizeLineKind,
} from "./shapes/line";
import type {
  OverlayAsset,
  OverlayBounds,
  OverlayPoint,
  OverlayShape,
  OverlayShapeId,
} from "./types";

const ORIGIN_PICK_MARKER_RADIUS = 14;

/**
 * The `transform-origin` for a div laid out on the reference box.
 *
 * `"center"` for an un-rotated shape, so nothing about the layout of the un-rotated case changes.
 * Once a shape is turned, it turns about the middle of what it draws — for an arc that is 25px
 * away from the middle of the box this div occupies. See `getShapeRotationPivot`.
 */
function shapeTransformOrigin(shape: OverlayShape, bounds: OverlayBounds, rotation: number): string {
  if (!rotation) {
    return "center";
  }

  const pivot = getShapeRotationPivot(shape);
  return `${pivot.x - bounds.x}px ${pivot.y - bounds.y}px`;
}

/**
 * The caption's anchor inside this shape's own `<svg>`, which spans the reference box.
 *
 * The position itself comes from `getShapeLabelPlacement`, the one definition the exported SVG and
 * the visible box read as well; only the page-to-local shift belongs here.
 */
function toLocalLabelPoint(shape: OverlayShape, bounds: OverlayBounds): OverlayPoint | null {
  const placement = getShapeLabelPlacement(shape);
  return placement
    ? { x: placement.anchor.x - bounds.x, y: placement.anchor.y - bounds.y }
    : null;
}

/**
 * Seam that keeps the editing runtime out of the static rendering path.
 *
 * Text and table shapes are edited through Tiptap, which must not reach `packages/viewer`
 * (`package-boundary.test.ts`) — and the viewer mounts this renderer through
 * `components/print/PrintPreview.tsx`. The interactive surface injects its editors here
 * (`shape-interactive-body.tsx`); every read-only surface omits them and gets the static views, so
 * a missing renderer is the read-only case rather than a mistake.
 */
export interface OverlayShapeEditorRenderers {
  renderTableEditor: (props: { editing: boolean; shape: Extract<OverlayShape, { type: "tableShape" }> }) => ReactNode;
  renderTextEditor: (props: {
    editing: boolean;
    externalRevision: number;
    shape: Extract<OverlayShape, { type: "callout" | "text" }>;
  }) => ReactNode;
}

export const noopFocus = () => {};
export const noopTextEditorCancel = () => {};
export const noopTextAutoSize = () => {};
export const noopTextChange = () => {};
export const noopGraphSpecChange = () => {};
export const noopGraphCropEnd = () => {};
export const noopTableEditorFocus = () => {};
export const noopTableChange = () => {};
export const noopTableResize = () => {};
export const noopShapePointerDown = () => {};
export const noopShapeDoubleClick = () => {};

export function OverlayShapeReadOnlyView({
  shape,
  assets,
  externalRevision = 0,
  diffClassName,
  decoration,
}: {
  shape: OverlayShape;
  assets: Record<string, OverlayAsset>;
  externalRevision?: number;
  /** Extra host-owned diff/apply class names; the renderer treats them opaquely. */
  diffClassName?: string;
  /** Optional feature-owned visual rendered without changing shape geometry. */
  decoration?: OverlayShapeDecoration | null;
}) {
  return (
    <OverlayShapeView
      shape={shape}
      assets={assets}
      externalRevision={externalRevision}
      selected={false}
      editing={false}
      disableGraphCrop
      hideGraphAxes={false}
      originPickPreview={null}
      dragTranslate={null}
      diffClassName={diffClassName}
      decoration={decoration}
      onPointerDown={noopShapePointerDown}
      onDoubleClick={noopShapeDoubleClick}
      onGraphSpecChange={noopGraphSpecChange}
      onGraphCropEnd={noopGraphCropEnd}
    />
  );
}

export function composeShapeTransform(
  rotation: number,
  dragTranslate: OverlayPoint | null,
  flipX = false,
  flipY = false,
): string | undefined {
  const parts: string[] = [];
  if (dragTranslate && (dragTranslate.x !== 0 || dragTranslate.y !== 0)) {
    parts.push(`translate(${dragTranslate.x}px, ${dragTranslate.y}px)`);
  }
  if (rotation) {
    parts.push(`rotate(${rotation}rad)`);
  }
  if (flipX || flipY) {
    parts.push(`scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export const OverlayShapeView = memo(function OverlayShapeView({
  shape,
  assets,
  externalRevision,
  selected,
  editing,
  disableGraphCrop,
  hideGraphAxes,
  originPickPreview,
  dragTranslate,
  onPointerDown,
  onDoubleClick,
  onGraphSpecChange,
  onGraphCropEnd,
  diffClassName,
  decoration,
  editorRenderers,
  textPaintRevision,
}: {
  shape: OverlayShape;
  assets: Record<string, OverlayAsset>;
  externalRevision: number;
  selected: boolean;
  editing: boolean;
  /** Omitted by every read-only surface; see `OverlayShapeEditorRenderers`. */
  editorRenderers?: OverlayShapeEditorRenderers;
  /** Changes only when a visible static text body must be rasterized again. */
  textPaintRevision?: number;
  disableGraphCrop: boolean;
  hideGraphAxes: boolean;
  originPickPreview: OriginPickPreview | null;
  dragTranslate: OverlayPoint | null;
  /** Host-owned diff/apply classes shared by read-only and interactive views. */
  diffClassName?: string;
  /** Optional feature-owned class and in-bounds overlay. */
  decoration?: OverlayShapeDecoration | null;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, shape: OverlayShape) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>, shape: OverlayShape) => void;
  onGraphSpecChange: (shapeId: OverlayShapeId, spec: Graph2DSpec, meta?: GraphSpecChangeMeta) => void;
  onGraphCropEnd: () => void;
}) {
  countPerformanceEvent("OverlayShapeView.render");
  const bounds = getShapeBounds(shape);
  const rotation = getShapeRotation(shape);
  const className = `overlay-shape overlay-shape-${shape.type} ${selected ? "selected" : ""} ${shape.locked ? "locked" : ""} ${decoration?.className ?? ""} ${diffClassName ?? ""}`;

  return (
    <div
      data-overlay-shape-id={shape.id}
      className={className}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.w,
        height: bounds.h,
        transform: composeShapeTransform(rotation, dragTranslate, shape.flipX, shape.flipY),
        transformOrigin: shapeTransformOrigin(shape, bounds, rotation),
        opacity: shape.opacity,
      }}
      onPointerDown={(event) => onPointerDown(event, shape)}
      onDoubleClickCapture={(event) => {
        if (shape.type !== "graph2dShape") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onDoubleClick(event, shape);
      }}
      onDoubleClick={(event) => {
        if (shape.type === "graph2dShape") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onDoubleClick(event, shape);
      }}
    >
      <ShapeBody
        key={!editing && (shape.type === "text" || shape.type === "callout") ? textPaintRevision : undefined}
        shape={shape}
        assets={assets}
        bounds={bounds}
        externalRevision={externalRevision}
        editing={editing}
        disableGraphCrop={disableGraphCrop}
        hideGraphAxes={hideGraphAxes}
        originPickPreview={originPickPreview}
        onGraphSpecChange={onGraphSpecChange}
        onGraphCropEnd={onGraphCropEnd}
        editorRenderers={editorRenderers}
      />
      {decoration?.content}
    </div>
  );
});

export const OverlayShapeDimensionLabels = memo(function OverlayShapeDimensionLabels({
  shapes,
  dragTranslate,
  movingShapeIds,
}: {
  shapes: OverlayShape[];
  dragTranslate: OverlayPoint | null;
  movingShapeIds: ReadonlySet<OverlayShapeId> | null;
}) {
  return (
    <>
      {shapes.map((shape) => (
        <OverlayShapeDimensionLabel
          key={`dimension-${shape.id}`}
          shape={shape}
          dragTranslate={movingShapeIds?.has(shape.id) ? dragTranslate : null}
        />
      ))}
    </>
  );
});

const OverlayShapeDimensionLabel = memo(function OverlayShapeDimensionLabel({
  shape,
  dragTranslate,
}: {
  shape: OverlayShape;
  dragTranslate: OverlayPoint | null;
}) {
  const bounds = getShapeDimensionBounds(shape);
  const rotatedBounds = getAxisAlignedRotatedBounds(bounds, getShapeRotation(shape));
  const labelCenterX = bounds.x + bounds.w / 2;
  const offsetX = dragTranslate?.x ?? 0;
  const offsetY = dragTranslate?.y ?? 0;

  return (
    <div
      className="overlay-shape-dimension-label"
      style={{
        left: labelCenterX + offsetX,
        top: rotatedBounds.y + rotatedBounds.h + 2 + offsetY,
      }}
      aria-hidden="true"
    >
      {formatShapeDimensionLabel(bounds)}
    </div>
  );
});

export const OverlayShapeHitTarget = memo(function OverlayShapeHitTarget({
  shape,
  selected,
  dragTranslate,
  onPointerDown,
  onDoubleClick,
}: {
  shape: OverlayShape;
  selected: boolean;
  dragTranslate: OverlayPoint | null;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, shape: OverlayShape) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>, shape: OverlayShape) => void;
}) {
  const bounds = getShapeBounds(shape);
  const rotation = getShapeRotation(shape);

  return (
    <div
      data-overlay-shape-id={shape.id}
      className={`overlay-shape overlay-shape-hit-target ${selected ? "selected" : ""}`}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.w,
        height: bounds.h,
        transform: composeShapeTransform(rotation, dragTranslate, shape.flipX, shape.flipY),
        transformOrigin: shapeTransformOrigin(shape, bounds, rotation),
      }}
      onPointerDown={(event) => onPointerDown(event, shape)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDoubleClick(event, shape);
      }}
    />
  );
});

export function ShapeBody({
  shape,
  assets,
  bounds,
  externalRevision,
  editing,
  disableGraphCrop,
  hideGraphAxes,
  originPickPreview,
  onGraphSpecChange,
  onGraphCropEnd,
  editorRenderers,
}: {
  shape: OverlayShape;
  assets: Record<string, OverlayAsset>;
  bounds: OverlayBounds;
  externalRevision: number;
  editing: boolean;
  /** Omitted by every read-only surface; see `OverlayShapeEditorRenderers`. */
  editorRenderers?: OverlayShapeEditorRenderers;
  disableGraphCrop: boolean;
  hideGraphAxes: boolean;
  originPickPreview: OriginPickPreview | null;
  onGraphSpecChange: (shapeId: OverlayShapeId, spec: Graph2DSpec, meta?: GraphSpecChangeMeta) => void;
  onGraphCropEnd: () => void;
}) {
  if (shape.type === "geo") {
    const strokeWidth = overlayStrokeWidth(shape.props.size);
    const labelPoint = { x: shape.props.w / 2, y: shape.props.h / 2 };
    return (
      <svg
        className="overlay-vector-svg"
        viewBox={`0 0 ${shape.props.w} ${shape.props.h}`}
        aria-hidden="true"
        style={{
          color: shape.props.color,
          strokeWidth,
          strokeDasharray: dashToStrokeDasharray(shape.props.dash),
        }}
      >
        <GeoSvgBody shape={shape} />
        {shape.props.label && (
          <text
            x={labelPoint.x}
            y={labelPoint.y}
            fill={shape.props.labelColor}
            stroke="none"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={overlayLabelFontSize(shape.props.size)}
          >
            {shape.props.label}
          </text>
        )}
      </svg>
    );
  }

  if (shape.type === "arrow") {
    const start = { x: shape.x + shape.props.start.x - bounds.x, y: shape.y + shape.props.start.y - bounds.y };
    const end = { x: shape.x + shape.props.end.x - bounds.x, y: shape.y + shape.props.end.y - bounds.y };
    const labelPoint = toLocalLabelPoint(shape, bounds);
    const strokeWidth = overlayStrokeWidth(shape.props.size);
    const plan = getShapeArrowheadPlan(shape);
    const [drawnStart, drawnEnd] = trimPolylinePoints([start, end], plan.start.trimPx, plan.end.trimPx);
    return (
      <svg
        className="overlay-vector-svg"
        viewBox={`0 0 ${bounds.w} ${bounds.h}`}
        aria-hidden="true"
        style={{
          color: shape.props.color,
          strokeWidth,
          strokeDasharray: dashToStrokeDasharray(shape.props.dash),
        }}
      >
        <defs>
          <ArrowMarkerDefs
            shapeId={shape.id}
            color={shape.props.color}
            opacity={shape.props.strokeOpacity}
            plan={plan}
          />
        </defs>
        <line
          x1={drawnStart.x}
          y1={drawnStart.y}
          x2={drawnEnd.x}
          y2={drawnEnd.y}
          strokeOpacity={shape.props.strokeOpacity}
          markerStart={markerUrl(shape.id, "start", plan.start.spec?.kind)}
          markerEnd={markerUrl(shape.id, "end", plan.end.spec?.kind)}
        />
        {labelPoint && (
          <text
            x={labelPoint.x}
            y={labelPoint.y}
            fill={shape.props.labelColor}
            stroke="none"
            textAnchor="middle"
            fontSize={overlayLabelFontSize(shape.props.size)}
          >
            {shape.props.label}
          </text>
        )}
      </svg>
    );
  }

  if (shape.type === "line") {
    const kind = normalizeLineKind(shape.props.kind);
    const points = shape.props.points.map((point) => ({ x: shape.x + point.x - bounds.x, y: shape.y + point.y - bounds.y }));
    const closed = isClosedPolyline(kind, points, shape.props.closed);
    const labelPoint = toLocalLabelPoint(shape, bounds);
    const strokeWidth = overlayStrokeWidth(shape.props.size);
    // One source for both "does this end draw a head" and "how much does it give up", so a closed
    // polyline can never end up shortened at an end that declares no marker.
    const plan = getShapeArrowheadPlan(shape);
    const drawnPoints = trimPolylinePoints(points, plan.start.trimPx, plan.end.trimPx);
    const markerStart = markerUrl(shape.id, "start", plan.start.spec?.kind);
    const markerEnd = markerUrl(shape.id, "end", plan.end.spec?.kind);
    const patternId = `fill-${shape.id}`;
    const fill = closed && shape.props.fill === "solid"
      ? shape.props.fillPattern === "diagonalHatch"
        ? `url(#${patternId})`
        : shape.props.fillColor ?? shape.props.color
      : "none";
    return (
      <svg
        className="overlay-vector-svg"
        viewBox={`0 0 ${bounds.w} ${bounds.h}`}
        aria-hidden="true"
        style={{
          color: shape.props.color,
          strokeWidth,
          strokeDasharray: dashToStrokeDasharray(shape.props.dash),
        }}
      >
        <defs>
          <ArrowMarkerDefs
            shapeId={shape.id}
            color={shape.props.color}
            opacity={shape.props.strokeOpacity}
            plan={plan}
          />
          {shape.props.fillPattern === "diagonalHatch" && (
            <pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6">
              <rect width="6" height="6" fill={shape.props.fillColor ?? "#ffffff"} />
              <path d="M -1 7 L 7 -1" stroke={shape.props.color} strokeWidth="1" />
            </pattern>
          )}
        </defs>
        {closed ? (
          <polygon
            points={getLinePolylinePoints(points)}
            fill={fill}
            fillOpacity={shape.props.fillOpacity}
            strokeOpacity={shape.props.strokeOpacity}
          />
        ) : kind === "polyline" ? (
          <polyline
            points={getLinePolylinePoints(drawnPoints)}
            strokeOpacity={shape.props.strokeOpacity}
            markerStart={markerStart}
            markerEnd={markerEnd}
          />
        ) : (
          <path
            d={getLineSvgPath(points, kind, getArrowheadPathTrim(plan))}
            strokeOpacity={shape.props.strokeOpacity}
            markerStart={markerStart}
            markerEnd={markerEnd}
          />
        )}
        {labelPoint && (
          <text
            x={labelPoint.x}
            y={labelPoint.y}
            fill={shape.props.labelColor ?? shape.props.color}
            stroke="none"
            textAnchor="middle"
            fontSize={overlayLabelFontSize(shape.props.size)}
          >
            {shape.props.label}
          </text>
        )}
      </svg>
    );
  }

  if (shape.type === "arc") {
    const strokeWidth = overlayStrokeWidth(shape.props.size);
    const plan = getShapeArrowheadPlan(shape);
    const markerStart = markerUrl(shape.id, "start", plan.start.spec?.kind);
    const markerEnd = markerUrl(shape.id, "end", plan.end.spec?.kind);
    return (
      <svg
        className="overlay-vector-svg"
        viewBox={`0 0 ${bounds.w} ${bounds.h}`}
        aria-hidden="true"
        style={{
          color: shape.props.color,
          strokeWidth,
          strokeDasharray: dashToStrokeDasharray(shape.props.dash),
        }}
      >
        <defs>
          <ArrowMarkerDefs
            shapeId={shape.id}
            color={shape.props.color}
            opacity={shape.props.strokeOpacity}
            plan={plan}
          />
        </defs>
        <path
          d={getArcPath(shape)}
          fill={getArcFill(shape)}
          fillOpacity={shape.props.kind === "sector" ? shape.props.fillOpacity : undefined}
          stroke="currentColor"
          strokeOpacity={shape.props.strokeOpacity}
          markerStart={markerStart}
          markerEnd={markerEnd}
        />
      </svg>
    );
  }

  if (shape.type === "image") {
    const asset = assets[shape.props.assetId];
    return asset ? <OverlayImageBody shape={shape} asset={asset} editing={editing} /> : null;
  }

  if (shape.type === "callout") {
    const geometry = getCalloutGeometry(shape);
    const textRect = getCalloutTextRect(shape);
    const bodyOffsetX = shape.x - bounds.x;
    const bodyOffsetY = shape.y - bounds.y;
    return (
      <div className="callout-shape overlay-callout-shape">
        <svg
          className="callout-shape-svg"
          viewBox={`${geometry.bounds.x} ${geometry.bounds.y} ${geometry.bounds.w} ${geometry.bounds.h}`}
          aria-hidden="true"
          style={{
            strokeWidth: overlayStrokeWidth(shape.props.strokeWidth),
            strokeDasharray: dashToStrokeDasharray(shape.props.dash),
          }}
        >
          <path d={getCalloutPath(shape)} />
        </svg>
        <div
          className="overlay-callout-text-frame"
          style={{
            left: bodyOffsetX + textRect.x,
            top: bodyOffsetY + textRect.y,
            width: textRect.w,
            height: textRect.h,
          }}
        >
          {editing && editorRenderers
            ? editorRenderers.renderTextEditor({ editing, externalRevision, shape })
            : <OverlayTextShapeStaticView shape={shape} />}
        </div>
      </div>
    );
  }

  if (shape.type === "graph2dShape") {
    const layout = getGraphRenderLayout(shape);
    const displaySpec = layout.spec;
    const graphDisplaySpec = hideGraphAxes ? hideGraphAxesInSpec(displaySpec) : displaySpec;
    const graphInteractionActive = editing || disableGraphCrop || hideGraphAxes || originPickPreview !== null;
    return (
      <div
        id={shape.id}
        className="graph-shape overlay-graph-shape"
        data-testid="overlay-graph2d"
        style={{
          position: "absolute",
          left: layout.renderBounds.x - shape.x,
          top: layout.renderBounds.y - shape.y,
          width: layout.renderBounds.w,
          height: layout.renderBounds.h,
          pointerEvents: graphInteractionActive ? "auto" : "none",
        }}
      >
        <Graph2DPreview
          spec={graphDisplaySpec}
          autoStartCrop={editing}
          disableCropInteraction={disableGraphCrop}
          onSpecChange={(nextSpec, meta) => onGraphSpecChange(shape.id, nextSpec, meta)}
          onCropEnd={onGraphCropEnd}
        />
        {originPickPreview && (
          <div
            className="graph-origin-preview"
            data-testid="overlay-graph-origin-preview"
            aria-hidden="true"
          >
            <Graph2DPreview
              spec={getOriginPickPreviewSpec(originPickPreview.spec)}
              className="graph-origin-preview-graph"
              staticMode
              disableCropInteraction
            />
            <svg
              className="graph-origin-preview-marker"
              data-testid="overlay-graph-origin-preview-target"
              viewBox={`0 0 ${originPickPreview.spec.width} ${originPickPreview.spec.height}`}
              aria-hidden="true"
            >
              <line
                x1={Math.max(0, originPickPreview.point.x - ORIGIN_PICK_MARKER_RADIUS)}
                x2={Math.min(originPickPreview.spec.width, originPickPreview.point.x + ORIGIN_PICK_MARKER_RADIUS)}
                y1={originPickPreview.point.y}
                y2={originPickPreview.point.y}
              />
              <line
                x1={originPickPreview.point.x}
                x2={originPickPreview.point.x}
                y1={Math.max(0, originPickPreview.point.y - ORIGIN_PICK_MARKER_RADIUS)}
                y2={Math.min(originPickPreview.spec.height, originPickPreview.point.y + ORIGIN_PICK_MARKER_RADIUS)}
              />
              <circle cx={originPickPreview.point.x} cy={originPickPreview.point.y} r="6" />
            </svg>
          </div>
        )}
      </div>
    );
  }

  if (shape.type === "tableShape") {
    if (editorRenderers) {
      return editorRenderers.renderTableEditor({ editing, shape });
    }
    return (
      <OverlayTableStaticView
        height={shape.props.h}
        table={shape.props.table}
        width={shape.props.w}
      />
    );
  }

  if (shape.type === "group") {
    return null;
  }

  if (!editing || !editorRenderers) {
    return <OverlayTextShapeStaticView shape={shape} />;
  }

  return editorRenderers.renderTextEditor({ editing, externalRevision, shape });
}

export function GeoSvgBody({ shape }: { shape: Extract<OverlayShape, { type: "geo" }> }) {
  const fill = shape.props.fill === "solid" ? shape.props.fillColor ?? shape.props.color : "transparent";
  const commonProps = {
    fill,
    stroke: shape.props.color,
    fillOpacity: shape.props.fillOpacity,
    strokeOpacity: shape.props.strokeOpacity,
  };

  if (shape.props.geo === "ellipse") {
    return (
      <ellipse
        cx={shape.props.w / 2}
        cy={shape.props.h / 2}
        rx={Math.max(1, shape.props.w / 2 - 1)}
        ry={Math.max(1, shape.props.h / 2 - 1)}
        {...commonProps}
      />
    );
  }

  if (shape.props.geo === "triangle" || shape.props.geo === "diamond" || shape.props.geo === "pentagon" || shape.props.geo === "regularPolygon" || shape.props.geo === "blockArrow") {
    return <polygon points={getGeoPolygonPoints(
      shape.props.geo,
      shape.props.w,
      shape.props.h,
      shape.props.apexX,
      shape.props.headLengthRatio,
      shape.props.shaftRatio,
      shape.props.polygonSides,
    )} {...commonProps} />;
  }

  const cornerRadius = typeof shape.props.radius === "number" && shape.props.radius > 0
    ? Math.max(0, Math.min(shape.props.radius, shape.props.w / 2 - 1, shape.props.h / 2 - 1))
    : undefined;
  return (
    <rect
      x={1}
      y={1}
      width={Math.max(1, shape.props.w - 2)}
      height={Math.max(1, shape.props.h - 2)}
      rx={cornerRadius}
      ry={cornerRadius}
      {...commonProps}
    />
  );
}

/**
 * The `<marker>` declarations for one shape's endpoints.
 *
 * Geometry comes from `ARROWHEAD_MARKER_SPECS`, the same table the SVG string exporter and the
 * toolbar preview read, so a head cannot look different here than it does on export. The reference
 * point comes from the endpoint plan rather than the table: it moves back by exactly what the line
 * gave up at this end, which is what puts the head's point on the stored endpoint.
 */
export function ArrowMarkerDefs({
  shapeId,
  color,
  opacity,
  plan,
}: {
  shapeId: OverlayShapeId;
  color: string;
  opacity?: number;
  plan: ArrowheadEndpointPlan;
}) {
  return (
    <>
      {getArrowheadMarkerRequests(shapeId, plan).map(({ spec, endpoint, id, refX }) => (
        <marker
          key={id}
          id={id}
          markerWidth={spec.markerWidth}
          markerHeight={spec.markerHeight}
          refX={refX}
          refY={spec.refY}
          orient={arrowheadOrient(spec, endpoint)}
          markerUnits="strokeWidth"
        >
          {spec.geometry.kind === "circle" ? (
            <circle
              cx={spec.geometry.cx}
              cy={spec.geometry.cy}
              r={spec.geometry.r}
              fill={spec.geometry.filled ? color : "none"}
              opacity={opacity}
              stroke="none"
            />
          ) : (
            <path
              d={arrowheadPathData(spec.geometry)}
              fill={spec.geometry.filled ? color : "none"}
              opacity={opacity}
              stroke={spec.geometry.filled ? "none" : color}
              strokeWidth={spec.geometry.filled ? undefined : spec.geometry.strokeWidth}
              strokeLinecap="butt"
              strokeLinejoin="miter"
            />
          )}
        </marker>
      ))}
    </>
  );
}

export function OverlayTextShapeStaticView({
  shape,
}: {
  shape: Extract<OverlayShape, { type: "text" | "callout" }>;
}) {
  const lineHeightPx = getTextShapeRenderedLineHeightPx(shape);
  const isCallout = shape.type === "callout";
  const autoSize = shape.type === "text" && shape.props.autoSize;
  const constrainedAutoSize = shape.type === "text" && shape.props.autoSize && shape.props.maxWidth !== undefined;
  return (
    <div
      className={`overlay-text-shape ${isCallout ? "embedded-callout" : ""} ${autoSize ? "auto-size" : ""} ${constrainedAutoSize ? "constrained" : ""}`}
      style={{
        width: isCallout
          ? "100%"
          : constrainedAutoSize
            ? shape.props.maxWidth
            : autoSize
              ? "max-content"
              : shape.props.w,
        minWidth: isCallout ? 0 : MIN_TEXT_SHAPE_WIDTH,
        minHeight: isCallout ? lineHeightPx : Math.max(shape.props.h ?? 0, lineHeightPx),
        color: shape.props.color,
        fontSize: `${getTextShapeFontSizePt(shape)}pt`,
        pointerEvents: "none",
      }}
    >
      <div className="overlay-text-shape-content ProseMirror">
        <OverlayRichTextPreview node={shape.props.richText} keyPrefix={`overlay-text-${shape.id}`} />
      </div>
    </div>
  );
}

export function OverlayImageBody({
  shape,
  asset,
  editing,
}: {
  shape: Extract<OverlayShape, { type: "image" }>;
  asset: OverlayAsset;
  editing: boolean;
}) {
  const cropStyle = getImageCropCss(shape, asset);
  return (
    <div className={`overlay-image-frame ${editing ? "cropping" : ""}`}>
      {editing && (
        <div
          className="overlay-image-crop-ghost"
          style={{
            width: cropStyle.width,
            height: cropStyle.height,
            transform: cropStyle.transform,
          }}
          aria-hidden="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.props.src} alt="" draggable={false} />
        </div>
      )}
      <div className="overlay-image-crop-viewport">
        <div
          className="overlay-image-crop-inner"
          style={{
            width: cropStyle.width,
            height: cropStyle.height,
            transform: cropStyle.transform,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="overlay-image-shape" src={asset.props.src} alt={asset.props.name} draggable={false} />
        </div>
      </div>
    </div>
  );
}

function formatShapeDimensionLabel(bounds: OverlayBounds): string {
  return `${Math.max(1, Math.round(bounds.w))} x ${Math.max(1, Math.round(bounds.h))}`;
}

function hideGraphAxesInSpec(spec: Graph2DSpec): Graph2DSpec {
  return {
    ...spec,
    axes: {
      ...spec.axes,
      grid: false,
      showX: false,
      showY: false,
      showTicks: false,
    },
  };
}

function getOriginPickPreviewSpec(spec: Graph2DSpec): Graph2DSpec {
  return {
    ...spec,
    title: "",
    axes: {
      ...spec.axes,
      grid: false,
      showX: true,
      showY: spec.kind === "cartesian",
      showTicks: false,
    },
    points: undefined,
    annotations: undefined,
    fills: undefined,
    showFormulaLabels: false,
  };
}
