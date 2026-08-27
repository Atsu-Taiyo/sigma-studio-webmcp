import type {
  BoxedVariant,
  InlineNode,
  TextMark,
} from "./model";
import type {
  OverlayRichTextBlock,
  OverlayRichTextDocument,
  OverlayTextSize,
} from "./overlay-model";

export type { OverlayTextSize } from "./overlay-model";

export type OverlayTextCommand =
  | "bold"
  | "italic"
  | "underline"
  | "boxed"
  | "boxedPaddingY"
  | "boxedVariant"
  | "color"
  | "backgroundColor"
  | "fontFamily"
  | "lineHeight"
  | "textAlign";

export function formatRichTextDocument(
  richText: OverlayRichTextDocument,
  command: OverlayTextCommand,
  value?: string,
): OverlayRichTextDocument {
  return {
    blocks: richText.blocks.map((block) => formatBlock(block, command, value)),
  };
}

export function fontSizeToOverlaySize(fontSize: number): OverlayTextSize {
  if (fontSize <= 10) {
    return "s";
  }
  if (fontSize <= 13) {
    return "m";
  }
  if (fontSize <= 16) {
    return "l";
  }
  return "xl";
}

export function overlayTextSizeToPx(size: OverlayTextSize): number {
  if (size === "s") {
    return 13;
  }
  if (size === "l") {
    return 20;
  }
  if (size === "xl") {
    return 24;
  }
  return 16;
}

function formatBlock(
  block: OverlayRichTextBlock,
  command: OverlayTextCommand,
  value?: string,
): OverlayRichTextBlock {
  const children = block.children.map((child) => formatInline(child, command, value));
  if (command === "lineHeight") {
    return { ...block, children, lineHeight: value };
  }
  if (command === "textAlign") {
    return { ...block, children, align: normalizeTextAlign(value) };
  }
  return { ...block, children };
}

function formatInline(
  node: InlineNode,
  command: OverlayTextCommand,
  value?: string,
): InlineNode {
  if (command === "bold" || command === "italic" || command === "underline" || command === "boxed") {
    if (node.type === "mathInline" && command !== "boxed" && command !== "underline") {
      return node;
    }
    if (node.type === "mathInline") {
      return {
        ...node,
        marks: toggleMathMark(node.marks, command === "boxed" ? "boxed" : "underline"),
      };
    }
    return { ...node, marks: toggleMark(node.marks, command) };
  }
  if (command === "boxedPaddingY") {
    if (node.type === "mathInline") {
      return {
        ...node,
        marks: ensureMathBoxedMark(node.marks),
        boxedPaddingY: normalizeNonnegativeNumber(value) ?? 0,
      };
    }
    return {
      ...node,
      marks: ensureBoxedMark(node.marks),
      boxedPaddingY: normalizeNonnegativeNumber(value) ?? 0,
    };
  }
  if (command === "boxedVariant") {
    const variant = normalizeBoxedVariant(value);
    if (node.type === "mathInline") {
      return {
        ...node,
        marks: ensureMathBoxedMark(node.marks),
        ...(variant && variant !== "frame" ? { boxedVariant: variant } : { boxedVariant: undefined }),
      };
    }
    return {
      ...node,
      marks: ensureBoxedMark(node.marks),
      ...(variant && variant !== "frame" ? { boxedVariant: variant } : { boxedVariant: undefined }),
    };
  }
  if (node.type === "mathInline") {
    return node;
  }
  if (command === "color" || command === "backgroundColor" || command === "fontFamily") {
    return { ...node, [command]: value || undefined };
  }
  return node;
}

function toggleMark(
  marks: readonly TextMark[] | undefined,
  mark: TextMark,
): TextMark[] | undefined {
  if (marks?.includes(mark)) {
    const next = marks.filter((item) => item !== mark);
    return next.length ? next : undefined;
  }
  return [...(marks ?? []), mark];
}

function ensureBoxedMark(marks: readonly TextMark[] | undefined): TextMark[] {
  return marks?.includes("boxed") ? [...marks] : [...(marks ?? []), "boxed"];
}

function toggleMathMark(
  marks: readonly ("underline" | "boxed")[] | undefined,
  mark: "underline" | "boxed",
): Array<"underline" | "boxed"> | undefined {
  if (marks?.includes(mark)) {
    const next = marks.filter((item) => item !== mark);
    return next.length ? next : undefined;
  }
  return [...(marks ?? []), mark];
}

function ensureMathBoxedMark(
  marks: readonly ("underline" | "boxed")[] | undefined,
): Array<"underline" | "boxed"> {
  return marks?.includes("boxed") ? [...marks] : [...(marks ?? []), "boxed"];
}

function normalizeNonnegativeNumber(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function normalizeBoxedVariant(value: unknown): BoxedVariant | undefined {
  return value === "frame" || value === "thick" || value === "double" || value === "oval" || value === "shade"
    ? value
    : undefined;
}

function normalizeTextAlign(value: unknown): "left" | "center" | "right" | "justify" | undefined {
  return value === "left" || value === "center" || value === "right" || value === "justify"
    ? value
    : undefined;
}

/**
 * Lines a rich-text document occupies: one per block, plus one per hard break inside it.
 *
 * This feature's copy. `features/rendering/core` has an identical one (drawing and rendering cannot
 * import this feature at runtime, only for types), and `overlay-text-line-model.test.ts` pins the
 * two against each other over a corpus — the count feeds the *stored* geometry of auto-sized text
 * shapes, so a rule that drifted would move figures in saved documents.
 */
export function getOverlayRichTextLineCount(document: OverlayRichTextDocument): number {
  const blocks = Array.isArray(document.blocks) ? document.blocks : [];
  if (blocks.length === 0) {
    return 1;
  }
  return Math.max(1, blocks.reduce((sum, block) => sum + getBlockLineCount(block?.children ?? []), 0));
}

function getBlockLineCount(content: readonly InlineNode[]): number {
  return 1 + content.reduce((sum, inline) => (
    inline?.type === "text" ? sum + Math.max(0, (inline.text ?? "").split("\n").length - 1) : sum
  ), 0);
}
