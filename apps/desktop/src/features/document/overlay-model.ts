import type {
  InlineNode,
  LineHeight,
  TextAlign,
} from "./model/rich-text";
import type { Graph2DSpec } from "./model/graph";

export type OverlayShapeId = string;
export type OverlayAssetId = string;
export type OverlayGroupId = string;
export type OverlayGraphAxisLabelKey = "x" | "y" | "origin";
export type OverlayStackLayer = "foreground" | "background";
export type OverlayExtensionValue =
  | null
  | boolean
  | number
  | string
  | readonly unknown[]
  | { readonly [key: string]: unknown };
export type OverlayExtensions = Record<string, OverlayExtensionValue>;

export type OverlayTextSize = "s" | "m" | "l" | "xl";
export type OverlayRegularPolygonSides = 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type OverlayDash = "solid" | "dashed" | "dotted";
/**
 * Every line/arc endpoint decoration, in the order the toolbar offers them.
 *
 * This array is the single definition of the set: the type, the validator, the MCP schema and the
 * marker specs are all derived from it, so a new head cannot reach one of them and miss another.
 * Existing values keep their name and their meaning — documents store these strings verbatim.
 */
export const OVERLAY_ARROWHEADS = [
  "none",
  "arrow",
  "triangle",
  "openArrow",
  "thinArrow",
  "diamond",
  "dot",
  "bar",
] as const;
export type OverlayArrowhead = (typeof OVERLAY_ARROWHEADS)[number];
export type OverlayLineKind = "polyline" | "curve" | "freehand";

/** Persisted, editor-agnostic rich text used by overlay text shapes. */
export interface OverlayRichTextDocument {
  blocks: OverlayRichTextBlock[];
}

export type OverlayRichTextBlock = OverlayRichTextParagraph | OverlayRichTextHeading;

export interface OverlayRichTextParagraph {
  type: "paragraph";
  children: InlineNode[];
  align?: TextAlign;
  lineHeight?: LineHeight;
}

export interface OverlayRichTextHeading {
  type: "heading";
  level: 1 | 2 | 3;
  children: InlineNode[];
  align?: TextAlign;
  lineHeight?: LineHeight;
}

export interface OverlaySnapshot {
  version: 1;
  shapes: OverlayShape[];
  assets: Record<OverlayAssetId, OverlayAsset>;
  /**
   * Namespaced, JSON-only extension data. Canonical shape and asset objects do
   * not accept arbitrary metadata fields.
   */
  extensions?: OverlayExtensions;
}

export interface OverlayStorageAssetRef {
  kind: "remote-asset";
  storageKey: string;
  assetId: string;
}

export interface OverlayAsset {
  id: OverlayAssetId;
  type: "image";
  props: {
    w: number;
    h: number;
    name: string;
    isAnimated: false;
    mimeType: string | null;
    src: string;
    fileSize: number;
    storage?: OverlayStorageAssetRef;
  };
}

export type OverlayShape =
  | OverlayGroupShape
  | OverlayGeoShape
  | OverlayArcShape
  | OverlayArrowShape
  | OverlayLineShape
  | OverlayTextShape
  | OverlayImageShape
  | OverlayCalloutShape
  | OverlayGraphShape
  | OverlayTableShape;

export type OverlayAnchor =
  | { type: "block"; blockId: string; dy: number; dx?: number; line?: OverlayLineAnchor; reserveSpace?: boolean }
  | { type: "shape"; shapeId: OverlayShapeId; dx: number; dy: number; rx?: number; ry?: number }
  | { type: "page" };

export interface OverlayLineAnchor {
  index: number;
  dy: number;
}

export type OverlayShapePatch = {
  id: OverlayShapeId;
  type: OverlayShape["type"];
  x?: number;
  y?: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  parentId?: OverlayShapeId;
  groupId?: OverlayGroupId;
  stackLayer?: OverlayStackLayer;
  locked?: boolean;
  hidden?: boolean;
  opacity?: number;
  anchor?: OverlayAnchor;
  props?: Record<string, unknown>;
};

