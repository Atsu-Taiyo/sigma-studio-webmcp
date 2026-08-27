import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OverlayRichTextPreview } from "./OverlayRichTextPreview";

describe("OverlayRichTextPreview", () => {
  it("renders boxed semantic text and math through the shared InlineContent path", () => {
    const html = renderToStaticMarkup(
      <OverlayRichTextPreview
        keyPrefix="overlay-preview"
        node={{
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
        }}
      />,
    );

    expect(html).toContain("rich-inline-content");
    expect(html).toContain("boxed-text");
    expect(html).toContain("boxed-inline-math");
    expect(html).toContain('data-sigma-doc-boxed-padding-y="2"');
    expect(html).toContain('data-sigma-doc-boxed-variant="double"');
    expect(html).toContain('data-boxed-run-id="overlay-preview-0-boxed-run-0"');
    expect(html).toContain('data-id="m_overlay"');
  });

  it("renders semantic headings, newlines, and inline styles", () => {
    const html = renderToStaticMarkup(
      <OverlayRichTextPreview
        node={{
          blocks: [{
            type: "heading",
            level: 1,
            align: "center",
            children: [{
              type: "text",
              text: "見出し\n続き",
              color: "#cc0000",
              backgroundColor: "#ffeeaa",
            }],
          }],
        }}
      />,
    );

    expect(html).toContain('<h1 style="text-align:center">');
    expect(html).toContain("color:#cc0000");
    expect(html).toContain("background-color:#ffeeaa");
    expect(html).toContain("見出し");
    expect(html).toContain("続き");
  });

  // An empty `<p>` has no line box, so a blank line the author typed into overlay text used to be
  // 16px tall while the Tiptap editor was focused (ProseMirror pads it with a trailing `<br>`) and
  // 0px the moment it blurred — the surrounding lines visibly reflowed on focus change.
  it("keeps a line box for blank blocks so display matches the focused editor", () => {
    const html = renderToStaticMarkup(
      <OverlayRichTextPreview
        keyPrefix="overlay-blank"
        node={{
          blocks: [
            { type: "paragraph", children: [{ type: "text", text: "うえ" }] },
            { type: "paragraph", children: [] },
            { type: "paragraph", children: [{ type: "text", text: "" }] },
            { type: "paragraph", children: [{ type: "text", text: "した" }] },
          ],
        }}
      />,
    );

    // Both blank blocks (no children at all, and a single empty text run) get the placeholder.
    expect(html.match(/<p><br\/><\/p>/g)).toHaveLength(2);
    expect(html.indexOf("うえ")).toBeLessThan(html.indexOf("<p><br/></p>"));
    expect(html.lastIndexOf("<p><br/></p>")).toBeLessThan(html.indexOf("した"));
  });

  it("does not replace content that only looks empty", () => {
    const html = renderToStaticMarkup(
      <OverlayRichTextPreview
        keyPrefix="overlay-not-blank"
        node={{
          blocks: [
            { type: "paragraph", children: [{ type: "text", text: " " }] },
            { type: "paragraph", children: [{ type: "text", text: "\n" }] },
            {
              type: "paragraph",
              children: [{ type: "mathInline", id: "m_blank", tex: "", display: "inline" }],
            },
          ],
        }}
      />,
    );

    expect(html).not.toContain("<p><br/></p>");
    expect(html).toContain('data-id="m_blank"');
  });
});
