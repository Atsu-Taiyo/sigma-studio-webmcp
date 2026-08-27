import { describe, expect, it } from "vitest";

import type { OverlayRichTextDocument } from "@/features/document";

import { cssTextFromDeclarations } from "./boxed-inline-dom";
import { renderOverlayRichTextHtml } from "./rich-text-html";

/**
 * The string serializers get their own defence, independent of the document normalization boundary.
 * This matters for reasons that are not symmetric with `overlay-snapshot.ts`:
 *
 * - Body (non-overlay) inline nodes never pass through overlay normalization at all — the schema
 *   keeps their `color` / `backgroundColor` / `fontFamily` as plain `z.string().optional()`, and
 *   Tiptap's `renderHTML` reaches the DOM through `cssTextFromDeclarations`.
 * - Composite declaration values (`1px solid <color>`) embed a document string inside a larger
 *   value, so a color-shaped check cannot see them.
 *
 * Every case below therefore feeds the serializer directly, with no normalization in front.
 */
const INJECTED =
  "red;position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff;z-index:2147483647";

const options = { renderMathHtml: (tex: string) => `<span data-math="${tex}"></span>` };

function styledDocument(style: Record<string, string>): OverlayRichTextDocument {
  return {
    blocks: [{
      type: "paragraph",
      children: [{ type: "text", text: "式", ...style }],
    }],
  } as OverlayRichTextDocument;
}

/** Every `style="…"` value, split into individual declarations (HTML entities decoded). */
function styleDeclarations(html: string): string[] {
  return [...html.matchAll(/style="([^"]*)"/g)]
    .flatMap((match) => match[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&").split(";"))
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.length > 0);
}

describe("rich text HTML serializer CSS injection", () => {
  it("drops an inline color that would append declarations", () => {
    const html = renderOverlayRichTextHtml(styledDocument({ color: INJECTED }), options);

    expect(html).not.toContain("position:fixed");
    expect(html).not.toContain("z-index");
    expect(styleDeclarations(html).filter((declaration) => declaration.startsWith("color:"))).toEqual([]);
  });

  it("drops an inline backgroundColor and fontFamily that would close the rule", () => {
    const html = renderOverlayRichTextHtml(
      styledDocument({ backgroundColor: INJECTED, fontFamily: "serif;}html{display:none" }),
      options,
    );

    expect(html).not.toContain("position:fixed");
    expect(html).not.toContain("display:none");
    expect(styleDeclarations(html)).toEqual([]);
  });

  it("keeps the inline styling the settings UI produces", () => {
    const html = renderOverlayRichTextHtml(
      styledDocument({
        color: "#1f2937",
        backgroundColor: "rgb(255, 255, 0)",
        fontFamily: "KaTeX_Main, \"M PLUS 1p\", serif",
      }),
      options,
    );

    expect(styleDeclarations(html)).toEqual([
      "color:#1f2937",
      "background-color:rgb(255, 255, 0)",
      "font-family:KaTeX_Main, \"M PLUS 1p\", serif",
      "--sigma-math-text-font-family:KaTeX_Main, \"M PLUS 1p\", serif",
    ]);
  });
});

describe("Tiptap style attribute CSS injection", () => {
  it("drops a body inline color that would append declarations", () => {
    // Body inline nodes reach ProseMirror's `renderHTML` through this helper without ever
    // touching the overlay normalization boundary.
    expect(cssTextFromDeclarations({ color: INJECTED })).toBeUndefined();
    expect(cssTextFromDeclarations({ color: INJECTED, "font-size": "10.5pt" })).toBe("font-size: 10.5pt");
  });

  it("keeps the declarations the editor legitimately emits", () => {
    expect(cssTextFromDeclarations({
      color: "#1f2937",
      "background-color": "rgb(255, 255, 0)",
      "font-family": "KaTeX_Main, \"M PLUS 1p\", serif",
      "font-size": "10.5pt",
    })).toBe(
      "color: #1f2937; background-color: rgb(255, 255, 0); font-family: KaTeX_Main, \"M PLUS 1p\", serif; font-size: 10.5pt",
    );
  });

  it("keeps composite and calc() values whole", () => {
    expect(cssTextFromDeclarations({ "border-top": "1px solid #1f2937" })).toBe("border-top: 1px solid #1f2937");
    expect(cssTextFromDeclarations({ "line-height": "calc(1.78em + 6px)" })).toBe("line-height: calc(1.78em + 6px)");
  });
});