interface OverlayBaseShape<Type extends string, Props> {
  id: OverlayShapeId;
  type: Type;
  x: number;
  y: number;
  rotation?: number;
  /** Mirrors the rendered shape in its local horizontal axis. Absent means false. */
  flipX?: boolean;
  /** Mirrors the rendered shape in its local vertical axis. Absent means false. */
  flipY?: boolean;
  parentId?: OverlayShapeId;
  /** Input-only grouping marker. Normalized snapshots use explicit group shapes and parentId. */
  groupId?: OverlayGroupId;
  stackLayer?: OverlayStackLayer;
  locked?: boolean;
  hidden?: boolean;
  opacity?: number;
  /** Vertical anchor. Absent ≡ { type: "page" } (y is used as the page-absolute value). */
  anchor?: OverlayAnchor;
  props: Props;
}

export type OverlayGroupShape = OverlayBaseShape<"group", {
  w: number;
  h: number;
  name?: string;
}>;

export type OverlayGeoShape = OverlayBaseShape<"geo", {
  w: number;
  h: number;
  geo: "rectangle" | "ellipse" | "triangle" | "diamond" | "pentagon" | "regularPolygon" | "blockArrow";
  polygonSides?: OverlayRegularPolygonSides;
  apexX?: number;
  headLengthRatio?: number;
  shaftRatio?: number;
  /** 角丸半径(px)。rectangle のみ有効。未指定は角あり。 */
  radius?: number;
  fill: "none" | "solid";
  color: string;
  fillColor?: string;
  strokeOpacity?: number;
  fillOpacity?: number;
  labelColor: string;
  dash: OverlayDash;
  size: OverlayTextSize;
  label?: string;
}>;

export type OverlayArcShape = OverlayBaseShape<"arc", {
  kind?: "arc" | "sector";
  r: number;
  rx?: number;
  ry?: number;
  startAngle: number;
  endAngle: number;
  arrowheadStart?: OverlayArrowhead;
  arrowheadEnd?: OverlayArrowhead;
  fill?: "none" | "solid";
  fillColor?: string;
  fillOpacity?: number;
  color: string;
  strokeOpacity?: number;
  dash: OverlayDash;
  size: OverlayTextSize;
}>;

export type OverlayArrowShape = OverlayBaseShape<"arrow", {
  start: OverlayPoint;
  end: OverlayPoint;
  arrowheadStart?: OverlayArrowhead;
  arrowheadEnd: OverlayArrowhead;
  fill: "none";
  color: string;
  strokeOpacity?: number;
  labelColor: string;
  dash: OverlayDash;
  size: OverlayTextSize;
  label?: string;
}>;

export type OverlayLineShape = OverlayBaseShape<"line", {
  kind?: OverlayLineKind;
  points: OverlayPoint[];
  closed: boolean;
  arrowheadStart?: OverlayArrowhead;
  arrowheadEnd?: OverlayArrowhead;
  fill?: "none" | "solid";
  fillColor?: string;
  fillOpacity?: number;
  fillPattern?: "diagonalHatch";
  color: string;
  strokeOpacity?: number;
  labelColor?: string;
  dash: OverlayDash;
  size: OverlayTextSize;
  label?: string;
}>;

export type OverlayTextShape = OverlayBaseShape<"text", {
  w: number;
  h?: number;
  /** Auto-sized text wraps to this width while its height continues to be measured. */
  maxWidth?: number;
  scale?: number;
  richText: OverlayRichTextDocument;
  autoSize: boolean;
  color: string;
  /** Font size in points. Shape bounds and positions remain CSS pixels. */
  fontSize?: number;
  size: OverlayTextSize;
}>;

export type OverlayImageShape = OverlayBaseShape<"image", {
  assetId: OverlayAssetId;
  w: number;
  h: number;
  crop?: OverlayImageCrop;
}>;

export interface OverlayImageCrop {
  topLeft: OverlayPoint;
  bottomRight: OverlayPoint;
}

export type OverlayCalloutShape = OverlayBaseShape<"callout", {
  /** 吹き出し本文の矩形サイズ。口はこの矩形の外側へはみ出せる。 */
  w: number;
  h: number;
  /** 本文矩形の角丸半径(px)。 */
  radius: number;
  /** 口の麓2点と頂点。麓はそれぞれ独立して本文矩形の外周を移動する。 */
  tail: {
    baseStart: OverlayPoint;
    baseEnd: OverlayPoint;
    tip: OverlayPoint;
  };
  /** 本文・図中数式と同じ永続化用リッチテキスト。 */
  richText: OverlayRichTextDocument;
  color: string;
  /** Font size in points. Shape bounds and positions remain CSS pixels. */
  fontSize?: number;
  size: OverlayTextSize;
  /** 枠線の種類(実線・破線・点線)。 */
  dash: OverlayDash;
  /** 枠線の太さプリセット。テキストサイズの `size` とは独立。 */
  strokeWidth: OverlayTextSize;
}>;

