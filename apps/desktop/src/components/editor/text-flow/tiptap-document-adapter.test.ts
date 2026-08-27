// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  BoxBlockBodyExtension,
  BoxBlockExtension,
  BoxBlockTitleExtension,
  LayoutSectionExtension,
  SigmaDocTextAttrs,
} from "@/components/editor/TextFlowEditor";
import { createRichTextEngineExtensions } from "@/components/tiptap/rich-text-engine";
import type { TextFlowBlock } from "@/features/text-editing";

import { textFlowBlockToTiptapNode, textFlowToTiptap, tiptapToTextFlow } from "./tiptap-document-adapter";
import { sliceToTextFlowBlocks } from "./text-run-slice";

function createEditor(blocks: TextFlowBlock[]) {
  return new Editor({
    element: document.createElement("div"),
    extensions: createRichTextEngineExtensions({
      blockExtensions: [
        SigmaDocTextAttrs,
        BoxBlockExtension,
        BoxBlockTitleExtension,
        BoxBlockBodyExtension,
        LayoutSectionExtension,
      ],
      // `LayoutSectionExtension` の content 式が `divider` を名指しているので、本文の
      // ブロック群と同時にしか組めない。片方だけ載せるとスキーマの構築時点で落ちる。
      bodyBlocks: true,
    }),
    content: textFlowToTiptap(blocks),
  });
}

const PARAGRAPH_WITH_BREAK: TextFlowBlock = {
  type: "paragraph",
  id: "p_break",
  children: [{ type: "text", text: "改ページの後ろ" }],
  pagination: { break: true },
};

describe("pagination round trip", () => {
  it("carries every pagination hint through the Tiptap node and back", () => {
    const blocks: TextFlowBlock[] = [
      PARAGRAPH_WITH_BREAK,
      {
        type: "heading",
        id: "h_keep",
        level: 2,
        children: [{ type: "text", text: "見出し" }],
        pagination: { keepWithNext: true },
      },
      {
        type: "list",
        id: "list_together",
        listType: "bullet",
        items: [{ type: "listItem", id: "li_1", children: [{ type: "text", text: "項目" }] }],
        pagination: { keepTogether: true },
      },
      {
        type: "boxBlock",
        id: "box_break",
        styleId: "fancybox",
        blocks: [{ type: "paragraph", id: "box_p", children: [] }],
        pagination: { break: true },
      },
      {
        type: "layoutSection",
        id: "layout_break",
        layout: { columnCount: 2 },
        children: [{ type: "paragraph", id: "layout_p", children: [] }],
        pagination: { break: true },
      },
    ];

    // previousBlocks を渡さない = 貼り付けなどで新しく現れたブロックと同じ扱い。
    const restored = tiptapToTextFlow(textFlowToTiptap(blocks));

    expect(restored.map((block) => block.pagination)).toEqual([
      { break: true },
      { keepWithNext: true },
      { keepTogether: true },
      { break: true },
      { break: true },
    ]);
  });

  it("keeps a manual page break inside a slice copied out of a real editor", () => {
    // PM のスキーマが pagination を宣言していないと attrs はここで落ちる。
    const editor = createEditor([
      { type: "paragraph", id: "p_first", children: [{ type: "text", text: "前" }] },
      PARAGRAPH_WITH_BREAK,
    ]);
    const blocks = sliceToTextFlowBlocks(editor.state.doc.slice(0, editor.state.doc.content.size));

    expect(blocks.find((block) => block.id === "p_break")?.pagination).toEqual({ break: true });
    editor.destroy();
  });

  it("lets SigmaDoc win over the node attribute for a block that already exists", () => {
    // 改ページの付け外しは SigmaDoc 側の操作。既存 id は必ずそちらへ従う
    // (従わないと、外したはずの改ページが古い attrs から生き返る)。
    const node = textFlowBlockToTiptapNode(PARAGRAPH_WITH_BREAK);
    const restored = tiptapToTextFlow({ type: "doc", content: [node] }, [
      { type: "paragraph", id: "p_break", children: [] },
    ]);

    expect(restored[0]?.pagination).toBeUndefined();
  });

  it("does not duplicate a break when the block is split in two", () => {
    const editor = createEditor([PARAGRAPH_WITH_BREAK]);
    editor.commands.setTextSelection(1 + "改ページ".length);
    editor.commands.splitBlock();
    const blocks = tiptapToTextFlow(editor.getJSON() as Parameters<typeof tiptapToTextFlow>[0]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.pagination).toEqual({ break: true });
    expect(blocks[1]?.pagination).toBeUndefined();
    editor.destroy();
  });

  it("ignores a malformed pagination attribute instead of persisting it", () => {
    const restored = tiptapToTextFlow({
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: { sigmaDocId: "p_bad", sigmaDocType: "paragraph", pagination: { break: "yes" } },
        content: [],
      }],
    });

    expect(restored[0]?.pagination).toBeUndefined();
  });
});

describe("layoutSection round trip", () => {
  it("keeps a column section that was copied as part of a slice", () => {
    const section: TextFlowBlock = {
      type: "layoutSection",
      id: "layout_1",
      layout: { columnCount: 3, columnGapMm: 12 },
      children: [
        { type: "paragraph", id: "layout_p1", children: [{ type: "text", text: "左" }] },
        { type: "paragraph", id: "layout_p2", children: [{ type: "text", text: "右" }] },
      ],
    };
    const editor = createEditor([section]);
    const blocks = sliceToTextFlowBlocks(editor.state.doc.slice(0, editor.state.doc.content.size));

    expect(blocks).toEqual([section]);
    editor.destroy();
  });
});
