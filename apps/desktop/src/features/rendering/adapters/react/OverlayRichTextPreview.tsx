"use client";

import { useMemo, type CSSProperties } from "react";

import {
  type MathFractionSizing,
  type OverlayRichTextDocument,
} from "@/features/document";
import {
  buildOverlayRichTextBlocksDom,
  type OverlayRichTextBlockDom,
} from "@/features/rendering/adapters";

import { InlineContent } from "./InlineContent";

export interface OverlayRichTextPreviewProps {
  node: OverlayRichTextDocument;
  keyPrefix?: string;
  mathFractionSizing?: MathFractionSizing | null;
}

/**
 * Static React rendering of overlay rich text.
 *
 * Both this and the HTML string serializer (`rich-text-html.ts`) walk the block descriptions
 * `buildOverlayRichTextBlocksDom` derives from the shared render model, so the editor/PDF surface
 * and the exported SVG cannot drift apart — `rich-text-parity.test.tsx` compares them literally.
 */
export function OverlayRichTextPreview({
  node,
  // Same default as `createOverlayRichTextRenderModel`, so a caller that passes nothing still
  // lands on the ids the HTML serializer produces.
  keyPrefix = "overlay",
  mathFractionSizing,
}: OverlayRichTextPreviewProps) {
  // Overlay text re-renders on every keystroke in the surrounding document; deriving the model
  // once per document identity keeps that off the typing path.
  const blocks = useMemo(
    () => buildOverlayRichTextBlocksDom(node, { runIdPrefix: keyPrefix }),
    [keyPrefix, node],
  );

  return <>{blocks.map((block) => renderOverlayRichTextBlock(block, mathFractionSizing))}</>;
}

function renderOverlayRichTextBlock(
  block: OverlayRichTextBlockDom,
  mathFractionSizing?: MathFractionSizing | null,
) {
  // A block with no visible inline content still occupies one line while the Tiptap editor is
  // focused, because ProseMirror pads every empty textblock with `<br class="ProseMirror-
  // trailingBreak">`. Without an equivalent placeholder here the same blank line renders at 0px
  // once the editor unmounts, so overlay text visibly reflows (行間が変わる) the moment it loses
  // focus. `getOverlayRichTextLineCount` already counts a blank block as one line, so the line
  // box is what both the measurement model and the editor agree on.
  const content = block.isBlank
    ? <br />
    : (
        <InlineContent
          nodes={block.inlineNodes}
          keyPrefix={block.key}
          mathFractionSizing={mathFractionSizing}
        />
      );
  const style = toReactStyle(block.style);
  const Tag = block.tag;
  return <Tag key={block.key} style={style}>{content}</Tag>;
}

function toReactStyle(style: Record<string, string> | undefined): CSSProperties | undefined {
  if (!style) {
    return undefined;
  }
  const cssStyle: Record<string, string> = {};
  for (const [property, value] of Object.entries(style)) {
    cssStyle[property.startsWith("--") ? property : property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  }
  return cssStyle as CSSProperties;
}
