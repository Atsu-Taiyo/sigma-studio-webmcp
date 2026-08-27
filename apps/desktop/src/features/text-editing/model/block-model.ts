import {
  inlineNodesToPlainText,
  listItemContinuationInlineNodes,
  type BoxBlockChildBlock,
  type InlineNode,
  type LayoutSectionChildBlock,
  type LayoutSectionNode,
  type ListItemNode,
  type QuoteChildBlock,
  type SigmaBlock,
} from "@/features/document";

import type { TextFlowBlock, TextFlowIdFactory } from "./text-flow-types";

export function getTextFlowBlockChildren(block: TextFlowBlock): InlineNode[] {
  if (block.type === "section") {
    return block.title ? [{ type: "text", text: block.title }] : [];
  }
  if (block.type === "boxBlock") {
    return block.blocks.flatMap(getTextFlowBlockChildren);
  }
  if (block.type === "layoutSection") {
    return block.children.flatMap(getTextFlowBlockChildren);
  }
  if (block.type === "list") {
    return block.items.flatMap(listItemToInlineNodes);
  }
  if (block.type === "quote") {
    return block.blocks.flatMap(getTextFlowBlockChildren);
  }
  // 区切り線は文章を持たない。空配列を返すことで、検索・文字数・書式適用が
  // 「文章の無いブロック」として素通りする。
  if (block.type === "divider") {
    return [];
  }
  return block.children;
}

export function withTextFlowBlockChildren(
  block: TextFlowBlock,
  children: InlineNode[],
  createId: TextFlowIdFactory,
): TextFlowBlock {
  if (block.type === "section") {
    return {
      ...block,
      title: inlineNodesToPlainText(children),
    };
  }
  if (block.type === "list") {
    const [firstItem, ...restItems] = block.items;
    return {
      ...block,
      items: firstItem
        ? [{ ...firstItem, children }, ...restItems]
        : [{ type: "listItem", id: createId("li"), children }],
    };
  }
  if (block.type === "boxBlock") {
    const [firstBlock, ...restBlocks] = block.blocks;
    return {
      ...block,
      blocks: firstBlock
        ? [
            withTextFlowBlockChildren(
              firstBlock,
              children,
              createId,
            ) as BoxBlockChildBlock,
            ...restBlocks,
          ]
        : [{ type: "paragraph", id: createId("p"), children }],
    };
  }
  if (block.type === "layoutSection") {
    const [firstBlock, ...restBlocks] = block.children;
    return {
      ...block,
      children: firstBlock
        ? [
            withTextFlowBlockChildren(
              firstBlock,
              children,
              createId,
            ) as LayoutSectionChildBlock,
            ...restBlocks,
          ]
        : [{ type: "paragraph", id: createId("p"), children }],
    };
  }
  if (block.type === "quote") {
    const [firstBlock, ...restBlocks] = block.blocks;
    return {
      ...block,
      blocks: firstBlock
        ? [
            withTextFlowBlockChildren(firstBlock, children, createId) as QuoteChildBlock,
            ...restBlocks,
          ]
        : [{ type: "paragraph", id: createId("p"), children }],
    };
  }
  // 区切り線には文章を書き戻せない。呼び出し側は「変わっていない」を identity で見るので、
  // 同じオブジェクトを返す。
  if (block.type === "divider") {
    return block;
  }
  return {
    ...block,
    children,
  };
}

export function createEmptyParagraphTextBlock(
  createId: TextFlowIdFactory,
): TextFlowBlock {
  return {
    type: "paragraph",
    id: createId("p"),
    children: [],
  };
}

export function getTextFlowBlockEditorLength(block: TextFlowBlock): number {
  return getTextFlowBlockChildren(block)
    .reduce((length, child) => length + getInlineEditorLength(child), 0);
}

export function getInlineEditorLength(child: InlineNode): number {
  return child.type === "text" ? child.text.length : 1;
}

export function cloneInlineNode(child: InlineNode): InlineNode {
  if (child.type === "text") {
    return {
      ...child,
      marks: child.marks ? [...child.marks] : undefined,
    };
  }
  return {
    ...child,
    marks: child.marks ? [...child.marks] : undefined,
  };
}

function listItemToInlineNodes(item: ListItemNode): InlineNode[] {
  const continuationText = (item.continuations ?? []).flatMap((continuation) => listItemContinuationInlineNodes(continuation));
  const nestedText = (item.nested ?? [])
    .flatMap((list) => list.items.flatMap(listItemToInlineNodes));
  return [...item.children, ...continuationText, ...nestedText];
}

export function isNonEmptyInlineNode(child: InlineNode): boolean {
  return child.type === "mathInline" || child.text.length > 0;
}

export function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function idPrefixForTextBlock(block: TextFlowBlock): string {
  if (block.type === "section") {
    return "section";
  }
  if (block.type === "list") {
    return "list";
  }
  if (block.type === "boxBlock") {
    return "box";
  }
  if (block.type === "layoutSection") {
    return "layout_section";
  }
  if (block.type === "quote") {
    return "quote";
  }
  if (block.type === "codeBlock") {
    return "code";
  }
  if (block.type === "divider") {
    return "divider";
  }
  return block.type === "heading" ? "heading" : "p";
}

export function isTextFlowBlock(
  block: SigmaBlock,
): block is Exclude<TextFlowBlock, LayoutSectionNode> {
  return block.type === "section"
    || block.type === "heading"
    || block.type === "paragraph"
    || block.type === "list"
    || block.type === "quote"
    || block.type === "codeBlock"
    || block.type === "divider"
    || block.type === "boxBlock";
}
