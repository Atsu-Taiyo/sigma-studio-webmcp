import { describe, expect, it } from "vitest";

import type {
  Graph2DSpec,
  OverlayArcShape,
  OverlayArrowShape,
  OverlayGraphShape,
  OverlayLineShape,
  OverlayShape,
  OverlayTextShape,
} from "@/features/document";

import {
  getArcRadii,
  getOverlayRichTextLineCount,
  getShapeBounds,
  getShapeDimensionBounds,
  getShapeRotation,
  getShapeSelectionBounds,
  getShapesSelectionBounds,
  getTextShapeFontSizePt,
  getTextShapeLineHeightPx,
  getTextShapeRenderedFontSizePx,
  getTextShapeRenderedLineHeightPx,
  normalizeTextShapeScale,
} from "./shape-bounds";

function graphSpec(kind: Graph2DSpec["kind"] = "cartesian"): Graph2DSpec {
  return {
    kind,
    title: "",
    width: kind === "numberLine" ? 200 : 360,
    height: kind === "numberLine" ? 100 : 240,
    viewBox: {
      xMin: "-5",
      xMax: "5",
      yMin: "-5",
      yMax: "5",
    },
    axes: { grid: false },
    curves: [],
  };
}

function graphShape(
  props: Partial<OverlayGraphShape["props"]> = {},
): OverlayGraphShape {
  return {
    id: "graph",
    type: "graph2dShape",
    x: 10,
    y: 20,
    props: {
      w: 360,
      h: 240,
      spec: graphSpec(),
      ...props,
    },
  };
}

function textShape(
  props: Partial<OverlayTextShape["props"]> = {},
): OverlayTextShape {
  return {
    id: "text",
    type: "text",
    x: 30,
    y: 40,
    props: {
      w: 4,
      richText: {
        blocks: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "a\nb\n" }],
          },
          {
            type: "paragraph",
            children: [{
              type: "mathInline",
              id: "math_x",
              tex: "x",
              display: "inline",
            }],
          },
        ],
      },
      autoSize: true,
      color: "black",
      size: "m",
      ...props,
    },
  };
}

