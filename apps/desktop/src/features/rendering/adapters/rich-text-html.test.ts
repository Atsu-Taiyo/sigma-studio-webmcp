import { describe, expect, it } from "vitest";

import type { OverlayRichTextDocument } from "@/features/document";

import {
  createOverlayRichTextRenderModel,
  createTiptapRichTextRenderModel,
  renderOverlayRichTextHtml,
  renderTiptapRichTextHtml,
} from "./rich-text-html";

const deterministicMath = (tex: string) => `<math>${tex}</math>`;

describe("rich text HTML rendering", () => {
  it("renders semantic overlay text, math, formatting, and boxed runs", () => {
    const document: OverlayRichTextDocument = {
      blocks: [
        {
          type: "paragraph",
          lineHeight: "1.8",
          align: "center",
          children: [
            {
              type: "text",
              text: "A<&",
              marks: ["bold", "italic", "underline", "boxed"],
              backgroundColor: "#fff000",
              color: "#123456",
              fontFamily: '"Yu Mincho", serif',
              fontSize: 12.5,
              boxedPaddingY: 2,
              boxedTone: "blue",
              boxedVariant: "double",
            },
            { type: "text", text: "\u200B" },
            {
              type: "mathInline",
              id: 'm"1',
              tex: "x<y",
              display: "inline",
              marks: ["underline", "boxed"],
              backgroundColor: "#abc",
              fontFamily: '"Math"',
              fontSize: 13.25,
              boxedPaddingY: 2,
              boxedTone: "blue",
              boxedVariant: "double",
            },
            { type: "text", text: "\ntail\nnext", marks: ["underline"] },
          ],
        },
        {
          type: "heading",
          level: 1,
          align: "right",
          children: [{ type: "text", text: "見出し" }],
        },
      ],
    };

    const html = renderOverlayRichTextHtml(document, { renderMathHtml: deterministicMath });
    expect(html).toContain('<p style="text-align:center;line-height:1.8">');
    expect(html).toContain('<span class="rich-inline-content">');
    expect(html).toContain("A&lt;&amp;");
    expect(html).toContain("background-color:#fff000");
    expect(html).toContain('data-id="m&quot;1"');
    // Boxed styling comes from `.boxed-text` + its data attributes inside the app; the Tiptap
    // mark emits the very same element (see `inline-dom-parity.test.tsx`).
    expect(html).toContain('class="boxed-text"');
    expect(html).toContain('data-sigma-doc-boxed-variant="double"');
    expect(html).not.toContain("border:1px solid currentColor");
    // `\n` becomes a real line break that closes the mark spans and reopens them after it —
    // exactly how ProseMirror stores a mark-less `hardBreak` between two marked text nodes.
    expect(html).toContain(
      '<br/><span class="sigma-underline-run" data-sigma-doc-underline-text="true">tail</span>'
      + '<br/><span class="sigma-underline-run" data-sigma-doc-underline-text="true">next</span>',
    );
    // The heading level used to be dropped and every heading came out as `<h3>`.
    expect(html).toContain('<h1 style="text-align:right">');
  });

  // The exported SVG is viewed without the app stylesheet, so the same DOM has to carry the
  // styling `document-surface.css` would otherwise supply.
  it("inlines the document-surface styling when the output must stand alone", () => {
    const document: OverlayRichTextDocument = {
      blocks: [{
        type: "paragraph",
        align: "center",
        children: [
          { type: "text", text: "枠", marks: ["boxed", "underline"], boxedPaddingY: 2 },
          { type: "mathInline", id: "m_self", tex: "x", display: "inline" },
        ],
      }],
    };

    const html = renderOverlayRichTextHtml(document, {
      renderMathHtml: deterministicMath,
      selfContained: true,
    });

    expect(html).toContain('<p style="margin:0;text-align:center">');
    // The boxed frame is inlined the way the stylesheet writes it — reading the custom properties
    // with a fallback, so a variant/tone attribute still wins wherever the stylesheet is present.
    expect(html).toContain("border:var(--boxed-text-border-width, 1px) var(--boxed-text-border-style, solid) var(--boxed-text-border-color, currentColor)");
    expect(html).toContain("--boxed-text-padding-y:2px");
    expect(html).toContain("text-decoration-line:underline");
    expect(html).toContain('class="inline-math-node"');
    expect(html).toContain("margin:0");
    // The classes stay on the markup as well, so the same string renders correctly in the app.
    expect(html).toContain('class="boxed-text"');
  });

  it("keeps the former Tiptap-oriented API names as thin compatibility aliases", () => {
    const document: OverlayRichTextDocument = {
      blocks: [{ type: "paragraph", children: [{ type: "text", text: "互換" }] }],
    };

    expect(createTiptapRichTextRenderModel(document)).toEqual(createOverlayRichTextRenderModel(document));
    expect(renderTiptapRichTextHtml(document, { renderMathHtml: deterministicMath }))
      .toBe(renderOverlayRichTextHtml(document, { renderMathHtml: deterministicMath }));
  });

  // Print/PDF/SVG go through this serializer, so a blank line has to survive here too — an empty
  // `<p>` draws no line box and would drop the author's blank line from the output entirely.
  it("gives blank blocks a line box so print keeps the author's blank lines", () => {
    const document: OverlayRichTextDocument = {
      blocks: [
        { type: "paragraph", children: [{ type: "text", text: "うえ" }] },
        { type: "paragraph", children: [] },
        { type: "paragraph", children: [{ type: "text", text: "した" }] },
      ],
    };

    const html = renderOverlayRichTextHtml(document, { renderMathHtml: deterministicMath });

    expect(html).toBe(
      '<p><span class="rich-inline-content">うえ</span></p>' +
      "<p><br/></p>" +
      '<p><span class="rich-inline-content">した</span></p>',
    );
  });
});
