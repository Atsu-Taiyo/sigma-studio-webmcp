import { DOMSerializer } from "@tiptap/pm/model";
import { getSchema } from "@tiptap/core";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BoxBlockBodyExtension,
  BoxBlockExtension,
  BoxBlockTitleExtension,
  SigmaDocTextAttrs,
  textFlowToTiptap,
  type TextFlowBlock,
} from "@/components/editor/TextFlowEditor";
import { TextFlowStaticBlock } from "@/components/editor/text-flow/TextFlowStaticBlock";
import { createRichTextEngineExtensions } from "@/components/tiptap/rich-text-engine";

/**
 * 本文ブロックを **Tiptap が描く DOM** と **静的レンダラが描く DOM** で突き合わせる。
 *
 * 可視範囲化 (画面外のユニットは Tiptap を建てずに静的表示にする) の前提がこれ。ここがずれて
 * いる種別は、画面に入って Tiptap が建った瞬間に本文が動く = 読んでいる場所が飛ぶ。ずれる
 * 種別が見つかったら、直すか「常に Tiptap を建てる」側に置くかを決める必要がある。
 *
 * 比較はタグ・クラス・属性・インラインスタイル・テキスト。実行時にしか付かないもの (計測の
 * `data-boxed-run-*`、ProseMirror が足す `contenteditable` 系) は除く — 見た目に効かないため。
 */
const schema = getSchema(createRichTextEngineExtensions({
  blockExtensions: [SigmaDocTextAttrs, BoxBlockExtension, BoxBlockTitleExtension, BoxBlockBodyExtension],
}));

interface NormalizedNode {
  attrs?: Record<string, string>;
  children?: NormalizedNode[];
  style?: Record<string, string>;
  tag?: string;
  text?: string;
}

interface DomLikeNode {
  childNodes: ArrayLike<DomLikeNode>;
  classList?: { contains: (name: string) => boolean };
  getAttribute?: (name: string) => null | string;
  getAttributeNames?: () => string[];
  nodeType: number;
  tagName?: string;
  textContent: null | string;
}

/** 実行時にだけ付く属性 (計測・編集の足場)。見た目に効かないので比較から外す。 */
const RUNTIME_ATTRIBUTES = new Set([
  "contenteditable",
  "data-boxed-run-aligned",
  "data-boxed-run-connect-left",
  "data-boxed-run-connect-right",
  "data-boxed-run-height-target",
  "data-boxed-run-id",
  "data-boxed-run-segment-count",
  "data-boxed-run-segment-id",
  "data-boxed-run-segment-index",
  "data-boxed-run-style-key",
  "data-inline-math-node-view",
  "data-sigma-doc-type",
  // ProseMirror は `data-sigma-doc-id` に加えて素の `id` も出すが、静的描画は出さない。
  // 見た目には効かないので比較から外す。ただし「意味が無い」わけではない: 目次ジャンプと
  // 検索ジャンプは `document.getElementById(blockId)` で対象を探す (EditorShell.tsx:3428 /
  // :4799 / :4811)。静的描画しか無いブロックへはこの 2 つが黙って何もしない。
  // 印刷ステージは本文と同時に DOM に載るので、静的側に素の `id` を足すと id が重複する。
  // 本文を静的描画に落とす仕組みを入れるなら、id を足すのではなく上の 2 経路を
  // `[data-sigma-doc-id="…"]` 検索へ寄せること (ai-source-reference-navigation.ts:83 が先例)。
  "id",
  "translate",
]);

/** 既定値と同じ宣言は「書いてある / 書いていない」の違いでしかないので落とす。 */
const DEFAULT_STYLE_DECLARATIONS: Record<string, string> = {
  "text-align": "left",
};

const CORPUS: Array<{ blocks: TextFlowBlock[]; name: string }> = [
  {
    name: "plain paragraph",
    blocks: [{ type: "paragraph", id: "p1", children: [{ type: "text", text: "ふつうの段落" }] }],
  },
  {
    name: "paragraph alignment and line height",
    blocks: [
      { type: "paragraph", id: "p2", align: "center", children: [{ type: "text", text: "中央" }] },
      { type: "paragraph", id: "p3", align: "right", lineHeight: "1.8", children: [{ type: "text", text: "右" }] },
    ],
  },
  {
    name: "headings",
    blocks: [
      { type: "heading", id: "h1", level: 1, children: [{ type: "text", text: "見出し1" }] },
      { type: "heading", id: "h2", level: 2, align: "center", children: [{ type: "text", text: "見出し2" }] },
    ],
  },
  {
    name: "inline marks",
    blocks: [{
      type: "paragraph",
      id: "p4",
      children: [
        { type: "text", text: "太字", marks: ["bold"] },
        { type: "text", text: "斜体", marks: ["italic"] },
        { type: "text", text: "下線", marks: ["underline"] },
      ],
    }],
  },
  {
    name: "inline text styling",
    blocks: [{
      type: "paragraph",
      id: "p5",
      children: [{
        type: "text",
        text: "色つき",
        color: "#cc0000",
        backgroundColor: "#ffeeaa",
        fontFamily: '"Yu Mincho", serif',
        fontSize: 12.5,
      }],
    }],
  },
  {
    name: "boxed run",
    blocks: [{
      type: "paragraph",
      id: "p6",
      children: [
        { type: "text", text: "囲み", marks: ["boxed"], boxedPaddingY: 2 },
        { type: "text", text: "そと" },
      ],
    }],
  },
  {
    name: "inline math",
    blocks: [{
      type: "paragraph",
      id: "p7",
      children: [
        { type: "text", text: "式は " },
        { type: "mathInline", id: "m1", tex: "x^2", display: "inline" },
        { type: "text", text: " です" },
      ],
    }],
  },
  {
    name: "bullet list",
    blocks: [{
      type: "list",
      id: "l1",
      listType: "bullet",
      items: [
        { type: "listItem", id: "li1", children: [{ type: "text", text: "ひとつ" }] },
        { type: "listItem", id: "li2", children: [{ type: "text", text: "ふたつ" }] },
      ],
    }],
  },
  {
    name: "ordered list",
    blocks: [{
      type: "list",
      id: "l2",
      listType: "ordered",
      items: [{ type: "listItem", id: "li3", children: [{ type: "text", text: "いち" }] }],
    }],
  },
];