export type OverlayRichTextShape = OverlayTextShape | OverlayCalloutShape;

export type OverlayGraphShape = OverlayBaseShape<"graph2dShape", {
  /** `x`/`y`/`w`/`h` describe the visible plot rectangle; SVG label margins are render-only. */
  boundsMode?: "plot";
  w: number;
  h: number;
  spec: Graph2DSpec;
  preserveSpecSize?: boolean;
  axisLabelTextShapeIds?: Partial<Record<OverlayGraphAxisLabelKey, OverlayShapeId>>;
  pointLabelTextShapeIdsByPointId?: Record<string, OverlayShapeId>;
  annotationTextShapeIdsByAnnotationId?: Record<string, OverlayShapeId>;
  labelTextShapeIds?: OverlayShapeId[];
  labelTextShapeIdsByCurveId?: Record<string, OverlayShapeId>;
}>;

export type OverlayTableShape = OverlayBaseShape<"tableShape", {
  w: number;
  h: number;
  table: SigmaTableSpec;
}>;

export type SigmaTableKind = "plain" | "variation";
export type SigmaTableColumnRole = "label" | "point" | "interval" | "value";
export type SigmaTableRowRole = "header" | "body" | "variable" | "derivative" | "variation" | "note";
export type SigmaTableVerticalAlign = "top" | "middle" | "bottom";
export type SigmaTableTrendDirection = "up" | "down" | "flat";
export type SigmaTableBorderStyle = "solid" | "dashed" | "dotted" | "double";
export type SigmaTableGridLineAxis = "vertical" | "horizontal";

export interface SigmaTableGridLineStyle {
  visible?: boolean;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: SigmaTableBorderStyle;
}

export type SigmaTableGridLineOverride =
  | {
      axis: "vertical";
      edge: "left" | "right";
      style: SigmaTableGridLineStyle;
    }
  | {
      axis: "vertical";
      beforeColumnId: string;
      style: SigmaTableGridLineStyle;
    }
  | {
      axis: "horizontal";
      edge: "top" | "bottom";
      style: SigmaTableGridLineStyle;
    }
  | {
      axis: "horizontal";
      beforeRowId: string;
      style: SigmaTableGridLineStyle;
    };

export type SigmaTableTrackSize =
  | { mode: "auto"; min?: number; max?: number }
  | { mode: "fixed"; value: number }
  | { mode: "fr"; value: number; min?: number; max?: number };

export interface SigmaTableSpec {
  version: 1;
  kind: SigmaTableKind;
  columns: SigmaTableColumn[];
  rows: SigmaTableRow[];
  cells: SigmaTableCell[];
  grid: SigmaTableGridStyle;
  defaultCellStyle: SigmaTableCellStyle;
}

export interface SigmaTableColumn {
  id: string;
  width: SigmaTableTrackSize;
  role?: SigmaTableColumnRole;
}

export interface SigmaTableRow {
  id: string;
  height: SigmaTableTrackSize;
  role?: SigmaTableRowRole;
}

export interface SigmaTableCell {
  id: string;
  rowId: string;
  columnId: string;
  rowSpan?: number;
  colSpan?: number;
  content: SigmaTableCellContent[];
  style?: Partial<SigmaTableCellStyle>;
}

export type SigmaTableCellContent =
  | SigmaTableCellParagraph
  | SigmaTableTrend;

export interface SigmaTableCellParagraph {
  type: "paragraph";
  id: string;
  children: InlineNode[];
  align?: TextAlign;
}

export interface SigmaTableTrend {
  type: "trend";
  id: string;
  direction: SigmaTableTrendDirection;
  label?: InlineNode[];
}

export interface SigmaTableGridStyle {
  borderColor: string;
  borderWidth: number;
  borderStyle?: SigmaTableBorderStyle;
  showOuterBorder?: boolean;
  showInnerBorders?: boolean;
  lineOverrides?: SigmaTableGridLineOverride[];
}

export interface SigmaTableCellStyle {
  align?: TextAlign;
  verticalAlign?: SigmaTableVerticalAlign;
  paddingX?: number;
  paddingY?: number;
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
}

export interface OverlayPoint {
  x: number;
  y: number;
}

export interface OverlayBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
