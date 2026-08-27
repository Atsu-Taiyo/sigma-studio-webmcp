import type {
  Graph2DPreset,
  SigmaTableSpec,
} from "@/features/document";

export type OverlayInsertCommand =
  | "rectangle"
  | "circle"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "pentagon"
  | "hexagon"
  | "heptagon"
  | "octagon"
  | "nonagon"
  | "decagon"
  | "hendecagon"
  | "dodecagon"
  | "blockArrow"
  | "arc"
  | "sector"
  | "threePointArc"
  | "arrow"
  | "line"
  | "polyline"
  | "curve"
  | "freehand"
  | "highlight"
  | "text"
  | "callout"
  | "graph"
  | "table";

export type OverlayTool =
  | { kind: "select" }
  | {
      kind: "insert";
      command: OverlayInsertCommand;
      graphPreset?: Graph2DPreset;
      /** 直前に調整した吹き出しの角丸半径。挿入プレビューと確定形状で共有する。 */
      calloutRadius?: number;
      table?: SigmaTableSpec;
      tableSize?: { w: number; h: number };
    };