/**
 * 一致していない種別。**既知の乖離**として固定する (`it.fails` なので、直したらここが赤くなる)。
 *
 * リストは編集面が `li > p[data-sigma-doc-id]`、静的レンダラが `li > span`。段落の余白と行の
 * 高さが変わりうるので、可視範囲化ではリストを含むユニットを「常に Tiptap を建てる」側に
 * 置いている。直すなら静的側を `p` に寄せる (= 印刷の出力が変わる) 判断が要る。
 */
const KNOWN_DIVERGENT = new Set(["bullet list", "ordered list"]);

describe("body blocks project the same DOM through Tiptap and the static renderer", () => {
  for (const { blocks, name } of CORPUS) {
    if (KNOWN_DIVERGENT.has(name)) {
      it.fails(`still differs on ${name} (known divergence)`, () => {
        expect(staticDom(blocks)).toEqual(editorDom(blocks));
      });
      continue;
    }
    it(`agrees on ${name}`, () => {
      expect(staticDom(blocks)).toEqual(editorDom(blocks));
    });
  }
});

function staticDom(blocks: TextFlowBlock[]): NormalizedNode[] {
  const html = blocks
    .map((block) => renderToStaticMarkup(<TextFlowStaticBlock block={block as never} />))
    .join("");
  return normalizeHtml(html);
}

function editorDom(blocks: TextFlowBlock[]): NormalizedNode[] {
  const window = new Window();
  const node = schema.nodeFromJSON(textFlowToTiptap(blocks));
  const container = window.document.createElement("div");
  // 数式は DOM が無いと素の TeX に落ちる (SSR 用のフォールバック)。ブラウザでの見た目を
  // 比べたいので、直列化の間だけ document を差し込む。
  const previousDocument = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = window.document;
  try {
    DOMSerializer.fromSchema(schema).serializeFragment(
      node.content,
      { document: window.document as unknown as Document },
      container as unknown as HTMLElement,
    );
  } finally {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = previousDocument;
    }
  }
  const html = container.innerHTML;
  window.close();
  return normalizeHtml(html);
}

function normalizeHtml(html: string): NormalizedNode[] {
  const window = new Window();
  const container = window.document.createElement("div");
  container.innerHTML = html;
  const nodes = Array.from(container.childNodes as unknown as ArrayLike<DomLikeNode>)
    .flatMap((node) => normalizeNode(node));
  window.close();
  return nodes;
}

function normalizeNode(node: DomLikeNode): NormalizedNode[] {
  if (node.nodeType === 3) {
    return node.textContent ? [{ text: node.textContent }] : [];
  }
  const element = node as Required<DomLikeNode>;
  const children = Array.from(element.childNodes).flatMap((child) => normalizeNode(child));
  const attrs: Record<string, string> = {};
  let style: Record<string, string> | undefined;
  for (const name of element.getAttributeNames().sort()) {
    if (RUNTIME_ATTRIBUTES.has(name)) {
      continue;
    }
    const value = element.getAttribute(name) ?? "";
    if (name === "style") {
      style = parseStyle(value);
      continue;
    }
    attrs[name] = value;
  }
  return [{
    tag: element.tagName.toLowerCase(),
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(style && Object.keys(style).length > 0 ? { style } : {}),
    children,
  }];
}

function parseStyle(value: string): Record<string, string> {
  const style: Record<string, string> = {};
  for (const declaration of value.split(";")) {
    const [property, ...rest] = declaration.split(":");
    const name = property?.trim();
    const propertyValue = rest.join(":").trim();
    if (name && propertyValue && DEFAULT_STYLE_DECLARATIONS[name] !== propertyValue) {
      style[name] = propertyValue;
    }
  }
  return style;
}
