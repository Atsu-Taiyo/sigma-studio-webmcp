import type {
  BoxedTone,
  BoxedVariant,
  InlineNode,
  TextAlign,
  TextMark,
} from "./model";
import { normalizeLineHeight } from "./application/line-height";
import type {
  OverlayRichTextBlock,
  OverlayRichTextDocument,
} from "./overlay-model";
import { isOverlayRichTextDocument } from "./overlay-validation";

/**
 * Converts the former persisted Tiptap-shaped overlay document into SigmaDoc
 * semantic rich text. Canonical input is returned by reference.
 */
export function migrateLegacyOverlayRichTextDocument(value: unknown): unknown {
  if (isOverlayRichTextDocument(value)) {
    return value;
  }
  if (!isRecord(value) || value.type !== "doc" || !Array.isArray(value.content)) {
    return value;
  }

  const legacyBlocks = normalizeLegacyRootContent(value.content);
  if (!legacyBlocks) {
    return value;
  }

  const blocks: OverlayRichTextBlock[] = [];
  for (const legacyBlock of legacyBlocks) {
    const block = convertLegacyBlock(legacyBlock);
    if (!block) {
      return value;
    }
    blocks.push(block);
  }

  return { blocks } satisfies OverlayRichTextDocument;
}

/** Applies the rich-text migration without otherwise normalizing a snapshot. */
export function migrateLegacyOverlaySnapshotRichText(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.shapes)) {
    return value;
  }

  let changed = false;
  const shapes = value.shapes.map((shape) => {
    if (
      !isRecord(shape) ||
      (shape.type !== "text" && shape.type !== "callout") ||
      !isRecord(shape.props)
    ) {
      return shape;
    }

    const richText = migrateLegacyOverlayRichTextDocument(shape.props.richText);
    if (richText === shape.props.richText) {
      return shape;
    }

    changed = true;
    return {
      ...shape,
      props: {
        ...shape.props,
        richText,
      },
    };
  });

  return changed ? { ...value, shapes } : value;
}

function normalizeLegacyRootContent(content: unknown[]): Record<string, unknown>[] | null {
  const blocks: Record<string, unknown>[] = [];
  for (const node of content) {
    if (!isRecord(node)) {
      return null;
    }
    if (node.type === "paragraph" || node.type === "heading") {
      blocks.push(node);
      continue;
    }
    if (!isLegacyInline(node)) {
      return null;
    }
    const last = blocks[blocks.length - 1];
    if (last?.type === "paragraph" || last?.type === "heading") {
      blocks[blocks.length - 1] = {
        ...last,
        content: [...(Array.isArray(last.content) ? last.content : []), node],
      };
    } else {
      blocks.push({ type: "paragraph", content: [node] });
    }
  }
  return blocks;
}

function convertLegacyBlock(value: Record<string, unknown>): OverlayRichTextBlock | null {
  if (
    (value.type !== "paragraph" && value.type !== "heading") ||
    (value.content !== undefined && !Array.isArray(value.content)) ||
    (value.attrs !== undefined && !isRecord(value.attrs))
  ) {
    return null;
  }

  const children = convertLegacyInlines(Array.isArray(value.content) ? value.content : []);
  if (!children) {
    return null;
  }
  const attrs = isRecord(value.attrs) ? value.attrs : {};
  const align = normalizeTextAlign(attrs.textAlign);
  const lineHeight = normalizeLineHeight(attrs.lineHeight);
  if (value.type === "heading") {
    const level = attrs.level === 1 || attrs.level === 2 || attrs.level === 3
      ? attrs.level
      : 2;
    return {
      type: "heading",
      level,
      children,
      ...(align ? { align } : {}),
      ...(lineHeight ? { lineHeight } : {}),
    };
  }
  return {
    type: "paragraph",
    children,
    ...(align ? { align } : {}),
    ...(lineHeight ? { lineHeight } : {}),
  };
}

function convertLegacyInlines(values: unknown[]): InlineNode[] | null {
  const result: InlineNode[] = [];
  for (const value of values) {
    if (!isLegacyInline(value)) {
      return null;
    }
    if (value.type === "hardBreak") {
      appendSemanticText(result, "\n", result[result.length - 1]?.type === "text"
        ? result[result.length - 1]
        : {});
      continue;
    }

    const marks = Array.isArray(value.marks) ? value.marks : [];
    const style = legacyInlineStyle(marks);
    if (value.type === "text") {
      appendSemanticText(result, value.text, style);
      continue;
    }

    const attrs = value.attrs;
    const mathMarks = legacyMathMarks(marks);
    result.push({
      type: "mathInline",
      id: typeof attrs.id === "string" && attrs.id ? attrs.id : `m_inline_${result.length}`,
      tex: attrs.tex,
      display: "inline",
      ...(mathMarks.length ? { marks: mathMarks } : {}),
      ...semanticStyleFields(style, mathMarks.includes("boxed")),
      semanticRole: "expression",
    });
  }
  return result;
}

interface SemanticInlineStyle {
  marks?: TextMark[];
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: number;
  boxedPaddingY?: number;
  boxedVariant?: BoxedVariant;
  boxedTone?: BoxedTone;
}

