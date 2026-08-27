import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OverlayRichTextDocument } from "@/features/document";
import { OverlayRichTextPreview } from "@/features/rendering/adapters/react";

import {
  inlineMathNodeClassName,
  inlineMathNodeDataAttributes,
} from "@/features/rendering/adapters/react";

import { DEFAULT_MATH_RENDER_ENVIRONMENT } from "@/lib/math-environment";

import { renderMathHtml as renderMathHtmlWithEnvironment } from "./math-html";
import { buildOverlayBlockInlineDom, buildOverlayRichTextBlocksDom } from "./rich-text-dom";
import { renderOverlayRichTextHtml } from "./rich-text-html";

/**
 * Overlay rich text has two static renderers: the React one the editor/PDF surface mounts, and the
 * HTML string one `overlay-svg.ts` embeds in a `<foreignObject>`. They used to be two independent
 * implementations of the same model, and they had silently drifted — headings collapsed to `<h3>`,
 * `\n` vanished, blank blocks disagreed, boxed metadata was missing.
 *
 * Both now project the same DOM description, so the outputs are compared literally: tags, classes,
 * attributes, inline styles, and text. There is deliberately no allow list — a difference here is a
 * bug in one of the two adapters, not something to register.
 *
 * The SVG export additionally needs the markup to stand on its own without a stylesheet; that is a
 * separate, opt-in `selfContained` projection covered by `svg-export.test.ts`, not a divergence in
 * the shared DOM.
 */

const KEY_PREFIX = "overlay";

interface NormalizedNode {
  attrs?: Record<string, string>;
  children?: NormalizedNode[];
  style?: Record<string, string>;
  tag?: string;
  text?: string;
}

interface DomLikeNode {
  childNodes: ArrayLike<DomLikeNode>;
  getAttribute?: (name: string) => null | string;
  getAttributeNames?: () => string[];
  nodeType: number;
  tagName?: string;
  textContent: null | string;
}

function normalizeDom(html: string): NormalizedNode[] {
  const window = new Window();
  const container = window.document.createElement("div");
  container.innerHTML = html;
  const nodes = Array.from(container.childNodes as unknown as ArrayLike<DomLikeNode>).map(normalizeNode);
  window.close();
  return nodes;
}

function normalizeNode(node: DomLikeNode): NormalizedNode {
  if (node.nodeType === 3) {
    return { text: node.textContent ?? "" };
  }
  const element = node as Required<DomLikeNode>;
  const attrs: Record<string, string> = {};
  let style: Record<string, string> | undefined;
  for (const name of element.getAttributeNames().sort()) {
    const value = element.getAttribute(name) ?? "";
    if (name === "style") {
      style = parseStyle(value);
      continue;
    }
    attrs[name] = value;
  }
  return {
    tag: element.tagName.toLowerCase(),
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(style && Object.keys(style).length > 0 ? { style } : {}),
    children: Array.from(element.childNodes).map(normalizeNode),
  };
}

function parseStyle(value: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const declaration of value.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) {
      continue;
    }
    const property = declaration.slice(0, separator).trim();
    const propertyValue = declaration.slice(separator + 1).trim();
    if (property) {
      declarations[property] = propertyValue;
    }
  }
  return Object.fromEntries(Object.entries(declarations).sort(([a], [b]) => a.localeCompare(b)));
}

