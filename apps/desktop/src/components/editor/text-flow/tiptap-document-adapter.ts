import { normalizeCodeLanguage } from "@/features/rendering/adapters";
import { createId } from "@/lib/id";
import {
  normalizeBlockSpaceAfterPx,
  normalizeCodeBlockTheme,
  normalizeLineHeight,
  normalizeOrderedListMarkerStyle,
  inlineNodesToPlainText,
  type BoxBlockChildBlock,
  type BoxBlockNode,
  type BoxFrameSpec,
  type LayoutSectionChildBlock,
  type LayoutSectionNode,
  type ListItemContinuationNode,
  type ListItemNode,
  type ListNode,
  type PaginationHints,
  type ParagraphNode,
  type QuoteBlockNode,
  type QuoteChildBlock,
} from "@/features/document";
import {
  inlineNodesToTiptapNodes,
  tiptapNodesToInlineNodes,
  type TiptapDoc,
  type TiptapNode,
} from "@/lib/tiptap-adapter";
import {
  getTextFlowBlockChildren,
  idPrefixForTextBlock,
  isNonEmptyInlineNode,
  isRecord,
  normalizeLayoutSectionColumnCount,
  normalizeNonnegativeNumber,
  normalizeTextAlign,
  type TextFlowBlock,
} from "@/features/text-editing";

export function textFlowToTiptap(blocks: TextFlowBlock[]): TiptapDoc {
  return {
    type: "doc",
    content: blocks.map(textFlowBlockToTiptapNode),
  };
}

export function tiptapToTextFlow(doc: TiptapDoc, previousBlocks: TextFlowBlock[] = []): TextFlowBlock[] {
  const usedIds = new Set<string>();
  const previousById = new Map(previousBlocks.map((block) => [block.id, block]));

  return (doc.content ?? [])
    .filter(isSupportedTiptapBlockNode)
    .map((node) => {
      const block = tiptapNodeToTextBlock(node);
      const previous = previousById.get(block.id);
      // 既にある id のブロックは SigmaDoc 側の pagination が正 (改ページの付け外しはそちらの
      // 操作で行う)。id が無い = 貼り付けなどで新しく現れたブロックだけ、node の attrs が
      // 運んできた pagination をそのまま使う。
      //
      // 2 度目に出てくる id は Enter によるブロック分割の後半。PM の `tr.split` は attrs を
      // 両側へ複製するので (Tiptap の `keepOnSplit` は末尾での分割にしか効かない)、そのままだと
      // 「このブロックの前で改ページ」が 2 つに増える。後半からは落とす。
      //
      // 下余白 (`spaceAfterPx`) も同じ規約に載せる: 「このブロックの下の余白」なので、割った
      // ときに残るのは前半。既存 id で SigmaDoc 側を正にするのも同じ理由で、これが無いと
      // 余白をコミットした直後の onUpdate が古い PM attrs でコミットを巻き戻す。
      const isSplitTail = usedIds.has(block.id);
      const carried = isSplitTail
        ? withCarriedBlockFields(block, undefined)
        : previous
          ? withCarriedBlockFields(block, previous)
          : block;
      return ensureUniqueTextFlowBlockIds(carried, usedIds);
    });
}

/**
 * PM の attrs ではなく SigmaDoc 側を正とするフィールドを載せ直す。
 * `previous` が無い (= 分割後半) ときは両方落とす。
 */
function withCarriedBlockFields<T extends TextFlowBlock>(block: T, previous: TextFlowBlock | undefined): T {
  return withSpaceAfter(withPagination(block, previous?.pagination), previous?.spaceAfterPx);
}

function withPagination<T extends TextFlowBlock>(block: T, pagination: PaginationHints | undefined): T {
  if (pagination) {
    return { ...block, pagination };
  }
  if (block.pagination === undefined) {
    return block;
  }
  const next = { ...block };
  delete next.pagination;
  return next;
}

