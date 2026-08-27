import { describe, expect, it } from "vitest";

import type { ParagraphNode } from "@/features/document";

import {
  getTextFlowBlockChildren,
  getTextFlowBlockEditorLength,
  isTextFlowBlock,
  withTextFlowBlockChildren,
} from "./block-model";

const createId = (prefix: string) => `${prefix}_created`;

describe("text-flow block model", () => {
  it("projects section, nested list, box body, and layout content into editor order", () => {
    expect(getTextFlowBlockChildren({
      type: "section",
      id: "section",
      title: "章",
    })).toEqual([{ type: "text", text: "章" }]);

    const block = {
      type: "layoutSection" as const,
      id: "layout",
      layout: { columnCount: 2 },
      children: [{
        type: "boxBlock" as const,
        id: "box",
        styleId: "fancybox",
        title: [{ type: "text" as const, text: "定理" }],
        blocks: [{
          type: "list" as const,
          id: "list",
          listType: "bullet" as const,
          items: [{
            type: "listItem" as const,
            id: "item",
            children: [{ type: "text" as const, text: "親" }],
            nested: [{
              type: "list" as const,
              id: "nested",
              listType: "bullet" as const,
              items: [{
                type: "listItem" as const,
                id: "nested-item",
                children: [{ type: "text" as const, text: "子" }],
              }],
            }],
          }],
        }],
      }],
    };

    expect(getTextFlowBlockChildren(block).map((node) => (
      node.type === "text" ? node.text : node.tex
    ))).toEqual(["親", "子"]);
    expect(getTextFlowBlockEditorLength(block)).toBe(2);
  });

  it("updates the first editable child and obtains new ids only through the port", () => {
    const emptyList = {
      type: "list" as const,
      id: "list",
      listType: "bullet" as const,
      items: [],
    };
    const children = [{ type: "text" as const, text: "追加" }];

    expect(withTextFlowBlockChildren(emptyList, children, createId)).toEqual({
      ...emptyList,
      items: [{
        type: "listItem",
        id: "li_created",
        children,
      }],
    });

    const box = {
      type: "boxBlock" as const,
      id: "box",
      styleId: "fancybox",
      title: [{ type: "text" as const, text: "定理" }],
      blocks: [{
        type: "paragraph" as const,
        id: "body",
        children: [{ type: "text" as const, text: "変更前" }],
      }],
    };
    expect(withTextFlowBlockChildren(box, children, createId)).toEqual({
      ...box,
      blocks: [{
        ...box.blocks[0],
        children,
      }],
    });
  });

  it("recognizes only top-level continuous-flow SigmaDoc blocks", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      id: "paragraph",
      children: [],
    };

    expect(isTextFlowBlock(paragraph)).toBe(true);
    expect(isTextFlowBlock({
      type: "problem",
      id: "problem",
      tags: [],
      lead: [],
      prompt: [],
      hints: [],
      solution: [],
    })).toBe(false);
    expect(isTextFlowBlock({
      type: "layoutSection",
      id: "layout",
      layout: { columnCount: 2 },
      children: [],
    })).toBe(false);
  });
});