function legacyInlineStyle(marks: unknown[]): SemanticInlineStyle {
  const textMarks = new Set<TextMark>();
  let color: string | undefined;
  let backgroundColor: string | undefined;
  let fontFamily: string | undefined;
  let fontSize: number | undefined;
  let boxedPaddingY: number | undefined;
  let boxedVariant: BoxedVariant | undefined;
  let boxedTone: BoxedTone | undefined;

  for (const mark of marks) {
    if (!isRecord(mark) || typeof mark.type !== "string") {
      continue;
    }
    if (mark.type === "bold" || mark.type === "italic" || mark.type === "underline") {
      textMarks.add(mark.type);
      continue;
    }
    const attrs = isRecord(mark.attrs) ? mark.attrs : {};
    if (mark.type === "boxed") {
      textMarks.add("boxed");
      boxedPaddingY = nonnegativeNumber(attrs.paddingY);
      boxedVariant = normalizeBoxedVariant(attrs.variant);
      boxedTone = normalizeBoxedTone(attrs.tone);
      continue;
    }
    if (mark.type !== "styledText") {
      continue;
    }
    color = nonemptyString(attrs.color);
    backgroundColor = nonemptyString(attrs.backgroundColor);
    fontFamily = nonemptyString(attrs.fontFamily);
    fontSize = normalizeLegacyFontSize(attrs.fontSize);
    if (attrs.fontWeight === "bold" || Number(attrs.fontWeight) >= 600) {
      textMarks.add("bold");
    }
    if (attrs.fontStyle === "italic") {
      textMarks.add("italic");
    }
    if (typeof attrs.textDecoration === "string" && attrs.textDecoration.includes("underline")) {
      textMarks.add("underline");
    }
  }

  return {
    ...(textMarks.size ? { marks: [...textMarks] } : {}),
    ...(color ? { color } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(fontSize ? { fontSize } : {}),
    ...(boxedPaddingY !== undefined ? { boxedPaddingY } : {}),
    ...(boxedVariant ? { boxedVariant } : {}),
    ...(boxedTone ? { boxedTone } : {}),
  };
}

function legacyMathMarks(marks: unknown[]): Array<"underline" | "boxed"> {
  const style = legacyInlineStyle(marks);
  return (style.marks ?? []).filter(
    (mark): mark is "underline" | "boxed" => mark === "underline" || mark === "boxed",
  );
}

function appendSemanticText(
  result: InlineNode[],
  text: string,
  style: SemanticInlineStyle,
): void {
  const previous = result[result.length - 1];
  if (
    previous?.type === "text" &&
    JSON.stringify(previous.marks ?? []) === JSON.stringify(style.marks ?? []) &&
    previous.color === style.color &&
    previous.backgroundColor === style.backgroundColor &&
    previous.fontFamily === style.fontFamily &&
    previous.fontSize === style.fontSize &&
    previous.boxedPaddingY === style.boxedPaddingY &&
    previous.boxedVariant === style.boxedVariant &&
    previous.boxedTone === style.boxedTone
  ) {
    previous.text += text;
    return;
  }
  result.push({
    type: "text",
    text,
    ...semanticStyleFields(style, style.marks?.includes("boxed") ?? false),
    ...(style.marks?.length ? { marks: style.marks } : {}),
  });
}

function semanticStyleFields(
  style: SemanticInlineStyle,
  includeBoxed: boolean,
): Omit<SemanticInlineStyle, "marks"> {
  return {
    ...(style.color ? { color: style.color } : {}),
    ...(style.backgroundColor ? { backgroundColor: style.backgroundColor } : {}),
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    ...(style.fontSize ? { fontSize: style.fontSize } : {}),
    ...(includeBoxed && style.boxedPaddingY !== undefined ? { boxedPaddingY: style.boxedPaddingY } : {}),
    ...(includeBoxed && style.boxedVariant ? { boxedVariant: style.boxedVariant } : {}),
    ...(includeBoxed && style.boxedTone ? { boxedTone: style.boxedTone } : {}),
  };
}

function isLegacyInline(value: unknown): value is (
  | { type: "text"; text: string; marks?: unknown[] }
  | { type: "hardBreak"; marks?: unknown[] }
  | { type: "mathInline"; attrs: { id?: unknown; tex: string }; marks?: unknown[] }
) {
  if (
    !isRecord(value) ||
    (value.marks !== undefined && (
      !Array.isArray(value.marks) ||
      !value.marks.every(isSupportedLegacyMark)
    ))
  ) {
    return false;
  }
  if (value.type === "text") {
    return typeof value.text === "string";
  }
  if (value.type === "hardBreak") {
    return true;
  }
  return value.type === "mathInline" &&
    isRecord(value.attrs) &&
    typeof value.attrs.tex === "string";
}

function isSupportedLegacyMark(value: unknown): boolean {
  return isRecord(value) && (
    value.type === "bold" ||
    value.type === "italic" ||
    value.type === "underline" ||
    value.type === "boxed" ||
    value.type === "styledText"
  ) && (value.attrs === undefined || isRecord(value.attrs));
}

function normalizeTextAlign(value: unknown): TextAlign | undefined {
  return value === "left" || value === "center" || value === "right" || value === "justify"
    ? value
    : undefined;
}

function normalizeLegacyFontSize(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  const points = typeof value === "string" && /px$/iu.test(value.trim())
    ? numeric / (96 / 72)
    : numeric;
  return Math.round(points * 100) / 100;
}

function nonnegativeNumber(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.min(12, Math.round(numeric * 10) / 10)
    : undefined;
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeBoxedVariant(value: unknown): BoxedVariant | undefined {
  return value === "frame" || value === "thick" || value === "double" || value === "oval" || value === "shade"
    ? value
    : undefined;
}

function normalizeBoxedTone(value: unknown): BoxedTone | undefined {
  return value === "gray" || value === "blue" || value === "green" || value === "red" || value === "yellow"
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