describe("shape bounds", () => {
  it("uses canonical plot bounds directly for current graph shapes", () => {
    const shape = graphShape({ boundsMode: "plot", w: 296, h: 188 });

    expect(getShapeBounds(shape)).toEqual({
      x: 10,
      y: 20,
      w: 296,
      h: 188,
    });
    expect(getShapeSelectionBounds(shape)).toEqual(getShapeBounds(shape));
    expect(getShapeDimensionBounds(shape)).toEqual(getShapeBounds(shape));
  });

  it("derives legacy cartesian and number-line plot bounds from render padding", () => {
    expect(getShapeBounds(graphShape())).toEqual({
      x: 56,
      y: 38,
      w: 296,
      h: 188,
    });
    expect(getShapeBounds(graphShape({
      w: 200,
      h: 100,
      spec: graphSpec("numberLine"),
    }))).toEqual({
      x: 44,
      y: 40,
      w: 138,
      h: 50,
    });
  });

  it("scales legacy graph padding when preserving a differently-sized spec", () => {
    expect(getShapeBounds(graphShape({
      preserveSpecSize: true,
      spec: {
        ...graphSpec(),
        width: 720,
        height: 480,
      },
    }))).toEqual({
      x: 33,
      y: 29,
      w: 328,
      h: 214,
    });
  });

  it("uses normalized elliptical arc radii", () => {
    const arc: OverlayArcShape = {
      id: "arc",
      type: "arc",
      x: 10,
      y: 20,
      props: {
        r: 20,
        rx: 30,
        ry: 0,
        startAngle: 0,
        endAngle: Math.PI,
        color: "black",
        dash: "solid",
        size: "m",
      },
    };

    expect(getArcRadii(arc)).toEqual({ rx: 30, ry: 0.5 });
    expect(getShapeBounds(arc)).toEqual({
      x: 10,
      y: 20,
      w: 60,
      h: 1,
    });
  });

  it("adds interaction padding to line and arrow selection bounds only", () => {
    const line: OverlayLineShape = {
      id: "line",
      type: "line",
      x: 10,
      y: 20,
      props: {
        points: [{ x: 0, y: 0 }, { x: 80, y: 60 }],
        closed: false,
        fill: "none",
        color: "black",
        dash: "solid",
        size: "m",
      },
    };
    const arrow: OverlayArrowShape = {
      id: "arrow",
      type: "arrow",
      x: 20,
      y: 30,
      props: {
        start: { x: 0, y: 0 },
        end: { x: 80, y: 0 },
        arrowheadEnd: "arrow",
        fill: "none",
        color: "black",
        labelColor: "black",
        dash: "solid",
        size: "m",
      },
    };

    expect(getShapeBounds(line)).toEqual({ x: 0, y: 10, w: 100, h: 80 });
    expect(getShapeDimensionBounds(line)).toEqual({ x: 10, y: 20, w: 80, h: 60 });
    expect(getShapeBounds(arrow)).toEqual({ x: 10, y: 20, w: 100, h: 20 });
    expect(getShapeDimensionBounds(arrow)).toEqual({ x: 20, y: 30, w: 80, h: 1 });
  });

  it("unions selection bounds and returns null for an empty selection", () => {
    const shapes: OverlayShape[] = [
      {
        id: "rect",
        type: "geo",
        x: 10,
        y: 20,
        props: {
          w: 30,
          h: 40,
          geo: "rectangle",
          fill: "none",
          color: "black",
          labelColor: "black",
          dash: "solid",
          size: "m",
        },
      },
      {
        id: "image",
        type: "image",
        x: 80,
        y: 60,
        props: {
          assetId: "asset",
          w: 50,
          h: 30,
        },
      },
    ];

    expect(getShapesSelectionBounds(shapes)).toEqual({
      x: 10,
      y: 20,
      w: 120,
      h: 70,
    });
    expect(getShapesSelectionBounds([])).toBeNull();
  });

  it("counts rich-text lines and expands text bounds using rendered line height", () => {
    const shape = textShape();

    expect(getOverlayRichTextLineCount(shape.props.richText)).toBe(4);
    expect(getTextShapeRenderedLineHeightPx(shape)).toBe(16);
    // Width stays clamped to the stored width / shape minimum -- only the height is derived from
    // the content (see `getTextShapeEffectiveSize`). Widening from the estimate would make the
    // box wider than the glyphs an `auto-size` shape actually renders at `width: max-content`.
    expect(getShapeBounds(shape)).toEqual({
      x: 30,
      y: 40,
      w: 8,
      h: 64,
    });
    expect(getShapeBounds(textShape({ h: 80 })).h).toBe(80);
  });

  it("preserves point-to-pixel conversion and scale clamping", () => {
    const pointSized = textShape({
      fontSize: 10.5,
      scale: 1,
    });
    const scaled = textShape({
      fontSize: 10.5,
      scale: 2,
    });

    expect(getTextShapeFontSizePt(pointSized)).toBe(10.5);
    expect(getTextShapeRenderedFontSizePx(pointSized)).toBe(14);
    expect(getTextShapeFontSizePt(scaled)).toBe(21);
    expect(getTextShapeRenderedFontSizePx(scaled)).toBe(28);
    expect(getTextShapeLineHeightPx("s")).toBe(13);
    expect(normalizeTextShapeScale(0)).toBe(0.25);
    expect(normalizeTextShapeScale(20)).toBe(8);
    expect(normalizeTextShapeScale(Number.NaN)).toBe(1);
  });

  it("keeps groups and tables unrotated in interaction geometry", () => {
    const group: OverlayShape = {
      id: "group",
      type: "group",
      x: 0,
      y: 0,
      rotation: Math.PI / 3,
      props: { w: 10, h: 10 },
    };

    expect(getShapeRotation(group)).toBe(0);
    expect(getShapeRotation({
      ...textShape(),
      rotation: Math.PI / 3,
    })).toBe(Math.PI / 3);
  });
});
