import type {
  OverlayRichTextBlock,
  OverlayRichTextDocument,
} from "@/features/document";

import {
  createInlineNodesRenderModel,
  type RichTextRenderFragment,
} from "./rich-text-render-model";

export interface OverlayRichTextRenderModelOptions {
  /**
   * Prefix for the per-block boxed-run ids. Each renderer keys its own DOM off this, so passing
   * the same value to both is what makes their output comparable.
   */
  runIdPrefix?: string;
}

/**
 * Per-(document, runIdPrefix) memo. Every overlay text shape re-derives this model on each render
 * of the surrounding document — the React preview, the SVG export, and the measurement path all
 * ask for the same thing. Rich text documents are immutable snapshots in the overlay model, so
 * keying on object identity gets a high hit rate with no invalidation logic (same reasoning as
 * `overlay-text-box.ts`'s size cache).
 */
const modelCache = new WeakMap<OverlayRichTextDocument, Map<string, RichTextRenderFragment>>();

/** Converts canonical SigmaDoc overlay rich text into the shared render model. */
export function createOverlayRichTextRenderModel(
  document: OverlayRichTextDocument,
  options: OverlayRichTextRenderModelOptions = {},
): RichTextRenderFragment {
  const runIdPrefix = options.runIdPrefix ?? "overlay";
  let cached = modelCache.get(document);
  if (!cached) {
    cached = new Map();
    modelCache.set(document, cached);
  }
  const hit = cached.get(runIdPrefix);
  if (hit) {
    return hit;
  }

  const model = buildOverlayRichTextRenderModel(document, runIdPrefix);
  cached.set(runIdPrefix, model);
  return model;
}

function buildOverlayRichTextRenderModel(
  document: OverlayRichTextDocument,
  runIdPrefix: string,
): RichTextRenderFragment {
  return {
    kind: "fragment",
    children: document.blocks.map((block, index) => ({
      kind: "block",
      blockType: block.type,
      headingLevel: block.type === "heading" ? block.level : undefined,
      isBlank: overlayRichTextBlockIsBlank(block),
      textAlign: block.align,
      lineHeight: normalizeOverlayLineHeight(block.lineHeight),
      children: createInlineNodesRenderModel(block.children, {
        annotateBoxedRuns: true,
        runIdPrefix: `${runIdPrefix}-${index}`,
      }).children,
    })),
  };
}

/**
 * True when a block carries no inline content that can draw a glyph, so a static renderer has to
 * emit an explicit line-box placeholder for it. The Tiptap editor gets this for free from
 * ProseMirror's trailing `<br>`; static output that skips it collapses the blank line to 0px and
 * makes the overlay reflow between the editing and display states.
 */
export function overlayRichTextBlockIsBlank(block: OverlayRichTextBlock): boolean {
  return block.children.every((child) => child.type === "text" && child.text.length === 0);
}

export function normalizeOverlayLineHeight(value: unknown): string | undefined {
  const text = typeof value === "number"
    ? String(value)
    : String(value ?? "").trim();
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/u.test(text)) {
    return undefined;
  }

  const number = Number(text);
  if (!Number.isFinite(number) || number < 0.8 || number > 3) {
    return undefined;
  }

  return number.toFixed(2).replace(/\.?0+$/u, "");
}
