// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { Editor, getSchema, type Editor as TiptapEditor } from "@tiptap/core";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";

import {
  appendSigmaDocTextIdentityTransaction,
  BoxBlockBodyExtension,
  BoxBlockExtension,
  BoxBlockTitleExtension,
  isLiteralPasteShortcut,
  resolveTextFlowFormatCommandOptions,
  resolveManualBreakBoundaryNavigation,
  resolveTextFormatStateContext,
  applyTextFlowSelectionBookmark,
  focusTextFlowSurface,
  getTextFlowSelectionBookmark,
  SigmaDocTextAttrs,
  SigmaDocTextIdentity,
  setTextFlowContentPreservingSelection,
  resolveManualTextPageBreakBlocks,
  shouldUseDocumentNextBlockForPageBreak,
  shouldSyncFocusedTextFlowContent,
  textFlowToTiptap,
  tiptapToTextFlow,
  type TextFlowBlock,
} from "@/components/editor/TextFlowEditor";
import { findTouchedGuardedBlockIds } from "@/components/tiptap/edit-guard-extension";
import { createRichTextEngineExtensions } from "@/components/tiptap/rich-text-engine";
import {
  applyTextFormatCommand,
  createTextFormatStateDetail,
} from "@/components/tiptap/text-format-controller";
import type { TiptapDoc } from "@/lib/tiptap-adapter";

/**
 * 箱ブロックのスタイルは 2 ファイルに分かれている: 紙面に出る見た目は共有の
 * `document-surface.css` (埋め込みビューアも import する)、空タイトルのプレースホルダなど
 * 編集専用のアフォーダンスは `globals.css`。どちらに書かれていても拾えるよう両方読む。
 */
function readBoxStylesheets(): string {
  return ["../../app/globals.css", "../../app/document-surface.css"]
    .map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8"))
    .join("\n");
}

describe("SigmaDoc text identity", () => {
  it("keeps font formatting after the real Enter shortcut", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createRichTextEngineExtensions({
        blockExtensions: [SigmaDocTextAttrs, SigmaDocTextIdentity],
      }),
      content: {
        type: "doc",
        content: [{
          type: "paragraph",
          attrs: { sigmaDocId: "p_original", sigmaDocType: "paragraph" },
          content: [{
            type: "text",
            marks: [{
              type: "styledText",
              attrs: {
                color: "#1d4ed8",
                fontFamily: '"Yu Mincho", serif',
                fontSize: 18,
              },
            }],
            text: "本文",
          }],
        }],
      },
    });

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(editor.view.someProp("handleKeyDown", (handler) => (
      handler(editor.view, keyEvent({ key: "Enter" }) as KeyboardEvent)
    ))).toBe(true);
    setTextFlowContentPreservingSelection(
      editor,
      tiptapToTextFlow(editor.getJSON() as TiptapDoc, []),
    );
    const nextBlockId = editor.getJSON().content?.[1]?.attrs?.sigmaDocId;
    expect(typeof nextBlockId).toBe("string");
    const restored = applyTextFlowSelectionBookmark(
      editor,
      caretBookmark(nextBlockId as string, 0),
    );
    expect(restored.applied).toBe(true);
    focusTextFlowSurface(editor, restored.activeMarks);
    editor.commands.insertContent("次の行");

    expect(editor.getJSON()).toMatchObject({
      content: [
        { content: [{ marks: [{ attrs: { fontFamily: '"Yu Mincho", serif', fontSize: 18 } }] }] },
        { content: [{ marks: [{ attrs: { fontFamily: '"Yu Mincho", serif', fontSize: 18 } }], text: "次の行" }] },
      ],
    });
    editor.destroy();
  });

  it("keeps inline formatting armed after Enter assigns a fresh paragraph id", () => {
    const schema = getSchema([
      ...createRichTextEngineExtensions(),
      SigmaDocTextAttrs,
    ]);
    const styledText = schema.marks.styledText.create({
      color: "#1d4ed8",
      fontFamily: '"Yu Mincho", serif',
      fontSize: 18,
    });
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(
        { sigmaDocId: "p_original", sigmaDocType: "paragraph" },
        schema.text("本文", [styledText]),
      ),
    ]);
    const oldState = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, doc.firstChild!.content.size + 1),
    });
    const splitTransaction = oldState.tr
      .split(oldState.selection.from)
      .setStoredMarks([styledText]);
    const splitState = oldState.apply(splitTransaction);

    const identityTransaction = appendSigmaDocTextIdentityTransaction(
      [splitTransaction],
      oldState,
      splitState,
    );
    expect(identityTransaction).not.toBeNull();

    const nextState = splitState.apply(identityTransaction!);
    expect(nextState.doc.child(0).attrs.sigmaDocId).not.toBe(nextState.doc.child(1).attrs.sigmaDocId);
    expect(nextState.storedMarks?.map((mark) => ({ attrs: mark.attrs, type: mark.type.name }))).toEqual([
      {
        attrs: {
          backgroundColor: null,
          color: "#1d4ed8",
          fontFamily: '"Yu Mincho", serif',
          fontSize: 18,
        },
        type: "styledText",
      },
    ]);
  });

  it("recovers formatting from the pre-Enter caret when splitBlock drops stored marks", () => {
    const schema = getSchema([
      ...createRichTextEngineExtensions(),
      SigmaDocTextAttrs,
    ]);
    const styledText = schema.marks.styledText.create({
      color: "#1d4ed8",
      fontFamily: '"Yu Mincho", serif',
      fontSize: 18,
    });
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(
        { sigmaDocId: "p_original", sigmaDocType: "paragraph" },
        schema.text("本文", [styledText]),
      ),
    ]);
    const oldState = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, doc.firstChild!.content.size + 1),
    });
    const splitTransaction = oldState.tr.split(oldState.selection.from);
    const splitState = oldState.apply(splitTransaction);
    expect(splitState.storedMarks).toBeNull();

    const identityTransaction = appendSigmaDocTextIdentityTransaction(
      [splitTransaction],
      oldState,
      splitState,
    );
    const nextState = splitState.apply(identityTransaction!);

    expect(nextState.storedMarks?.map((mark) => mark.attrs.fontFamily)).toEqual([
      '"Yu Mincho", serif',
    ]);
  });

  it("assigns ids to quote, code, and divider blocks created by editor commands", () => {
    // PM のコマンド (`toggleQuoteBlock` 等) が作るノードは sigmaDocId を持たない。
    // 段組みのブロック配置は id で引くので、ここで配られないと配置されないまま
    // 「潰れた編集面 root の原点 = 1 ページ目上端」に取り残される。
    const schema = getSchema([
      ...createRichTextEngineExtensions({ bodyBlocks: true }),
      SigmaDocTextAttrs,
    ]);
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(
        { sigmaDocId: "p_lead", sigmaDocType: "paragraph" },
        schema.text("前"),
      ),
      schema.nodes.quote.create(null, [
        schema.nodes.paragraph.create(null, schema.text("引用")),
      ]),
      schema.nodes.codeBlock.create(null, schema.text("code")),
      schema.nodes.divider.create(null),
    ]);
    const oldState = EditorState.create({ schema, doc });
    const editTransaction = oldState.tr.insertText("あ", 1);
    const editedState = oldState.apply(editTransaction);

    const identityTransaction = appendSigmaDocTextIdentityTransaction(
      [editTransaction],
      oldState,
      editedState,
    );
    expect(identityTransaction).not.toBeNull();

    const nextState = editedState.apply(identityTransaction!);
    expect(nextState.doc.child(0).attrs.sigmaDocId).toBe("p_lead");
    expect(nextState.doc.child(1).attrs.sigmaDocId).toMatch(/^quote_/);
    expect(nextState.doc.child(1).firstChild!.attrs.sigmaDocId).toMatch(/^p_/);
    expect(nextState.doc.child(2).attrs.sigmaDocId).toMatch(/^code_/);
    expect(nextState.doc.child(3).attrs.sigmaDocId).toMatch(/^divider_/);
  });
});

