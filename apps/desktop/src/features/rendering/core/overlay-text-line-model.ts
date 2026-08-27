import type {
  InlineNode,
  OverlayRichTextDocument,
} from "@/features/document";

/**
 * How overlay text is broken into lines — one implementation, shared by drawing and rendering.
 *
 * The estimator in `features/drawing/overlay-text-measure.ts` used to walk `richText.blocks` and
 * split text on newlines itself, in parallel with the render model. Two copies of "what counts as a
 * line" is exactly the class of bug this refactor removes: the measured height is the *stored*
 * geometry of every auto-sized figure, so a rule that drifts from the renderer moves figures.
 *
 * Tokens carry only content. What a formula's box measures — and whether it is measured at all or
 * flattened into plain characters because no metrics port is registered — is a measurement policy
 * and stays with the measurer.
 */

export type OverlayTextLineToken =
  | { kind: "math"; tex: string }
  | { kind: "text"; text: string };

export type OverlayTextLine = OverlayTextLineToken[];

export interface OverlayTextLineModelInput {
  /** SigmaDoc inline content. */
  inlineContent?: readonly InlineNode[];
  /** Plain-text lines; each entry may itself contain hard breaks. */
  lines?: readonly string[];
  /** Overlay rich text, including multiple blocks and hard breaks. */
  richText?: OverlayRichTextDocument;
}

/** The one newline rule: CRLF, CR and LF all start a new line. */
export function splitOverlayTextLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/**
 * Per-document memo. `getShapeBounds` sits on the hottest overlay path (pointermove hit-testing,
 * marquee selection, `view-cache`'s per-shape pass) and re-derives this for the same immutable rich
 * text over and over; `overlay-text-box.ts` caches its own result against the same object identity
 * for the same reason.
 */
const richTextLineCache = new WeakMap<OverlayRichTextDocument, readonly OverlayTextLine[]>();

export function createOverlayTextLineModel(
  input: OverlayTextLineModelInput,
): readonly OverlayTextLine[] {
  if (input.inlineContent) {
    return buildInlineLines(input.inlineContent);
  }

  if (input.richText) {
    const cached = richTextLineCache.get(input.richText);
    if (cached) {
      return cached;
    }
    const lines = buildRichTextLines(input.richText);
    richTextLineCache.set(input.richText, lines);
    return lines;
  }

  if (input.lines && input.lines.length > 0) {
    const lines: OverlayTextLine[] = [];
    for (const raw of input.lines) {
      for (const segment of splitOverlayTextLines(raw)) {
        lines.push(segment.length > 0 ? [{ kind: "text", text: segment }] : []);
      }
    }
    return lines;
  }

  return [[]];
}

function buildInlineLines(inlineContent: readonly InlineNode[]): OverlayTextLine[] {
  const lines: OverlayTextLine[] = [[]];
  for (const node of inlineContent) {
    appendInlineNode(lines, node);
  }
  return lines;
}

/**
 * Measurement runs inside React's render (`getShapeBounds` → `view-cache`), so throwing here blanks
 * the screen. A document that is not in canonical form — a legacy Tiptap shape, or a broken
 * proposal draft — measures as empty instead.
 */
function buildRichTextLines(document: OverlayRichTextDocument): OverlayTextLine[] {
  const blocks = Array.isArray(document.blocks) ? document.blocks : [];
  const lines: OverlayTextLine[] = [[]];
  blocks.forEach((block, index) => {
    if (index > 0) {
      lines.push([]);
    }
    for (const inline of block?.children ?? []) {
      appendInlineNode(lines, inline);
    }
  });
  return lines;
}

function appendInlineNode(lines: OverlayTextLine[], node: InlineNode | undefined): void {
  if (node?.type === "text") {
    appendText(lines, node.text ?? "");
    return;
  }
  if (node?.type === "mathInline") {
    lines[lines.length - 1].push({ kind: "math", tex: node.tex });
  }
}

/**
 * Appends text to the current line, starting a new line at every hard break. Module-private on
 * purpose: the memoized model is shared, so a caller that mutated it would poison every later
 * `getShapeBounds` for that document with no way to invalidate.
 */
function appendText(lines: OverlayTextLine[], text: string): void {
  const segments = splitOverlayTextLines(text);
  segments.forEach((segment, index) => {
    if (index > 0) {
      lines.push([]);
    }
    if (segment.length > 0) {
      lines[lines.length - 1].push({ kind: "text", text: segment });
    }
  });
}

/**
 * Lines a rich-text document occupies: one per block plus one per `\n`.
 *
 * Deliberately **not** derived from `createOverlayTextLineModel`. The estimator's line model treats
 * a lone `\r` as a break (see `splitOverlayTextLines`) while the React renderer
 * (`rich-text-dom.ts`'s text splitter) and `features/document`'s normalization split on `\n` only.
 * That difference predates this module; making the count follow the model would have changed the
 * stored height of any shape containing a `\r`, so the count keeps the renderer's rule and
 * `overlay-text-line-model.test.ts` pins it against the copy in `features/document`.
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
