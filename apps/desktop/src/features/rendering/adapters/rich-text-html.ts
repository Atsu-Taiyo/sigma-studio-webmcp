import type { OverlayRichTextDocument } from "@/features/document";
import { inlineMathBodyClassName } from "./inline-math-frame";
import { isSafeCssDeclarationValue } from "@/features/document/css-safety";
import { createOverlayRichTextRenderModel } from "@/features/rendering/core";

import {
  buildOverlayBlockInlineDom,
  buildOverlayRichTextBlocksDom,
  mergeStyles,
  type RichTextDomNode,
  type RichTextDomStyle,
} from "./rich-text-dom";

interface RichTextHtmlOptions {
  renderMathHtml: (tex: string) => string;
}

interface OverlayRichTextHtmlOptions extends RichTextHtmlOptions {
  /** Must match the React renderer's `keyPrefix` for the two DOM outputs to be comparable. */
  runIdPrefix?: string;
  /**
   * Repeat the styling that `document-surface.css` would have supplied as inline declarations.
   * The exported SVG carries no stylesheet, so its `<foreignObject>` markup has to stand alone.
   * Inside the app the same markup takes its styling from CSS, which is what lets boxed variants,
   * tones, and the boxed-run height targets keep working.
   */
  selfContained?: boolean;
}

export { createOverlayRichTextRenderModel };

/**
 * Overlay rich text as an HTML string, walking the same DOM description the React renderer mounts
 * (`rich-text-dom.ts`). `rich-text-parity.test.tsx` compares the two outputs literally.
 */
export function renderOverlayRichTextHtml(
  node: OverlayRichTextDocument,
  options: OverlayRichTextHtmlOptions,
): string {
  return buildOverlayRichTextBlocksDom(node, { runIdPrefix: options.runIdPrefix })
    .map((block) => {
      const style = options.selfContained
        ? mergeStyles(block.selfContainedStyle, block.style)
        : block.style;
      const children = block.isBlank
        ? "<br/>"
        : serializeDomNode({
            kind: "element",
            tag: "span",
            className: "rich-inline-content",
            key: block.key,
            children: buildOverlayBlockInlineDom(block),
          }, options);
      return `<${block.tag}${styleAttribute(style)}>${children}</${block.tag}>`;
    })
    .join("");
}

/** Compatibility aliases for callers that still use the former Tiptap-oriented names. */
export const createTiptapRichTextRenderModel = createOverlayRichTextRenderModel;
export const renderTiptapRichTextHtml = renderOverlayRichTextHtml;

function serializeDomNode(node: RichTextDomNode, options: OverlayRichTextHtmlOptions): string {
  if (node.kind === "text") {
    return escapeHtml(node.text);
  }
  if (node.kind === "lineBreak") {
    return "<br/>";
  }
  if (node.kind === "mathBody") {
    return [
      `<span class="${inlineMathBodyClassName()}" data-empty="${node.tex ? "false" : "true"}">`,
      options.renderMathHtml(node.tex),
      "</span>",
    ].join("");
  }

  const style = options.selfContained
    ? mergeStyles(node.selfContainedStyle, node.style)
    : node.style;
  const className = node.className ? ` class="${escapeHtmlAttribute(node.className)}"` : "";
  const children = node.children.map((child) => serializeDomNode(child, options)).join("");
  return `<${node.tag}${className}${attributes(node.attrs)}${styleAttribute(style)}>${children}</${node.tag}>`;
}

function attributes(attrs: Record<string, string> | undefined): string {
  if (!attrs) {
    return "";
  }
  return Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeHtmlAttribute(value)}"`)
    .join("");
}

function styleAttribute(style: RichTextDomStyle | undefined): string {
  if (!style) {
    return "";
  }
  // `escapeHtmlAttribute` only guards the HTML attribute; `;` and `:` pass through it untouched,
  // so a document-supplied value would otherwise be free to append declarations of its own. The
  // check is per value (not per color) because composite values such as `1px solid <color>` embed
  // the document string, and it deliberately allows `calc(...)`, which the renderers emit.
  const declarations = Object.entries(style)
    .filter(([, value]) => isSafeCssDeclarationValue(value))
    .map(([property, value]) => `${property}:${value}`)
    .join(";");
  return declarations ? ` style="${escapeHtmlAttribute(declarations)}"` : "";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