describe("resolveManualTextPageBreakBlocks", () => {
  it("puts break on the next paragraph when the cursor is at the end of a paragraph", () => {
    const blocks = [
      paragraph("p_first", "first"),
      paragraph("p_second", "second"),
    ];

    const result = resolveManualTextPageBreakBlocks(blocks, "p_first", true, {
      blockId: "p_first",
      offset: 5,
    });

    expect(result?.blocks).toHaveLength(2);
    expect(result?.blocks[0].pagination).toBeUndefined();
    expect(result?.blocks[1].pagination?.break).toBe(true);
    expect(result?.focusBlockId).toBe("p_second");
  });

  it("puts break on the next paragraph when the cursor is at the start of a paragraph", () => {
    const blocks = [
      paragraph("p_first", "first"),
      paragraph("p_second", "second"),
    ];

    const result = resolveManualTextPageBreakBlocks(blocks, "p_first", true, {
      blockId: "p_first",
      offset: 0,
    });

    expect(result?.blocks).toHaveLength(2);
    expect(result?.blocks[0].pagination).toBeUndefined();
    expect(result?.blocks[1].pagination?.break).toBe(true);
    expect(result?.focusBlockId).toBe("p_second");
  });

  it("splits a paragraph at the cursor and puts break on the following paragraph", () => {
    const blocks = [paragraph("p_first", "abcdef")];

    const result = resolveManualTextPageBreakBlocks(blocks, "p_first", true, {
      blockId: "p_first",
      offset: 3,
    });

    expect(result?.blocks).toHaveLength(2);
    expect(getText(result!.blocks[0])).toBe("abc");
    expect(getText(result!.blocks[1])).toBe("def");
    expect(result?.blocks[1].id).not.toBe("p_first");
    expect(result?.blocks[1].pagination?.break).toBe(true);
    expect(result?.focusBlockId).toBe(result?.blocks[1].id);
  });

  it("creates an empty following paragraph when there is no next paragraph", () => {
    const blocks = [paragraph("p_first", "first")];

    const result = resolveManualTextPageBreakBlocks(blocks, "p_first", true, {
      blockId: "p_first",
      offset: 5,
    });

    expect(result?.blocks).toHaveLength(2);
    expect(getText(result!.blocks[0])).toBe("first");
    expect(getText(result!.blocks[1])).toBe("");
    expect(result?.blocks[1].pagination?.break).toBe(true);
    expect(result?.focusBlockId).toBe(result?.blocks[1].id);
  });

  it("splits a box body without mixing its title into the editable body", () => {
    const blocks: TextFlowBlock[] = [{
      type: "boxBlock",
      id: "box_manual_break",
      styleId: "itembox",
      title: [{ type: "text", text: "定理" }],
      blocks: [{
        type: "paragraph",
        id: "box_manual_break_body",
        children: [{ type: "text", text: "abcdef" }],
      }],
    }];

    const result = resolveManualTextPageBreakBlocks(blocks, "box_manual_break", true, {
      blockId: "box_manual_break",
      offset: 3,
    }, {
      createId: (prefix) => `${prefix}_after_break`,
    });

    expect(result?.blocks).toMatchObject([
      {
        type: "boxBlock",
        title: [{ type: "text", text: "定理" }],
        blocks: [{ children: [{ type: "text", text: "abc" }] }],
      },
      {
        type: "boxBlock",
        title: [{ type: "text", text: "定理" }],
        pagination: { break: true },
        blocks: [{ children: [{ type: "text", text: "def" }] }],
      },
    ]);
  });
});