function withSpaceAfter<T extends TextFlowBlock>(block: T, spaceAfterPx: number | undefined): T {
  const normalized = normalizeBlockSpaceAfterPx(spaceAfterPx);
  if (normalized !== undefined) {
    return { ...block, spaceAfterPx: normalized };
  }
  if (block.spaceAfterPx === undefined) {
    return block;
  }
  const next = { ...block };
  delete next.spaceAfterPx;
  return next;
}

/** PM の attrs へ載せる搬送用の値。SigmaDoc に無ければ null (attrs の既定値と揃える)。 */
function paginationAttr(block: { pagination?: PaginationHints | undefined }): PaginationHints | null {
  return block.pagination ?? null;
}

function spaceAfterAttr(block: { spaceAfterPx?: number | undefined }): number | null {
  return normalizeBlockSpaceAfterPx(block.spaceAfterPx) ?? null;
}

/** attrs から戻す。範囲外は clamp、非数は「指定なし」に倒す。 */
function spaceAfterFromAttrs(node: TiptapNode): number | undefined {
  return normalizeBlockSpaceAfterPx(node.attrs?.spaceAfterPx);
}

/** attrs から戻す。壊れた値は無視して「指定なし」に倒す。 */
function paginationFromAttrs(node: TiptapNode): PaginationHints | undefined {
  const value = node.attrs?.pagination;
  if (!isRecord(value)) {
    return undefined;
  }
  const hints: PaginationHints = {};
  if (value.break === true) {
    hints.break = true;
  }
  if (value.keepTogether === true) {
    hints.keepTogether = true;
  }
  if (value.keepWithNext === true) {
    hints.keepWithNext = true;
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
}

export function textFlowBlockToTiptapNode(block: TextFlowBlock): TiptapNode {
  if (block.type === "section") {
    return {
      type: "heading",
      attrs: {
        level: 1,
        sigmaDocId: block.id,
        sigmaDocType: block.type,
        textAlign: block.align ?? null,
        lineHeight: block.lineHeight ?? null,
        pagination: paginationAttr(block),
        spaceAfterPx: spaceAfterAttr(block),
      },
      content: block.title ? [{ type: "text", text: block.title }] : undefined,
    };
  }

  if (block.type === "heading") {
    return {
      type: "heading",
      attrs: {
        level: block.level,
        sigmaDocId: block.id,
        sigmaDocType: block.type,
        textAlign: block.align ?? null,
        lineHeight: block.lineHeight ?? null,
        pagination: paginationAttr(block),
        spaceAfterPx: spaceAfterAttr(block),
      },
      content: inlineNodesToTiptapNodes(block.children),
    };
  }

  if (block.type === "list") {
    return listNodeToTiptapNode(block);
  }

  if (block.type === "layoutSection") {
    return layoutSectionToTiptapNode(block);
  }

  if (block.type === "boxBlock") {
    return boxBlockToTiptapNode(block);
  }

  if (block.type === "quote") {
    return {
      type: "quote",
      attrs: blockIdentityAttrs(block),
      // 引用は必ず 1 つ以上の子を持つ。空で保存されていても段落 1 つに直して開く
      // (content 式が `+` なので、空のままだと PM がノードを作れず文書ごと開けなくなる)。
      content: block.blocks.length > 0
        ? block.blocks.map((child) => textFlowBlockToTiptapNode(child))
        : [textFlowBlockToTiptapNode(createEmptyParagraph(`${block.id}_p`))],
    };
  }

  if (block.type === "codeBlock") {
    return {
      type: "codeBlock",
      attrs: {
        ...blockIdentityAttrs(block),
        language: normalizeCodeLanguage(block.language) ?? null,
        theme: normalizeCodeBlockTheme(block.theme) ?? "light",
      },
      content: inlineNodesToTiptapNodes(block.children),
    };
  }

  if (block.type === "divider") {
    return { type: "divider", attrs: blockIdentityAttrs(block) };
  }

  return {
    type: "paragraph",
    attrs: {
      ...blockIdentityAttrs(block),
      textAlign: block.align ?? null,
      lineHeight: block.lineHeight ?? null,
    },
    content: inlineNodesToTiptapNodes(block.children),
  };
}

/** どのブロックも同じ形で運ぶ id・種別・改ページ指定・下余白。 */
function blockIdentityAttrs(block: {
  id: string;
  type: string;
  pagination?: PaginationHints | undefined;
  spaceAfterPx?: number | undefined;
}) {
  return {
    sigmaDocId: block.id,
    sigmaDocType: block.type,
    pagination: paginationAttr(block),
    spaceAfterPx: spaceAfterAttr(block),
  };
}

function createEmptyParagraph(id: string): ParagraphNode {
  return { type: "paragraph", id, children: [] };
}

function boxBlockToTiptapNode(block: BoxBlockNode): TiptapNode {
  return {
    type: "boxBlock",
    attrs: {
      sigmaDocId: block.id,
      sigmaDocType: "boxBlock",
      styleId: block.styleId,
      frame: block.frame ?? null,
      pagination: paginationAttr(block),
      spaceAfterPx: spaceAfterAttr(block),
    },
    content: [
      {
        type: "boxBlockTitle",
        content: inlineNodesToTiptapNodes(block.title ?? []),
      },
      {
        type: "boxBlockBody",
        content: block.blocks.length > 0
          ? block.blocks.map(boxBlockChildToTiptapNode)
          : [boxBlockChildToTiptapNode({ type: "paragraph", id: createId("p"), children: [] })],
      },
    ],
  };
}

function layoutSectionToTiptapNode(block: LayoutSectionNode): TiptapNode {
  return {
    type: "layoutSection",
    attrs: {
      sigmaDocId: block.id,
      sigmaDocType: "layoutSection",
      columnCount: normalizeLayoutSectionColumnCount(block.layout.columnCount),
      columnGapMm: block.layout.columnGapMm ?? 8,
      pagination: paginationAttr(block),
      spaceAfterPx: spaceAfterAttr(block),
    },
    content: block.children.length > 0
      ? block.children.map(layoutSectionChildToTiptapNode)
      : [layoutSectionChildToTiptapNode({ type: "paragraph", id: createId("p"), children: [] })],
  };
}

function boxBlockChildToTiptapNode(block: BoxBlockChildBlock): TiptapNode {
  if (block.type === "layoutSection") {
    return layoutSectionToTiptapNode(block);
  }
  return layoutSectionChildToTiptapNode(block);
}

function layoutSectionChildToTiptapNode(block: LayoutSectionChildBlock): TiptapNode {
  return textFlowBlockToTiptapNode(block);
}

function listNodeToTiptapNode(list: ListNode): TiptapNode {
  return {
    type: list.listType === "ordered" ? "orderedList" : "bulletList",
    attrs: {
      sigmaDocId: list.id,
      sigmaDocType: "list",
      pagination: paginationAttr(list),
      spaceAfterPx: spaceAfterAttr(list),
      ...(list.listType === "ordered" && list.start ? { start: list.start } : {}),
      ...(list.listType === "ordered" && list.markerStyle ? { markerStyle: list.markerStyle } : {}),
    },
    content: list.items.map(listItemNodeToTiptapNode),
  };
}

function listItemNodeToTiptapNode(item: ListItemNode): TiptapNode {
  return {
    type: "listItem",
    content: [
      {
        type: "paragraph",
        attrs: {
          sigmaDocId: item.id,
          sigmaDocType: "listItem",
          ...(item.align ? { textAlign: item.align } : {}),
        },
        content: inlineNodesToTiptapNodes(item.children),
      },
      ...(item.continuations ?? []).map(textFlowBlockToTiptapNode),
      ...(item.nested ?? []).map(listNodeToTiptapNode),
    ],
  };
}

function isTiptapListNode(node: TiptapNode): boolean {
  return node.type === "bulletList" || node.type === "orderedList";
}

/**
 * SigmaDoc へ書き戻せるノードか。
 *
 * ここに無い種別は **黙って捨てられる**。かつて StarterKit の blockquote / codeBlock /
 * horizontalRule が有効なまま素通りしていて、`> ` と打つと引用ができ、次の同期で中身ごと
 * 消えていた。いまは `createRichTextEngineExtensions` がそれらのノードを本文スキーマから
 * 外しているので、ここへ来ない種別は「本当に描けないもの」だけになっている。
 */
/**
 * 引用ノードを SigmaDoc へ戻す。
 *
 * 子は `QuoteChildBlock` しか取らない。PM のスキーマ (content 式) がそれ以外を作れないので、
 * ここで弾かれるものが出るのは「スキーマと SigmaDoc の型が食い違ったとき」だけ — そのときは
 * 黙って捨てるのではなく段落として残す方が、書いた文字が消えないぶん必ず良い。
 */
function tiptapQuoteNodeToTextBlock(node: TiptapNode): QuoteBlockNode {
  const pagination = paginationFromAttrs(node);
  const spaceAfterPx = spaceAfterFromAttrs(node);
  const blocks = (node.content ?? [])
    .filter(isSupportedTiptapBlockNode)
    .map((child) => tiptapNodeToTextBlock(child))
    .map(toQuoteChildBlock);
  return {
    type: "quote",
    id: typeof node.attrs?.sigmaDocId === "string" ? node.attrs.sigmaDocId : createId("quote"),
    blocks: blocks.length > 0
      ? blocks
      : [{ type: "paragraph", id: createId("p"), children: [] }],
    ...(pagination ? { pagination } : {}),
    ...(spaceAfterPx ? { spaceAfterPx } : {}),
  };
}

function toQuoteChildBlock(block: TextFlowBlock): QuoteChildBlock {
  if (
    block.type === "paragraph"
    || block.type === "heading"
    || block.type === "list"
    || block.type === "codeBlock"
    || block.type === "divider"
  ) {
    return block;
  }
  return {
    type: "paragraph",
    id: block.id,
    children: getTextFlowBlockChildren(block),
  };
}

function isSupportedTiptapBlockNode(node: TiptapNode): boolean {
  return node.type === "paragraph"
    || node.type === "heading"
    || node.type === "quote"
    || node.type === "codeBlock"
    || node.type === "divider"
    || node.type === "boxBlock"
    || node.type === "layoutSection"
    || isTiptapListNode(node);
}

function ensureUniqueTextFlowBlockIds<T extends TextFlowBlock>(block: T, usedIds: Set<string>): T {
  if (block.type === "boxBlock") {
    const id = claimUniqueId(block.id, "box", usedIds);
    return {
      ...block,
      id,
      blocks: block.blocks.map((child) => ensureUniqueBoxBlockChildIds(child, usedIds)),
    } as T;
  }

  if (block.type === "layoutSection") {
    const id = claimUniqueId(block.id, "layout_section", usedIds);
    return {
      ...block,
      id,
      children: block.children.map((child) => ensureUniqueLayoutSectionChildIds(child, usedIds)),
    } as T;
  }

  if (block.type !== "list") {
    if (!usedIds.has(block.id)) {
      usedIds.add(block.id);
      return block;
    }

    const next = {
      ...block,
      id: createId(idPrefixForTextBlock(block)),
    };
    usedIds.add(next.id);
    return next;
  }

  const nextList = ensureUniqueListNodeIds(block, usedIds);
  return nextList as T;
}

function ensureUniqueBoxBlockChildIds(block: BoxBlockChildBlock, usedIds: Set<string>): BoxBlockChildBlock {
  if (block.type === "layoutSection") {
    const id = claimUniqueId(block.id, "layout_section", usedIds);
    return {
      ...block,
      id,
      children: block.children.map((child) => ensureUniqueLayoutSectionChildIds(child, usedIds)),
    };
  }
  return ensureUniqueLayoutSectionChildIds(block, usedIds);
}

function ensureUniqueLayoutSectionChildIds(block: LayoutSectionChildBlock, usedIds: Set<string>): LayoutSectionChildBlock {
  if (block.type === "boxBlock") {
    const id = claimUniqueId(block.id, "box", usedIds);
    return {
      ...block,
      id,
      blocks: block.blocks.map((child) => ensureUniqueBoxBlockChildIds(child, usedIds)),
    };
  }
  return ensureUniqueTextFlowBlockIds(block, usedIds) as LayoutSectionChildBlock;
}

function ensureUniqueListNodeIds(list: ListNode, usedIds: Set<string>): ListNode {
  const id = claimUniqueId(list.id, "list", usedIds);
  return {
    ...list,
    id,
    items: list.items.map((item) => ensureUniqueListItemNodeIds(item, usedIds)),
  };
}

function ensureUniqueListItemNodeIds(item: ListItemNode, usedIds: Set<string>): ListItemNode {
  return {
    ...item,
    id: claimUniqueId(item.id, "li", usedIds),
    ...(item.continuations ? {
      continuations: item.continuations.map((continuation) => ({
        ...continuation,
        id: claimUniqueId(continuation.id, continuationIdPrefix(continuation.type), usedIds),
      })),
    } : {}),
    ...(item.nested ? { nested: item.nested.map((list) => ensureUniqueListNodeIds(list, usedIds)) } : {}),
  };
}

function continuationIdPrefix(type: ListItemContinuationNode["type"]): string {
  if (type === "heading") {
    return "heading";
  }
  if (type === "divider") {
    return "divider";
  }
  return "p";
}

function claimUniqueId(id: string, prefix: string, usedIds: Set<string>): string {
  if (id && !usedIds.has(id)) {
    usedIds.add(id);
    return id;
  }

  let nextId = "";
  do {
    nextId = createId(prefix);
  } while (usedIds.has(nextId));

  usedIds.add(nextId);
  return nextId;
}


function tiptapNodeToTextBlock(node: TiptapNode): TextFlowBlock {
  if (isTiptapListNode(node)) {
    return tiptapListNodeToTextBlock(node);
  }

  if (node.type === "boxBlock") {
    return tiptapBoxNodeToTextBlock(node);
  }

  if (node.type === "layoutSection") {
    return tiptapLayoutSectionNodeToTextBlock(node);
  }

  if (node.type === "quote") {
    return tiptapQuoteNodeToTextBlock(node);
  }

  if (node.type === "codeBlock") {
    const codePagination = paginationFromAttrs(node);
    const codeSpaceAfter = spaceAfterFromAttrs(node);
    const theme = normalizeCodeBlockTheme(node.attrs?.theme);
    return {
      type: "codeBlock",
      id: typeof node.attrs?.sigmaDocId === "string" ? node.attrs.sigmaDocId : createId("code"),
      children: tiptapNodesToInlineNodes(node.content ?? []),
      language: normalizeCodeLanguage(node.attrs?.language),
      ...(theme && theme !== "light" ? { theme } : {}),
      ...(codePagination ? { pagination: codePagination } : {}),
      ...(codeSpaceAfter ? { spaceAfterPx: codeSpaceAfter } : {}),
    };
  }

  if (node.type === "divider") {
    const dividerPagination = paginationFromAttrs(node);
    const dividerSpaceAfter = spaceAfterFromAttrs(node);
    return {
      type: "divider",
      id: typeof node.attrs?.sigmaDocId === "string" ? node.attrs.sigmaDocId : createId("divider"),
      ...(dividerPagination ? { pagination: dividerPagination } : {}),
      ...(dividerSpaceAfter ? { spaceAfterPx: dividerSpaceAfter } : {}),
    };
  }

  const previousType = node.attrs?.sigmaDocType;
  const id = typeof node.attrs?.sigmaDocId === "string" ? node.attrs.sigmaDocId : createId("text");
  const children = tiptapNodesToInlineNodes(node.content ?? []);

  const pagination = paginationFromAttrs(node);
  const spaceAfterPx = spaceAfterFromAttrs(node);

  // `section` は level 1 の見出しとして描いている。level が動いていたら、それは
  // Tiptap の chain (`setHeading`) で見出しレベルを変えた結果なので、section へ
  // 引き戻さずその見出しにする — 引き戻すと選んだレベルが黙って 1 に戻る。
  if (previousType === "section" && Number(node.attrs?.level ?? 1) === 1) {
    return {
      type: "section",
      id,
      title: inlineNodesToPlainText(children),
      align: normalizeTextAlign(node.attrs?.textAlign),
      lineHeight: normalizeLineHeight(node.attrs?.lineHeight),
      ...(pagination ? { pagination } : {}),
      ...(spaceAfterPx ? { spaceAfterPx } : {}),
    };
  }

  if (node.type === "heading") {
    const level = Number(node.attrs?.level ?? 2);
    return {
      type: "heading",
      id,
      level: level === 1 || level === 2 || level === 3 ? level : 2,
      children,
      align: normalizeTextAlign(node.attrs?.textAlign),
      lineHeight: normalizeLineHeight(node.attrs?.lineHeight),
      ...(pagination ? { pagination } : {}),
      ...(spaceAfterPx ? { spaceAfterPx } : {}),
    };
  }

  return {
    type: "paragraph",
    id,
    children,
    align: normalizeTextAlign(node.attrs?.textAlign),
    lineHeight: normalizeLineHeight(node.attrs?.lineHeight),
    ...(pagination ? { pagination } : {}),
    ...(spaceAfterPx ? { spaceAfterPx } : {}),
  };
}

function tiptapBoxNodeToTextBlock(node: TiptapNode): BoxBlockNode {
  const styleId = typeof node.attrs?.styleId === "string" && node.attrs.styleId
    ? node.attrs.styleId
    : "fancybox";
  const frame = isRecord(node.attrs?.frame) ? node.attrs.frame as BoxFrameSpec : undefined;
  const titleNode = node.content?.find((child) => child.type === "boxBlockTitle");
  const bodyNode = node.content?.find((child) => child.type === "boxBlockBody");
  const title = tiptapNodesToInlineNodes(titleNode?.content ?? []);
  const blocks = tiptapNodesToBoxBlockChildren(bodyNode?.content ?? []);
  return {
    type: "boxBlock",
    id: typeof node.attrs?.sigmaDocId === "string" ? node.attrs.sigmaDocId : createId("box"),
    styleId,
    ...(title.length > 0 ? { title } : {}),
    ...(frame ? { frame } : {}),
    ...(paginationFromAttrs(node) ? { pagination: paginationFromAttrs(node) } : {}),
    ...(spaceAfterFromAttrs(node) ? { spaceAfterPx: spaceAfterFromAttrs(node) } : {}),
    blocks: blocks.length > 0 ? blocks : [{
      type: "paragraph",
      id: createId("p"),
      children: [],
    }],
  };
}

function tiptapLayoutSectionNodeToTextBlock(node: TiptapNode): LayoutSectionNode {
  const children = tiptapNodesToLayoutSectionChildren(node.content ?? []);
  return {
    type: "layoutSection",
    id: typeof node.attrs?.sigmaDocId === "string" ? node.attrs.sigmaDocId : createId("layout_section"),
    layout: {
      columnCount: normalizeLayoutSectionColumnCount(node.attrs?.columnCount),
      columnGapMm: normalizeNonnegativeNumber(node.attrs?.columnGapMm) ?? 8,
    },
    ...(paginationFromAttrs(node) ? { pagination: paginationFromAttrs(node) } : {}),
    ...(spaceAfterFromAttrs(node) ? { spaceAfterPx: spaceAfterFromAttrs(node) } : {}),
    children: children.length > 0 ? children : [{
      type: "paragraph",
      id: createId("p"),
      children: [],
    }],
  };
}

function tiptapNodesToBoxBlockChildren(nodes: TiptapNode[]): BoxBlockChildBlock[] {
  return nodes
    .filter(isSupportedTiptapBlockNode)
    .map((node) => {
      if (node.type === "layoutSection") {
        return tiptapLayoutSectionNodeToTextBlock(node);
      }
      return tiptapNodeToLayoutSectionChildBlock(node);
    });
}

function tiptapNodesToLayoutSectionChildren(nodes: TiptapNode[]): LayoutSectionChildBlock[] {
  return nodes
    .filter(isSupportedTiptapBlockNode)
    .map(tiptapNodeToLayoutSectionChildBlock);
}

function tiptapNodeToLayoutSectionChildBlock(node: TiptapNode): LayoutSectionChildBlock {
  const block = tiptapNodeToTextBlock(node);
  return isLayoutSectionChildBlock(block)
    ? block
    : {
      type: "paragraph",
      id: createId("p"),
      children: [],
    };
}

function tiptapListNodeToTextBlock(node: TiptapNode): ListNode {
  const isOrdered = node.type === "orderedList";
  const start = normalizePositiveInteger(node.attrs?.start);
  const markerStyle = normalizeOrderedListMarkerStyle(node.attrs?.markerStyle);
  return {
    type: "list",
    id: typeof node.attrs?.sigmaDocId === "string" ? node.attrs.sigmaDocId : createId("list"),
    listType: isOrdered ? "ordered" : "bullet",
    ...(paginationFromAttrs(node) ? { pagination: paginationFromAttrs(node) } : {}),
    ...(spaceAfterFromAttrs(node) ? { spaceAfterPx: spaceAfterFromAttrs(node) } : {}),
    ...(isOrdered && start && start !== 1 ? { start } : {}),
    ...(isOrdered && markerStyle && markerStyle !== "decimal" ? { markerStyle } : {}),
    items: (node.content ?? [])
      .filter((child) => child.type === "listItem")
      .map(tiptapListItemNodeToSigmaNode),
  };
}

function tiptapListItemNodeToSigmaNode(node: TiptapNode): ListItemNode {
  // 項目の 1 行目は必ず段落か見出し。続きには区切り線とコードも置ける
  // (`ListItemContinuationNode`)。入れ物 (引用・囲み枠・段組) は項目の中には置かない。
  const bodyBlocks = (node.content ?? []).filter((child) => (
    child.type === "paragraph" || child.type === "heading" || child.type === "divider"
  ));
  const firstTextBlock = bodyBlocks.findIndex((child) => (
    child.type === "paragraph" || child.type === "heading"
  ));
  const firstBody = firstTextBlock >= 0 ? bodyBlocks[firstTextBlock] : undefined;
  const children = tiptapNodesToInlineNodes(firstBody?.content ?? []).filter(isNonEmptyInlineNode);
  const align = normalizeTextAlign(firstBody?.attrs?.textAlign);
  const continuations = bodyBlocks
    .filter((_, index) => index !== firstTextBlock)
    .map(tiptapNodeToTextBlock)
    .filter((body): body is ListItemContinuationNode => (
      body.type === "paragraph" || body.type === "heading" || body.type === "divider"
    ));
  const nested = (node.content ?? [])
    .filter(isTiptapListNode)
    .map(tiptapListNodeToTextBlock);

  return {
    type: "listItem",
    id: typeof firstBody?.attrs?.sigmaDocId === "string" ? firstBody.attrs.sigmaDocId : createId("li"),
    children,
    ...(align && align !== "left" ? { align } : {}),
    ...(continuations.length > 0 ? { continuations } : {}),
    ...(nested.length > 0 ? { nested } : {}),
  };
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function isLayoutSectionChildBlock(block: TextFlowBlock): block is LayoutSectionChildBlock {
  return block.type === "section" || block.type === "heading" || block.type === "paragraph" || block.type === "list" || block.type === "boxBlock";
}
