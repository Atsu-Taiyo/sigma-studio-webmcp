import { describe, expect, it } from "vitest";

import type { ParagraphNode } from "@/features/document";

import {
  resolveManualTextPageBreakBlocks,
  shouldUseDocumentNextBlockForPageBreak,
} from "./manual-page-break";

function paragraph(id: string, text: string): ParagraphNode {
  return {
    type: "paragraph",
    id,
    children: text ? [{ type: "text", text }] : [],
  };
}

function deterministicIdFactory() {
  let sequence = 0;
  return (prefix: string) => `${prefix}_generated_${++sequence}`;
}

describe("manual page-break application model", () => {
  it("splits inline content at the editor offset and requests ids through the port", () => {
    const result = resolveManualTextPageBreakBlocks(
      [paragraph("first", "abcdef")],
      "first",
      true,
      { blockId: "first", offset: 3 },
      { createId: deterministicIdFactory() },
    );

    expect(result).toEqual({
      blocks: [
        paragraph("first", "abc"),
        {
          ...paragraph("p_generated_1", "def"),
          pagination: { break: true },
        },
      ],
      focusBlockId: "p_generated_1",
      focusPosition: "start",
    });
  });

  it("uses the adjacent block at a boundary without allocating an id", () => {
    const createId = () => {
      throw new Error("id allocation is not expected");
    };
    const result = resolveManualTextPageBreakBlocks(
      [paragraph("first", "first"), paragraph("second", "second")],
      "first",
      true,
      { blockId: "first", offset: 5 },
      { createId },
    );

    expect(result?.blocks[1].pagination?.break).toBe(true);
    expect(result?.focusBlockId).toBe("second");
  });

  it("removes only break-before and preserves unrelated pagination hints", () => {
    const block = {
      ...paragraph("first", "first"),
      pagination: {
        break: true as const,
        keepWithNext: true,
      },
    };

    expect(resolveManualTextPageBreakBlocks(
      [block],
      "first",
      false,
    )?.blocks[0].pagination).toEqual({ keepWithNext: true });
    expect(resolveManualTextPageBreakBlocks(
      [paragraph("first", "first")],
      "first",
      false,
    )).toBeNull();
  });

  it("defers only edge selections at the final chunk block", () => {
    const blocks = [paragraph("first", "abc")];
    const detail = {
      blockId: "first",
      enabled: true,
      documentNextBlockId: "next-chunk",
    };

    expect(shouldUseDocumentNextBlockForPageBreak(
      blocks,
      detail,
      { blockId: "first", offset: 0 },
    )).toBe(true);
    expect(shouldUseDocumentNextBlockForPageBreak(
      blocks,
      detail,
      { blockId: "first", offset: 2 },
    )).toBe(false);
  });
});