describe("shouldUseDocumentNextBlockForPageBreak", () => {
  it("defers a page break at a chunk boundary to the document-level next block", () => {
    const blocks = [
      paragraph("p_first", "first"),
      paragraph("p_boundary", "boundary"),
    ];

    expect(shouldUseDocumentNextBlockForPageBreak(blocks, {
      blockId: "p_boundary",
      enabled: true,
      documentNextBlockId: "p_next_chunk",
    }, {
      blockId: "p_boundary",
      offset: "boundary".length,
    })).toBe(true);
  });

  it("keeps page breaks inside the current editor when the next block is in the same chunk", () => {
    const blocks = [
      paragraph("p_first", "first"),
      paragraph("p_middle", "middle"),
      paragraph("p_last", "last"),
    ];

    expect(shouldUseDocumentNextBlockForPageBreak(blocks, {
      blockId: "p_middle",
      enabled: true,
      documentNextBlockId: "p_last",
    }, {
      blockId: "p_middle",
      offset: "middle".length,
    })).toBe(false);
  });
});

describe("resolveManualBreakBoundaryNavigation", () => {
  const blocksWithBreak = [
    paragraph("before_break", "前"),
    {
      ...paragraph("after_break", "後"),
      pagination: { break: true as const },
    },
  ];

  it("moves Backspace from the break block start to the previous block end without changing the document", () => {
    const state = createParagraphBoundaryState(blocksWithBreak, "after_break", "start");
    const navigation = resolveManualBreakBoundaryNavigation(state, "backward", blocksWithBreak);

    expect(navigation?.blockId).toBe("after_break");
    expect(textBlockAtPosition(state, navigation?.position ?? -1)).toMatchObject({
      id: "before_break",
      text: "前",
    });
  });

  it("moves Delete from the previous block end to the break block start", () => {
    const state = createParagraphBoundaryState(blocksWithBreak, "before_break", "end");
    const navigation = resolveManualBreakBoundaryNavigation(state, "forward", blocksWithBreak);

    expect(navigation?.blockId).toBe("after_break");
    expect(textBlockAtPosition(state, navigation?.position ?? -1)).toMatchObject({
      id: "after_break",
      text: "後",
    });
  });

  it("does not intercept an ordinary boundary", () => {
    const blocks = [
      paragraph("ordinary_first", "前"),
      paragraph("ordinary_second", "後"),
    ];
    const state = createParagraphBoundaryState(blocks, "ordinary_second", "start");

    expect(resolveManualBreakBoundaryNavigation(state, "backward", blocks)).toBeNull();
  });
});