const CORPUS: Array<{ document: OverlayRichTextDocument; name: string }> = [
  {
    name: "plain paragraph",
    document: { blocks: [{ type: "paragraph", children: [{ type: "text", text: "ふつうの段落" }] }] },
  },
  {
    name: "heading levels 1/2/3",
    document: {
      blocks: [
        { type: "heading", level: 1, children: [{ type: "text", text: "見出し1" }] },
        { type: "heading", level: 2, children: [{ type: "text", text: "見出し2" }] },
        { type: "heading", level: 3, children: [{ type: "text", text: "見出し3" }] },
      ],
    },
  },
  {
    name: "align and lineHeight",
    document: {
      blocks: [
        { type: "paragraph", align: "center", lineHeight: "1.8", children: [{ type: "text", text: "中央" }] },
        { type: "paragraph", align: "right", lineHeight: "1.80", children: [{ type: "text", text: "右" }] },
        { type: "heading", level: 1, align: "justify", children: [{ type: "text", text: "両端" }] },
      ],
    },
  },
  {
    name: "blank blocks",
    document: {
      blocks: [
        { type: "paragraph", children: [{ type: "text", text: "うえ" }] },
        { type: "paragraph", children: [] },
        { type: "paragraph", children: [{ type: "text", text: "" }] },
        { type: "paragraph", children: [{ type: "text", text: "", color: "#f00" }] },
        { type: "paragraph", children: [{ type: "text", text: "した" }] },
      ],
    },
  },
  {
    name: "blocks that only look blank",
    document: {
      blocks: [
        { type: "paragraph", children: [{ type: "text", text: " " }] },
        { type: "paragraph", children: [{ type: "text", text: "\n" }] },
        { type: "paragraph", children: [{ type: "mathInline", id: "m_blank", tex: "", display: "inline" }] },
      ],
    },
  },
  {
    name: "line breaks inside text",
    document: {
      blocks: [{
        type: "paragraph",
        children: [
          { type: "text", text: "いち\nに\nさん" },
          { type: "text", text: "\n" },
          { type: "text", text: "よん\n" },
        ],
      }],
    },
  },
  {
    name: "inline styles",
    document: {
      blocks: [{
        type: "paragraph",
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
  },
  {
    name: "bold italic underline",
    document: {
      blocks: [{
        type: "paragraph",
        children: [
          { type: "text", text: "太字", marks: ["bold"] },
          { type: "text", text: "斜体", marks: ["italic"] },
          { type: "text", text: "下線", marks: ["underline"] },
          { type: "text", text: "全部", marks: ["bold", "italic", "underline"] },
        ],
      }],
    },
  },
  {
    name: "consecutive underline run",
    document: {
      blocks: [{
        type: "paragraph",
        children: [
          { type: "text", text: "ここから", marks: ["underline"] },
          { type: "mathInline", id: "m_u", tex: "x^2", display: "inline", marks: ["underline"] },
          { type: "text", text: "ここまで", marks: ["underline"] },
          { type: "text", text: "そと" },
        ],
      }],
    },
  },
  {
    name: "underline run interrupted by a line break",
    document: {
      blocks: [{
        type: "paragraph",
        children: [
          { type: "text", text: "まえ", marks: ["underline"] },
          { type: "text", text: "改\n行", marks: ["underline"] },
          { type: "text", text: "あと", marks: ["underline"] },
        ],
      }],
    },
  },
  {
    name: "inline math",
    document: {
      blocks: [{
        type: "paragraph",
        children: [
          { type: "text", text: "式は" },
          { type: "mathInline", id: "m_1", tex: "\\frac{1}{2}", display: "inline" },
          { type: "text", text: "です" },
        ],
      }],
    },
  },
  {
    name: "styled inline math",
    document: {
      blocks: [{
        type: "paragraph",
        children: [{
          type: "mathInline",
          id: "m_styled",
          tex: "a+b",
          display: "inline",
          color: "#0000ff",
          backgroundColor: "#eeeeee",
          fontSize: 13.25,
        }],
      }],
    },
  },
  {
    name: "boxed run of text + math + text",
    document: {
      blocks: [{
        type: "paragraph",
        lineHeight: "1.8",
        children: [
          { type: "text", text: "辺", marks: ["boxed"], boxedPaddingY: 2, boxedVariant: "double" },
          {
            type: "mathInline",
            id: "m_overlay",
            tex: "\\sum_{k=1}^{n} k",
            display: "inline",
            marks: ["boxed"],
            boxedPaddingY: 2,
            boxedVariant: "double",
          },
          { type: "text", text: "は", marks: ["boxed"], boxedPaddingY: 2, boxedVariant: "double" },
        ],
      }],
    },
  },
  {
    name: "boxed variants and tones",
    document: {
      blocks: [{
        type: "paragraph",
        children: [
          { type: "text", text: "太枠", marks: ["boxed"], boxedVariant: "thick" },
          { type: "text", text: "そと" },
          { type: "text", text: "楕円", marks: ["boxed"], boxedVariant: "oval", boxedTone: "blue" },
          { type: "text", text: "そと2" },
          { type: "text", text: "網掛", marks: ["boxed"], boxedVariant: "shade", boxedTone: "gray", boxedPaddingY: 3 },
        ],
      }],
    },
  },
  {
    name: "boxed plus underline plus style",
    document: {
      blocks: [{
        type: "paragraph",
        children: [{
          type: "text",
          text: "A<&\"",
          marks: ["bold", "italic", "underline", "boxed"],
          backgroundColor: "#fff000",
          color: "#123456",
          fontFamily: '"Yu Mincho", serif',
          fontSize: 12.5,
          boxedPaddingY: 2,
          boxedTone: "blue",
          boxedVariant: "double",
        }],
      }],
    },
  },
  {
    name: "underline run of text only",
    document: {
      blocks: [{
        type: "paragraph",
        children: [
          { type: "text", text: "ここから", marks: ["underline"] },
          { type: "text", text: "ここまで", marks: ["underline"] },
        ],
      }],
    },
  },
  {
    name: "empty and zero style values",
    document: {
      blocks: [{
        type: "paragraph",
        children: [
          { type: "text", text: "空色", color: "", backgroundColor: "" },
          { type: "text", text: "ゼロ", fontSize: 0, fontFamily: "" },
        ],
      }],
    },
  },
  {
    name: "escaping and zero-width characters",
    document: {
      blocks: [{
        type: "paragraph",
        children: [
          { type: "text", text: "A<&>\"'" },
          { type: "text", text: "​" },
          { type: "mathInline", id: 'm"quote', tex: "x<y", display: "inline" },
        ],
      }],
    },
  },
];

/** `OverlayRichTextPreview` は context の既定環境で描くので、文字列側も同じ環境で束ねる。 */
const renderMathHtml = (tex: string) => renderMathHtmlWithEnvironment(tex, DEFAULT_MATH_RENDER_ENVIRONMENT);

describe("overlay rich text renderers agree", () => {
  for (const { document, name } of CORPUS) {
    it(`produces the same DOM for ${name}`, () => {
      const react = renderToStaticMarkup(
        <OverlayRichTextPreview keyPrefix={KEY_PREFIX} node={document} />,
      );
      const html = renderOverlayRichTextHtml(document, { renderMathHtml, runIdPrefix: KEY_PREFIX });

      expect(normalizeDom(html)).toEqual(normalizeDom(react));
    });
  }
});

function stripStyles(nodes: NormalizedNode[]): NormalizedNode[] {
  return nodes.map((node) => {
    const stripped: NormalizedNode = { ...node };
    delete stripped.style;
    if (node.children) {
      stripped.children = stripStyles(node.children);
    }
    return stripped;
  });
}

describe("the self-contained projection only adds styling", () => {
  for (const { document, name } of CORPUS) {
    it(`keeps the same DOM for ${name}`, () => {
      const shared = renderOverlayRichTextHtml(document, { renderMathHtml, runIdPrefix: KEY_PREFIX });
      const selfContained = renderOverlayRichTextHtml(document, {
        renderMathHtml,
        runIdPrefix: KEY_PREFIX,
        selfContained: true,
      });

      // The exported SVG has no stylesheet, so it inlines what CSS would have supplied — but it
      // must never reach a different DOM, or the two surfaces start drifting again.
      expect(stripStyles(normalizeDom(selfContained))).toEqual(stripStyles(normalizeDom(shared)));
    });
  }
});

describe("the shared math frame matches the React math contract", () => {
  it("uses the class and data attributes InlineMathPreview publishes", () => {
    const [block] = buildOverlayRichTextBlocksDom({
      blocks: [{
        type: "paragraph",
        children: [{ type: "mathInline", id: "m_contract", tex: "x^2", display: "inline" }],
      }],
    });
    // Unstyled inline content gets no wrapper span of its own: ProseMirror emits the bare node
    // too, and an extra span on only one of the two surfaces is a difference in the DOM.
    const [frame] = buildOverlayBlockInlineDom(block);

    expect(frame?.kind).toBe("element");
    if (frame?.kind !== "element") {
      return;
    }
    expect(frame.className).toBe(inlineMathNodeClassName());
    expect(frame.attrs).toEqual(inlineMathNodeDataAttributes({ id: "m_contract", tex: "x^2" }));
  });
});

describe("the renderers agree on their defaults", () => {
  it("produces the same DOM without an explicit prefix", () => {
    const document: OverlayRichTextDocument = {
      blocks: [{
        type: "paragraph",
        children: [{ type: "text", text: "枠", marks: ["boxed"], boxedPaddingY: 1 }],
      }],
    };

    const react = renderToStaticMarkup(<OverlayRichTextPreview node={document} />);
    const html = renderOverlayRichTextHtml(document, { renderMathHtml });

    expect(normalizeDom(html)).toEqual(normalizeDom(react));
    expect(html).toContain('data-boxed-run-id="overlay-0-boxed-run-0"');
  });
});

describe("the self-contained underline mirrors the stylesheet", () => {
  // The exported SVG is injected back into the app (PrintPreview / running regions / page canvas /
  // material preview), where `document-surface.css` applies as well. Inlining the wrong branch
  // painted a text-decoration underline *and* the run's bottom border on the same element.
  const underlineRunStyle = (children: OverlayRichTextDocument["blocks"][number]["children"]) => {
    const html = renderOverlayRichTextHtml(
      { blocks: [{ type: "paragraph", children }] },
      { renderMathHtml, selfContained: true },
    );
    const [paragraph] = normalizeDom(html);
    const run = paragraph.children?.[0]?.children?.[0];
    return run?.style ?? {};
  };

  it("uses text-decoration for a text-only run", () => {
    const style = underlineRunStyle([
      { type: "text", text: "あ", marks: ["underline"] },
      { type: "text", text: "い", marks: ["underline"] },
    ]);

    expect(style["text-decoration-line"]).toBe("underline");
    expect(style["border-bottom"]).toBeUndefined();
  });

  it("uses a bottom border for a run that contains math", () => {
    const style = underlineRunStyle([
      { type: "text", text: "あ", marks: ["underline"] },
      { type: "mathInline", id: "m_u", tex: "x", display: "inline", marks: ["underline"] },
    ]);

    expect(style["border-bottom"]).toBe("1.25px solid currentColor");
    expect(style["text-decoration"]).toBe("none");
    expect(style["text-decoration-line"]).toBeUndefined();
  });
});
