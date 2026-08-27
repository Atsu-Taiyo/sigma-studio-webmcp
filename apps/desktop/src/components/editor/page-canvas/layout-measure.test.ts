import { describe, expect, it } from "vitest";

import type { OverlayShape } from "@/components/editor/overlay-canvas/types";
import type { ProblemNode } from "@/features/document";
import type { TextFlowBlock } from "@/features/text-editing";

import {
  calculateReserveSpaceGaps,
  collectRenderUnitBlockIds,
  isFlowMeasurementStale,
} from "./layout-measure";
import type { RenderUnit } from "./types";

describe("calculateReserveSpaceGaps", () => {
  it("keeps body flow independent from legacy reserveSpace overlay anchors", () => {
    const shape = {
      id: "legacy_callout",
      type: "callout",
      x: 20,
      y: 80,
      rotation: 0,
      anchor: { type: "block", blockId: "body_1", dx: 20, dy: 80, reserveSpace: true },
      props: {
        w: 320,
        h: 68,
        radius: 18,
        tail: {
          baseStart: { x: 48, y: 68 },
          baseEnd: { x: 88, y: 68 },
          tip: { x: 64, y: 96 },
        },
        richText: { blocks: [{ type: "paragraph", children: [] }] },
        color: "#111111",
        size: "m",
        dash: "solid",
        strokeWidth: "m",
      },
    } satisfies OverlayShape;

    expect(calculateReserveSpaceGaps([shape])).toEqual({});
  });
});

describe("stale flow measurement detection", () => {
  const paragraph = (id: string): TextFlowBlock => ({
    type: "paragraph",
    id,
    children: [{ type: "text", text: id }],
  });

  function textFlowUnit(id: string, blocks: TextFlowBlock[]): RenderUnit {
    return { type: "textFlow", id, blocks };
  }

  it("collects every id a render unit can put in the flow, including nested box children", () => {
    const units: RenderUnit[] = [
      textFlowUnit("unit_1", [
        paragraph("p_outside"),
        {
          type: "boxBlock",
          id: "box_1",
          styleId: "fancybox",
          blocks: [paragraph("p_inside")],
        },
      ]),
    ];

    expect(collectRenderUnitBlockIds(units)).toEqual(
      new Set(["unit_1", "p_outside", "box_1", "p_inside"]),
    );
  });

  it("collects the ids of the non-text flow units the page can render", () => {
    const problem = {
      type: "problem" as const,
      id: "problem_1",
      tags: [],
      lead: [],
      prompt: [paragraph("p_prompt")] as ProblemNode["prompt"],
      solution: [],
      hints: [],
    };
    const units: RenderUnit[] = [
      {
        type: "layoutSection",
        id: "unit_section",
        section: { type: "layoutSection", id: "section_1", layout: { columnCount: 2 }, children: [] },
        blocks: [paragraph("p_in_section")],
      },
      {
        type: "problemArea",
        id: "unit_area",
        problem,
        area: "prompt",
        blocks: [paragraph("p_prompt")],
        isFirstProblemArea: true,
        isLastProblemArea: true,
        isFirstProblemFrameArea: true,
        isLastProblemFrameArea: true,
      },
    ];

    expect(collectRenderUnitBlockIds(units)).toEqual(new Set([
      "unit_section",
      "section_1",
      "p_in_section",
      "unit_area",
      "problem_1",
      "p_prompt",
    ]));
  });

  it("rejects a measurement that still carries a block the render no longer knows", () => {
    // Undo removed `p_gone`, but the ProseMirror DOM has not been swapped yet: adopting this
    // measurement is what paints the box at its pre-undo height for a frame.
    const known = collectRenderUnitBlockIds([textFlowUnit("unit_1", [paragraph("p_kept")])]);

    expect(isFlowMeasurementStale(["p_kept", "p_gone"], known)).toBe(true);
  });

  it("accepts a measurement whose blocks are all known", () => {
    const known = collectRenderUnitBlockIds([
      textFlowUnit("unit_1", [paragraph("p_first"), paragraph("p_second")]),
    ]);

    expect(isFlowMeasurementStale(["p_first", "p_second"], known)).toBe(false);
  });

  it("accepts a measurement that is only missing blocks", () => {
    // React may render a unit before its editor has mounted. That is not staleness, and
    // treating it as such would stop pagination from ever catching up.
    const known = collectRenderUnitBlockIds([
      textFlowUnit("unit_1", [paragraph("p_first"), paragraph("p_second")]),
    ]);

    expect(isFlowMeasurementStale(["p_first"], known)).toBe(false);
    expect(isFlowMeasurementStale([], known)).toBe(false);
  });

  it("never rejects when the render units are not known yet", () => {
    // An empty expectation must not be read as "everything is stale" — that would freeze layout.
    expect(isFlowMeasurementStale(["p_first"], new Set())).toBe(false);
  });
});