describe("TextFlowEditor list conversion", () => {
  it("converts Tiptap bullet lists created by markdown input into SigmaDoc lists", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { sigmaDocId: "list_bullet", sigmaDocType: "list" },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  attrs: { sigmaDocId: "li_first", sigmaDocType: "listItem" },
                  content: [{ type: "text", text: "first" }],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(tiptapToTextFlow(doc)).toEqual([
      {
        type: "list",
        id: "list_bullet",
        listType: "bullet",
        items: [
          {
            type: "listItem",
            id: "li_first",
            children: [{ type: "text", text: "first" }],
          },
        ],
      },
    ]);
  });

  it("keeps ordered nested lists and inline formatting through a round trip", () => {
    const blocks: TextFlowBlock[] = [
      {
        type: "list",
        id: "list_ordered",
        listType: "ordered",
        start: 3,
        items: [
          {
            type: "listItem",
            id: "li_parent",
            children: [
              { type: "text", text: "parent ", marks: ["bold"] },
              { type: "mathInline", id: "m_inline", tex: "x^2", display: "inline", semanticRole: "expression" },
            ],
            nested: [
              {
                type: "list",
                id: "list_nested",
                listType: "bullet",
                items: [
                  {
                    type: "listItem",
                    id: "li_child",
                    children: [{ type: "text", text: "child", marks: ["underline"] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const [list] = tiptapToTextFlow(textFlowToTiptap(blocks), blocks);

    expect(list).toMatchObject({
      type: "list",
      id: "list_ordered",
      listType: "ordered",
      start: 3,
      items: [
        {
          type: "listItem",
          id: "li_parent",
          children: [
            { type: "text", text: "parent ", marks: ["bold"] },
            { type: "mathInline", id: "m_inline", tex: "x^2" },
          ],
          nested: [
            {
              type: "list",
              id: "list_nested",
              listType: "bullet",
              items: [
                {
                  type: "listItem",
                  id: "li_child",
                  children: [{ type: "text", text: "child", marks: ["underline"] }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("keeps the (1) marker style of an ordered list through a round trip", () => {
    const blocks: TextFlowBlock[] = [
      {
        type: "list",
        id: "list_paren",
        listType: "ordered",
        markerStyle: "paren",
        items: [
          {
            type: "listItem",
            id: "li_paren",
            children: [{ type: "text", text: "括弧付き番号" }],
            nested: [
              {
                type: "list",
                id: "list_paren_nested",
                listType: "ordered",
                markerStyle: "paren",
                items: [{ type: "listItem", id: "li_paren_child", children: [{ type: "text", text: "子" }] }],
              },
            ],
          },
        ],
      },
    ];

    expect(tiptapToTextFlow(textFlowToTiptap(blocks), blocks)).toMatchObject([
      {
        type: "list",
        markerStyle: "paren",
        items: [{ nested: [{ type: "list", markerStyle: "paren" }] }],
      },
    ]);
  });

  it("keeps alignment on parenthesized and nested list items through a round trip", () => {
    const blocks: TextFlowBlock[] = [{
      type: "list",
      id: "list_aligned",
      listType: "ordered",
      markerStyle: "paren",
      items: [{
        type: "listItem",
        id: "li_aligned",
        children: [{ type: "text", text: "中央" }],
        align: "center",
        continuations: [
          {
            type: "paragraph",
            id: "li_aligned_second",
            children: [{ type: "text", text: "左" }],
            align: "left",
          },
          {
            type: "paragraph",
            id: "li_aligned_third",
            children: [{ type: "text", text: "右" }],
            align: "right",
          },
        ],
        nested: [{
          type: "list",
          id: "list_nested_aligned",
          listType: "ordered",
          items: [{
            type: "listItem",
            id: "li_nested_aligned",
            children: [{ type: "text", text: "右" }],
            align: "right",
          }],
        }],
      }],
    }];

    const tiptap = textFlowToTiptap(blocks);
    expect(tiptap.content?.[0]?.content?.[0]?.content?.[0]?.attrs?.textAlign).toBe("center");
    expect(tiptap.content?.[0]?.content?.[0]?.content?.[1]?.attrs).toMatchObject({
      sigmaDocId: "li_aligned_second",
      textAlign: "left",
    });
    expect(tiptapToTextFlow(tiptap, blocks)).toMatchObject([{
      items: [{
        align: "center",
        continuations: [
          { id: "li_aligned_second", align: "left" },
          { id: "li_aligned_third", align: "right" },
        ],
        nested: [{ items: [{ align: "right" }] }],
      }],
    }]);
  });

  it("does not invent a marker style for plain decimal lists", () => {
    const blocks: TextFlowBlock[] = [
      {
        type: "list",
        id: "list_decimal",
        listType: "ordered",
        items: [{ type: "listItem", id: "li_decimal", children: [{ type: "text", text: "1つめ" }] }],
      },
    ];

    expect(tiptapToTextFlow(textFlowToTiptap(blocks), blocks)[0]).not.toHaveProperty("markerStyle");
  });

  it("round-trips SigmaDoc box blocks with rich editable titles and body blocks", () => {
    const blocks: TextFlowBlock[] = [
      {
        type: "boxBlock",
        id: "box_fancybox",
        styleId: "fancybox",
        title: [
          {
            type: "text",
            text: "定理 ",
            marks: ["bold"],
            color: "#1d4ed8",
            fontSize: 18,
          },
          {
            type: "mathInline",
            id: "box_title_math",
            tex: String.raw`a^2+b^2=c^2`,
            display: "inline",
            color: "#dc2626",
            fontSize: 16,
            semanticRole: "expression",
          },
        ],
        frame: {
          borderWidthPx: 1.4,
          borderColor: "#111111",
          paddingPx: { top: 12, right: 14, bottom: 12, left: 14 },
        },
        blocks: [
          {
            type: "paragraph",
            id: "box_body",
            children: [
              { type: "text", text: "ここに", marks: ["bold"] },
              { type: "text", text: "本文を書く", marks: ["italic"], color: "#15803d" },
            ],
          },
        ],
      },
    ];

    const tiptap = textFlowToTiptap(blocks);
    expect(tiptap.content?.[0]).toMatchObject({
      type: "boxBlock",
      attrs: {
        sigmaDocId: "box_fancybox",
        styleId: "fancybox",
      },
      content: [
        {
          type: "boxBlockTitle",
          content: [
            {
              type: "text",
              text: "定理 ",
              marks: [
                { type: "bold" },
                {
                  type: "styledText",
                  attrs: {
                    color: "#1d4ed8",
                    fontSize: 18,
                  },
                },
              ],
            },
            {
              type: "mathInline",
              attrs: {
                id: "box_title_math",
                tex: String.raw`a^2+b^2=c^2`,
              },
            },
          ],
        },
        {
          type: "boxBlockBody",
          content: [
            {
              type: "paragraph",
              attrs: { sigmaDocId: "box_body" },
              content: [
                { type: "text", text: "ここに", marks: [{ type: "bold" }] },
                {
                  type: "text",
                  text: "本文を書く",
                  marks: [
                    { type: "italic" },
                    { type: "styledText", attrs: { color: "#15803d" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const schema = getSchema(createRichTextEngineExtensions({
      blockExtensions: [
        SigmaDocTextAttrs,
        BoxBlockExtension,
        BoxBlockTitleExtension,
        BoxBlockBodyExtension,
      ],
    }));
    const boxNode = schema.nodeFromJSON(tiptap.content?.[0]);
    expect(boxNode.type.name).toBe("boxBlock");
    expect(boxNode.child(0).type.name).toBe("boxBlockTitle");
    expect(boxNode.child(1).type.name).toBe("boxBlockBody");
    const richBoxBlock = blocks[0];
    if (richBoxBlock.type !== "boxBlock") {
      throw new Error("Expected a box block fixture");
    }
    const changedTitleTiptap = textFlowToTiptap([{
      ...richBoxBlock,
      title: [{ type: "text", text: "変更後" }],
    }]);
    expect(findTouchedGuardedBlockIds(
      schema.node("doc", null, [boxNode]),
      schema.node("doc", null, [schema.nodeFromJSON(changedTitleTiptap.content?.[0])]),
      new Set(["box_fancybox"]),
    )).toEqual(["box_fancybox"]);

    const [box] = tiptapToTextFlow(tiptap, blocks);

    expect(box).toMatchObject({
      type: "boxBlock",
      id: "box_fancybox",
      styleId: "fancybox",
      title: [
        {
          type: "text",
          text: "定理 ",
          marks: ["bold"],
          color: "#1d4ed8",
          fontSize: 18,
        },
        {
          type: "mathInline",
          id: "box_title_math",
          tex: String.raw`a^2+b^2=c^2`,
          color: "#dc2626",
          fontSize: 16,
        },
      ],
      blocks: [
        {
          type: "paragraph",
          id: "box_body",
          children: [
            { type: "text", text: "ここに", marks: ["bold"] },
            { type: "text", text: "本文を書く", marks: ["italic"], color: "#15803d" },
          ],
        },
      ],
    });
  });

  it("does not resync focused content while editing inside a box block", () => {
    const blocks: TextFlowBlock[] = [
      {
        type: "boxBlock",
        id: "box_corner",
        styleId: "cornerbox",
        blocks: [
          {
            type: "paragraph",
            id: "box_corner_body",
            children: [{ type: "text", text: "入力中" }],
          },
        ],
      },
    ];

    expect(shouldSyncFocusedTextFlowContent(["box_corner", "box_corner_body"], blocks)).toBe(false);
    expect(shouldSyncFocusedTextFlowContent(["box_corner_body"], blocks)).toBe(true);
  });

  it("reports a box title selection as an enabled document text target", () => {
    const { state } = createBoxTitleSelectionState();
    const context = resolveTextFormatStateContext(state);
    const editor = {
      isActive: (name: string) => name === "bold",
      getAttributes: () => ({}),
    } as Pick<TiptapEditor, "getAttributes" | "isActive">;

    expect(createTextFormatStateDetail(editor, "document", context)).toMatchObject({
      target: "document",
      enabled: true,
      nodeType: "boxBlockTitle",
      blockId: "box_title_format",
      bold: true,
    });
  });

  it("reports code as the same enabled text-format target used by rich body blocks", () => {
    const schema = getSchema(createRichTextEngineExtensions({
      blockExtensions: [SigmaDocTextAttrs],
      bodyBlocks: true,
    }));
    const doc = schema.nodeFromJSON(textFlowToTiptap([{
      type: "codeBlock",
      id: "code_format",
      children: [{ type: "text", text: "answer = 42", marks: ["bold"] }],
    }]));
    const initial = EditorState.create({ schema, doc });
    const state = initial.apply(initial.tr.setSelection(TextSelection.create(doc, 2)));

    expect(resolveTextFormatStateContext(state)).toEqual({
      enabled: true,
      nodeType: "codeBlock",
      blockId: "code_format",
    });
  });

  it("keeps paragraph formatting enabled inside a nested list item", () => {
    const schema = getSchema(createRichTextEngineExtensions({
      blockExtensions: [SigmaDocTextAttrs],
      textBlockStyle: true,
    }));
    const doc = schema.nodeFromJSON(textFlowToTiptap([{
      type: "list",
      id: "outer_list",
      listType: "ordered",
      items: [{
        type: "listItem",
        id: "outer_item",
        children: [{ type: "text", text: "親" }],
        nested: [{
          type: "list",
          id: "nested_list",
          listType: "ordered",
          items: [{
            type: "listItem",
            id: "nested_item",
            children: [{ type: "text", text: "子" }],
          }],
        }],
      }],
    }]));
    let nestedTextPos = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === "子") {
        nestedTextPos = pos;
        return false;
      }
      return true;
    });
    const initial = EditorState.create({ schema, doc });
    const state = initial.apply(initial.tr.setSelection(TextSelection.create(doc, nestedTextPos)));

    expect(resolveTextFormatStateContext(state)).toEqual({
      enabled: true,
      nodeType: "paragraph",
      blockId: "nested_item",
    });
  });

  it("applies bold to the live selection in a box title without enabling block style", () => {
    const { state } = createBoxTitleSelectionState();
    const calls: unknown[][] = [];
    const chain = new Proxy({}, {
      get(_target, property) {
        return (...args: unknown[]) => {
          calls.push([String(property), ...args]);
          return chain;
        };
      },
    });
    const editor = {
      state,
      isFocused: false,
      chain: () => chain,
    } as unknown as TiptapEditor;
    const options = resolveTextFlowFormatCommandOptions(
      editor,
      "box_title_format",
      null,
    );

    expect(options).toMatchObject({
      selection: {
        from: state.selection.from,
        to: state.selection.to,
      },
      blockNodeType: "paragraph",
      allowBlockStyle: false,
    });
    expect(applyTextFormatCommand(editor, { command: "bold" }, options)).toBe(true);
    expect(calls).toEqual([
      ["focus"],
      ["setTextSelection", {
        from: state.selection.from,
        to: state.selection.to,
      }],
      ["toggleBold"],
      ["setTextSelection", {
        from: state.selection.from,
        to: state.selection.to,
      }],
      ["run"],
    ]);
  });
});

describe("empty box title editing structure", () => {
  it("keeps a real boxBlockTitle node after all title content is removed", () => {
    const tiptap = textFlowToTiptap([{
      type: "boxBlock",
      id: "empty_title_box",
      styleId: "itembox",
      title: [],
      blocks: [paragraph("empty_title_body", "本文")],
    }]);
    const boxNode = tiptap.content?.[0];

    expect(boxNode?.type).toBe("boxBlock");
    expect(boxNode?.content?.[0]).toEqual({
      type: "boxBlockTitle",
      content: [],
    });
    expect(boxNode?.content?.[1]?.type).toBe("boxBlockBody");
  });

  it("keeps the empty-title hit target out of normal flow with a real clickable area", () => {
    const css = readBoxStylesheets();
    const emptyTitleRule = css.match(
      /\.sigma-doc-box-title:empty,\s*\.sigma-doc-box-title:has\(> br\.ProseMirror-trailingBreak:only-child\) \{([^}]+)\}/,
    )?.[1];

    expect(emptyTitleRule).toBeDefined();
    expect(emptyTitleRule).toMatch(/position:\s*absolute/);
    expect(emptyTitleRule).toMatch(/min-width:\s*4em/);
    expect(emptyTitleRule).toMatch(/min-height:\s*18px/);
    expect(emptyTitleRule).toMatch(/pointer-events:\s*auto/);
  });

  it("keeps title plates on the box background without an opaque focused placeholder chip", () => {
    const css = readBoxStylesheets();
    const titlePlateRule = css.match(
      /\.box-frame--title-plate \.sigma-doc-box-title,\s*\.box-frame--title-plate \.print-box-title \{([^}]+)\}/,
    )?.[1];
    const focusedPlaceholderRule = css.match(
      /\.sigma-doc-box-title:empty:focus::before,\s*\.sigma-doc-box-title:has\(> br\.ProseMirror-trailingBreak:only-child\):focus::before \{([^}]+)\}/,
    )?.[1];
    const titleBandRule = css.match(
      /\.box-frame--title-band \.sigma-doc-box-title,\s*\.box-frame--title-band \.print-box-title \{([^}]+)\}/,
    )?.[1];

    expect(titlePlateRule).toMatch(/background:\s*var\(--sigma-doc-box-background,\s*#ffffff\)/);
    expect(focusedPlaceholderRule).toBeDefined();
    expect(focusedPlaceholderRule).not.toMatch(/background\s*:/);
    expect(titleBandRule).toMatch(/background:\s*var\(--sigma-doc-box-title-background,\s*#e2e8f0\)/);
  });
});

describe("キャレット復元のフォーカス所有権", () => {
  it("applyTextFlowSelectionBookmark は view.focus() を呼ばない", () => {
    const editor = createCaretOwnershipEditor();
    const focusSpy = vi.spyOn(editor.view, "focus");

    const restored = applyTextFlowSelectionBookmark(editor, caretBookmark("p_1", 2));

    expect(restored.applied).toBe(true);
    expect(editor.state.selection.head).toBe(3);
    expect(focusSpy).toHaveBeenCalledTimes(0);
    editor.destroy();
  });

  it("解決できない blockId では false を返し、選択も変えない", () => {
    const editor = createCaretOwnershipEditor();
    editor.commands.setTextSelection(2);
    const before = editor.state.selection;
    const focusSpy = vi.spyOn(editor.view, "focus");

    const restored = applyTextFlowSelectionBookmark(editor, caretBookmark("missing", 0));

    expect(restored.applied).toBe(false);
    expect(editor.state.selection.eq(before)).toBe(true);
    expect(focusSpy).toHaveBeenCalledTimes(0);
    editor.destroy();
  });

  it("focusTextFlowSurface は focus が storedMarks を落としても張り直す", () => {
    const editor = createCaretOwnershipEditor();
    const marks = [editor.schema.marks.styledText.create({ color: "#1d4ed8" })];
    editor.commands.setTextSelection(3);
    editor.view.dispatch(editor.state.tr.setStoredMarks(marks));
    // 実機の `view.focus()` は DOM 選択の同期を通じて storedMarks を落としうる。
    vi.spyOn(editor.view, "focus").mockImplementation(() => {
      editor.view.dispatch(editor.state.tr.setStoredMarks(null));
    });

    focusTextFlowSurface(editor, marks);

    expect(editor.state.storedMarks).toEqual(marks);
    editor.destroy();
  });

  it("選択が空でないときは storedMarks を張り直さない", () => {
    const editor = createCaretOwnershipEditor();
    const marks = [editor.schema.marks.styledText.create({ color: "#1d4ed8" })];
    editor.commands.setTextSelection({ from: 1, to: 4 });
    vi.spyOn(editor.view, "focus").mockImplementation(() => undefined);

    focusTextFlowSurface(editor, marks);

    expect(editor.state.storedMarks).toBeNull();
    editor.destroy();
  });
});

describe("キャレット位置の正規化", () => {
  it("トップレベルの区切り線を選んでも bookmark が null にならない", () => {
    const editor = createBodyBlockEditor();
    const position = nodePositionOf(editor, "d_1");
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)),
    );

    expect(getTextFlowSelectionBookmark(editor, null)).toMatchObject({
      anchor: { blockId: "d_1", kind: "node" },
      head: { blockId: "d_1", kind: "node" },
    });
    editor.destroy();
  });

  it("区切り線の bookmark を復元すると NodeSelection に戻る", () => {
    const editor = createBodyBlockEditor();
    editor.commands.setTextSelection(2);

    const restored = applyTextFlowSelectionBookmark(editor, {
      anchor: { affinity: "after", blockId: "d_1", kind: "node", offset: 0 },
      head: { affinity: "after", blockId: "d_1", kind: "node", offset: 0 },
      preferredX: null,
    });

    expect(restored.applied).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.attrs.sigmaDocId).toBe("d_1");
    editor.destroy();
  });

  it("コンテナ id を渡しても例外を投げず葉へ落ちる", () => {
    const editor = createBodyBlockEditor();

    const restored = applyTextFlowSelectionBookmark(editor, caretBookmark("box_1", 0));

    expect(restored.applied).toBe(true);
    // 箱の中の position は子の番号であって文字位置ではない。文字を持つブロックまで落ちる。
    expect(editor.state.selection.$head.parent.isTextblock).toBe(true);
    editor.destroy();
  });

  it("片側だけノードを指す bookmark は NodeSelection にしない", () => {
    const editor = createBodyBlockEditor();
    editor.commands.setTextSelection(2);

    const restored = applyTextFlowSelectionBookmark(editor, {
      anchor: { affinity: "after", blockId: "d_1", kind: "node", offset: 0 },
      head: { affinity: "after", blockId: "box_p", kind: "text", offset: 1 },
      preferredX: null,
    });

    expect(restored.applied).toBe(true);
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
    editor.destroy();
  });

  it("ブロックとブロックの隙間からは位置を作り出さない", () => {
    const editor = createBodyBlockEditor();
    // 文書全体の選択は両端が文書直下 (どの本文ブロックにも載っていない) 位置になる。
    // ここで隣のブロックを拾うと「最後のブロックの先頭」のような別物の選択が生まれる。
    editor.commands.selectAll();

    expect(getTextFlowSelectionBookmark(editor, null)).toBeNull();
    editor.destroy();
  });

  it("preferredX が bookmark に載る (上下移動での消費は後続作業)", () => {
    const editor = createCaretOwnershipEditor();
    editor.commands.setTextSelection(3);

    const bookmark = getTextFlowSelectionBookmark(editor, 123.5);

    expect(bookmark).toMatchObject({
      head: { affinity: "after", blockId: "p_1", kind: "text", offset: 2 },
      preferredX: 123.5,
    });
    expect(applyTextFlowSelectionBookmark(editor, bookmark!).applied).toBe(true);
    expect(bookmark?.preferredX).toBe(123.5);
    editor.destroy();
  });
});

describe("isLiteralPasteShortcut", () => {
  it("accepts Command-Shift-V and Control-Shift-V", () => {
    expect(isLiteralPasteShortcut(keyEvent({ metaKey: true, shiftKey: true }))).toBe(true);
    expect(isLiteralPasteShortcut(keyEvent({ ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("does not change the normal paste shortcut", () => {
    expect(isLiteralPasteShortcut(keyEvent({ metaKey: true }))).toBe(false);
    expect(isLiteralPasteShortcut(keyEvent({ metaKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(isLiteralPasteShortcut(keyEvent({ metaKey: true, shiftKey: true, key: "c" }))).toBe(false);
  });
});

function caretBookmark(blockId: string, offset: number) {
  const address = { affinity: "after" as const, blockId, kind: "text" as const, offset };
  return { anchor: address, head: address, preferredX: null };
}

/** 区切り線と箱を含む本文。トップレベル atom とコンテナ id の両方を試すための土台。 */
function createBodyBlockEditor(): TiptapEditor {
  return new Editor({
    element: document.createElement("div"),
    extensions: createRichTextEngineExtensions({
      blockExtensions: [
        SigmaDocTextAttrs,
        SigmaDocTextIdentity,
        BoxBlockExtension,
        BoxBlockTitleExtension,
        BoxBlockBodyExtension,
      ],
      bodyBlocks: true,
    }),
    content: textFlowToTiptap([
      { type: "paragraph", id: "p_before", children: [{ type: "text", text: "前" }] },
      { type: "divider", id: "d_1" },
      {
        type: "boxBlock",
        id: "box_1",
        styleId: "fancybox",
        blocks: [{ type: "paragraph", id: "box_p", children: [{ type: "text", text: "箱の中" }] }],
      },
    ]),
  });
}

function nodePositionOf(editor: TiptapEditor, blockId: string): number {
  let position = -1;
  editor.state.doc.descendants((node, nodePosition) => {
    if (position >= 0) {
      return false;
    }
    if (node.attrs.sigmaDocId === blockId) {
      position = nodePosition;
      return false;
    }
    return true;
  });
  if (position < 0) {
    throw new Error(`node not found: ${blockId}`);
  }
  return position;
}

function createCaretOwnershipEditor(): TiptapEditor {
  return new Editor({
    element: document.createElement("div"),
    extensions: createRichTextEngineExtensions({
      blockExtensions: [SigmaDocTextAttrs, SigmaDocTextIdentity],
    }),
    content: {
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: { sigmaDocId: "p_1", sigmaDocType: "paragraph" },
        content: [{ type: "text", text: "本文テキスト" }],
      }],
    },
  });
}

function createBoxTitleSelectionState(): { state: EditorState } {
  const schema = getSchema(createRichTextEngineExtensions({
    blockExtensions: [
      SigmaDocTextAttrs,
      BoxBlockExtension,
      BoxBlockTitleExtension,
      BoxBlockBodyExtension,
    ],
  }));
  const doc = schema.nodeFromJSON(textFlowToTiptap([{
    type: "boxBlock",
    id: "box_title_format",
    styleId: "itembox",
    title: [{ type: "text", text: "定理" }],
    blocks: [{
      type: "paragraph",
      id: "box_title_format_body",
      children: [{ type: "text", text: "本文" }],
    }],
  }]));
  let from = -1;
  let to = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === "boxBlockTitle") {
      from = pos + 1;
      to = pos + node.nodeSize - 1;
      return false;
    }
    return undefined;
  });
  if (from < 0 || to <= from) {
    throw new Error("Expected a non-empty box title range");
  }

  return {
    state: EditorState.create({
      doc,
      selection: TextSelection.create(doc, from, to),
    }),
  };
}

function createParagraphBoundaryState(
  blocks: TextFlowBlock[],
  blockId: string,
  boundary: "start" | "end",
): EditorState {
  const schema = getSchema(createRichTextEngineExtensions({
    blockExtensions: [
      SigmaDocTextAttrs,
      BoxBlockExtension,
      BoxBlockTitleExtension,
      BoxBlockBodyExtension,
    ],
  }));
  const doc = schema.nodeFromJSON(textFlowToTiptap(blocks));
  let position = -1;
  doc.descendants((node, pos) => {
    if (node.attrs.sigmaDocId !== blockId) {
      return undefined;
    }
    position = boundary === "start" ? pos + 1 : pos + node.nodeSize - 1;
    return false;
  });
  if (position < 0) {
    throw new Error(`Text block ${blockId} was not found`);
  }
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, position),
  });
}

function textBlockAtPosition(
  state: EditorState,
  position: number,
): { id: string; text: string } | null {
  if (position < 0) {
    return null;
  }
  const resolved = state.doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (
      (node.type.name === "paragraph" || node.type.name === "heading")
      && typeof node.attrs.sigmaDocId === "string"
    ) {
      return { id: node.attrs.sigmaDocId, text: node.textContent };
    }
  }
  return null;
}

function paragraph(id: string, text: string): TextFlowBlock {
  return {
    type: "paragraph",
    id,
    children: text ? [{ type: "text", text }] : [],
  };
}

function keyEvent(
  overrides: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">>,
): Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"> {
  return {
    altKey: false,
    ctrlKey: false,
    key: "v",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function getText(block: TextFlowBlock): string {
  if (block.type === "section") {
    return block.title;
  }
  if (block.type === "list") {
    return block.items.map((item) => getText({
      type: "paragraph",
      id: item.id,
      children: item.children,
    })).join("\n");
  }
  if (block.type === "boxBlock") {
    return [
      ...(block.title ?? []).map((child) => child.type === "text" ? child.text : `$${child.tex}$`),
      ...block.blocks.map(getText),
    ].join("\n");
  }
  if (block.type === "layoutSection") {
    return block.children.map(getText).join("\n");
  }
  if (block.type === "divider") {
    return "";
  }
  if (block.type === "quote") {
    return block.blocks.map(getText).join("\n");
  }
  return block.children.map((child) => child.type === "text" ? child.text : `$${child.tex}$`).join("");
}
