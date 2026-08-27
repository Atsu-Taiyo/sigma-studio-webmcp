import { describe, expect, it } from "vitest";

import type {
  LayoutSectionNode,
  ProblemNode,
  SigmaBlock,
} from "@/types/sigma-doc";

import type { TextFlowBlock } from "../text-flow/types";
import { resolveBodyTextFlowTransition } from "./body-text-flow-transition";

describe("body TextFlow transition", () => {
  it("keeps document reconciliation pure and reuses unchanged problem-area children", () => {
    const target = paragraph("target", "same");
    const problem = problemNode("problem", {
      prompt: [target],
    });
    const content: SigmaBlock[] = [
      paragraph("outside", "outside"),
      problem,
    ];
    const transition = resolveBodyTextFlowTransition(content, {
      scope: "problemArea",
      targetId: problem.id,
      area: "prompt",
      previousIds: [target.id],
      nextBlocks: [structuredClone(target)],
    });

    expect(transition.targetId).toBe(problem.id);
    expect(transition.reduce(content[0])).toBe(content[0]);

    const result = transition.reduce(problem);
    expect(result).not.toBe(problem);
    expect(result.type).toBe("problem");
    if (result.type !== "problem") {
      return;
    }
    expect(result.prompt).toBe(problem.prompt);
    expect(result.prompt[0]).toBe(target);
    expect(result.lead).toBe(problem.lead);
    expect(content[1]).toBe(problem);
  });

  it("keeps a problem-area box block with its rich title, body, frame, and ids", () => {
    const target = paragraph("target", "置換前");
    const problem = problemNode("problem", {
      prompt: [target],
    });
    const box: TextFlowBlock = {
      id: "box",
      type: "boxBlock",
      styleId: "itembox",
      title: [
        {
          type: "text",
          text: "重要",
          marks: ["bold"],
          color: "#dc2626",
          fontFamily: "serif",
          fontSize: 14,
        },
        {
          type: "mathInline",
          id: "box_title_math",
          tex: "x^2",
          display: "inline",
        },
      ],
      blocks: [paragraph("box_body", "箱の本文")],
      frame: {
        borderColor: "#2563eb",
        titlePosition: "c",
      },
      pagination: { keepWithNext: true },
    };
    const transition = resolveBodyTextFlowTransition([problem], {
      scope: "problemArea",
      targetId: problem.id,
      area: "prompt",
      previousIds: [target.id],
      nextBlocks: [box],
    });

    const result = transition.reduce(problem);
    expect(result.type).toBe("problem");
    if (result.type !== "problem") {
      return;
    }
    expect(result.prompt).toEqual([box]);
    expect(result.prompt[0]?.id).toBe("box");
    expect(result.prompt[0]?.type === "boxBlock" ? result.prompt[0].blocks[0]?.id : null)
      .toBe("box_body");
  });

  it("reserves ids outside the edited problem range and preserves problem-area conversion", () => {
    const reservedLayout: LayoutSectionNode = {
      id: "outside_layout",
      type: "layoutSection",
      layout: { columnCount: 2 },
      children: [paragraph("reserved_nested", "outside")],
    };
    const target = paragraph("target", "old");
    const problem = problemNode("problem", {
      prompt: [target],
    });
    const section: TextFlowBlock = {
      id: "reserved_nested",
      type: "section",
      title: "見出し",
      align: "center",
      lineHeight: "1.6",
    };
    const transition = resolveBodyTextFlowTransition(
      [reservedLayout, problem],
      {
        scope: "problemArea",
        targetId: problem.id,
        area: "prompt",
        previousIds: [target.id],
        nextBlocks: [section],
      },
    );

    const result = transition.reduce(problem);
    expect(result.type).toBe("problem");
    if (result.type !== "problem") {
      return;
    }
    expect(result.prompt).toHaveLength(1);
    expect(result.prompt[0]).toMatchObject({
      type: "heading",
      level: 1,
      children: [{ type: "text", text: "見出し" }],
      align: "center",
      lineHeight: "1.6",
    });
    expect(result.prompt[0]?.id).not.toBe("reserved_nested");
    expect(result.prompt[0]?.id).toMatch(/^heading_/);
    expect(reservedLayout.children[0]?.id).toBe("reserved_nested");
  });

  it("reserves deeply nested ids while allowing edited layout child ids to remain", () => {
    const external: SigmaBlock = {
      id: "outside_box",
      type: "boxBlock",
      styleId: "frame",
      blocks: [{
        id: "outside_nested_layout",
        type: "layoutSection",
        layout: { columnCount: 2 },
        children: [{
          id: "outside_list",
          type: "list",
          listType: "bullet",
          items: [{
            id: "reserved_deep",
            type: "listItem",
            children: [{ type: "text", text: "outside" }],
          }],
        }],
      }],
    };
    const edited = paragraph("edited", "old");
    const untouched = paragraph("untouched", "same");
    const section: LayoutSectionNode = {
      id: "target_layout",
      type: "layoutSection",
      layout: { columnCount: 2 },
      children: [edited, untouched],
    };
    const transition = resolveBodyTextFlowTransition([external, section], {
      scope: "layoutSection",
      targetId: section.id,
      previousIds: [edited.id],
      nextBlocks: [
        paragraph("edited", "new"),
        paragraph("reserved_deep", "collision"),
      ],
    });

    const result = transition.reduce(section);
    expect(result.type).toBe("layoutSection");
    if (result.type !== "layoutSection") {
      return;
    }
    expect(result.children).toHaveLength(3);
    expect(result.children[0]).toMatchObject({
      id: "edited",
      type: "paragraph",
      children: [{ type: "text", text: "new" }],
    });
    expect(result.children[1]?.id).not.toBe("reserved_deep");
    expect(result.children[1]?.id).toMatch(/^p_/);
    expect(result.children[2]).toBe(untouched);

    const nestedLayout = external.type === "boxBlock"
      ? external.blocks[0]
      : null;
    expect(
      nestedLayout?.type === "layoutSection"
        ? nestedLayout.children[0]?.type === "list"
          ? nestedLayout.children[0].items[0]?.id
          : null
        : null,
    ).toBe("reserved_deep");
  });

  it("keeps a layout section non-empty after its last child is removed", () => {
    const target = paragraph("target", "remove");
    const section: LayoutSectionNode = {
      id: "target_layout",
      type: "layoutSection",
      layout: { columnCount: 2 },
      children: [target],
    };
    const transition = resolveBodyTextFlowTransition([section], {
      scope: "layoutSection",
      targetId: section.id,
      previousIds: [target.id],
      nextBlocks: [],
    });

    const result = transition.reduce(section);
    expect(result).not.toBe(section);
    expect(result.type).toBe("layoutSection");
    if (result.type !== "layoutSection") {
      return;
    }
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({
      type: "paragraph",
      children: [],
    });
    expect(result.children[0]?.id).toMatch(/^p_/);
  });
});

function paragraph(
  id: string,
  text: string,
): Extract<SigmaBlock, { type: "paragraph" }> {
  return {
    type: "paragraph",
    id,
    children: text ? [{ type: "text", text }] : [],
  };
}

function problemNode(
  id: string,
  areas: Partial<Pick<ProblemNode, "lead" | "prompt" | "hints" | "solution">>,
): ProblemNode {
  return {
    id,
    type: "problem",
    tags: [],
    lead: areas.lead ?? [],
    prompt: areas.prompt ?? [],
    hints: areas.hints ?? [],
    solution: areas.solution ?? [],
  };
}
